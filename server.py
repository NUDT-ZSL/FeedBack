# -*- coding: utf-8 -*-
"""本地离线 HTTP 服务：提供对齐推演 API 与单页界面。"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import align_engine as eng

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(ROOT, "sample_data.json")

state = None
result = None


def load_initial():
    global state, result
    with open(STATE_FILE, encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("decisions", {})
    state.setdefault("anchors", [])
    state.setdefault("segments", [])
    state.setdefault("media", {"duration": 0.0, "fps": 25.0})
    result = eng.derive(state)


def respond(handler, code, obj):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def mutate(changed_segments=(), changed_anchors=(), changed_decisions=()):
    """应用变更并增量重推，返回 (result, affected)。"""
    global result
    result, affected = eng.apply_change(
        state, result, changed_segments, changed_anchors,
        changed_decisions)
    return result, affected


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index.html"):
            p = os.path.join(ROOT, "static", "index.html")
        elif self.path.startswith("/static/"):
            p = os.path.normpath(os.path.join(ROOT, self.path.lstrip("/")))
            if not p.startswith(os.path.join(ROOT, "static")):
                respond(self, 403, {"error": "forbidden"})
                return
        else:
            p = None
        if p and os.path.isfile(p):
            with open(p, "rb") as f:
                body = f.read()
            ctype = ("text/html" if p.endswith(".html") else
                     "application/javascript" if p.endswith(".js")
                     else "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/api/state"):
            respond(self, 200, {"state": state, "result": result})
        else:
            respond(self, 404, {"error": "not found"})

    def do_POST(self):
        global state, result
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception as exc:
            respond(self, 400, {"error": "请求体不是合法 JSON: %s" % exc})
            return
        path = self.path
        try:
            if path == "/api/anchor/update":
                a = next(x for x in state["anchors"] if x["id"] == body["id"])
                a["media_time"] = float(body["media_time"])
                r, aff = mutate(changed_anchors=[a["id"]])
            elif path == "/api/anchor/add":
                a = {"id": body.get("id") or
                     "a%d" % (len(state["anchors"]) + 1),
                     "segment_id": body["segment_id"],
                     "media_time": float(body["media_time"]),
                     "note": body.get("note", "")}
                state["anchors"].append(a)
                r, aff = mutate(changed_anchors=[a["id"]])
            elif path == "/api/anchor/delete":
                state["anchors"] = [x for x in state["anchors"]
                                    if x["id"] != body["id"]]
                r, aff = mutate(changed_anchors=[body["id"]])
            elif path == "/api/adjudicate":
                sid = body["segment_id"]
                if body.get("choice") == "clear":
                    state["decisions"].pop(sid, None)
                else:
                    state["decisions"][sid] = {
                        "choice": body["choice"],
                        "offset": body.get("offset")}
                r, aff = mutate(changed_decisions=[sid])
            elif path == "/api/segment/update":
                s = next(x for x in state["segments"] if x["id"] == body["id"])
                s["start"] = float(body["start"])
                s["end"] = float(body["end"])
                r, aff = mutate(changed_segments=[s["id"]])
            elif path == "/api/load":
                state = body
                state.setdefault("decisions", {})
                result = eng.derive(state)
                r, aff = result, [s["id"] for s in state["segments"]]
            elif path == "/api/reset":
                load_initial()
                r, aff = result, [s["id"] for s in state["segments"]]
            else:
                respond(self, 404, {"error": "not found"})
                return
        except (KeyError, ValueError, StopIteration) as exc:
            respond(self, 400, {"error": "请求参数错误: %s" % exc})
            return
        respond(self, 200, {"result": r, "affected": aff, "state": state})


def main():
    load_initial()
    port = int(os.environ.get("ALIGN_PORT", "8765"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("字幕对齐工具已启动: http://127.0.0.1:%d" % port)
    srv.serve_forever()


if __name__ == "__main__":
    main()
