"""区域仓网调拨工作台：本地 HTTP 服务（仅标准库）。

用法：python server.py [端口]   默认 8000，浏览器打开 http://localhost:8000
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from solver import compute_plan

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def do_POST(self):
        if self.path == "/api/plan":
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                result = compute_plan(
                    payload.get("locations", []),
                    payload.get("distances", []),
                    payload.get("weights"),
                )
                self._send(200, result)
            except Exception as exc:  # noqa: BLE001 - 把错误透传给前端提示
                self._send(400, {"error": str(exc)})
        else:
            self._send(404, {"error": "not found"})

    def _send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
    print(f"调拨工作台已启动: http://localhost:{port}  (Ctrl+C 停止)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
