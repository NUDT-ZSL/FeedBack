# -*- coding: utf-8 -*-
"""分析结果的可读化输出。"""

VERDICT_LABEL = {
    "reuse": "可复用缓存",
    "rebuild": "必须重编",
    "cyclic": "成环无法构建",
    "untrustworthy": "结论不可信",
}


def print_report(ana):
    """打印完整状态报告：构建顺序、环、缺失依赖、逐模块结论。"""
    print("== 构建顺序 ==")
    if ana.order:
        for i, m in enumerate(ana.order, 1):
            print("  %2d. %s" % (i, m))
    else:
        print("  （无可构建模块）")
    if ana.cycles:
        print("!! 依赖环（无法给出构建顺序）:")
        for group in ana.cycles:
            print("   %s" % " -> ".join(group + [group[0]]))
    if ana.missing:
        print("!! 缺失依赖:")
        for m in sorted(ana.missing):
            print("   %s 指向不存在的模块: %s"
                  % (m, ", ".join(ana.missing[m])))
        print("   受波及（结论不可信）: %s"
              % ", ".join(sorted(ana.untrustworthy)))
    print("== 模块结论 ==")
    for m in sorted(ana.modules):
        status, reason = ana.verdicts[m]
        print("  [%s] %s - %s" % (VERDICT_LABEL[status], m, reason))


def print_summary(ana):
    groups = {}
    for m, (status, _reason) in ana.verdicts.items():
        groups.setdefault(status, []).append(m)
    print("== 当前汇总 ==")
    for key in ("reuse", "rebuild", "cyclic", "untrustworthy"):
        items = sorted(groups.get(key, []))
        body = ", ".join(items) if items else "无"
        print("  %s (%d): %s" % (VERDICT_LABEL[key], len(items), body))


def print_mutation_report(title, before, after, origin=None, before_deps=None):
    """打印一次改动的影响面：重编集合（含传导链）、仅顺序调整集合。"""
    print("== %s ==" % title)
    chains = after.impact_of(origin) if origin else {}
    affected = [m for m in after.signatures
                if before.signatures.get(m) != after.signatures.get(m)]
    if affected:
        print("必须重编（输入签名变化）:")
        for m in sorted(affected):
            chain = chains.get(m)
            if chain:
                note = "传导链: " + " -> ".join(chain)
            elif m == origin:
                note = "变更源头"
            else:
                note = "依赖集发生变化"
            print("  - %s（%s）" % (m, note))
    else:
        print("没有模块的输入签名发生变化。")
    order_only = []
    for m in after.modules:
        if m in affected or m not in after.signatures:
            continue
        if after.verdicts[m][0] in ("cyclic", "untrustworthy"):
            continue
        decl_changed = before_deps is not None and \
            before_deps.get(m) != after.modules[m].deps
        pos_changed = before.position.get(m) != after.position.get(m)
        if decl_changed or pos_changed:
            order_only.append(m)
    if order_only:
        print("仅依赖声明/顺序调整（本次改动未改变其输入签名，无需重编）:")
        for m in sorted(order_only):
            print("  - %s" % m)
    for m in sorted(after.untrustworthy - before.untrustworthy):
        print("!! %s 变为结论不可信" % m)
    for m in sorted(after.cyclic - before.cyclic):
        print("!! %s 新卷入依赖环" % m)
    print_summary(after)
