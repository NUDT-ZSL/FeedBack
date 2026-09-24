# -*- coding: utf-8 -*-
"""HTTP 服务：静态页面 + JSON API。仅依赖 Python 标准库。"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from engine import Engine

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")

engine = Engine()


def reset_engine():
    global engine
    engine = Engine()
    with open(os.path.join(ROOT, "sample_data.json"), encoding="utf-8") as f:
        data = json.load(f)
    engine.import_data(data.get("objects"), data.get("queries"), mode="replace")


reset_engine()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8") if n else "{}"
        return json.loads(raw or "{}")

    def _respond(self, extra=None):
        payload = {"state": engine.state(), "consistency": engine.consistency_check()}
        if extra:
            payload.update(extra)
        self._send_json(payload)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/state":
            return self._send_json({"state": engine.state(),
                                    "consistency": engine.consistency_check()})
        if path == "/api/consistency":
            return self._send_json(engine.consistency_check())
        if path == "/":
            path = "/index.html"
        fp = os.path.normpath(os.path.join(STATIC, path.lstrip("/")))
        if not fp.startswith(STATIC) or not os.path.isfile(fp):
            return self._send_json({"error": "not found"}, 404)
        ctype = {".html": "text/html", ".js": "text/javascript",
                 ".css": "text/css"}.get(os.path.splitext(fp)[1], "application/octet-stream")
        with open(fp, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self._body()
            if path == "/api/import":
                engine.import_data(data.get("objects"), data.get("queries"),
                                   data.get("mode", "merge"))
                return self._respond()
            if path == "/api/reset":
                reset_engine()
                return self._respond()
            if path == "/api/claim":
                claim, affected = engine.add_claim(**data)
                return self._respond({"claim": claim, "affected": affected})
            if path == "/api/claim/retract":
                return self._respond({"affected": engine.retract_claim(data["claim_id"])})
            if path == "/api/adjudicate":
                return self._respond({"affected": engine.adjudicate(**data)})
            if path == "/api/query":
                qid = engine.upsert_query(data)
                return self._respond({"query_id": qid, "affected": [qid]})
            if path == "/api/query/delete":
                engine.delete_query(data["query_id"])
                return self._respond({"affected": [data["query_id"]]})
            return self._send_json({"error": "unknown route"}, 404)
        except Exception as exc:  # noqa: BLE001 - 返回可读错误给前端
            return self._send_json({"error": str(exc)}, 400)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print("服务已启动: http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
