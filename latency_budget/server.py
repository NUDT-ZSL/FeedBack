"""Local-only web UI server for the latency attribution engine."""

from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .engine import analyze_batch, load_json_file


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = Path(__file__).resolve().parent / "web"
DEFAULT_DATA = PROJECT_ROOT / "data" / "sample_requests.json"


class AnalysisHandler(SimpleHTTPRequestHandler):
    """Serve static UI assets and the small JSON analysis API."""

    def __init__(self, *args, data_path: Path = DEFAULT_DATA, **kwargs):
        self.data_path = data_path
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/sample":
            try:
                self._send_json({"data": load_json_file(self.data_path)})
            except (OSError, json.JSONDecodeError) as exc:
                self._send_json({"error": f"Unable to load sample data: {exc}"}, status=500)
            return
        if parsed.path == "/api/health":
            self._send_json({"status": "ok", "offline": True})
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/analyze":
            self._send_json({"error": "Not found."}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            body = json.loads(raw_body.decode("utf-8"))
            data = body.get("data", {})
            budgets = body.get("budgets")
            include_segments = bool(body.get("include_segments", True))
            result = analyze_batch(data, budgets, include_segments=include_segments)
            self._send_json(result)
        except (ValueError, UnicodeDecodeError) as exc:
            self._send_json({"error": f"Invalid JSON request: {exc}"}, status=400)
        except Exception as exc:  # Keep the local UI responsive on bad input.
            self._send_json({"error": f"Analysis failed: {exc}"}, status=500)


def make_server(host: str, port: int, data_path: Path) -> ThreadingHTTPServer:
    def handler(*args, **kwargs):
        AnalysisHandler(*args, data_path=data_path, **kwargs)

    return ThreadingHTTPServer((host, port), handler)


def run(host: str = "127.0.0.1", port: int = 8765, data_path: Path = DEFAULT_DATA,
        open_browser: bool = True) -> None:
    server = make_server(host, port, data_path)
    actual_host, actual_port = server.server_address
    url = f"http://{actual_host}:{actual_port}/index.html"
    print(f"Offline latency budget analysis UI: {url}")
    print("Press Ctrl+C to stop.")
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline latency budget analysis UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    run(args.host, args.port, args.data, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
