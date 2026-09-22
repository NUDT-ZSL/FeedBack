"""End-to-end verification against a running server on :8000."""
import hashlib
import json
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8000"
CHUNK = 64 * 1024
N = 8
DATA = bytes((i * 7 + 3) % 256 for i in range(CHUNK * N - 1000))  # 非整除尾段
TOKEN = "e2e-token-0001"


def req(method, path, body=None, headers=None, expect=200):
    r = urllib.request.Request(BASE + path, data=body, method=method,
                               headers=headers or {})
    try:
        with urllib.request.urlopen(r) as resp:
            assert resp.status == expect, (resp.status, expect)
            return json.loads(resp.read() or b"{}"), resp.status
    except urllib.error.HTTPError as e:
        if expect is None:
            return json.loads(e.read() or b"{}"), e.code
        raise


def chunk(i):
    return DATA[i * CHUNK:(i + 1) * CHUNK]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def wait_state(uid, states, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        s, _ = req("GET", f"/api/uploads/{uid}")
        if s["state"] in states:
            return s
        time.sleep(0.3)
    raise AssertionError("timeout waiting for " + str(states))


# 1. init (twice with same token -> same session, no duplicate)
s1, _ = req("POST", "/api/uploads", json.dumps({
    "filename": "big.bin", "size": len(DATA), "chunk_size": CHUNK,
    "client_token": TOKEN}).encode(), {"Content-Type": "application/json"})
s2, _ = req("POST", "/api/uploads", json.dumps({
    "filename": "big.bin", "size": len(DATA), "chunk_size": CHUNK,
    "client_token": TOKEN}).encode(), {"Content-Type": "application/json"})
uid = s1["id"]
assert s2["id"] == uid, "reconnect should resume same session"
assert s1["total_chunks"] == N
print("1 OK  init + reconnect resume, total_chunks =", N)

# 2. upload chunks 0..4, then re-PUT chunk 2 (duplicate, not billed twice)
for i in range(5):
    r, _ = req("PUT", f"/api/uploads/{uid}/chunks/{i}", chunk(i),
               {"x-chunk-sha256": sha(chunk(i))})
    assert r["status"] == "stored" and r["billed"]
r, _ = req("PUT", f"/api/uploads/{uid}/chunks/2", chunk(2),
           {"x-chunk-sha256": sha(chunk(2))})
assert r["status"] == "duplicate" and not r["billed"]
s, _ = req("GET", f"/api/uploads/{uid}")
assert s["bytes_billed"] == sum(len(chunk(i)) for i in range(5)), s["bytes_billed"]
print("2 OK  idempotent dedup, bytes_billed =", s["bytes_billed"])

# 3. corrupt chunk 5 -> 409, failed_chunks records reason; retry fixes it
_, code = req("PUT", f"/api/uploads/{uid}/chunks/5", chunk(5),
              {"x-chunk-sha256": "0" * 64}, expect=None)
assert code == 409
s, _ = req("GET", f"/api/uploads/{uid}")
assert "5" in s["failed_chunks"] and "校验和不匹配" in s["failed_chunks"]["5"]["error"]
r, _ = req("PUT", f"/api/uploads/{uid}/chunks/5", chunk(5),
           {"x-chunk-sha256": sha(chunk(5))})
assert r["status"] == "stored"
s, _ = req("GET", f"/api/uploads/{uid}")
assert "5" not in s["failed_chunks"]
print("3 OK  chunk failure reported with reason, single-chunk retry works")

# 4. finish remaining chunks -> state uploaded; convert starts
for i in (6, 7):
    req("PUT", f"/api/uploads/{uid}/chunks/{i}", chunk(i),
        {"x-chunk-sha256": sha(chunk(i))})
s, _ = req("GET", f"/api/uploads/{uid}")
assert s["state"] == "uploaded" and not s["missing_chunks"]
print("4 OK  all chunks received, state =", s["state"])

# 5. convert with fail_at=5 -> convert_failed, parts 0..4 kept; resume finishes
req("POST", f"/api/uploads/{uid}/convert?fail_at=5")
s = wait_state(uid, ["convert_failed"])
assert s["conversion"]["failed_at"] == 5 and s["conversion"]["converted_count"] == 5
assert s["conversion"]["error"]
req("POST", f"/api/uploads/{uid}/convert")
s = wait_state(uid, ["completed"])
assert s["result_ready"] and s["conversion"]["progress"] == 1.0
print("5 OK  conversion failed at 5, resumed from checkpoint, completed")

# 6. result downloadable + events log covers the whole lifecycle
r = urllib.request.urlopen(BASE + f"/api/uploads/{uid}/result")
result = r.read()
assert result[:4] == b"UFMT"
ev, _ = req("GET", f"/api/uploads/{uid}/events")
types = [e["type"] for e in ev["events"]]
for t in ("created", "session_resumed", "chunk_received", "chunk_failed",
          "all_chunks_received", "conversion_started", "conversion_failed",
          "conversion_resumed", "completed"):
    assert t in types, t
print("6 OK  result", len(result), "bytes; event types:", sorted(set(types)))
print("ALL E2E CHECKS PASSED")
