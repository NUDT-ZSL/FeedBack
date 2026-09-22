#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线笔记应用服务端（仅依赖 Python 标准库）。

数据模型：
- notes: 服务端权威数据，带 version 字段做乐观并发控制
- applied_ops: 已应用的 op_id 集合，保证客户端重试时幂等，绝不重复应用
"""
import json
import sqlite3
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "notes_server.db"
STATIC_DIR = BASE / "static"
PORT = 8765

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at REAL NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS applied_ops(
  op_id TEXT PRIMARY KEY,
  applied_at REAL NOT NULL,
  summary TEXT
);
"""


class Store:
    def __init__(self, path=DB_PATH):
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    @staticmethod
    def _note(cur, nid):
        r = cur.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
        return dict(r) if r else None

    def list_notes(self):
        with self.lock:
            rows = self.conn.execute(
                "SELECT * FROM notes WHERE deleted=0 ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def apply_op(self, op):
        """应用一条客户端改动，返回 (http_status, payload)。"""
        with self.lock:
            cur = self.conn.cursor()
            if cur.execute("SELECT 1 FROM applied_ops WHERE op_id=?",
                           (op["op_id"],)).fetchone():
                return 200, {
                    "status": "duplicate",
                    "message": "该改动此前已成功提交，本次为重试，已幂等忽略",
                    "server_note": self._note(cur, op["note_id"]),
                }
            t, nid = op["type"], op["note_id"]
            base = op.get("base_version")
            note = self._note(cur, nid)
            alive = note is not None and not note["deleted"]
            conflict = None
            if t == "create":
                if alive:
                    conflict = "服务端已存在相同 ID 的笔记"
            elif not alive:
                conflict = "该笔记在服务端已被删除"
            elif base != note["version"]:
                conflict = (f"本地基于版本 v{base} 修改，"
                            f"但服务端已更新到 v{note['version']}")
            if conflict:
                return 409, {"status": "conflict", "reason": conflict,
                             "server_note": note}
            ts = time.time()
            if t == "create":
                cur.execute("INSERT INTO notes VALUES(?,?,?,?,?,0)",
                            (nid, op["title"], op["content"], 1, ts))
                ver = 1
            elif t == "update":
                ver = note["version"] + 1
                cur.execute(
                    "UPDATE notes SET title=?,content=?,version=?,updated_at=?"
                    " WHERE id=?",
                    (op["title"], op["content"], ver, ts, nid))
            else:  # delete
                ver = note["version"] + 1
                cur.execute(
                    "UPDATE notes SET deleted=1,version=?,updated_at=?"
                    " WHERE id=?", (ver, ts, nid))
            cur.execute("INSERT INTO applied_ops VALUES(?,?,?)",
                        (op["op_id"], ts, f"{t}:{nid}"))
            self.conn.commit()
            return 200, {"status": "applied", "version": ver,
                         "message": f"{t} 已应用，服务端版本 v{ver}"}

    def resolve(self, req):
        """应用冲突解决结果（保留本地 / 手动合并）。"""
        with self.lock:
            cur = self.conn.cursor()
            if cur.execute("SELECT 1 FROM applied_ops WHERE op_id=?",
                           (req["op_id"],)).fetchone():
                return 200, {"status": "duplicate",
                             "message": "该解决结果此前已提交，幂等忽略"}
            nid = req["note_id"]
            note = self._note(cur, nid)
            alive = note is not None and not note["deleted"]
            ts = time.time()
            if alive:
                if req["base_version"] != note["version"]:
                    return 409, {
                        "status": "conflict",
                        "reason": (f"解决时基于服务端 v{req['base_version']}，"
                                   f"但服务端已更新到 v{note['version']}，"
                                   "请刷新后重新解决"),
                        "server_note": note}
                ver = note["version"] + 1
                cur.execute(
                    "UPDATE notes SET title=?,content=?,version=?,updated_at=?"
                    " WHERE id=?",
                    (req["title"], req["content"], ver, ts, nid))
            else:
                ver = 1
                cur.execute("INSERT OR REPLACE INTO notes VALUES(?,?,?,?,?,0)",
                            (nid, req["title"], req["content"], ver, ts))
            cur.execute("INSERT INTO applied_ops VALUES(?,?,?)",
                        (req["op_id"], ts, f"resolve:{nid}"))
            self.conn.commit()
            return 200, {"status": "applied", "version": ver,
                         "message": f"冲突解决结果已应用，服务端版本 v{ver}"}

    def debug_server_edit(self, req):
        """模拟另一个客户端直接在服务端修改笔记（用于演示/测试冲突）。"""
        with self.lock:
            cur = self.conn.cursor()
            note = self._note(cur, req["note_id"])
            ts = time.time()
            if note is None or note["deleted"]:
                ver = 1
                cur.execute("INSERT OR REPLACE INTO notes VALUES(?,?,?,?,?,0)",
                            (req["note_id"], req["title"], req["content"],
                             ver, ts))
            else:
                ver = note["version"] + 1
                cur.execute(
                    "UPDATE notes SET title=?,content=?,version=?,updated_at=?"
                    " WHERE id=?",
                    (req["title"], req["content"], ver, ts, req["note_id"]))
            self.conn.commit()
            return 200, {"status": "ok",
                         "note": self._note(cur, req["note_id"])}

    def state(self):
        with self.lock:
            notes = [dict(r) for r in self.conn.execute(
                "SELECT * FROM notes ORDER BY id").fetchall()]
            ops = [dict(r) for r in self.conn.execute(
                "SELECT * FROM applied_ops ORDER BY applied_at").fetchall()]
            return {"notes": notes, "applied_ops": ops}

    def reset(self):
        with self.lock:
            self.conn.execute("DELETE FROM notes")
            self.conn.execute("DELETE FROM applied_ops")
            self.conn.commit()


STORE = Store()

CONTENT_TYPES = {".html": "text/html; charset=utf-8",
                 ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 静默请求日志

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/api/notes":
            return self._json({"notes": STORE.list_notes()})
        if self.path == "/api/state":
            return self._json(STORE.state())
        path = "/index.html" if self.path in ("/", "") else self.path
        if path.startswith("/static/"):
            path = path[len("/static"):]
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve())) \
                or not target.is_file():
            return self._json({"error": "not found"}, 404)
        body = target.read_bytes()
        ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            req = self._read_json()
        except Exception:
            return self._json({"error": "bad json"}, 400)
        if self.path == "/api/op":
            status, payload = STORE.apply_op(req)
            return self._json(payload, status)
        if self.path == "/api/resolve":
            status, payload = STORE.resolve(req)
            return self._json(payload, status)
        if self.path == "/api/debug/server-edit":
            status, payload = STORE.debug_server_edit(req)
            return self._json(payload, status)
        if self.path == "/api/debug/reset":
            STORE.reset()
            return self._json({"status": "ok"})
        return self._json({"error": "not found"}, 404)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"离线笔记应用已启动: http://127.0.0.1:{PORT}")
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
