# -*- coding: utf-8 -*-
"""本地离线版本回看工作台 HTTP 服务(仅标准库)。"""
import json
import os
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from core import VersionStore

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data", "versions.json")
SEED = os.path.join(BASE, "data", "seed_versions.json")
STATIC = os.path.join(BASE, "static")

if not os.path.exists(DATA) and os.path.exists(SEED):
    shutil.copyfile(SEED, DATA)

store = VersionStore(DATA)


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200, ctype="application/json; charset=utf-8"):
        body = obj.encode("utf-8") if isinstance(obj, str) else \
            json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def log_message(self, *a):
        pass

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            with open(os.path.join(STATIC, "index.html"), encoding="utf-8") as f:
                self._send(f.read(), ctype="text/html; charset=utf-8")
        elif path == "/api/state":
            with store.lock:
                self._send(store.state())
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        body = self._body()
        with store.lock:
            if path == "/api/versions":
                self._send(store.add_version(body))
            elif path == "/api/compare":
                self._send(store.compare(body.get("a", ""), body.get("b", "")))
            elif path.startswith("/api/versions/"):
                vid, _, action = path[len("/api/versions/"):].partition("/")
                if action == "update":
                    self._send(store.update_version(vid, body))
                elif action == "revoke":
                    self._send(store.revoke(vid))
                elif action == "reparent":
                    self._send(store.reparent(vid, body.get("new_parent")))
                elif action == "candidates":
                    self._send({"candidates": store.parent_candidates(vid)})
                else:
                    self._send({"error": "unknown action"}, 404)
            elif path == "/api/reload":
                store.load()
                self._send(store.state())
            else:
                self._send({"error": "not found"}, 404)


if __name__ == "__main__":
    port = 8765
    print("版本回看工作台: http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
