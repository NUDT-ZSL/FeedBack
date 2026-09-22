# -*- coding: utf-8 -*-
"""离线实验比较工具：标准库 HTTP 服务 + JSON API + 静态前端。"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import Engine, demo_store

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "store.json")

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}


def save(engine):
    if not os.path.isdir(DATA_DIR):
        os.makedirs(DATA_DIR)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(engine.store, f, ensure_ascii=False, indent=1)


def load_engine():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return Engine(json.load(f))
    engine = Engine(demo_store())
    save(engine)
    return engine


ENGINE = load_engine()


def route(path, d):
    e = ENGINE
    if path == "/api/group/create":
        e.add_group(d)
    elif path == "/api/group/update":
        e.update_group(d.get("id", ""), d)
    elif path == "/api/group/delete":
        e.delete_group(d.get("id", ""))
    elif path == "/api/variant/create":
        e.add_variant(d)
    elif path == "/api/variant/update":
        e.update_variant(d.get("id", ""), d)
    elif path == "/api/variant/delete":
        e.delete_variant(d.get("id", ""))
    elif path == "/api/membership/add":
        e.add_membership(d.get("variant_id", ""), d.get("group_id", ""))
    elif path == "/api/membership/remove":
        e.remove_membership(d.get("variant_id", ""), d.get("group_id", ""))
    elif path == "/api/conflict/resolve":
        e.resolve_conflict(d.get("key", ""), d.get("action", ""),
                           d.get("variant_id"), d.get("group_id"))
    elif path == "/api/baseline/set":
        e.set_baseline(d.get("group_id") or None)
    elif path == "/api/demo/load":
        e.store = demo_store()
        e.recompute_full()
    else:
        raise ValueError("未知接口: " + path)


def payload():
    s = ENGINE.state()
    s["ok"] = True
    s["consistent"] = ENGINE.verify_consistency()
    return s


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        if self.path.startswith("/api/state"):
            return self._send_json(payload())
        path = self.path.split("?")[0]
        if path in ("/", ""):
            path = "/index.html"
        full = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send_json({"ok": False, "error": "not found"}, 404)
        with open(full, "rb") as f:
            body = f.read()
        ext = os.path.splitext(full)[1]
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            route(self.path.split("?")[0], self._read_body())
            save(ENGINE)
            self._send_json(payload())
        except (ValueError, KeyError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)

    def log_message(self, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "8787"))
    print("实验比较工具已启动: http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
