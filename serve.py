from __future__ import annotations

import functools
import http.server
import socket
import socketserver
import threading
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class ExclusiveTCPServer(socketserver.TCPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        socketserver.TCPServer.server_bind(self)


def main() -> None:
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler,
        directory=str(ROOT),
    )
    last_error: OSError | None = None
    for port in range(8765, 8781):
        try:
            httpd = ExclusiveTCPServer(("127.0.0.1", port), handler)
            break
        except OSError as exc:
            last_error = exc
    else:
        raise SystemExit(f"未找到可用端口: {last_error}")

    url = f"http://127.0.0.1:{port}/index.html"
    print(f"运营指标异常归因推演台已启动：{url}")
    print("按 Ctrl+C 停止服务。")
    threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
