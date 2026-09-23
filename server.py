# -*- coding: utf-8 -*-
"""协作编辑协调工具 —— 本地启动入口（仅依赖 Python 标准库）。

启动: python server.py [--port 8000]
"""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from merge import MergeEngine

BASE = os.path.dirname(os.path.abspath(__file__))
ENGINE = None  # type: MergeEngine


def load_sample():
    global ENGINE
    with open(os.path.join(BASE, "sample", "document.json"), encoding="utf-8") as f:
        doc = json.load(f)
    with open(os.path.join(BASE, "sample", "edits.json"), encoding="utf-8") as f:
        edits = json.load(f)
    ENGINE = MergeEngine(doc, edits)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel, ctype):
        path = os.path.join(BASE, rel)
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._static(os.path.join("static", "index.html"),
                         "text/html; charset=utf-8")
        elif self.path.startswith("/static/"):
            rel = self.path.lstrip("/")
            ctype = "application/javascript; charset=utf-8"
            if rel.endswith(".css"):
                ctype = "text/css; charset=utf-8"
            self._static(rel, ctype)
        elif self.path == "/api/state":
            self._json(ENGINE.state())
        elif self.path == "/api/final":
            self._json({"document": ENGINE.build_document(final_only=True),
                        "unresolved": ENGINE.unresolved()})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            self._json({"error": "请求不是合法 JSON: %s" % exc}, 400)
            return
        try:
            if self.path == "/api/load":
                if "document" in payload and "edits" in payload:
                    ENGINE.__init__(payload["document"], payload["edits"])
                else:
                    load_sample()
                self._json(ENGINE.state())
            elif self.path == "/api/decide":
                ENGINE.decide(payload["edit_id"], payload["action"],
                              payload.get("content"))
                self._json(ENGINE.state())
            else:
                self.send_error(404)
        except (KeyError, ValueError) as exc:
            self._json({"error": str(exc)}, 400)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    load_sample()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print("协作编辑协调工具已启动: http://%s:%d" % (args.host, args.port))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
