# -*- coding: utf-8 -*-
"""构建签名计算与缓存状态判定。

签名语义：模块的构建签名 = 哈希（自身内容指纹 + 全部依赖的签名）。
因此任何自身内容或上游输入的变化都会改变签名；缓存产物只有在签名
一致时才可复用。每次改动后都对全图重新计算，保证结果与从零全量
重算完全一致。
"""
import hashlib

from . import graph


def _hash(parts):
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:16]


class ModuleStatus(object):
    """单个模块的判定结果。"""

    def __init__(self, mid):
        self.id = mid
        self.signature = None
        self.reusable = False
        self.reason = ""
        self.in_cycle = False
        self.cycle_members = []
        self.missing_deps = []
        self.untrusted = False


class Analysis(object):
    """对一份清单做完整的图分析（每次改动后整体重算）。"""

    def __init__(self, manifest):
        self.manifest = manifest
        self.edges, self.missing = graph.dependency_edges(manifest)
        self.sccs = graph.tarjan_scc(sorted(manifest.modules), self.edges)
        self.cycle_groups = []
        self.cycle_of = {}
        for scc in self.sccs:
            cyclic = len(scc) > 1 or scc[0] in self.edges.get(scc[0], [])
            if cyclic:
                self.cycle_groups.append(scc)
                for m in scc:
                    self.cycle_of[m] = scc
        self.order = graph.build_order(sorted(manifest.modules), self.edges, self.sccs)
        self.signatures = self._compute_signatures()
        sources = sorted(self.missing)
        if sources:
            self.untrusted = graph.reverse_reachable(self.edges, sources)
        else:
            self.untrusted = set()
        self.statuses = {m: self._status(m) for m in manifest.modules}

    def _dep_tokens(self, mid, sigs):
        """依赖签名 token：存在的依赖取其签名，缺失的依赖用 MISSING 标记。"""
        tokens = {}
        for dep in self.manifest.modules[mid].deps:
            if dep in self.manifest.modules:
                if dep in sigs:
                    tokens[dep] = "dep:%s=%s" % (dep, sigs[dep])
            else:
                tokens[dep] = "missing:%s" % dep
        return tokens

    def _compute_signatures(self):
        sigs = {}
        scc_of = {}
        for scc in self.sccs:
            for m in scc:
                scc_of[m] = scc
        done = set()
        for m in self.order:
            if m in done:
                continue
            scc = scc_of[m]
            if m in self.cycle_of:
                # 成环分量：组内全部指纹 + 组外依赖签名共同决定组签名，
                # 组内任一成员变化都会导致整组重编。
                parts = ["cycle"]
                for member in scc:
                    parts.append("fp:%s=%s"
                                 % (member, self.manifest.modules[member].fingerprint))
                ext = []
                for member in scc:
                    for dep, token in self._dep_tokens(member, sigs).items():
                        if dep not in scc:
                            ext.append(token)
                parts.extend(sorted(ext))
                group_sig = _hash(parts)
                for member in scc:
                    sigs[member] = _hash([group_sig, "member:%s" % member])
            else:
                tokens = sorted(self._dep_tokens(m, sigs).values())
                sigs[m] = _hash(["fp:%s" % self.manifest.modules[m].fingerprint] + tokens)
            done.update(scc)
        return sigs

    def _status(self, mid):
        mod = self.manifest.modules[mid]
        st = ModuleStatus(mid)
        st.signature = self.signatures[mid]
        st.in_cycle = mid in self.cycle_of
        st.cycle_members = list(self.cycle_of.get(mid, []))
        st.missing_deps = list(self.missing.get(mid, []))
        st.untrusted = mid in self.untrusted
        cache = mod.cache if isinstance(mod.cache, dict) else {}
        cached_sig = cache.get("signature")
        if not cached_sig:
            st.reusable = False
            st.reason = "无缓存产物或产物签名未知"
        elif cached_sig == st.signature:
            st.reusable = True
            st.reason = "构建签名与缓存一致"
        else:
            st.reusable = False
            st.reason = "构建签名已变化（内容指纹或依赖输入与缓存时不一致）"
        return st
