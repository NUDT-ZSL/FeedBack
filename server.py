# -*- coding: utf-8 -*-
"""多渠道反馈分流系统后端:标准库 http.server + JSON 文件持久化"""
import json
import os
import re
import threading
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from analysis import (URGENCY_LABEL, detect_contradictions, impact_of,
                      norm_feature, priority_of, similarity, urgency_of)

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "data.json")
LOCK = threading.Lock()
MERGE_SIM_THRESHOLD = 0.08
DISPOSITIONS = ["立即修复", "排期优化", "转需求评审", "暂不处理", "需要更多信息"]

def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def new_id(prefix):
    return prefix + uuid.uuid4().hex[:8]

def empty_state():
    return {"items": [], "demands": [], "audit": []}

def load():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return empty_state()

def save(state):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)

def log(state, action, detail):
    state["audit"].append({"time": now(), "action": action, "detail": detail})

def find_demand(state, did):
    for d in state["demands"]:
        if d["id"] == did:
            return d
    return None

def demand_items(state, demand):
    by_id = {i["id"]: i for i in state["items"]}
    return [by_id[i] for i in demand["item_ids"] if i in by_id]

def compute_demand(state, demand):
    """重算诉求的合并依据、矛盾、影响面/紧急度与优先级(可解释)。"""
    items = demand_items(state, demand)
    demand["contradictions"] = detect_contradictions(items, demand.get("rulings", {}))
    impact, impact_expl = impact_of(items)
    urg = max((urgency_of(i["text"]) for i in items), default=1)
    urg_hits = sorted({URGENCY_LABEL[urgency_of(i["text"])] for i in items})
    score, level = priority_of(impact, urg)
    demand["impact"] = impact
    demand["impact_expl"] = impact_expl
    demand["urgency"] = urg
    demand["urgency_expl"] = "、".join(urg_hits) if urg_hits else "一般反馈"
    demand["priority_score"] = score
    demand["priority_level"] = level
    demand["priority_expl"] = f"影响面{impact}×2 + 紧急度{urg}×3 = {score}"
    return demand

def attach_item(state, item):
    """把新条目并入最匹配的诉求或新建诉求;返回(诉求, 动作, 依据)。"""
    best, best_sim, best_reason = None, 0.0, ""
    nf = norm_feature(item["feature"])
    for d in state["demands"]:
        if norm_feature(d["feature"]) != nf:
            continue
        sims = []
        for iid in d["item_ids"]:
            other = next((i for i in state["items"] if i["id"] == iid), None)
            if other:
                sims.append(similarity(item["text"], other["text"]))
        s = max(sims) if sims else 0.0
        if s > best_sim:
            best, best_sim = d, s
            best_reason = f"同一功能点「{d['feature']}」,与已有反馈最高文本相似度 {s:.2f}"
    if best is not None and best_sim >= MERGE_SIM_THRESHOLD:
        best["item_ids"].append(item["id"])
        item["demand_id"] = best["id"]
        best.setdefault("merge_log", []).append({
            "time": now(), "item_id": item["id"],
            "reason": best_reason + f"(阈值 {MERGE_SIM_THRESHOLD})"})
        if best["status"] == "已裁定":
            best["status"] = "待重审"
            best["stale_reason"] = (f"{now()} 收到新来源反馈(条目 {item['id']}),"
                                    "判定依据已变化,需重新确认去向;确认前旧结论不生效。")
            log(state, "判定失效", f"诉求 {best['id']} 收到新反馈,转入待重审")
        compute_demand(state, best)
        return best, "merged", best_reason
    demand = {
        "id": new_id("D"), "feature": item["feature"],
        "title": item["text"][:40], "item_ids": [item["id"]],
        "status": "待处理", "disposition": None, "rulings": {},
        "merge_log": [{"time": now(), "item_id": item["id"],
                       "reason": f"新建诉求:功能点「{item['feature']}」下无相似度达标的既有诉求"}],
        "created_at": now(), "adjudications": [], "stale_reason": None,
    }
    item["demand_id"] = demand["id"]
    compute_demand(state, demand)
    state["demands"].append(demand)
    return demand, "created", "新建诉求"

def parse_import(raw):
    """支持 JSON 数组或行式:来源|功能点|时间|文本"""
    raw = (raw or "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        data = json.loads(raw)
        return [{"source": str(x.get("source", "")).strip(),
                 "feature": str(x.get("feature", "")).strip(),
                 "time": str(x.get("time", "")).strip() or now(),
                 "text": str(x.get("text", "")).strip()} for x in data]
    rows = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 4:
            raise ValueError(f"行格式错误(需 来源|功能点|时间|文本):{line[:40]}")
        rows.append({"source": parts[0], "feature": parts[1],
                     "time": parts[2] or now(), "text": parts[3]})
    return rows

SAMPLE_ROWS = [
    {"source": "工单", "feature": "数据导出", "time": "2026-09-18 09:12", "text": "导出报表时系统直接崩溃,数据丢失,无法使用,请尽快处理"},
    {"source": "社区", "feature": "数据导出", "time": "2026-09-18 14:40", "text": "导出功能一直报错失败,点导出就闪退"},
    {"source": "客服记录", "feature": "数据导出", "time": "2026-09-19 10:05", "text": "客户反馈导出报表闪退报错,无法完成导出"},
    {"source": "社区", "feature": "数据导出", "time": "2026-09-19 16:22", "text": "建议保留旧版导出按钮,不要删除,老用户还需要"},
    {"source": "工单", "feature": "数据导出", "time": "2026-09-20 08:47", "text": "建议移除旧版导出入口,和新版重复,请下线旧入口"},
    {"source": "客服记录", "feature": "消息通知", "time": "2026-09-18 11:30", "text": "用户希望通知默认开启,现在默认关闭导致漏消息"},
    {"source": "社区", "feature": "消息通知", "time": "2026-09-19 09:15", "text": "建议通知默认关闭,默认开启太打扰,应该关闭"},
    {"source": "工单", "feature": "搜索", "time": "2026-09-20 13:02", "text": "搜索加载太慢,经常超时,卡顿明显"},
    {"source": "社区", "feature": "搜索", "time": "2026-09-20 15:44", "text": "搜索速度很流畅,不卡,体验很好"},
    {"source": "客服记录", "feature": "搜索", "time": "2026-09-21 09:20", "text": "多位客户反馈搜索响应很慢,希望优化"},
]

def import_rows(state, rows):
    results = []
    for r in rows:
        if not r.get("text"):
            continue
        item = {"id": new_id("F"), "source": r.get("source") or "未标注",
                "feature": r.get("feature") or "未分类",
                "time": r.get("time") or now(), "text": r["text"],
                "imported_at": now(), "demand_id": None}
        state["items"].append(item)
        demand, action, reason = attach_item(state, item)
        results.append({"item_id": item["id"], "demand_id": demand["id"],
                        "action": action, "reason": reason})
        log(state, "导入反馈", f"[{item['source']}] {item['text'][:30]} -> {demand['id']}({action})")
    merge_demands(state)
    return results

def merge_demands(state):
    """导入后兜底:同功能点下若两个诉求间最高相似度达标则归并。"""
    changed = True
    while changed:
        changed = False
        for i in range(len(state["demands"])):
            for j in range(i + 1, len(state["demands"])):
                a, b = state["demands"][i], state["demands"][j]
                if norm_feature(a["feature"]) != norm_feature(b["feature"]):
                    continue
                sim = max((similarity(x["text"], y["text"])
                           for x in demand_items(state, a)
                           for y in demand_items(state, b)), default=0.0)
                if sim >= MERGE_SIM_THRESHOLD:
                    a["item_ids"] += b["item_ids"]
                    for it in state["items"]:
                        if it["id"] in b["item_ids"]:
                            it["demand_id"] = a["id"]
                    a.setdefault("merge_log", []).append({
                        "time": now(), "item_id": ",".join(b["item_ids"]),
                        "reason": f"诉求级归并:与诉求 {b['id']} 最高相似度 {sim:.2f}(阈值 {MERGE_SIM_THRESHOLD})"})
                    a["merge_log"] += b.get("merge_log", [])
                    a["adjudications"] += b.get("adjudications", [])
                    a.setdefault("rulings", {}).update(b.get("rulings", {}))
                    if a["status"] == "已裁定" or b["status"] == "已裁定":
                        a["status"] = "待重审"
                        a["stale_reason"] = f"{now()} 发生诉求归并,判定依据已变化,需重新确认去向。"
                    state["demands"].remove(b)
                    compute_demand(state, a)
                    log(state, "诉求归并", f"{b['id']} 并入 {a['id']}(相似度 {sim:.2f})")
                    changed = True
                    break
            if changed:
                break

def adjudicate(state, demand, disposition, note, operator):
    demand["disposition"] = disposition
    demand["status"] = "已裁定"
    demand["stale_reason"] = None
    compute_demand(state, demand)
    record = {"time": now(), "operator": operator or "运营",
              "disposition": disposition, "note": note or "",
              "priority": demand["priority_level"],
              "basis": (f"影响面 {demand['impact']}({demand['impact_expl']});"
                        f"紧急度 {demand['urgency']}({demand['urgency_expl']});"
                        f"{demand['priority_expl']}")}
    demand["adjudications"].append(record)
    log(state, "裁定去向", f"诉求 {demand['id']} -> {disposition},优先级 {demand['priority_level']}")
    return record

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/api/state":
            with LOCK:
                self._send(200, load())
            return
        path = self.path.split("?")[0]
        if path == "/":
            path = "/index.html"
        fp = os.path.normpath(os.path.join(BASE, "static", path.lstrip("/")))
        if os.path.isfile(fp) and fp.startswith(os.path.join(BASE, "static")):
            ctype = {".html": "text/html", ".js": "text/javascript",
                     ".css": "text/css"}.get(os.path.splitext(fp)[1], "application/octet-stream")
            data = open(fp, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            with LOCK:
                state = load()
                out = self.route(state)
                save(state)
            self._send(200, out)
        except Exception as e:
            self._send(400, {"error": str(e)})

    def route(self, state):
        p = self.path
        if p == "/api/import":
            rows = parse_import(self._body().get("raw", ""))
            return {"results": import_rows(state, rows)}
        if p == "/api/sample":
            return {"results": import_rows(state, SAMPLE_ROWS)}
        if p == "/api/reset":
            state.clear()
            state.update(empty_state())
            return {"ok": True}
        m = re.fullmatch(r"/api/demand/([\w-]+)/(\w+)", p)
        if m:
            demand = find_demand(state, m.group(1))
            if not demand:
                raise ValueError("诉求不存在")
            act = m.group(2)
            body = self._body()
            if act == "adjudicate":
                disp = body.get("disposition")
                if disp not in DISPOSITIONS:
                    raise ValueError("非法的处理去向")
                return {"record": adjudicate(state, demand, disp,
                                             body.get("note"), body.get("operator"))}
            if act == "contradiction":
                aspect, resolution = body.get("aspect"), (body.get("resolution") or "").strip()
                if not aspect or not resolution:
                    raise ValueError("缺少矛盾方面或裁定结论")
                demand.setdefault("rulings", {})[aspect] = {
                    "resolution": resolution, "time": now(),
                    "operator": body.get("operator") or "运营"}
                compute_demand(state, demand)
                log(state, "矛盾裁定", f"诉求 {demand['id']} 方面「{aspect}」:{resolution[:40]}")
                return {"ok": True}
            if act == "confirm":
                disp = body.get("disposition") or demand.get("disposition")
                if disp not in DISPOSITIONS:
                    raise ValueError("请先选择处理去向再确认")
                return {"record": adjudicate(state, demand, disp,
                                             body.get("note") or "依据变化后重新确认",
                                             body.get("operator"))}
        raise ValueError("未知接口 " + p)

def main():
    port = int(os.environ.get("PORT", "8787"))
    print(f"反馈分流系统已启动: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

if __name__ == "__main__":
    main()
