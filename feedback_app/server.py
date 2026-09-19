"""Local HTTP API + static UI. Standard library only, fully offline."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .store import Store

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


def make_handler(store: Store):
    class Handler(BaseHTTPRequestHandler):
        server_version = "FeedbackCluster/0.1"

        def log_message(self, *args):
            pass

        # ----- helpers -----
        def _send_json(self, obj, status=200):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_file(self, path, content_type):
            if not os.path.isfile(path):
                self._send_json({"error": "not found"}, 404)
                return
            with open(path, "rb") as fh:
                body = fh.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            raw = self.rfile.read(length)
            try:
                return json.loads(raw.decode("utf-8"))
            except Exception:
                return {}

        # ----- routes -----
        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/api/state":
                self._send_json(store.state())
            elif path in ("/", "/index.html"):
                self._send_file(os.path.join(STATIC_DIR, "index.html"),
                                "text/html; charset=utf-8")
            elif path == "/app.js":
                self._send_file(os.path.join(STATIC_DIR, "app.js"),
                                "application/javascript; charset=utf-8")
            elif path == "/style.css":
                self._send_file(os.path.join(STATIC_DIR, "style.css"),
                                "text/css; charset=utf-8")
            else:
                self._send_json({"error": "not found"}, 404)

        def do_POST(self):
            path = urlparse(self.path).path
            data = self._body()
            if path == "/api/feedback":
                fb = store.add_feedback(data.get("source", ""),
                                        data.get("text", ""),
                                        data.get("tags"))
                self._send_json({"ok": True, "feedback": fb.to_dict()})
            elif path == "/api/op/move":
                ok, msg = store.op_move(data.get("feedback_id", ""),
                                        data.get("target_cluster_id", ""))
                self._send_json({"ok": ok, "message": msg},
                                200 if ok else 400)
            elif path == "/api/op/merge":
                ok, msg = store.op_merge(data.get("cluster_a", ""),
                                         data.get("cluster_b", ""))
                self._send_json({"ok": ok, "message": msg},
                                200 if ok else 400)
            elif path == "/api/op/split":
                ok, msg = store.op_split(data.get("cluster_id", ""),
                                         data.get("feedback_ids", []))
                self._send_json({"ok": ok, "message": msg},
                                200 if ok else 400)
            elif path == "/api/op/reset":
                ok, msg = store.op_reset()
                self._send_json({"ok": ok, "message": msg})
            elif path == "/api/settings":
                store.set_params(data.get("threshold"), data.get("band"))
                self._send_json({"ok": True})
            else:
                self._send_json({"error": "not found"}, 404)

        def do_PUT(self):
            path = urlparse(self.path).path
            data = self._body()
            prefix = "/api/feedback/"
            if path.startswith(prefix):
                fb = store.update_feedback(path[len(prefix):],
                                           source=data.get("source"),
                                           text=data.get("text"),
                                           tags=data.get("tags"))
                if fb is None:
                    self._send_json({"error": "not found"}, 404)
                else:
                    self._send_json({"ok": True, "feedback": fb.to_dict()})
            else:
                self._send_json({"error": "not found"}, 404)

        def do_DELETE(self):
            path = urlparse(self.path).path
            prefix = "/api/feedback/"
            if path.startswith(prefix):
                ok = store.delete_feedback(path[len(prefix):])
                self._send_json({"ok": ok}, 200 if ok else 404)
            else:
                self._send_json({"error": "not found"}, 404)

    return Handler


def serve(store: Store, host="127.0.0.1", port=8765):
    httpd = ThreadingHTTPServer((host, port), make_handler(store))
    print("Feedback clustering UI: http://%s:%d" % (host, port))
    httpd.serve_forever()
