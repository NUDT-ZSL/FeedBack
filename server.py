"""本地协作编辑协调工具服务器 (仅依赖 Python 标准库)。

启动: python server.py [--port 8000]
然后浏览器打开 http://127.0.0.1:8000/
"""

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from merge_engine import MergeSession

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SAMPLE = ROOT / "sample_data"


def load_sample():
    document = json.loads((SAMPLE / "document.json").read_text(encoding="utf-8"))
    edits = json.loads((SAMPLE / "edits.json").read_text(encoding="utf-8"))
    return MergeSession(document, edits)


SESSION = load_sample()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self._send_file(STATIC / "index.html", "text/html; charset=utf-8")
        elif path == "/app.js":
            self._send_file(STATIC / "app.js", "text/javascript; charset=utf-8")
        elif path == "/style.css":
            self._send_file(STATIC / "style.css", "text/css; charset=utf-8")
        elif path == "/api/state":
            self._send_json(SESSION.state())
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        global SESSION
        path = urlparse(self.path).path
        try:
            data = self._read_json()
            if path == "/api/decision":
                SESSION.decide(data["edit_id"], data["action"])
            elif path == "/api/override":
                SESSION.set_override(data["paragraph_id"], data["text"])
            elif path == "/api/override/clear":
                SESSION.clear_override(data["paragraph_id"])
            elif path == "/api/reset":
                SESSION = load_sample()
            else:
                self._send_json({"error": "not found"}, 404)
                return
            self._send_json(SESSION.state())
        except (KeyError, ValueError) as exc:
            self._send_json({"error": str(exc)}, 400)

    def log_message(self, fmt, *args):
        pass  # 保持控制台干净打印安静


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"协作编辑协调工具已启动: http://127.0.0.1:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
