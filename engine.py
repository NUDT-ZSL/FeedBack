# -*- coding: utf-8 -*-
"""物料循环去向推演引擎（纯逻辑，无 IO 依赖，便于测试）。

数据模型（state 为普通 dict，可直接 JSON 序列化）：
  batches: {id: {id, name, input_qty, source, initial_dest, created_at}}
  records: {id: {id, batch_id, ts, qty, dest_type, dest_batch, note,
                 status, correction_of, superseded_by, ruling_note}}
    status: active | rejected | superseded
  seq: 自增序号
"""

DEST_TYPES = ["回收", "再利用", "损耗", "转出"]


def new_state():
    return {"batches": {}, "records": {}, "seq": 0}


def _next_id(state, prefix):
    state["seq"] += 1
    return "%s%04d" % (prefix, state["seq"])


def active_records(state):
    return [r for r in state["records"].values() if r["status"] == "active"]


# ---------------------------------------------------------------- 变更操作

def add_batch(state, name, input_qty, source, initial_dest, created_at=""):
    bid = _next_id(state, "B")
    state["batches"][bid] = {
        "id": bid, "name": name, "input_qty": float(input_qty),
        "source": source, "initial_dest": initial_dest,
        "created_at": created_at,
    }
    return bid


def add_record(state, batch_id, ts, qty, dest_type, dest_batch="", note=""):
    if batch_id not in state["batches"]:
        raise ValueError("批次不存在: %s" % batch_id)
    if dest_type not in DEST_TYPES:
        raise ValueError("非法去向类型: %s" % dest_type)
    rid = _next_id(state, "R")
    state["records"][rid] = {
        "id": rid, "batch_id": batch_id, "ts": ts, "qty": float(qty),
        "dest_type": dest_type, "dest_batch": dest_batch or "",
        "note": note, "status": "active",
        "correction_of": "", "superseded_by": "", "ruling_note": "",
    }
    return rid


def correct_record(state, record_id, qty, dest_type, dest_batch="", note=""):
    """修正记录：原记录标记 superseded 并保留，生成新的有效记录。"""
    old = state["records"].get(record_id)
    if old is None:
        raise ValueError("记录不存在: %s" % record_id)
    if old["status"] != "active":
        raise ValueError("仅可修正有效记录，当前状态: %s" % old["status"])
    if dest_type not in DEST_TYPES:
        raise ValueError("非法去向类型: %s" % dest_type)
    rid = _next_id(state, "R")
    state["records"][rid] = {
        "id": rid, "batch_id": old["batch_id"], "ts": old["ts"],
        "qty": float(qty), "dest_type": dest_type,
        "dest_batch": dest_batch or "", "note": note,
        "status": "active", "correction_of": record_id,
        "superseded_by": "", "ruling_note": "",
    }
    old["status"] = "superseded"
    old["superseded_by"] = rid
    affected = {old["batch_id"]}
    for b in (old.get("dest_batch") or "", dest_batch or ""):
        if b:
            affected.add(b)
    return rid, affected


def resolve_conflict(state, winner_id, note=""):
    """冲突裁决：保留全部来源，同组其余有效记录标记 rejected。"""
    winner = state["records"].get(winner_id)
    if winner is None or winner["status"] != "active":
        raise ValueError("裁决对象必须是有效记录: %s" % winner_id)
    affected = {winner["batch_id"]}
    for r in active_records(state):
        if r["id"] != winner_id and (r["batch_id"], r["ts"]) == \
                (winner["batch_id"], winner["ts"]):
            r["status"] = "rejected"
            r["ruling_note"] = note or "裁决保留 %s" % winner_id
            if r.get("dest_batch"):
                affected.add(r["dest_batch"])
    winner["ruling_note"] = note or "裁决为本组有效记录"
    if winner.get("dest_batch"):
        affected.add(winner["dest_batch"])
    return affected


# ---------------------------------------------------------------- 推演分析

def detect_conflicts(state):
    """同一批次同一时刻存在多条有效记录 -> 冲突组（全部保留，不静默择一）。"""
    groups = {}
    for r in active_records(state):
        groups.setdefault((r["batch_id"], r["ts"]), []).append(r)
    conflicts = []
    for (bid, ts), recs in sorted(groups.items()):
        if len(recs) < 2:
            continue
        sigs = {(r["qty"], r["dest_type"], r.get("dest_batch") or "")
                for r in recs}
        kind = "重复登记" if len(sigs) == 1 else "数量/去向矛盾"
        conflicts.append({
            "batch_id": bid, "ts": ts, "kind": kind,
            "record_ids": [r["id"] for r in recs],
        })
    return conflicts


def _build_edges(state):
    """由有效转出记录构建批次间链路，并收集前置缺失异常。"""
    edges = []      # (from_batch, to_batch, record)
    anomalies = []
    for r in active_records(state):
        if r["dest_type"] != "转出":
            continue
        tb = r.get("dest_batch") or ""
        if not tb or tb not in state["batches"]:
            anomalies.append({
                "type": "前置批次缺失", "batch_id": r["batch_id"],
                "record_id": r["id"],
                "detail": "记录 %s 转出指向不存在或未登记的批次「%s」，"
                          "该链路不计入正常流转。" % (r["id"], tb or "（空）"),
            })
        else:
            edges.append((r["batch_id"], tb, r))
    return edges, anomalies


def _find_cycles(edges):
    adj = {}
    for f, t, _ in edges:
        adj.setdefault(f, []).append(t)
    cycles, color, stack = [], {}, []

    def dfs(u):
        color[u] = 1
        stack.append(u)
        for v in adj.get(u, []):
            c = color.get(v, 0)
            if c == 1:
                cycles.append(stack[stack.index(v):] + [v])
            elif c == 0:
                dfs(v)
        stack.pop()
        color[u] = 2

    for n in list(adj):
        if color.get(n, 0) == 0:
            dfs(n)
    return cycles


def downstream_closure(edges, seeds):
    """受影响批次及其全部下游批次集合。"""
    adj = {}
    for f, t, _ in edges:
        adj.setdefault(f, set()).add(t)
    seen, stack = set(seeds), [s for s in seeds if s]
    while stack:
        u = stack.pop()
        for v in adj.get(u, ()):
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return seen


def _compute_batch(state, bid, incoming_map):
    """单批次推演：可用量、各去向累计、损耗与未闭合差额。"""
    b = state["batches"][bid]
    out = {t: 0.0 for t in DEST_TYPES}
    out_records = {t: [] for t in DEST_TYPES}
    for r in active_records(state):
        if r["batch_id"] != bid:
            continue
        out[r["dest_type"]] += r["qty"]
        out_records[r["dest_type"]].append(r["id"])
    incoming = sum(q for q, _ in incoming_map.get(bid, []))
    incoming_ids = [rid for _, rid in incoming_map.get(bid, [])]
    available = b["input_qty"] + incoming
    total_out = sum(out.values())
    unallocated = round(available - total_out, 6)
    anomalies = []
    if total_out > available + 1e-9:
        anomalies.append({
            "type": "超量转出", "batch_id": bid,
            "detail": "批次 %s 登记流出 %.3f 超过可用量 %.3f，"
                      "存在超量登记。" % (b["name"], total_out, available),
        })
    return {
        "batch_id": bid, "name": b["name"], "source": b["source"],
        "input_qty": b["input_qty"], "incoming": round(incoming, 6),
        "incoming_records": incoming_ids,
        "available": round(available, 6),
        "out": {k: round(v, 6) for k, v in out.items()},
        "out_records": out_records,
        "unallocated": unallocated,
        "anomalies": anomalies,
    }


def compute(state, only_batches=None, prev_results=None):
    """推演入口。

    only_batches 为 None 时全量重推；否则仅重推受影响批次及其下游，
    未受影响批次沿用 prev_results（增量重推，结果须与全量一致）。
    """
    edges, anomalies = _build_edges(state)
    cycles = _find_cycles(edges)
    cycle_nodes = set()
    cycle_edge_keys = set()
    for c in cycles:
        cycle_nodes.update(c)
        for i in range(len(c) - 1):
            cycle_edge_keys.add((c[i], c[i + 1]))
    for c in cycles:
        anomalies.append({
            "type": "循环引用", "batch_id": c[0],
            "detail": "检测到循环链路：%s，环内转出不参与数量传播。"
                      % " -> ".join(state["batches"][n]["name"] for n in c),
        })

    incoming_map = {}
    for f, t, r in edges:
        if (f, t) in cycle_edge_keys:
            continue  # 环内边不传播，避免无限循环
        incoming_map.setdefault(t, []).append((r["qty"], r["id"]))

    if only_batches is None:
        targets = set(state["batches"])
    else:
        targets = downstream_closure(edges, only_batches)
        targets &= set(state["batches"])

    results = dict(prev_results) if prev_results else {}
    for bid in sorted(targets):
        results[bid] = _compute_batch(state, bid, incoming_map)
    for bid in list(results):
        if bid not in state["batches"]:
            del results[bid]

    for bid in targets:
        anomalies.extend(results[bid]["anomalies"])
    return {"results": results, "anomalies": anomalies,
            "cycles": cycles, "edges": [(f, t, r["id"]) for f, t, r in edges]}


def closure_summary(state, results):
    """去向闭合校验：投入+转入 = 回收+再利用+损耗+转出 + 未闭合差额。

    转出为批次间内部流转，会在下游批次形成转入；未闭合差额按各批次
    （投入+转入-已登记流出）累加，与全链路口径一致。
    """
    total_input = sum(b["input_qty"] for b in state["batches"].values())
    total_incoming = sum(r["incoming"] for r in results.values())
    totals = {t: 0.0 for t in DEST_TYPES}
    basis = {t: [] for t in DEST_TYPES}
    for res in results.values():
        for t in DEST_TYPES:
            totals[t] += res["out"][t]
            basis[t].extend(res["out_records"][t])
    diff = round(sum(r["unallocated"] for r in results.values()), 6)
    gap_batches = [
        {"batch_id": r["batch_id"], "name": r["name"],
         "unallocated": r["unallocated"],
         "依据": "投入 %.3f + 转入 %.3f - 已登记流出 %.3f"
                 % (r["input_qty"], r["incoming"],
                    sum(r["out"].values()))}
        for r in results.values() if abs(r["unallocated"]) > 1e-9
    ]
    return {
        "投入总量": round(total_input, 6),
        "转入总量": round(total_incoming, 6),
        "回收": round(totals["回收"], 6),
        "再利用": round(totals["再利用"], 6),
        "损耗": round(totals["损耗"], 6),
        "转出到后续批次": round(totals["转出"], 6),
        "未闭合差额": diff,
        "差额说明": "未闭合差额 = 各批次（投入+转入-已登记流出）之和；"
                    "转出为批次间内部流转，在下游形成转入。",
        "差额依据": gap_batches,
        "去向依据记录": {t: basis[t] for t in DEST_TYPES},
    }


def verify_incremental(state, incr_results):
    """校验增量重推结果与全量重推一致，返回 (是否一致, 差异列表)。"""
    full = compute(state)["results"]
    diffs = []
    for bid in set(full) | set(incr_results):
        a, b = full.get(bid), incr_results.get(bid)
        if a != b:
            diffs.append(bid)
    return (not diffs), diffs
