"""Offline HTTP server (stdlib only) exposing the feedback clustering
module as a JSON API plus a single-page UI."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from store import Store
from view import build_state

BASE = os.path.dirname(os.path.abspath(__file__))
STORE = Store(os.path.join(BASE, "data.json"))


def _json(handler, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _groups_by_gid():
    groups, _, _, _, _, _ = STORE.compute_groups()
    return groups


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            return _json(self, 200, build_state(STORE))
        if path in ("/", "/index.html"):
            with open(os.path.join(BASE, "static", "index.html"),
                      "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return _json(self, 404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self._body()
        except Exception:
            return _json(self, 400, {"error": "invalid json"})
        try:
            if path == "/api/feedback":
                item = STORE.add_feedback(data.get("source"),
                                          data.get("text", ""),
                                          data.get("tags"),
                                          data.get("time"))
                return _json(self, 200, {"ok": True, "item": item})
            if path == "/api/threshold":
                STORE.set_threshold(data["threshold"])
                return _json(self, 200, {"ok": True})
            if path == "/api/move":
                groups = _groups_by_gid()
                target = groups[int(data["target_gid"])]
                source = next((g for g in groups
                               if data["item"] in g), [])
                remaining = [m for m in source if m != data["item"]]
                STORE.move_item(data["item"], remaining, target)
                return _json(self, 200, {"ok": True})
            if path == "/api/merge":
                groups = _groups_by_gid()
                STORE.merge_groups(groups[int(data["gid_a"])],
                                   groups[int(data["gid_b"])])
                return _json(self, 200, {"ok": True})
            if path == "/api/split":
                groups = _groups_by_gid()
                members = groups[int(data["gid"])]
                extracted = [i for i in data["item_ids"] if i in members]
                remaining = [i for i in members if i not in extracted]
                if not extracted or not remaining:
                    return _json(self, 400,
                                 {"error": "split needs both parts"})
                STORE.split_group(remaining, extracted)
                return _json(self, 200, {"ok": True})
            if path == "/api/reset":
                STORE.reset_adjustments()
                return _json(self, 200, {"ok": True})
            return _json(self, 404, {"error": "not found"})
        except (KeyError, IndexError, ValueError) as e:
            return _json(self, 400, {"error": str(e)})

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/feedback/"):
            iid = path.rsplit("/", 1)[1]
            if iid not in STORE.items:
                return _json(self, 404, {"error": "not found"})
            item = STORE.update_feedback(iid, self._body())
            return _json(self, 200, {"ok": True, "item": item})
        return _json(self, 404, {"error": "not found"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/feedback/"):
            iid = path.rsplit("/", 1)[1]
            STORE.delete_feedback(iid)
            return _json(self, 200, {"ok": True})
        return _json(self, 404, {"error": "not found"})


def main():
    port = int(os.environ.get("PORT", "8321"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("反馈聚类模块已启动: http://127.0.0.1:%d" % port)
    server.serve_forever()


if __name__ == "__main__":
    main()
