"""数据血缘推演引擎(纯函数, 不依赖 IO)。

核心概念:
  - 数据集 dataset: 字段定义 + 版本号, 定义每次变更版本号递增。
  - 派生依据 derivation: 说明某派生数据集由哪些上游经哪些加工步骤产生,
    含字段映射与"上次应用时"的上游版本快照(input_versions)。
  - 状态: ok / stale(需要重算) / invalid(结论失效) / conflict(依据冲突) / disabled。

evaluate() 支持全量与增量两种模式, 增量模式结果与全量一致(由测试保证)。
"""

OK = "ok"
STALE = "stale"
INVALID = "invalid"
CONFLICT = "conflict"
DISABLED = "disabled"

STATE_LABELS = {
    OK: "正常",
    STALE: "需要重算",
    INVALID: "结论失效",
    CONFLICT: "依据冲突",
    DISABLED: "已停用",
}


def _active_derivations(data):
    """按目标数据集分组生效中的派生依据。"""
    by_target = {}
    for der in data["derivations"].values():
        if der.get("status", "active") != "active":
            continue
        by_target.setdefault(der["target"], []).append(der)
    return by_target


def downstream_closure(data, ids):
    """沿派生边(上游 -> 下游)求受影响闭包, 包含 ids 本身。"""
    children = {}
    for der in data["derivations"].values():
        if der.get("status", "active") != "active":
            continue
        for inp in der.get("inputs", []):
            children.setdefault(inp["dataset"], set()).add(der["target"])
    seen = set(ids)
    stack = list(ids)
    while stack:
        cur = stack.pop()
        for nxt in children.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _find_cycles(edges):
    """在 target -> upstream 依赖图上找环, 返回 {节点: 环路径}。"""
    color = {}
    cycles = {}
    stack = []

    def dfs(u):
        color[u] = 1
        stack.append(u)
        for v in edges.get(u, ()):
            if v not in edges:
                continue
            c = color.get(v, 0)
            if c == 0:
                dfs(v)
            elif c == 1:
                path = stack[stack.index(v):] + [v]
                for n in path:
                    cycles.setdefault(n, path)
        stack.pop()
        color[u] = 2

    for n in list(edges):
        if color.get(n, 0) == 0:
            dfs(n)
    return cycles


def _local_check(data, ds, der):
    """对单条派生依据做本地校验。

    返回 (invalid, stale, reasons, issues); issues 为结构化诊断
    (severity/code/message/field), 供 evaluate 挂到具体环节。
    """
    datasets = data["datasets"]
    invalid = False
    stale = False
    reasons = []
    issues = []

    def issue(code, msg, field=None):
        d = {"severity": "error", "code": code, "message": msg}
        if field:
            d["field"] = field
        issues.append(d)
        reasons.append(msg)

    for inp in der.get("inputs", []):
        up_id = inp["dataset"]
        up = datasets.get(up_id)
        if up is None:
            invalid = True
            issue("missing_upstream", "上游数据集 %s 缺失" % up_id)
            continue
        if up.get("status") == "disabled":
            invalid = True
            issue("upstream_disabled", "上游数据集 %s 已停用" % up.get("name", up_id))
        up_fields = {f["name"] for f in up.get("fields", [])}
        for m in inp.get("mappings", []):
            if m.get("from") not in up_fields:
                invalid = True
                issue("bad_mapping", "字段映射引用了上游不存在的字段 %s.%s"
                      % (up_id, m.get("from")), field=m.get("from"))
        recorded = der.get("input_versions", {}).get(up_id)
        current = up.get("version", 1)
        if recorded is not None and recorded != current:
            stale = True
            reasons.append("上游 %s 定义已变更 (v%s -> v%s)" % (up.get("name", up_id), recorded, current))
    mapped = {m["to"] for inp in der.get("inputs", []) for m in inp.get("mappings", [])}
    unmapped = [f["name"] for f in ds.get("fields", []) if f["name"] not in mapped]
    if unmapped:
        invalid = True
        issue("incomplete_mapping", "字段映射不完整, 未覆盖目标字段: " + ", ".join(unmapped))
    return invalid, stale, reasons, issues


def _evaluate_all(data, only=None, prev_states=None):
    """核心推演。only 为 None 时全量; 否则仅重算 only(须为下游闭包), 其余沿用 prev_states。"""
    datasets = data["datasets"]
    active = _active_derivations(data)
    edges = {t: {i["dataset"] for d in ders for i in d.get("inputs", [])}
             for t, ders in active.items()}
    cycles = _find_cycles(edges)
    states = {}
    diagnostics = []

    def diag(severity, code, message, dataset=None, derivation=None, field=None):
        d = {"severity": severity, "code": code, "message": message}
        if dataset:
            d["dataset"] = dataset
        if derivation:
            d["derivation"] = derivation
        if field:
            d["field"] = field
        diagnostics.append(d)

    # 拓扑序: 上游先于下游求值(环中节点单独处理)
    order = []
    visited = set()

    def visit(u):
        if u in visited:
            return
        visited.add(u)
        for v in edges.get(u, ()):
            if v in datasets and v not in cycles:
                visit(v)
        order.append(u)

    for nid in datasets:
        if nid not in cycles:
            visit(nid)

    # 环中节点直接置为失效并定位原因
    for nid, path in cycles.items():
        if nid not in datasets:
            continue
        if only is not None and nid not in only:
            states[nid] = prev_states[nid]
            continue
        msg = "循环依赖: " + " -> ".join(path)
        states[nid] = {"state": INVALID, "reasons": [msg]}
        diag("error", "cycle", msg, dataset=nid)

    for nid in order:
        if only is not None and nid not in only:
            states[nid] = prev_states[nid]
            continue
        ds = datasets[nid]
        if ds.get("status") == "disabled":
            states[nid] = {"state": DISABLED, "reasons": ["数据集已停用"]}
            continue
        ders = active.get(nid, [])
        if not ders:
            if ds.get("kind") == "derived":
                msg = "派生数据集没有生效中的派生依据"
                states[nid] = {"state": INVALID, "reasons": [msg]}
                diag("error", "no_derivation", msg, dataset=nid)
            else:
                states[nid] = {"state": OK, "reasons": []}
            continue
        if len(ders) > 1:
            msg = "存在 %d 条互相矛盾的派生依据, 等待人工裁决" % len(ders)
            states[nid] = {"state": CONFLICT, "reasons": [msg]}
            for d in ders:
                diag("conflict", "conflict",
                     "派生依据 %s 与其他依据冲突: %s" % (d["id"], d.get("note", "")),
                     dataset=nid, derivation=d["id"])
            continue
        der = ders[0]
        invalid, stale, reasons, issues = _local_check(data, ds, der)
        for it in issues:
            diag(it["severity"], it["code"], it["message"], dataset=nid,
                 derivation=der["id"], field=it.get("field"))
        for inp in der.get("inputs", []):
            up_id = inp["dataset"]
            if up_id not in datasets:
                continue
            up_state = states.get(up_id, {}).get("state")
            up_name = datasets[up_id].get("name", up_id)
            if up_state in (INVALID, CONFLICT):
                invalid = True
                reasons.append("上游 %s 的结论已失效" % up_name)
            elif up_state == STALE:
                stale = True
                reasons.append("上游 %s 需要重算" % up_name)
        state = INVALID if invalid else (STALE if stale else OK)
        states[nid] = {"state": state, "reasons": reasons}

    return states, diagnostics


def evaluate(data, prev_states=None, only=None):
    """推演所有数据集状态, 返回 (states, diagnostics)。

    增量模式: 传入 prev_states 与 only(受影响下游闭包), 只重算闭包内节点,
    结果与全量重算一致(见 test_engine.py 的一致性测试)。
    """
    return _evaluate_all(data, only=only, prev_states=prev_states)
