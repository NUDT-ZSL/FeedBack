# -*- coding: utf-8 -*-
"""物料循环去向推演工具 - 本地离线服务。

运行: python server.py [--port 8765]
启动后自动打开本地界面 http://127.0.0.1:8765/
数据持久化在 data/store.json，全程离线，无外部依赖。
"""
import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STORE_PATH = os.path.join(DATA_DIR, "store.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")

LOCK = threading.Lock()
STATE = None
RESULTS = {}          # 当前（增量维护的）推演结果
LAST_MODE = "full"    # 最近一次重推方式
LAST_AFFECTED = []    # 最近一次增量重推的受影响批次


# ---------------------------------------------------------------- 持久化

def load_state():
    global STATE
    if os.path.exists(STORE_PATH):
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            STATE = json.load(f)
    else:
        STATE = engine.new_state()
        seed_demo(STATE)
        save_state()


def save_state():
    if not os.path.isdir(DATA_DIR):
        os.makedirs(DATA_DIR)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(STATE, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STORE_PATH)


def seed_demo(state):
    """首次启动写入演示数据：含正常链路、冲突、修正历史、异常链路。"""
    b1 = engine.add_batch(state, "原料批次A-2026", 1000, "供应商甲", "回收线1", "2026-09-01")
    b2 = engine.add_batch(state, "再生批次B-2026", 0, "批次A转入", "再利用线", "2026-09-05")
    b3 = engine.add_batch(state, "尾料批次C-2026", 0, "批次B转入", "待定", "2026-09-08")
    engine.add_record(state, b1, "2026-09-02 09:00", 600, "回收", note="首批回收")
    engine.add_record(state, b1, "2026-09-03 10:00", 300, "转出", dest_batch=b2, note="转入再生")
    engine.add_record(state, b2, "2026-09-06 14:00", 250, "再利用", note="再生利用")
    engine.add_record(state, b2, "2026-09-07 09:30", 30, "损耗", note="加工损耗")
    # 冲突：同一批次同一时刻两条矛盾记录
    engine.add_record(state, b2, "2026-09-07 16:00", 20, "转出", dest_batch=b3, note="仓管登记")
    engine.add_record(state, b2, "2026-09-07 16:00", 35, "损耗", note="巡检登记")
    # 修正历史演示
    r = engine.add_record(state, b1, "2026-09-02 18:00", 50, "损耗", note="初录损耗")
    engine.correct_record(state, r, 45, "损耗", note="复核后修正为45")
    # 异常链路演示：转出指向不存在的批次
    engine.add_record(state, b3, "2026-09-09 11:00", 10, "转出",
                      dest_batch="B9999", note="指向未登记批次")


# ---------------------------------------------------------------- 推演调度

def recompute(affected=None):
    """affected 为 None 时全量重推，否则仅重推受影响链路。"""
    global RESULTS, LAST_MODE, LAST_AFFECTED
    if affected is None or not RESULTS:
        out = engine.compute(STATE)
        RESULTS = out["results"]
        LAST_MODE = "full"
        LAST_AFFECTED = sorted(STATE["batches"])
        return out
    out = engine.compute(STATE, only_batches=affected, prev_results=RESULTS)
    RESULTS = out["results"]
    LAST_MODE = "incremental"
    LAST_AFFECTED = sorted(engine.downstream_closure(
        [(f, t, None) for f, t, _ in
         [(e[0], e[1], None) for e in out["edges"]]], affected))
    return out


def build_payload(recompute_out):
    ok, diffs = engine.verify_incremental(STATE, RESULTS)
    return {
        "batches": list(STATE["batches"].values()),
        "records": sorted(STATE["records"].values(),
                          key=lambda r: (r["batch_id"], r["ts"], r["id"])),
        "results": RESULTS,
        "conflicts": engine.detect_conflicts(STATE),
        "anomalies": recompute_out["anomalies"],
        "cycles": recompute_out["cycles"],
        "edges": recompute_out["edges"],
        "closure": engine.closure_summary(STATE, RESULTS),
        "meta": {
            "recompute_mode": LAST_MODE,
            "affected_batches": LAST_AFFECTED,
            "incremental_matches_full": ok,
            "diff_batches": diffs,
        },
    }


# ---------------------------------------------------------------- HTTP 接口

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            with LOCK:
                self._send_json(build_payload(recompute()))
            return
        if path == "/api/verify":
            with LOCK:
                ok, diffs = engine.verify_incremental(STATE, RESULTS)
                self._send_json({"consistent": ok, "diff_batches": diffs,
                                 "mode": LAST_MODE})
            return
        fname = "index.html" if path in ("/", "") else path.lstrip("/")
        fpath = os.path.normpath(os.path.join(STATIC_DIR, fname))
        if not fpath.startswith(STATIC_DIR) or not os.path.isfile(fpath):
            self.send_error(404)
            return
        ctype = {".html": "text/html", ".js": "text/javascript",
                 ".css": "text/css"}.get(
                     os.path.splitext(fpath)[1], "application/octet-stream")
        with open(fpath, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            with LOCK:
                self._handle_post()
        except ValueError as e:
            self._send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            self._send_json({"error": "服务器内部错误: %s" % e}, 500)

    def _handle_post(self):
        path = self.path.split("?")[0]
        d = self._read_json()
        if path == "/api/batch":
            engine.add_batch(STATE, d["name"], d["input_qty"],
                             d.get("source", ""), d.get("initial_dest", ""),
                             d.get("created_at", ""))
            out = recompute()
        elif path == "/api/record":
            rid = engine.add_record(STATE, d["batch_id"], d["ts"], d["qty"],
                                    d["dest_type"], d.get("dest_batch", ""),
                                    d.get("note", ""))
            affected = {d["batch_id"]}
            if d.get("dest_batch"):
                affected.add(d["dest_batch"])
            out = recompute(affected)
        elif path == "/api/correct":
            rid, affected = engine.correct_record(
                STATE, d["record_id"], d["qty"], d["dest_type"],
                d.get("dest_batch", ""), d.get("note", ""))
            out = recompute(affected)
        elif path == "/api/resolve":
            affected = engine.resolve_conflict(STATE, d["winner_id"],
                                               d.get("note", ""))
            out = recompute(affected)
        elif path == "/api/recompute":
            out = recompute()
        else:
            self.send_error(404)
            return
        save_state()
        self._send_json(build_payload(out))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    load_state()
    recompute()
    url = "http://127.0.0.1:%d/" % args.port
    print("物料循环去向推演工具已启动: %s （数据文件: %s）" % (url, STORE_PATH))
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
