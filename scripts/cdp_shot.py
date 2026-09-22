"""Screenshot a URL with headless Edge via CDP, waiting real seconds for async loads."""
import base64
import json
import subprocess
import sys
import time
import urllib.request

import websocket

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def main(url, out, wait=8.0, width=1400, height=900):
    port = 9333
    proc = subprocess.Popen([
        EDGE, "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
        "--remote-debugging-port=%d" % port, "--remote-allow-origins=*",
        "--window-size=%d,%d" % (width, height), "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(
                    "http://127.0.0.1:%d/json" % port, timeout=1))
                pages = [t for t in tabs if t.get("type") == "page"]
                if pages:
                    ws_url = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass
            time.sleep(0.3)
        if not ws_url:
            raise RuntimeError("no CDP page")
        ws = websocket.create_connection(ws_url, timeout=30)
        mid = [0]

        def send(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method,
                                "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == mid[0]:
                    return msg.get("result", {})

        send("Page.enable")
        send("Page.navigate", {"url": url})
        time.sleep(wait)
        shot = send("Page.captureScreenshot", {"format": "png"})
        with open(out, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print("wrote", out)
    finally:
        proc.terminate()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 8.0)
