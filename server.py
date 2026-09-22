"""地理围栏推演工具 - 本地静态服务器（仅依赖 Python 标准库）"""
import http.server
import os
import socketserver
import sys
import webbrowser

PORT = int(os.environ.get("GEOFENCE_PORT", "8000"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[server] " + (fmt % args) + "\n")


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/"
        print(f"地理围栏推演工具已启动: {url}  (Ctrl+C 停止)")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
