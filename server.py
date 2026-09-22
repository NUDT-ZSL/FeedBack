# -*- coding: utf-8 -*-
"""本地队列控制台：HTTP API + 单页界面。仅依赖 Python 标准库。

用法: python server.py [--manifest manifest.json] [--port 8000] [--fresh]
"""
from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from scheduler_core import load_manifest
from scheduler_engine import Engine

BASE = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT = os.path.join(BASE, "state.json")


class App:
    """持有引擎实例，reset 时整体重建。"""

    def __init__(self, manifest_path, fresh=False):
        self.manifest_path = manifest_path
        self.lock = threading.Lock()
        self.engine = None
        self.fresh = fresh
        self.reload()

    def reload(self):
        with self.lock:
            if self.engine:
                self.engine.stop()
            if self.fresh and os.path.exists(CHECKPOINT):
                os.remove(CHECKPOINT)
            materials, machines, tasks = load_manifest(self.manifest_path)
            self.engine = Engine(materials, machines, tasks,
                                 checkpoint_path=CHECKPOINT)
            self.engine.start()


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/api/state":
                return self._send(200, app.engine.snapshot())
            if path in ("/", "/index.html"):
                fp = os.path.join(BASE, "static", "index.html")
                with open(fp, "rb") as f:
                    body = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self._send(404, {"error": "not found"})

        def do_POST(self):
            u = urlparse(self.path)
            parts = [p for p in u.path.split("/") if p]
            qs = parse_qs(u.query)
            eng = app.engine
            ok, msg = False, "bad request"
            if parts[:1] == ["api"] and len(parts) >= 3:
                kind, ident = parts[1], parts[2]
                action = parts[3] if len(parts) > 3 else ""
                if kind == "task" and action == "fail":
                    ok, msg = eng.fail_task(ident), "fail injected"
                elif kind == "task" and action == "retry":
                    ok, msg = eng.retry_task(ident), "retried"
                elif kind == "machine" and action == "pause":
                    ok, msg = eng.pause_machine(ident), "paused"
                elif kind == "machine" and action == "resume":
                    ok, msg = eng.resume_machine(ident), "resumed"
                elif kind == "material" and action == "replace":
                    ok, msg = eng.replace_material(ident), "replaced"
                elif kind == "material" and action == "decision":
                    rerun = qs.get("rerun", ["0"])[0] in ("1", "true")
                    ok, msg = eng.material_decision(ident, rerun), "decided"
                elif kind == "queue" and ident == "reset":
                    app.fresh = True
                    app.reload()
                    ok, msg = True, "reset"
            self._send(200 if ok else 400, {"ok": ok, "msg": msg})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=os.path.join(BASE, "manifest.json"))
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--fresh", action="store_true", help="忽略已有检查点，从头开始")
    args = ap.parse_args()
    app = App(args.manifest, fresh=args.fresh)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(app))
    print(f"控制台已启动: http://127.0.0.1:{args.port}  (Ctrl+C 停止)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.engine.stop()
        srv.server_close()


if __name__ == "__main__":
    main()
