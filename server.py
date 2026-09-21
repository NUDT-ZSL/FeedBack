#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AutoDemo 离线分块接收 + 后台转换服务。
仅依赖 Python 标准库：本地 HTTP 服务 + SQLite 持久化，无外部存储与在线服务。

功能要点：
1. 文件按分段大小切分为有序分段，逐段接收，实时上报状态与进度。
2. 分段失败保留已成功分段，仅重试失败分段。
3. 全部分段接收后后台转换；中断后从已完成部分继续。
4. 分段内容与先前记录不一致时保留双方、标出差异位置，等待用户裁决。
5. 裁决/重试只影响相关分段与转换进度，最终结果与整体重推一致。
"""
import hashlib
import json
import os
import random
import shutil
import sqlite3
import threading
import time
import uuid
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
STATIC_DIR = os.path.join(ROOT, "static")
DB_PATH = os.path.join(DATA_DIR, "app.db")

os.makedirs(DATA_DIR, exist_ok=True)

_db_lock = threading.RLock()
_registry_lock = threading.Lock()
_workers = {}      # file_id -> threading.Thread
_stop_flags = {}   # file_id -> threading.Event

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'receiving',
  converted_count INTEGER NOT NULL DEFAULT 0,
  output_checksum TEXT,
  error TEXT,
  created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  file_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  size INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  has_conflict INTEGER NOT NULL DEFAULT 0,
  conflict_checksum TEXT,
  conflict_size INTEGER,
  diff_json TEXT,
  converted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, idx)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with _db_lock, connect() as conn:
        conn.executescript(SCHEMA)


def get_setting(key, default=None):
    with _db_lock, connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key, value):
    with _db_lock, connect() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)",
                     (key, str(value)))


# ---------- 路径 ----------
def file_dir(fid):
    return os.path.join(DATA_DIR, "files", fid)


def chunk_path(fid, idx):
    return os.path.join(file_dir(fid), "chunks", "%06d.bin" % idx)


def converted_path(fid, idx):
    return os.path.join(file_dir(fid), "converted", "%06d.bin" % idx)


def conflict_path(fid, idx):
    return os.path.join(file_dir(fid), "conflicts", "%06d.incoming.bin" % idx)


def output_path(fid):
    return os.path.join(file_dir(fid), "output.bin")


def ensure_dirs(fid):
    for sub in ("chunks", "converted", "conflicts"):
        os.makedirs(os.path.join(file_dir(fid), sub), exist_ok=True)


# ---------- 转换 ----------
MAGIC = b"CNV1"


def transform(data):
    """确定性的分段转换：加魔数头并压缩。同样的输入永远得到同样的输出。"""
    return MAGIC + zlib.compress(data, 6)


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


# ---------- 状态推导 ----------
def worker_alive(fid):
    with _registry_lock:
        t = _workers.get(fid)
        return bool(t and t.is_alive())


def recompute_status(conn, fid):
    """根据分段与转换进度推导文件整体状态。"""
    rows = conn.execute(
        "SELECT status, converted FROM chunks WHERE file_id=?", (fid,)).fetchall()
    if not rows:
        return "receiving"
    statuses = [r["status"] for r in rows]
    if "conflict" in statuses:
        new = "conflict"
    elif "failed" in statuses:
        new = "failed"
    elif all(s == "received" for s in statuses):
        converted = sum(1 for r in rows if r["converted"])
        if converted == len(rows) and os.path.exists(output_path(fid)):
            new = "done"
        elif worker_alive(fid):
            new = "converting"
        else:
            new = "paused"  # 转换被中断，可从断点继续
    else:
        new = "receiving"
    conn.execute("UPDATE files SET status=? WHERE id=?", (new, fid))
    return new


# ---------- 后台转换 ----------
def start_conversion(fid):
    """启动（或继续）后台转换线程；只处理尚未转换的分段。"""
    with _registry_lock:
        t = _workers.get(fid)
        if t and t.is_alive():
            return False
        stop = threading.Event()
        _stop_flags[fid] = stop
        t = threading.Thread(target=conversion_worker, args=(fid,), daemon=True)
        _workers[fid] = t
        t.start()
    with _db_lock, connect() as conn:
        conn.execute("UPDATE files SET status='converting' WHERE id=?", (fid,))
    return True


def stop_conversion(fid):
    with _registry_lock:
        flag = _stop_flags.get(fid)
        if flag:
            flag.set()


def conversion_worker(fid):
    stop = _stop_flags.get(fid)
    try:
        while True:
            if stop and stop.is_set():
                break
            with _db_lock, connect() as conn:
                row = conn.execute(
                    "SELECT idx FROM chunks WHERE file_id=? AND status='received' "
                    "AND converted=0 ORDER BY idx LIMIT 1", (fid,)).fetchone()
            if row is None:
                break
            idx = row["idx"]
            with open(chunk_path(fid, idx), "rb") as fh:
                data = fh.read()
            # 模拟耗时的真实转换，让进度可见；耗时与数据量成正比，
            # 并可通过 convert_delay 设置额外延时（便于演示中断/续转）
            delay = min(1.0, 0.15 + len(data) / (8 * 1024 * 1024))
            delay = max(delay, float(get_setting("convert_delay", "0") or 0))
            time.sleep(delay)
            if stop and stop.is_set():
                break  # 中断：已写入磁盘的转换结果保留，下次从这里继续
            out = transform(data)
            tmp = converted_path(fid, idx) + ".tmp"
            with open(tmp, "wb") as fh:
                fh.write(out)
            os.replace(tmp, converted_path(fid, idx))  # 原子落盘，崩溃不留半成品
            with _db_lock, connect() as conn:
                conn.execute(
                    "UPDATE chunks SET converted=1 WHERE file_id=? AND idx=?",
                    (fid, idx))
                n = conn.execute(
                    "SELECT COUNT(*) AS c FROM chunks WHERE file_id=? AND converted=1",
                    (fid,)).fetchone()["c"]
                conn.execute("UPDATE files SET converted_count=? WHERE id=?", (n, fid))
        finalize_conversion(fid, stopped=bool(stop and stop.is_set()))
    except Exception as exc:  # noqa: BLE001
        with _db_lock, connect() as conn:
            conn.execute("UPDATE files SET status='failed', error=? WHERE id=?",
                         ("转换失败: %s" % exc, fid))
    finally:
        with _registry_lock:
            _workers.pop(fid, None)


def finalize_conversion(fid, stopped):
    with _db_lock, connect() as conn:
        if stopped:
            conn.execute("UPDATE files SET status='paused' WHERE id=?", (fid,))
            return
        rows = conn.execute(
            "SELECT idx, status, converted FROM chunks WHERE file_id=? ORDER BY idx",
            (fid,)).fetchall()
        if rows and all(r["status"] == "received" for r in rows) \
                and all(r["converted"] for r in rows):
            # 全部分段转换完成：按序拼接为最终产物
            h = hashlib.sha256()
            tmp = output_path(fid) + ".tmp"
            with open(tmp, "wb") as out:
                for r in rows:
                    with open(converted_path(fid, r["idx"]), "rb") as fh:
                        data = fh.read()
                    h.update(data)
                    out.write(data)
            os.replace(tmp, output_path(fid))
            conn.execute(
                "UPDATE files SET status='done', output_checksum=?, error=NULL "
                "WHERE id=?", (h.hexdigest(), fid))
        else:
            recompute_status(conn, fid)


# ---------- 冲突差异 ----------
def compute_diff(old, new):
    """找出两个字节串的差异位置（首个/末个不同字节及不同字节总数）。"""
    n = min(len(old), len(new))
    first = None
    last = None
    count = 0
    for i in range(n):
        if old[i] != new[i]:
            if first is None:
                first = i
            last = i
            count += 1
    if first is None and len(old) != len(new):
        first = n
        last = max(len(old), len(new)) - 1
    return {"first": first, "last": last, "diff_bytes": count,
            "old_len": len(old), "new_len": len(new)}


# ---------- 业务操作 ----------
def create_file(name, size, chunk_size):
    if not name:
        raise ValueError("文件名不能为空")
    if size <= 0:
        raise ValueError("文件大小必须大于 0")
    if chunk_size < 1024:
        raise ValueError("分段大小不能小于 1 KB")
    fid = uuid.uuid4().hex[:12]
    total = (size + chunk_size - 1) // chunk_size
    ensure_dirs(fid)
    with _db_lock, connect() as conn:
        conn.execute(
            "INSERT INTO files(id, name, size, chunk_size, total_chunks, status, "
            "created_at) VALUES(?,?,?,?,?,'receiving',?)",
            (fid, name, size, chunk_size, total, time.time()))
        conn.executemany(
            "INSERT INTO chunks(file_id, idx) VALUES(?, ?)",
            [(fid, i) for i in range(total)])
    return fid


def _fail_chunk(conn, fid, idx, reason):
    conn.execute(
        "UPDATE chunks SET status='failed', error=?, attempts=attempts+1 "
        "WHERE file_id=? AND idx=?", (reason, fid, idx))
    recompute_status(conn, fid)


def receive_chunk(fid, idx, body, client_checksum):
    """接收一个分段。返回 (http_code, payload)。"""
    with _db_lock, connect() as conn:
        f = conn.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        row = conn.execute(
            "SELECT * FROM chunks WHERE file_id=? AND idx=?",
            (fid, idx)).fetchone()
        if not f or not row:
            return 404, {"ok": False, "error": "文件或分段不存在"}
        computed = sha256_bytes(body)

        # 故障注入：一次性必失败 / 按比例随机失败
        if get_setting("fail_next", "0") == "1":
            set_setting("fail_next", "0")
            _fail_chunk(conn, fid, idx, "模拟故障：连接被对端重置（一次性故障注入）")
            return 200, {"ok": False, "error": "模拟故障：连接被对端重置（一次性故障注入）"}
        if random.random() < float(get_setting("fail_rate", "0") or 0):
            _fail_chunk(conn, fid, idx, "模拟故障：网络抖动导致分段传输中断")
            return 200, {"ok": False, "error": "模拟故障：网络抖动导致分段传输中断"}

        if client_checksum and client_checksum != computed:
            _fail_chunk(conn, fid, idx,
                        "校验和不匹配：数据在传输中损坏（客户端 %s，服务端 %s）"
                        % (client_checksum[:12], computed[:12]))
            return 200, {"ok": False, "error": "校验和不匹配，数据损坏"}

        if row["status"] == "received" and row["checksum"] == computed:
            # 幂等：相同内容重复上传，直接确认，不产生任何变化
            return 200, {"ok": True, "note": "内容一致，已跳过"}

        if row["status"] in ("received", "conflict") and row["checksum"] != computed:
            # 与先前记录不一致 -> 保留双方并标记差异，等待裁决
            ensure_dirs(fid)
            with open(conflict_path(fid, idx), "wb") as fh:
                fh.write(body)
            with open(chunk_path(fid, idx), "rb") as fh:
                old = fh.read()
            diff = compute_diff(old, body)
            conn.execute(
                "UPDATE chunks SET status='conflict', has_conflict=1, "
                "conflict_checksum=?, conflict_size=?, diff_json=?, "
                "attempts=attempts+1, error=NULL WHERE file_id=? AND idx=?",
                (computed, len(body), json.dumps(diff), fid, idx))
            recompute_status(conn, fid)
            return 200, {"ok": True, "conflict": True, "diff": diff}

        # 正常接收（pending / failed 重试）
        ensure_dirs(fid)
        tmp = chunk_path(fid, idx) + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(body)
        os.replace(tmp, chunk_path(fid, idx))
        conn.execute(
            "UPDATE chunks SET status='received', size=?, checksum=?, error=NULL, "
            "attempts=attempts+1 WHERE file_id=? AND idx=?",
            (len(body), computed, fid, idx))
        recompute_status(conn, fid)

    # 全部分段就绪后自动开始后台转换
    with _db_lock, connect() as conn:
        st = conn.execute("SELECT status FROM files WHERE id=?", (fid,)).fetchone()
        if st and st["status"] in ("receiving", "paused") and not worker_alive(fid):
            pending = conn.execute(
                "SELECT COUNT(*) AS c FROM chunks WHERE file_id=? AND "
                "status != 'received'", (fid,)).fetchone()["c"]
            if pending == 0:
                start_conversion(fid)
    return 200, {"ok": True}


def resolve_conflict(fid, idx, choice):
    """裁决冲突：keep_old 保留原有内容；keep_new 采用新内容。"""
    with _db_lock, connect() as conn:
        row = conn.execute(
            "SELECT * FROM chunks WHERE file_id=? AND idx=?", (fid, idx)).fetchone()
        if not row or row["status"] != "conflict":
            return 404, {"ok": False, "error": "该分段当前没有待裁决的冲突"}
        inc = conflict_path(fid, idx)
        if choice == "keep_new":
            os.replace(inc, chunk_path(fid, idx))
            # 仅作废该分段的转换结果与最终产物，其余分段转换结果保持原样
            if os.path.exists(converted_path(fid, idx)):
                os.remove(converted_path(fid, idx))
            if os.path.exists(output_path(fid)):
                os.remove(output_path(fid))
            conn.execute(
                "UPDATE chunks SET status='received', size=?, checksum=?, "
                "converted=0, has_conflict=0, conflict_checksum=NULL, "
                "conflict_size=NULL, diff_json=NULL, error=NULL "
                "WHERE file_id=? AND idx=?",
                (row["conflict_size"], row["conflict_checksum"], fid, idx))
            conn.execute(
                "UPDATE files SET output_checksum=NULL, converted_count=("
                "SELECT COUNT(*) FROM chunks WHERE file_id=? AND converted=1) "
                "WHERE id=?", (fid, fid))
        else:  # keep_old：丢弃新内容，原有分段与转换结果完全不动
            if os.path.exists(inc):
                os.remove(inc)
            conn.execute(
                "UPDATE chunks SET status='received', has_conflict=0, "
                "conflict_checksum=NULL, conflict_size=NULL, diff_json=NULL, "
                "error=NULL WHERE file_id=? AND idx=?", (fid, idx))
        recompute_status(conn, fid)
    with _db_lock, connect() as conn:
        st = conn.execute("SELECT status FROM files WHERE id=?", (fid,)).fetchone()
        if st and st["status"] in ("receiving", "paused") and not worker_alive(fid):
            missing = conn.execute(
                "SELECT COUNT(*) AS c FROM chunks WHERE file_id=? AND "
                "status != 'received'", (fid,)).fetchone()["c"]
            stale = conn.execute(
                "SELECT COUNT(*) AS c FROM chunks WHERE file_id=? AND "
                "status='received' AND converted=0", (fid,)).fetchone()["c"]
            if missing == 0 and stale > 0:
                start_conversion(fid)
    return 200, {"ok": True}


def verify_consistency(fid):
    """整体重推校验：从源分段全量重算最终产物校验和，与增量结果对比。"""
    with _db_lock, connect() as conn:
        f = conn.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
        if not f:
            return 404, {"ok": False, "error": "文件不存在"}
        rows = conn.execute(
            "SELECT idx, status, converted FROM chunks WHERE file_id=? ORDER BY idx",
            (fid,)).fetchall()
        if not rows or not all(r["status"] == "received" for r in rows):
            return 200, {"ok": True, "consistent": False,
                         "message": "分段尚未全部接收，无法校验"}
        if not f["output_checksum"] or not os.path.exists(output_path(fid)):
            return 200, {"ok": True, "consistent": False,
                         "message": "转换尚未完成，无法校验"}
        h = hashlib.sha256()
        for r in rows:
            with open(chunk_path(fid, r["idx"]), "rb") as fh:
                h.update(transform(fh.read()))
        expected = h.hexdigest()
        actual = f["output_checksum"]
        ok = expected == actual
        return 200, {
            "ok": True, "consistent": ok,
            "expected": expected, "actual": actual,
            "message": ("增量更新结果与整体重推完全一致"
                        if ok else "不一致！增量结果与整体重推存在差异"),
        }


def delete_file(fid):
    stop_conversion(fid)
    with _registry_lock:
        t = _workers.get(fid)
    if t and t.is_alive():
        t.join(timeout=5)
    with _db_lock, connect() as conn:
        conn.execute("DELETE FROM chunks WHERE file_id=?", (fid,))
        conn.execute("DELETE FROM files WHERE id=?", (fid,))
    shutil.rmtree(file_dir(fid), ignore_errors=True)


# ---------- 状态序列化 ----------
def build_state():
    with _db_lock, connect() as conn:
        files = []
        for f in conn.execute("SELECT * FROM files ORDER BY created_at"):
            chunks = []
            received = 0
            for c in conn.execute(
                    "SELECT * FROM chunks WHERE file_id=? ORDER BY idx", (f["id"],)):
                has_data = c["status"] in ("received", "conflict")
                if has_data:
                    received += 1
                chunks.append({
                    "idx": c["idx"],
                    "status": c["status"],
                    "size": c["size"],
                    "checksum": c["checksum"],
                    "error": c["error"],
                    "attempts": c["attempts"],
                    "has_conflict": bool(c["has_conflict"]),
                    "conflict_checksum": c["conflict_checksum"],
                    "conflict_size": c["conflict_size"],
                    "diff": json.loads(c["diff_json"]) if c["diff_json"] else None,
                    "converted": bool(c["converted"]),
                })
            total = f["total_chunks"]
            files.append({
                "id": f["id"],
                "name": f["name"],
                "size": f["size"],
                "chunk_size": f["chunk_size"],
                "total_chunks": total,
                "status": f["status"],
                "converted_count": f["converted_count"],
                "output_checksum": f["output_checksum"],
                "error": f["error"],
                "received_count": received,
                "recv_progress": received / total if total else 0,
                "conv_progress": (f["converted_count"] / total) if total else 0,
                "chunks": chunks,
            })
        return {
            "settings": {
                "fail_rate": float(get_setting("fail_rate", "0") or 0),
                "fail_next": get_setting("fail_next", "0") == "1",
                "convert_delay": float(get_setting("convert_delay", "0") or 0),
            },
            "files": files,
        }


# ---------- HTTP 层 ----------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _read_json(self):
        raw = self._read_body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._serve_static("index.html")
        elif path == "/api/state":
            self._json(build_state())
        elif path.startswith("/api/files/") and path.endswith("/download"):
            fid = path.split("/")[3]
            self._download(fid)
        else:
            self._json({"ok": False, "error": "not found"}, 404)

    def _serve_static(self, name):
        p = os.path.join(STATIC_DIR, name)
        if not os.path.isfile(p):
            self._json({"ok": False, "error": "static file missing"}, 404)
            return
        with open(p, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _download(self, fid):
        p = output_path(fid)
        if not os.path.isfile(p):
            self._json({"ok": False, "error": "产物尚未生成"}, 404)
            return
        with open(p, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition",
                         "attachment; filename=output_%s.bin" % fid)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urlparse(self.path).path
        parts = [p for p in path.split("/") if p]
        try:
            if path == "/api/settings":
                data = self._read_json()
                if "fail_rate" in data:
                    rate = max(0.0, min(1.0, float(data["fail_rate"])))
                    set_setting("fail_rate", rate)
                if "fail_next" in data:
                    set_setting("fail_next", "1" if data["fail_next"] else "0")
                if "convert_delay" in data:
                    set_setting("convert_delay",
                                max(0.0, float(data["convert_delay"])))
                self._json({"ok": True})
                return
            if path == "/api/files":
                data = self._read_json()
                fid = create_file(str(data.get("name", "")),
                                  int(data.get("size", 0)),
                                  int(data.get("chunk_size", 0)))
                self._json({"ok": True, "id": fid})
                return
            if len(parts) >= 3 and parts[0] == "api" and parts[1] == "files":
                fid = parts[2]
                if len(parts) == 5 and parts[3] == "chunks":
                    idx = int(parts[4])
                    body = self._read_body()
                    code, payload = receive_chunk(
                        fid, idx, body, self.headers.get("X-Client-Checksum"))
                    self._json(payload, code)
                    return
                if len(parts) == 6 and parts[3] == "chunks" and parts[5] == "resolve":
                    data = self._read_json()
                    code, payload = resolve_conflict(
                        fid, int(parts[4]), data.get("choice", "keep_old"))
                    self._json(payload, code)
                    return
                if len(parts) == 5 and parts[3] == "convert":
                    if parts[4] == "start":
                        started = start_conversion(fid)
                        with _db_lock, connect() as conn:
                            recompute_status(conn, fid)
                        self._json({"ok": True, "started": started})
                        return
                    if parts[4] == "stop":
                        stop_conversion(fid)
                        self._json({"ok": True})
                        return
                if len(parts) == 4 and parts[3] == "verify":
                    code, payload = verify_consistency(fid)
                    self._json(payload, code)
                    return
                if len(parts) == 4 and parts[3] == "delete":
                    delete_file(fid)
                    self._json({"ok": True})
                    return
            self._json({"ok": False, "error": "not found"}, 404)
        except ValueError as exc:
            self._json({"ok": False, "error": str(exc)}, 400)
        except Exception as exc:  # noqa: BLE001
            self._json({"ok": False, "error": "服务器内部错误: %s" % exc}, 500)


def main():
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("AutoDemo 离线分块处理服务已启动: http://127.0.0.1:%d" % port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
