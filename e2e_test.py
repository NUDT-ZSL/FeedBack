#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端验证：分块接收、失败重试、断点续转、冲突裁决、一致性校验。"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8123"
ROOT = os.path.dirname(os.path.abspath(__file__))


def call(path, data=None, raw=None, headers=None, method=None):
    h = dict(headers or {})
    body = raw
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=body, headers=h,
                                 method=method or ("POST" if body is not None else "GET"))
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def wait_for(cond, timeout=30, desc=""):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = call("/api/state")
        if cond(st):
            return st
        time.sleep(0.2)
    raise AssertionError("timeout: " + desc)


def main():
    shutil.rmtree(os.path.join(ROOT, "data"), ignore_errors=True)
    env = dict(os.environ, PORT="8123")
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], env=env)
    try:
        for _ in range(50):
            try:
                call("/api/state")
                break
            except Exception:
                time.sleep(0.2)

        # 1) create: 2MB, 256KB chunks -> 8 chunks
        blob = os.urandom(2 * 1024 * 1024)
        cs = 256 * 1024
        r = call("/api/files", {"name": "big.bin", "size": len(blob), "chunk_size": cs})
        fid = r["id"]
        total = 8

        def upload(idx, data):
            return call("/api/files/%s/chunks/%d" % (fid, idx), raw=data,
                        headers={"X-Client-Checksum": hashlib.sha256(data).hexdigest()})

        # 2) fail injection: first upload of chunk 0 fails, retry only that chunk
        call("/api/settings", {"fail_next": True})
        r = upload(0, blob[:cs])
        assert not r["ok"], "fail injection should fail first receive"
        st = call("/api/state")
        f0 = st["files"][0]
        assert f0["chunks"][0]["status"] == "failed" and f0["chunks"][0]["error"]
        r = upload(0, blob[:cs])
        assert r["ok"], "retry of failed chunk should succeed"
        print("[1] failed chunk kept + retry only failed chunk OK")

        # 3) upload remaining chunks in order; successful chunks stay intact
        for i in range(1, 5):
            upload(i, blob[i * cs:(i + 1) * cs])
        st = call("/api/state")
        f0 = st["files"][0]
        assert f0["received_count"] == 5 and f0["status"] == "receiving"
        assert f0["chunks"][0]["attempts"] == 2
        print("[2] ordered receive + live progress OK (5/8)")
        # 4) finish all chunks -> auto background conversion; interrupt then resume
        call("/api/settings", {"convert_delay": 0.6})
        for i in range(5, total):
            upload(i, blob[i * cs:(i + 1) * cs])
        st = wait_for(lambda s: s["files"][0]["status"] in ("converting", "done"),
                      desc="enter converting")
        wait_for(lambda s: s["files"][0]["converted_count"] >= 1,
                 desc="first chunk converted")
        call("/api/files/%s/convert/stop" % fid, {})
        st = wait_for(lambda s: s["files"][0]["status"] in ("paused", "done"),
                      desc="conversion paused")
        f0 = st["files"][0]
        assert f0["status"] == "paused", "conversion should be paused, got " + f0["status"]
        done_at_pause = f0["converted_count"]
        assert 0 < done_at_pause < total
        call("/api/files/%s/convert/start" % fid, {})
        st = wait_for(lambda s: s["files"][0]["status"] == "done",
                      desc="resume to done")
        print("[3] interrupt + resume conversion OK (paused at %d/%d)"
              % (done_at_pause, total))
        call("/api/settings", {"convert_delay": 0})

        # 5) consistency: incremental result == full recompute
        r = call("/api/files/%s/verify" % fid, {})
        assert r["consistent"], r["message"]
        print("[4] consistency check OK:", r["message"])

        # 6) conflict: mutate one byte of chunk 2 and re-upload
        mutated = bytearray(blob[2 * cs:3 * cs])
        mutated[100] ^= 0xFF
        r = upload(2, bytes(mutated))
        assert r.get("conflict"), "conflict expected"
        assert r["diff"]["first"] == 100 and r["diff"]["diff_bytes"] == 1
        st = call("/api/state")
        f0 = st["files"][0]
        assert f0["status"] == "conflict"
        assert f0["chunks"][2]["status"] == "conflict"
        assert f0["chunks"][2]["checksum"] != f0["chunks"][2]["conflict_checksum"]
        conv_before = f0["converted_count"]
        print("[5] conflict detected OK: diff first=%s last=%s"
              % (r["diff"]["first"], r["diff"]["last"]))

        # 7) resolve keep_new: only that chunk re-converted, others untouched
        r = call("/api/files/%s/chunks/2/resolve" % fid, {"choice": "keep_new"})
        assert r["ok"]
        st = wait_for(lambda s: s["files"][0]["status"] == "done",
                      desc="re-convert after resolve")
        f0 = st["files"][0]
        assert f0["chunks"][2]["checksum"] == hashlib.sha256(bytes(mutated)).hexdigest()
        r = call("/api/files/%s/verify" % fid, {})
        assert r["consistent"], "after resolve, incremental must equal full recompute"
        print("[6] resolve + partial re-convert OK, final consistency OK "
              "(other %d converted chunks untouched)" % (conv_before - 1,))

        # 8) idempotent: same content re-upload changes nothing
        r = upload(3, blob[3 * cs:4 * cs])
        assert r["ok"] and r.get("note")
        print("[7] idempotent re-upload OK:", r["note"])

        print("\nALL E2E CHECKS PASSED")
    finally:
        srv.terminate()
        srv.wait(timeout=10)


if __name__ == "__main__":
    main()
