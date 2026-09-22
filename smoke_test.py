"""冒烟测试：启动本地服务并校验三个静态资源均可访问。"""
import http.server
import socketserver
import threading
import urllib.request
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
for name in ("index.html", "app.js", "style.css"):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/{name}") as r:
        print(name, r.status, len(r.read()), "bytes")
srv.shutdown()
print("SMOKE OK")
