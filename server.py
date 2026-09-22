# -*- coding: utf-8 -*-
"""Local offline HTTP server: serves the review UI and the JSON API."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import Engine, split_chapters, full_recheck, normalize

BASE = os.path.dirname(os.path.abspath(__file__))
DOC_PATH = os.path.join(BASE, "data", "document.md")
RULES_PATH = os.path.join(BASE, "data", "rules.json")
WEB_DIR = os.path.join(BASE, "web")
HOST = "127.0.0.1"
PORT = 8000

engine = Engine()
state = {}


def load_inputs():
    with open(DOC_PATH, encoding="utf-8") as f:
        chapters = split_chapters(f.read())
    with open(RULES_PATH, encoding="utf-8") as f:
        rules = json.load(f)["rules"]
    return chapters, rules


def rebuild():
    chapters, rules = load_inputs()
    results, stats = engine.evaluate(rules, chapters)
    consistent = normalize(full_recheck(rules, chapters)) == normalize(results)
    state.clear()
    state.update(chapters=chapters, rules=rules, results=results,
                 stats=stats, consistent=consistent)


class Handler(BaseHTTPRequestHandler):
    def _send(self, body, ctype="application/json; charset=utf-8", code=200):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            with open(os.path.join(WEB_DIR, "index.html"), encoding="utf-8") as f:
                self._send(f.read(), "text/html; charset=utf-8")
        elif self.path == "/api/state":
            self._send(json.dumps(state, ensure_ascii=False))
        else:
            self._send('{"error":"not found"}', code=404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        if self.path == "/api/rules":
            try:
                rules = json.loads(body)["rules"]
                assert isinstance(rules, list)
                for r in rules:
                    assert isinstance(r, dict) and r.get("type")
            except Exception as exc:
                self._send(json.dumps({"error": "规范 JSON 无效: %s" % exc},
                                      ensure_ascii=False), code=400)
                return
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump({"rules": rules}, f, ensure_ascii=False, indent=2)
            rebuild()
            self._send(json.dumps(state, ensure_ascii=False))
        elif self.path == "/api/reload":
            rebuild()
            self._send(json.dumps(state, ensure_ascii=False))
        else:
            self._send('{"error":"not found"}', code=404)

    def log_message(self, *args):
        pass


def main():
    rebuild()
    print("离线风格审查工具已启动: http://%s:%d" % (HOST, PORT))
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
