# -*- coding: utf-8 -*-
"""Launcher: start the local server and open the review UI in the browser."""
import threading
import webbrowser

import server

if __name__ == "__main__":
    server.rebuild()
    url = "http://%s:%d" % (server.HOST, server.PORT)
    print("离线风格审查工具已启动: " + url)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    from http.server import ThreadingHTTPServer
    ThreadingHTTPServer((server.HOST, server.PORT), server.Handler).serve_forever()
