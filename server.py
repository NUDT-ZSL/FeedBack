# -*- coding: utf-8 -*-
"""经验条目关联管理系统的 HTTP 服务（仅标准库）。

用法：python server.py [端口]   默认 8000
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
SEED_FILE = os.path.join(BASE_DIR, "seed_data.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".js": "application/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}


def load_state():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    with open(SEED_FILE, encoding="utf-8") as f:
        seed = json.load(f)
    state = {"entries": [], "events": []}
    for item in seed:
        item = dict(item)
        history = item.pop("history", [])
        entry = engine.new_entry(**item)
        state["entries"].append(entry)
        for h in history:
            engine.revise_entry(state, entry["id"], h.get("body"),
                                h.get("tags"), h.get("note", ""))
        state["events"] = []  # 种子重放不产生噪音事件
    engine.log_event(state, "系统初始化，载入 {} 条经验条目".format(len(state["entries"])))
    engine.bootstrap(state)
    save_state(state)
    return state


def save_state(state):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)


STATE = load_state()


def next_entry_id():
    nums = [int(e["id"][1:]) for e in STATE["entries"]
            if e["id"].startswith("E") and e["id"][1:].isdigit()]
    return "E{:03d}".format(max(nums, default=0) + 1)


def handle_post(path, payload):
    if path == "/api/entries":
        e = engine.new_entry(next_entry_id(), payload["title"],
                             payload["body"], payload.get("tags", []),
                             note="手工新建")
        STATE["entries"].append(e)
        engine.log_event(STATE, "新建条目 {}（{}）".format(e["id"], e["title"]))
        for other in STATE["entries"]:
            if other["id"] != e["id"] and other["status"] == "active":
                engine.maybe_infer(STATE, e, other)
        engine.detect_conflicts(STATE)
        return {"ok": True, "id": e["id"]}
    parts = [p for p in path.split("/") if p]
    if len(parts) == 4 and parts[0] == "api" and parts[1] == "entries":
        entry_id, action = parts[2], parts[3]
        if action == "revise":
            engine.revise_entry(STATE, entry_id, payload.get("body"),
                                payload.get("tags"), payload.get("note", ""))
        elif action == "deprecate":
            engine.deprecate_entry(STATE, entry_id, payload.get("note", ""))
        elif action == "merge":
            engine.merge_entries(STATE, entry_id, payload["target"])
        else:
            return {"ok": False, "error": "未知操作：" + action}
        return {"ok": True}
    if path == "/api/links/decision":
        engine.decide_link(STATE, payload["source"], payload["target"],
                           payload["decision"])
        return {"ok": True}
    if path == "/api/reset":
        if os.path.exists(DATA_FILE):
            os.remove(DATA_FILE)
        STATE.clear()
        STATE.update(load_state())
        return {"ok": True}
    return {"ok": False, "error": "未知接口：" + path}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path):
        ext = os.path.splitext(path)[1]
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type",
                         CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            self._send_json(STATE)
            return
        if path == "/":
            path = "/index.html"
        safe = os.path.normpath(path).lstrip(os.sep).lstrip("/")
        full = os.path.join(STATIC_DIR, safe)
        if os.path.commonpath([os.path.abspath(full), STATIC_DIR]) == STATIC_DIR \
                and os.path.isfile(full):
            self._send_file(full)
        else:
            self._send_json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            result = handle_post(path, payload)
            save_state(STATE)
            result["state"] = STATE
            self._send_json(result, 200 if result.get("ok") else 400)
        except (KeyError, ValueError) as exc:
            self._send_json({"ok": False, "error": str(exc)}, 400)

    def log_message(self, fmt, *args):
        sys.stderr.write("[server] " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print("经验条目关联管理系统： http://127.0.0.1:{}".format(port))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
