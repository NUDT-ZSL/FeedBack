# -*- coding: utf-8 -*-
"""处置推演台本地离线服务：标准库实现，无第三方依赖。"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from engine import Store

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
store = Store()
store.load_seed(os.path.join(ROOT, "seed_data.json"))


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_GET(self):
        if self.path.startswith("/api/state"):
            return self._json(store.get_state())
        path = self.path.split("?")[0]
        if path == "/":
            path = "/index.html"
        fp = os.path.abspath(os.path.join(STATIC, path.lstrip("/")))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self._json({"error": "not found"}, 404)
        ctype = {".html": "text/html", ".js": "text/javascript",
                 ".css": "text/css"}.get(os.path.splitext(fp)[1], "application/octet-stream")
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        try:
            b = self._body()
            p = self.path
            if p == "/api/signal":
                new_id = store.add_signal(b)
                return self._json({"ok": True, "id": new_id, "state": store.get_state()})
            if p == "/api/action":
                new_id = store.add_action(b)
                return self._json({"ok": True, "id": new_id, "state": store.get_state()})
            if p == "/api/signal/retract":
                store.retract_signal(b["id"])
            elif p == "/api/adjudicate":
                store.adjudicate(b["conflict_id"], b["shipment_id"],
                                 int(b["leg_index"]), b["kept_signal_ids"],
                                 b.get("by", "dispatch"))
            elif p == "/api/action/remove":
                store.remove_action(b["id"])
            elif p == "/api/clock":
                store.set_clock(b["now"])
            elif p == "/api/reset":
                store.load_seed(os.path.join(ROOT, "seed_data.json"))
            else:
                return self._json({"error": "unknown route"}, 404)
            return self._json({"ok": True, "state": store.get_state()})
        except Exception as e:  # noqa: BLE001
            return self._json({"ok": False, "error": str(e)}, 400)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("DISPATCH_SIM_PORT", "8765"))
    print("处置推演台已启动: http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
