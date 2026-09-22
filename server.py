"""小队战术 AI 规划演示服务器（仅标准库）。
用法: python server.py [port]   然后浏览器打开 http://127.0.0.1:8000
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from engine.game import GameController  # noqa: E402

GAME = GameController()
STATIC = os.path.join(ROOT, "static")


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/api/state":
            return self._json(GAME.to_dict())
        path = "/index.html" if self.path in ("/", "") else self.path
        path = path.split("?")[0].lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, path))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            self.send_error(404)
            return
        ctype = {".html": "text/html", ".js": "text/javascript",
                 ".css": "text/css"}.get(os.path.splitext(full)[1],
                                         "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global GAME
        try:
            data = self._body()
            if self.path == "/api/plan":
                return self._json(GAME.plan_all())
            if self.path == "/api/execute":
                return self._json(GAME.execute_turn())
            if self.path == "/api/event":
                return self._json(GAME.apply_event(
                    data.get("type", "random"), **{
                        k: v for k, v in data.items() if k != "type"}))
            if self.path == "/api/override":
                return self._json(GAME.override_plan(
                    data["uid"], int(data["pid"])))
            if self.path == "/api/cancel":
                return self._json(GAME.cancel_plan(data["uid"]))
            if self.path == "/api/reset":
                GAME = GameController()
                return self._json(GAME.to_dict())
            self.send_error(404)
        except Exception as exc:  # 演示服务器：把错误返回给前端
            self._json({"error": str(exc)}, 500)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"服务器已启动: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

