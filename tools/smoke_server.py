#!/usr/bin/env python3
"""冒烟测试：启动服务器，请求关键资源，然后关闭。"""
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8917


def main():
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py"), "--port", str(PORT), "--no-browser"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        base = f"http://127.0.0.1:{PORT}"
        for _ in range(30):
            if proc.poll() is not None:
                raise SystemExit("server exited early: " + proc.stdout.read().decode())
            try:
                urllib.request.urlopen(base + "/", timeout=1)
                break
            except OSError:
                time.sleep(0.3)
        else:
            raise SystemExit("server did not start")
        for path, needle in [
            ("/", "清晰阅读"),
            ("/style.css", "--font-size"),
            ("/lib.js", "computeColumns"),
            ("/app.js", "restoreAnchor"),
            ("/sample.txt", "灯塔"),
        ]:
            body = urllib.request.urlopen(base + path, timeout=5).read()
            text = body.decode("utf-8")
            assert needle in text, f"{path} missing {needle!r}"
            print(f"OK {path} ({len(body)} bytes)")
        print("smoke test: all passed")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    main()
