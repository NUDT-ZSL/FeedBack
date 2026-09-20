# -*- coding: utf-8 -*-
"""核心推演引擎：构建顺序、成环检测、影响面与缓存判定。

关键语义：模块的"输入签名" = 自身内容指纹 + 全部传递依赖指纹集合的哈希。
签名与缓存标记一致 => 可复用缓存；不一致或无缓存 => 必须重编。
依赖声明变化但传递依赖集合不变时签名不变，属于"仅顺序调整"。
"""
import hashlib

from .graph import find_cycles, impact_chains, topo_order


class Analysis(object):
    """对一份模块清单做一次完整分析（与从零全量重算等价）。""" 

    def __init__(self, modules):
        self.modules = modules
        # 依赖边仅保留指向已存在模块的部分，缺失目标单独记录
        self.edges = {}
        self.missing = {}
        for mid, mod in modules.items():
            known, lost = [], []
            for dep in mod.deps:
                (known if dep in modules else lost).append(dep)
            self.edges[mid] = known
            if lost:
                self.missing[mid] = lost
        # 依赖环（明确列出参与闭环的模块）
        self.cycles = find_cycles(sorted(modules), self.edges)
        self.cyclic = set()
        for group in self.cycles:
            self.cyclic.update(group)
        # 拓扑构建顺序（环上模块无法排序，不参与）
        buildable = [m for m in sorted(modules) if m not in self.cyclic]
        sub_edges = {m: [d for d in self.edges[m] if d not in self.cyclic]
                     for m in buildable}
        self.order = topo_order(buildable, sub_edges)
        self.position = {m: i + 1 for i, m in enumerate(self.order)}
        # 传递依赖闭包（仅含清单中存在的模块）
        self.trans_deps = {}
        for m in self.order:
            seen = set()
            stack = list(self.edges[m])
            while stack:
                cur = stack.pop()
                if cur in seen or cur in self.cyclic:
                    continue
                seen.add(cur)
                stack.extend(self.edges.get(cur, []))
            self.trans_deps[m] = seen
        # 结论不可信集合：声明了缺失依赖的模块及其全部下游
        self.untrustworthy = set()
        self.untrustworthy_via = {}
        for src in self.missing:
            for m in [src] + list(impact_chains(self.edges, src)):
                if m in self.cyclic:
                    continue
                self.untrustworthy.add(m)
                self.untrustworthy_via.setdefault(m, []).append(src)
        # 输入签名
        self.signatures = {}
        for m in self.order:
            mod = modules[m]
            parts = sorted("%s:%s" % (d, modules[d].fingerprint)
                           for d in self.trans_deps[m])
            raw = mod.fingerprint + "|" + ",".join(parts)
            self.signatures[m] = hashlib.sha1(
                raw.encode("utf-8")).hexdigest()[:12]
        # 每个模块的结论: (状态, 依据)
        self.verdicts = {m: self._verdict(m) for m in modules}

    def _cycle_of(self, m):
        for group in self.cycles:
            if m in group:
                return group
        return [m]

    def _verdict(self, m):
        mod = self.modules[m]
        if m in self.cyclic:
            ring = self._cycle_of(m)
            return ("cyclic",
                    "参与依赖环: %s" % " -> ".join(ring + [ring[0]]))
        if m in self.untrustworthy:
            if m in self.missing:
                return ("untrustworthy",
                        "声明了缺失依赖: %s" % ", ".join(self.missing[m]))
            via = sorted(set(self.untrustworthy_via.get(m, [])))
            return ("untrustworthy",
                    "上游 %s 存在缺失依赖，结论不可信" % ", ".join(via))
        sig = self.signatures.get(m)
        if mod.cache is None:
            return ("rebuild", "无缓存产物（当前签名 %s）" % sig)
        if mod.cache != sig:
            return ("rebuild", "输入已变化（缓存标记 %s，当前签名 %s）"
                    % (mod.cache, sig))
        return ("reuse", "缓存标记与当前输入签名一致")

    def impact_of(self, m):
        """m 的内容变化时，沿依赖方向传导到的 {模块: 传导链}。"""
        return impact_chains(self.edges, m)
