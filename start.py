# 本地离线启动脚本：启动一个仅服务当前目录的本地服务器并打开浏览器。
# 用法：python start.py  （或直接双击 index.html，无需服务器）
import http.server
import os
import socketserver
import threading
import webbrowser

PORT = 8137

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    url = "http://127.0.0.1:%d/index.html" % PORT
    print("学习路径推演台已启动: " + url)
    print("按 Ctrl+C 停止。")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    httpd.serve_forever()
