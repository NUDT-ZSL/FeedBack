"""End-to-end smoke test: boots the real server on a free port and
exercises the JSON API, including conflict rejection and history switch."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8199
BASE = f"http://127.0.0.1:{PORT}"


def post(payload):
    req = urllib.request.Request(
        BASE + "/api/action",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def main():
    proc = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "server.py"),
         "--port", str(PORT), "--no-browser"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/api/state", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        else:
            raise SystemExit("server did not start")

        assert post({"action": "add", "id": "app", "role": "main",
                     "name": "App"})[0] == 200
        assert post({"action": "add", "id": "nav", "role": "navigation",
                     "name": "Nav", "parent_id": "app"})[0] == 200
        assert post({"action": "add", "id": "ok", "role": "button",
                     "name": "OK", "parent_id": "nav"})[0] == 200

        status, body = post({"action": "reparent", "element_id": "app",
                             "new_parent_id": "ok"})
        assert status == 409 and body["conflict"]["element_id"] == "app", body
        print("cycle rejected:", body["conflict"]["reason"])

        status, body = post({"action": "set_name", "element_id": "ok",
                             "name": ""})
        assert status == 409 and body["conflict"]["relation"] == "name", body
        print("empty name rejected:", body["conflict"]["reason"])

        status, body = post({"action": "reorder", "element_id": "ok",
                             "index": 0})
        assert status == 200, body

        with urllib.request.urlopen(BASE + "/api/state") as resp:
            state = json.loads(resp.read())
        order = [e["id"] for e in state["reading_order"]]
        assert order == ["app", "nav", "ok"], order
        print("reading order:", " -> ".join(order))
        print("history entries:", len(state["history"]))

        assert post({"action": "switch", "index": 0})[0] == 200
        with urllib.request.urlopen(BASE + "/api/state") as resp:
            state = json.loads(resp.read())
        assert state["elements"] == {}, "switch to empty initial scheme"
        print("switch to scheme #0 restored empty tree")

        with urllib.request.urlopen(BASE + "/") as resp:
            html = resp.read().decode("utf-8")
        assert "app.js" in html
        with urllib.request.urlopen(BASE + "/app.js") as resp:
            assert resp.status == 200
        print("UI assets served OK")
        print("SMOKE TEST PASSED")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    main()
