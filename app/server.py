from __future__ import annotations

import json
import os
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import service
from .db import connect, seed_if_empty
from .engine import recompute_all


ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
DB_PATH = Path(os.environ.get("READING_DB", ROOT / "reading.db"))
DB_LOCK = threading.RLock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        # Keep the launcher console readable; API errors are still sent in JSON.
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            return json.loads(raw or "{}")
        except (ValueError, json.JSONDecodeError):
            raise service.ServiceError("请求必须是有效 JSON")

    def guess_type(self, path):
        suffix = Path(path).suffix.lower()
        return {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }.get(suffix, super().guess_type(path))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/state":
            return super().do_GET()
        with DB_LOCK, connect(DB_PATH) as conn:
            state = service.get_state(conn)
            state["next_actions"] = service.next_actions(conn)
        self._send_json(state)

    def do_POST(self):
        self._handle_write()

    def do_PATCH(self):
        self._handle_write()

    def do_DELETE(self):
        self._handle_write()

    def _handle_write(self):
        parsed = urlparse(self.path)
        data = self._read_json() if self.command != "DELETE" else {}
        parts = [p for p in parsed.path.strip("/").split("/") if p]
        try:
            with DB_LOCK, connect(DB_PATH) as conn:
                result = self._dispatch(conn, parts, data)
            self._send_json(result)
        except service.ServiceError as exc:
            self._send_json({"error": str(exc)}, exc.status)
        except Exception as exc:
            self._send_json({"error": f"服务器处理失败：{exc}"}, 500)

    def _dispatch(self, conn, parts, data):
        if parts == ["api", "materials"] and self.command == "POST":
            return service.create_material(conn, data)
        if len(parts) == 3 and parts[:2] == ["api", "materials"] and \
                self.command == "PATCH":
            return service.update_material(conn, parts[2], data)
        if len(parts) == 3 and parts[:2] == ["api", "materials"] and \
                self.command == "DELETE":
            return service.delete_material(conn, parts[2])
        if len(parts) == 4 and parts[:2] == ["api", "materials"] and \
                parts[3] == "events" and self.command == "POST":
            return service.create_event(conn, parts[2], data)
        if len(parts) == 3 and parts[:2] == ["api", "events"] and \
                self.command == "PATCH":
            return service.update_event(conn, parts[2], data)
        if len(parts) == 4 and parts[:3] == ["api", "events", "active"] and \
                self.command == "PATCH":
            return service.set_event_active(conn, parts[3], data.get("active", False),
                                            data.get("reason", ""))
        if parts == ["api", "relations"] and self.command == "POST":
            return service.create_relation(conn, data)
        if len(parts) == 3 and parts[:2] == ["api", "relations"] and \
                self.command == "DELETE":
            return service.delete_relation(conn, parts[2])
        if len(parts) == 4 and parts[:3] == ["api", "conflicts", "resolve"] and \
                self.command == "POST":
            return service.resolve_conflict(conn, parts[3], data)
        if len(parts) == 4 and parts[:3] == ["api", "conflicts", "reopen"] and \
                self.command == "POST":
            return service.reopen_conflict(conn, parts[3])
        raise service.ServiceError("接口不存在", 404)


def prepare_database() -> None:
    conn = connect(DB_PATH)
    seed_if_empty(conn)
    recompute_all(conn)
    conn.commit()
    conn.close()


def run(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True):
    prepare_database()
    httpd = ThreadingHTTPServer((host, port), Handler)
    actual_host, actual_port = httpd.server_address
    url = f"http://{actual_host}:{actual_port}/"
    if open_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    print(f"阅读消化推演工具已启动：{url}")
    print("按 Ctrl+C 退出；数据保存在", DB_PATH)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    run()
