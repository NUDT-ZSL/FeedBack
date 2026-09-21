"""Local, dependency-free UI host for latency budget attribution."""

from __future__ import annotations

import argparse
import json
import threading
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from latency_budget.analyzer import AnalysisError, analyze_batch, analyze_request, load_budgets, load_records  # noqa: E402


STATIC_DIR = ROOT / "web" / "static"
DEFAULT_RECORDS = ROOT / "sample" / "sample_requests.json"
DEFAULT_BUDGETS = ROOT / "sample" / "sample_budgets.json"


def _sample_payload() -> dict[str, Any]:
    return {
        "records": load_records(DEFAULT_RECORDS),
        "budgets": load_budgets(DEFAULT_BUDGETS),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "LatencyBudgetUI/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[ui] {self.address_string()} - {fmt % args}")

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, relative_path: str) -> None:
        target = (STATIC_DIR / relative_path).resolve()
        if not str(target).startswith(str(STATIC_DIR)) or not target.is_file():
            self.send_error(404)
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_types.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib hook
        if self.path in ("/", "/index.html"):
            self._send_file("index.html")
        elif self.path.startswith("/static/"):
            self._send_file(self.path.removeprefix("/static/"))
        elif self.path == "/api/sample":
            try:
                self._send_json(_sample_payload())
            except (OSError, AnalysisError, json.JSONDecodeError) as exc:
                self._send_json({"error": str(exc)}, 500)
        else:
            self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802 - stdlib hook
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise AnalysisError("Request body must be a JSON object.")

            if self.path == "/api/analyze-batch":
                records = payload.get("records")
                if records is None:
                    records = load_records(DEFAULT_RECORDS)
                self._send_json(analyze_batch(records, payload.get("budgets"), include_timeline=False))
            elif self.path == "/api/analyze-request":
                record = payload.get("request")
                if record is not None:
                    self._send_json(analyze_request(record, payload.get("budgets"), include_timeline=True))
                else:
                    records = payload.get("records")
                    request_id = str(payload.get("request_id", ""))
                    if records is None and request_id:
                        records = load_records(DEFAULT_RECORDS)
                    if not isinstance(records, list) or not request_id:
                        raise AnalysisError("Provide either 'request' or both 'records' and 'request_id'.")
                    matches = [
                        item for item in records
                        if isinstance(item, dict) and str(item.get("id", "")) == request_id
                    ]
                    if not matches:
                        raise AnalysisError(f"Request {request_id!r} was not found.")
                    self._send_json(analyze_request(matches[0], payload.get("budgets"), include_timeline=True))
            else:
                self.send_error(404)
        except (OSError, ValueError, json.JSONDecodeError, AnalysisError) as exc:
            self._send_json({"error": str(exc)}, 400)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline latency budget attribution UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{httpd.server_port}/"
    if not args.no_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    print(f"Latency budget UI is running at {url}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping UI...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
