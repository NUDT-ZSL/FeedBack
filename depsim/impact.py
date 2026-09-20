# -*- coding: utf-8 -*-
"""改动影响推演：对比改动前后的完整分析，给出重编范围、传导链与缓存复用结论。"""
from . import graph
from .engine import Analysis


class DepDeclDiff(object):
    """单个模块依赖声明的差异。"""

    def __init__(self, mid, before_deps, after_deps):
        self.id = mid
        self.added = [d for d in after_deps if d not in before_deps]
        self.removed = [d for d in before_deps if d not in after_deps]
        self.reordered = (not self.added and not self.removed
                          and list(before_deps) != list(after_deps))

    @property
    def changed(self):
        return bool(self.added or self.removed or self.reordered)

    def describe(self):
        parts = []
        if self.added:
            parts.append("新增依赖 %s" % ", ".join(self.added))
        if self.removed:
            parts.append("移除依赖 %s" % ", ".join(self.removed))
        if self.reordered:
            parts.append("仅依赖顺序调整")
        return "；".join(parts)


class Impact(object):
    """一次改动推演的完整结果。"""

    def __init__(self, after):
        self.after = after
        self.fp_changed = []    # 指纹变化的模块
        self.dep_diffs = {}     # 模块id -> DepDeclDiff
        self.rebuild = {}       # 模块id -> 重编原因
        self.chains = {}        # 模块id -> 传导链（模块id列表）
        self.reorder_only = []  # 仅顺序调整、缓存可复用的模块
        self.reused = []        # 未受影响且缓存可复用的模块


def _shortest_chains(edges, sources):
    """从直接改动的模块出发，沿“被谁依赖”方向 BFS，记录每个模块的首条传导链。"""
    rev = graph.reverse_adjacency(edges)
    chains = {s: [s] for s in sources}
    queue = list(sources)
    while queue:
        cur = queue.pop(0)
        for nxt in rev.get(cur, []):
            if nxt not in chains:
                chains[nxt] = chains[cur] + [nxt]
                queue.append(nxt)
    return chains


def compute_impact(before_manifest, after_manifest):
    """对比两份清单，推演改动影响。内部对前后各自做完整重算。"""
    before = Analysis(before_manifest)
    after = Analysis(after_manifest)
    imp = Impact(after)

    dep_changed = []
    for mid, mod in after_manifest.modules.items():
        old = before_manifest.modules.get(mid)
        old_deps = old.deps if old else []
        diff = DepDeclDiff(mid, old_deps, mod.deps)
        if diff.changed:
            imp.dep_diffs[mid] = diff
        if diff.added or diff.removed:
            dep_changed.append(mid)

    imp.fp_changed = [mid for mid, mod in after_manifest.modules.items()
                      if mid in before_manifest.modules
                      and before_manifest.modules[mid].fingerprint != mod.fingerprint]

    direct = sorted(set(imp.fp_changed) | set(dep_changed))
    chains = _shortest_chains(after.edges, direct) if direct else {}

    for mid in after.order:
        if before.signatures.get(mid) == after.signatures.get(mid):
            continue
        if mid in imp.fp_changed:
            reason = "内容指纹变化"
        elif mid in dep_changed:
            reason = "依赖声明变化（%s）" % imp.dep_diffs[mid].describe()
        elif mid in chains:
            reason = "沿依赖链传导：" + " -> ".join(chains[mid])
        else:
            reason = "依赖输入变化"
        imp.rebuild[mid] = reason
        if mid in chains:
            imp.chains[mid] = chains[mid]

    for mid, diff in imp.dep_diffs.items():
        if diff.reordered and mid not in imp.rebuild:
            imp.reorder_only.append(mid)
    imp.reorder_only.sort()

    imp.reused = [mid for mid in after.order
                  if mid not in imp.rebuild and after.statuses[mid].reusable]
    return imp
