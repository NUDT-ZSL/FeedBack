#!/usr/bin/env python3
"""低视力阅读排版工具 - 本地静态服务器"""
import argparse
import functools
import http.server
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "public"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # 保持控制台安静
        pass


def main():
    ap = argparse.ArgumentParser(description="低视力阅读排版工具")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"低视力阅读排版工具已启动: {url}")
        print("按 Ctrl+C 停止服务")
        if not args.no_browser:
            threading.Timer(0.5, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
