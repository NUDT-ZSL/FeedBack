#!/usr/bin/env python3
"""本地离线数据血缘推演工具 - HTTP 服务。

仅依赖 Python 标准库。运行: python server.py 然后访问 http://127.0.0.1:8000
"""
import json
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import lineage_engine as engine

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, "data.json")
STATIC_DIR = os.path.join(ROOT, "static")
PORT = int(os.environ.get("LINEAGE_PORT", "8000"))


def new_id(prefix):
    return "%s_%s" % (prefix, uuid.uuid4().hex[:8])


def _ds(i, name, kind, fields):
    return {"id": i, "name": name, "kind": kind, "status": "active",
            "version": 1, "fields": [{"name": n, "type": t} for n, t in fields]}


def _der(i, target, note, steps, inputs, versions):
    return {"id": i, "target": target, "note": note, "status": "active",
            "version": 1, "steps": steps, "inputs": inputs,
            "input_versions": versions}


def demo_data():
    """内置演示血缘: 3 个源表 + 5 个派生数据集, 其中 dws_region_sales 带冲突口径。"""
    datasets = [
        _ds("src_orders", "订单流水", "source",
            [("order_id", "string"), ("user_id", "string"), ("amount", "decimal"),
             ("pay_time", "datetime"), ("order_time", "datetime")]),
        _ds("src_users", "用户维表", "source",
            [("user_id", "string"), ("region", "string"), ("level", "string")]),
        _ds("src_refunds", "退款流水", "source",
            [("refund_id", "string"), ("order_id", "string"), ("refund_amount", "decimal")]),
        _ds("dwd_order_detail", "订单明细(关联用户)", "derived",
            [("order_id", "string"), ("user_id", "string"), ("amount", "decimal"),
             ("region", "string"), ("pay_time", "datetime")]),
        _ds("dws_user_refund", "用户退款汇总", "derived",
            [("user_id", "string"), ("total_refund", "decimal")]),
        _ds("ads_user_360", "用户全景画像", "derived",
            [("user_id", "string"), ("region", "string"),
             ("total_amount", "decimal"), ("total_refund", "decimal")]),
        _ds("rpt_daily_sales", "每日销售报表", "derived",
            [("day", "date"), ("total_amount", "decimal")]),
        _ds("dws_region_sales", "大区销售汇总", "derived",
            [("region", "string"), ("total_amount", "decimal")]),
    ]
    m = lambda fr, to: {"from": fr, "to": to}
    derivations = [
        _der("der_order_detail", "dwd_order_detail", "订单关联用户维表补全地区",
             [{"name": "join_users", "operation": "JOIN", "description": "按 user_id 关联用户维表"},
              {"name": "dedup", "operation": "DISTINCT", "description": "按 order_id 去重"}],
             [{"dataset": "src_orders",
               "mappings": [m("order_id", "order_id"), m("user_id", "user_id"),
                            m("amount", "amount"), m("pay_time", "pay_time")]},
              {"dataset": "src_users",
               "mappings": [m("region", "region")]}],
             {"src_orders": 1, "src_users": 1}),
        _der("der_user_refund", "dws_user_refund", "退款流水关联订单后按用户汇总",
             [{"name": "join_orders", "operation": "JOIN", "description": "按 order_id 关联订单"},
              {"name": "agg", "operation": "GROUP_BY", "description": "按 user_id 汇总退款金额"}],
             [{"dataset": "src_refunds",
               "mappings": [m("refund_amount", "total_refund")]},
              {"dataset": "src_orders",
               "mappings": [m("user_id", "user_id")]}],
             {"src_refunds": 1, "src_orders": 1}),
        _der("der_user_360", "ads_user_360", "订单明细与用户退款汇总拼接画像",
             [{"name": "join", "operation": "JOIN", "description": "按 user_id 全连接"},
              {"name": "agg", "operation": "GROUP_BY", "description": "汇总消费与退款"}],
             [{"dataset": "dwd_order_detail",
               "mappings": [m("user_id", "user_id"), m("region", "region"),
                            m("amount", "total_amount")]},
              {"dataset": "dws_user_refund",
               "mappings": [m("total_refund", "total_refund")]}],
             {"dwd_order_detail": 1, "dws_user_refund": 1}),
        _der("der_daily_sales", "rpt_daily_sales", "按支付日期汇总销售额",
             [{"name": "agg", "operation": "GROUP_BY", "description": "按支付日期汇总"}],
             [{"dataset": "dwd_order_detail",
               "mappings": [m("pay_time", "day"), m("amount", "total_amount")]}],
             {"dwd_order_detail": 1}),
        _der("der_region_by_order", "dws_region_sales", "口径A: 按下单时间归属大区",
             [{"name": "agg", "operation": "GROUP_BY", "description": "按地区+下单时间汇总"}],
             [{"dataset": "dwd_order_detail",
               "mappings": [m("region", "region"), m("amount", "total_amount")]}],
             {"dwd_order_detail": 1}),
        _der("der_region_by_pay", "dws_region_sales", "口径B: 按支付时间归属大区",
             [{"name": "agg", "operation": "GROUP_BY", "description": "按地区+支付时间汇总"}],
             [{"dataset": "dwd_order_detail",
               "mappings": [m("region", "region"), m("amount", "total_amount")]}],
             {"dwd_order_detail": 1}),
    ]
    return {"datasets": {d["id"]: d for d in datasets},
            "derivations": {d["id"]: d for d in derivations}}


class Store(object):
    """持有血缘数据, 应用变更并记录每次操作引起的下游状态变化。"""

    def __init__(self):
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = demo_data()
        self.events = []
        self.states, self.diagnostics = engine.evaluate(self.data)

    def save(self):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def snapshot(self):
        return {"datasets": self.data["datasets"],
                "derivations": self.data["derivations"],
                "states": self.states,
                "state_labels": engine.STATE_LABELS,
                "diagnostics": self.diagnostics,
                "events": self.events[-100:]}

    def mutate(self, action, changed_ids, fn):
        """应用变更 fn, 只重算受影响下游闭包, 并校验与全量推演一致。"""
        prev = self.states
        fn()
        closure = engine.downstream_closure(self.data, changed_ids)
        new_states, diags = engine.evaluate(self.data, prev_states=prev, only=closure)
        full_states, full_diags = engine.evaluate(self.data)
        consistent = all(new_states.get(k) == v for k, v in full_states.items())
        if consistent:  # 增量与全量一致时采用全量诊断(信息更完整)
            diags = full_diags
        else:           # 理论上不应发生; 发生时回退全量结果保证正确
            new_states, diags = full_states, full_diags
        changes = []
        for nid in sorted(closure):
            old = prev.get(nid, {}).get("state")
            new = new_states.get(nid, {}).get("state")
            if old != new:
                changes.append({"dataset": nid, "from": old, "to": new})
        self.states, self.diagnostics = new_states, diags
        self.events.append({
            "time": time.strftime("%H:%M:%S"),
            "action": action,
            "affected": sorted(closure),
            "changes": changes,
            "consistent": consistent,
        })
        self.save()
        return self.snapshot()

    def reset(self):
        self.data = demo_data()
        self.states, self.diagnostics = engine.evaluate(self.data)
        self.events.append({"time": time.strftime("%H:%M:%S"),
                            "action": "重置为演示数据", "affected": [],
                            "changes": [], "consistent": True})
        self.save()
        return self.snapshot()


STORE = Store()


# ---------------- API 动作 ----------------

def api_create_dataset(body):
    i = new_id("ds")
    ds = {"id": i, "name": body.get("name") or i, "kind": body.get("kind", "source"),
          "status": "active", "version": 1, "fields": body.get("fields", [])}
    def fn():
        STORE.data["datasets"][i] = ds
    return STORE.mutate("新建数据集 %s" % ds["name"], [i], fn)


def api_update_dataset(i, body):
    ds = STORE.data["datasets"][i]
    def fn():
        if "name" in body:
            ds["name"] = body["name"]
        if "fields" in body:
            ds["fields"] = body["fields"]
        ds["version"] = ds.get("version", 1) + 1
    return STORE.mutate("修改数据集定义 %s (v%s)" % (ds.get("name", i), ds.get("version", 1) + 1), [i], fn)


def api_dataset_status(i, body):
    ds = STORE.data["datasets"][i]
    status = body.get("status")
    if status not in ("active", "disabled"):
        raise ValueError("status 只能是 active/disabled")
    def fn():
        ds["status"] = status
        ds["version"] = ds.get("version", 1) + 1
    label = "停用" if status == "disabled" else "启用"
    return STORE.mutate("%s数据集 %s" % (label, ds.get("name", i)), [i], fn)


def api_dataset_recomputed(i):
    ds = STORE.data["datasets"][i]
    def fn():
        for der in STORE.data["derivations"].values():
            if der["target"] == i and der.get("status", "active") == "active":
                der["input_versions"] = {
                    inp["dataset"]: STORE.data["datasets"].get(inp["dataset"], {}).get("version", 1)
                    for inp in der.get("inputs", [])}
    return STORE.mutate("标记已重算 %s" % ds.get("name", i), [i], fn)


def api_create_derivation(body):
    i = new_id("der")
    target = body["target"]
    inputs = body.get("inputs", [])
    der = {"id": i, "target": target, "note": body.get("note", ""),
           "status": "active", "version": 1,
           "steps": body.get("steps", []), "inputs": inputs,
           "input_versions": {inp["dataset"]: STORE.data["datasets"].get(inp["dataset"], {}).get("version", 1)
                              for inp in inputs}}
    def fn():
        STORE.data["derivations"][i] = der
    return STORE.mutate("新增派生依据 %s -> %s" % (i, target), [target], fn)


def api_update_derivation(i, body):
    der = STORE.data["derivations"][i]
    def fn():
        for k in ("note", "steps", "inputs"):
            if k in body:
                der[k] = body[k]
        der["version"] = der.get("version", 1) + 1
        der["input_versions"] = {
            inp["dataset"]: STORE.data["datasets"].get(inp["dataset"], {}).get("version", 1)
            for inp in der.get("inputs", [])}
    return STORE.mutate("修改派生依据 %s" % i, [der["target"]], fn)


def api_delete_derivation(i):
    der = STORE.data["derivations"][i]
    def fn():
        del STORE.data["derivations"][i]
    return STORE.mutate("删除派生依据 %s" % i, [der["target"]], fn)


def api_adopt_derivation(i):
    der = STORE.data["derivations"][i]
    target = der["target"]
    def fn():
        for d in STORE.data["derivations"].values():
            if d["target"] == target:
                d["status"] = "active" if d["id"] == i else "superseded"
        der["input_versions"] = {
            inp["dataset"]: STORE.data["datasets"].get(inp["dataset"], {}).get("version", 1)
            for inp in der.get("inputs", [])}
    return STORE.mutate("裁决采用派生依据 %s (%s)" % (i, der.get("note", "")), [target], fn)


# ---------------- HTTP 层 ----------------

ROUTES = [
    ("POST", r"^/api/reset$", lambda b, m: STORE.reset()),
    ("GET", r"^/api/state$", lambda b, m: STORE.snapshot()),
    ("POST", r"^/api/datasets$", lambda b, m: api_create_dataset(b)),
    ("PUT", r"^/api/datasets/([\w-]+)$", lambda b, m: api_update_dataset(m[0], b)),
    ("POST", r"^/api/datasets/([\w-]+)/status$", lambda b, m: api_dataset_status(m[0], b)),
    ("POST", r"^/api/datasets/([\w-]+)/recomputed$", lambda b, m: api_dataset_recomputed(m[0])),
    ("POST", r"^/api/derivations$", lambda b, m: api_create_derivation(b)),
    ("PUT", r"^/api/derivations/([\w-]+)$", lambda b, m: api_update_derivation(m[0], b)),
    ("DELETE", r"^/api/derivations/([\w-]+)$", lambda b, m: api_delete_derivation(m[0])),
    ("POST", r"^/api/derivations/([\w-]+)/adopt$", lambda b, m: api_adopt_derivation(m[0])),
]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send_json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_file(self, path, ctype):
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def _handle(self, method):
        path = urlparse(self.path).path
        if method == "GET" and path in ("/", "/index.html"):
            return self._send_file(os.path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8")
        if method == "GET" and path.startswith("/static/"):
            name = os.path.basename(path)
            fp = os.path.join(STATIC_DIR, name)
            if os.path.isfile(fp):
                ctype = {"js": "application/javascript", "css": "text/css",
                         "html": "text/html"}.get(name.rsplit(".", 1)[-1], "application/octet-stream")
                return self._send_file(fp, ctype)
            return self._send_json({"error": "not found"}, 404)
        for m_method, pattern, fn in ROUTES:
            if m_method != method:
                continue
            mt = re.match(pattern, path)
            if not mt:
                continue
            try:
                body = self._read_json() if method in ("POST", "PUT") else {}
                return self._send_json(fn(body, mt.groups()))
            except KeyError as exc:
                return self._send_json({"error": "对象不存在: %s" % exc}, 404)
            except (ValueError, TypeError) as exc:
                return self._send_json({"error": str(exc)}, 400)
        self._send_json({"error": "not found"}, 404)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")


def main():
    print("数据血缘推演工具已启动: http://127.0.0.1:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
