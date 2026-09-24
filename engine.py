# -*- coding: utf-8 -*-
"""多级代理转发推导引擎：逐跳匹配规则、保留全部候选、备用目标/上一跳回退、循环与缺失检测。"""
from copy import deepcopy

MAX_HOPS = 32

REASON_TEXT = {
    "cycle": "规则链出现循环指向",
    "missing-target": "规则指向缺失的节点",
    "unreachable": "目标不可达且无可用回退",
    "no-rule": "该跳无可用规则",
}


def _match(rule, features):
    """返回 (是否命中, 依据列表)。依据逐条列出每个条件及其是否满足。"""
    cond = rule.get("when") or {}
    basis, ok_all = [], True
    for key, val in cond.items():
        if key == "path_prefix":
            ok = str(features.get("path", "")).startswith(str(val))
            desc = "path 以 '%s' 开头" % val
        elif key == "header":
            hk, hv = val
            ok = (features.get("headers") or {}).get(hk) == hv
            desc = "header[%s] == '%s'" % (hk, hv)
        else:
            ok = features.get(key) == val
            desc = "%s == '%s'" % (key, val)
        basis.append({"cond": desc, "ok": bool(ok)})
        ok_all = ok_all and ok
    if not basis:
        basis.append({"cond": "无条件（兜底规则）", "ok": True})
    return ok_all, basis
def derive_request(req, rules_by_node, nodes, max_hops=MAX_HOPS):
    """对单个请求做多跳推导。

    返回 {request_id, outcome, trace, route, deps}：
    - outcome: delivered(最终落点) 或 undetermined(原因 + 中断跳)
    - trace:   每一跳的候选规则、命中依据、选择、回退事件
    - route:   成功链路上各跳实际选用的规则与目标
    - deps:    推导过程中触达的规则与节点（用于增量重推）
    """
    features = req.get("features", {})
    trace, failures = [], []
    deps_rules, deps_nodes = set(), set()

    def resolve(node_id, depth, stack):
        hop = {"depth": depth, "node": node_id, "events": [], "candidates": [], "chosen": None}
        trace.append(hop)
        deps_nodes.add(node_id)
        if depth > max_hops:
            hop["events"].append("超过最大跳数，判定为循环")
            failures.append({"depth": depth, "node": node_id, "reason": "cycle", "detail": "超过最大跳数"})
            return None
        node = nodes.get(node_id)
        if node is None:
            hop["events"].append("目标节点 '%s' 不存在（指向缺失）" % node_id)
            failures.append({"depth": depth, "node": node_id, "reason": "missing-target",
                             "detail": "节点 '%s' 未定义" % node_id})
            return None
        if node_id in stack:
            loop = " -> ".join(stack + [node_id])
            hop["events"].append("检测到循环指向：%s" % loop)
            failures.append({"depth": depth, "node": node_id, "reason": "cycle", "detail": loop})
            return None
        if node.get("terminal"):
            hop["events"].append("到达终点节点，投递完成")
            return node_id
        if not node.get("reachable", True):
            hop["events"].append("节点不可达，本分支失败")
            failures.append({"depth": depth, "node": node_id, "reason": "unreachable",
                             "detail": "节点 '%s' 不可达" % node_id})
            return None
        node_rules = rules_by_node.get(node_id, [])
        for r in node_rules:
            deps_rules.add(r["id"])
        active, withdrawn = [], []
        for r in node_rules:
            ok, basis = _match(r, features)
            if not ok:
                continue
            cand = {"rule_id": r["id"], "priority": r.get("priority", 100),
                    "target": r["target"], "backups": list(r.get("backups") or []),
                    "basis": basis, "status": r.get("status", "active")}
            (withdrawn if cand["status"] == "withdrawn" else active).append(cand)
        sort_key = lambda c: c["priority"]
        # 同一跳的全部命中候选都保留并标出依据；已撤回的也列出但不参与选择
        hop["candidates"] = sorted(active, key=sort_key) + sorted(withdrawn, key=sort_key)
        if not active:
            detail = ("节点 '%s' 命中的规则均已撤回" % node_id) if withdrawn else \
                     ("节点 '%s' 无可用规则" % node_id)
            hop["events"].append(detail)
            failures.append({"depth": depth, "node": node_id, "reason": "no-rule", "detail": detail})
            return None
        for cand in sorted(active, key=sort_key):
            for ti, target in enumerate([cand["target"]] + cand["backups"]):
                if ti > 0:
                    hop["events"].append("主目标失败，回退到备用目标 '%s'（规则 %s）" % (target, cand["rule_id"]))
                landing = resolve(target, depth + 1, stack + [node_id])
                if landing is not None:
                    hop["chosen"] = {"rule_id": cand["rule_id"], "target": target, "via_backup": ti > 0}
                    return landing
                hop["events"].append("目标 '%s' 推导失败，尝试下一选择" % target)
        hop["events"].append("本跳全部候选均失败，回退到上一跳重新选择")
        return None

    landing = resolve(req["entry"], 0, [])
    if landing is not None:
        outcome = {"status": "delivered", "landing": landing}
    else:
        # 造成中断的那一跳：主路径（最高优先级分支）上第一处失败；
        # 全部失败记录一并保留，便于界面展示各分支的中断原因
        f = failures[0] if failures else \
            {"depth": 0, "node": req["entry"], "reason": "no-rule", "detail": "入口无规则"}
        outcome = {"status": "undetermined", "reason": f["reason"],
                   "reason_text": REASON_TEXT[f["reason"]],
                   "break_hop": {"depth": f["depth"], "node": f["node"]},
                   "detail": f["detail"], "failures": failures}
    route = [{"node": h["node"], "rule_id": h["chosen"]["rule_id"],
              "target": h["chosen"]["target"], "via_backup": h["chosen"]["via_backup"]}
             for h in trace if h["chosen"]]
    return {"request_id": req["id"], "outcome": outcome, "trace": trace, "route": route,
            "deps": {"rules": sorted(deps_rules), "nodes": sorted(deps_nodes)}}
def _outcome_key(d):
    o = d["outcome"]
    bh = o.get("break_hop") or {}
    return (o["status"], o.get("landing"), o.get("reason"), bh.get("node"), bh.get("depth"))


def summarize(d):
    """面向列表展示的结论摘要。"""
    o = d["outcome"]
    chain = ([d["route"][0]["node"]] + [r["target"] for r in d["route"]]) if d["route"] else []
    s = {"status": o["status"], "path": chain}
    if o["status"] == "delivered":
        s["landing"] = o["landing"]
    else:
        s["reason"] = o["reason"]
        s["reason_text"] = o["reason_text"]
        s["break_hop"] = o["break_hop"]
        s["detail"] = o["detail"]
    return s


class Engine:
    """持有规则/节点/请求，支持整体推导与增量重推。"""

    def __init__(self, data):
        self.reset(data)

    def reset(self, data):
        data = deepcopy(data)
        self.nodes = {n["id"]: n for n in data.get("nodes", [])}
        self.rules = {r["id"]: r for r in data.get("rules", [])}
        self.requests = {q["id"]: q for q in data.get("requests", [])}
        self._rebuild_index()
        self.derive_all()

    def _rebuild_index(self):
        self.rules_by_node = {}
        for r in self.rules.values():
            self.rules_by_node.setdefault(r["node"], []).append(r)

    def derive_all(self):
        self.derivations = {
            qid: derive_request(q, self.rules_by_node, self.nodes)
            for qid, q in self.requests.items()
        }
        return self.derivations

    def summaries(self):
        return {qid: summarize(d) for qid, d in self.derivations.items()}

    def apply_mutation(self, mut):
        """应用一次修改，只重推受影响的请求，并与整体重推核对一致性。

        返回 {rederived, changed, consistent, results}。
        """
        before = {qid: _outcome_key(d) for qid, d in self.derivations.items()}
        touched_rules, touched_nodes, force = set(), set(), set()
        t = mut.get("type")
        if t == "rule_update":
            rid = mut["rule_id"]
            if rid not in self.rules:
                raise ValueError("规则不存在: %s" % rid)
            old_node = self.rules[rid]["node"]
            self.rules[rid].update(mut.get("patch") or {})
            touched_rules.add(rid)
            touched_nodes.update([old_node, self.rules[rid]["node"]])
        elif t == "rule_status":
            rid = mut["rule_id"]
            self.rules[rid]["status"] = mut["status"]
            touched_rules.add(rid)
            touched_nodes.add(self.rules[rid]["node"])
        elif t == "rule_add":
            r = dict(mut["rule"])
            r.setdefault("status", "active")
            r.setdefault("backups", [])
            self.rules[r["id"]] = r
            touched_rules.add(r["id"])
            touched_nodes.add(r["node"])
        elif t == "rule_delete":
            rid = mut["rule_id"]
            touched_rules.add(rid)
            touched_nodes.add(self.rules[rid]["node"])
            del self.rules[rid]
        elif t == "node_reachable":
            nid = mut["node_id"]
            self.nodes[nid]["reachable"] = bool(mut["reachable"])
            touched_nodes.add(nid)
        elif t == "request_update":
            qid = mut["request_id"]
            self.requests[qid].update(mut.get("patch") or {})
            force.add(qid)
        else:
            raise ValueError("未知修改类型: %s" % t)
        self._rebuild_index()
        # 增量：仅重推依赖集与改动相交（或被强制）的请求
        rederived = []
        for qid, d in self.derivations.items():
            deps = d["deps"]
            hit = qid in force or \
                bool(touched_rules & set(deps["rules"])) or \
                bool(touched_nodes & set(deps["nodes"]))
            if hit:
                self.derivations[qid] = derive_request(
                    self.requests[qid], self.rules_by_node, self.nodes)
                rederived.append(qid)
        # 核对：整体重推一遍，未重推请求的结论必须与全量一致
        full = {qid: derive_request(q, self.rules_by_node, self.nodes)
                for qid, q in self.requests.items()}
        consistent = all(_outcome_key(full[qid]) == _outcome_key(self.derivations[qid])
                         for qid in full)
        changed = [qid for qid in before
                   if _outcome_key(self.derivations[qid]) != before[qid]]
        return {"rederived": sorted(rederived), "changed": sorted(changed),
                "consistent": consistent, "results": self.summaries()}
