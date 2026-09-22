"""Zero-dependency local web server for the daily equipment scheduling app."""

from __future__ import annotations

import argparse
import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict

from dataio import load_sample, parse_devices_csv, parse_tasks_csv, parse_transitions_csv
from scheduler import schedule

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
        path = self.path.split("?", 1)[0]
        if path == "/api/sample":
            sample = load_sample(ROOT / "sample")
            self._send_json({"ok": True, **sample, "result": schedule(sample)})
            return
        if path == "/":
            self.path = "/static/index.html"
        elif path.startswith("/api/"):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/schedule":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("请求体必须是 JSON 对象")
            files = payload.get("files", {}) if isinstance(payload.get("files"), dict) else {}
            if files:
                if files.get("devices"):
                    payload["devices"] = parse_devices_csv(files["devices"])
                if files.get("tasks"):
                    payload["tasks"] = parse_tasks_csv(files["tasks"])
                if files.get("transitions"):
                    payload["transitions"] = parse_transitions_csv(files["transitions"])
            result = schedule(payload)
            self._send_json({"ok": True, "result": result})
        except Exception as exc:  # surface CSV/JSON errors in UI
            self._send_json({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 400)

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep the launcher console readable.
        print(f"{self.address_string()} {fmt % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local equipment scheduling demo")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"车间调度应用已启动: http://{args.host}:{args.port}")
    print("按 Ctrl+C 停止服务。")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
