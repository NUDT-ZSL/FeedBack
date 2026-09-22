"""易读 · 本地静态服务器。用法: python server.py [端口]"""
import http.server
import socketserver
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 保持控制台干净


httpd = None
for _ in range(20):
    try:
        httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
        break
    except OSError:
        PORT += 1
if httpd is None:
    sys.exit("没有可用端口")
with httpd:
    url = f"http://127.0.0.1:{PORT}/"
    print(f"易读已启动: {url}  (Ctrl+C 停止)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd.serve_forever()
