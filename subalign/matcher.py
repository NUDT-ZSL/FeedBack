"""锚点匹配：在基准条目与候选条目之间找出文本吻合的对应点。

匹配规则（全部确定、与条目输入顺序无关地以索引为准）：

1. 归一化文本完全相等 → 精确锚点；
2. 否则相似度达到阈值 → 模糊锚点（记录共有词数等证据）；
3. 用全局最优分配（带优先级的最近匹配 + 单调双射约束）消除一对多；
4. 拒绝会造成时间轴反向的锚点，按候选时间排序输出。
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from .model import Anchor, Entry
from .textnorm import normalize, shared_signals, similarity


class AnchorMatcher:
    def __init__(self, threshold: float, fuzzy_cap: float, min_anchors: int = 2):
        self._threshold = threshold
        self._fuzzy_cap = fuzzy_cap
        self._min_anchors = min_anchors

    def match(
        self, ref_entries: Sequence[Entry], cand_entries: Sequence[Entry]
    ) -> List[Anchor]:
        candidates = self._candidate_matches(ref_entries, cand_entries)
        chosen = self._monotone_bijection(candidates, len(ref_entries), len(cand_entries))
        anchors: List[Anchor] = []
        for i, j in chosen:
            ref_e, cand_e = ref_entries[i], cand_entries[j]
            sc = similarity(ref_e.text, cand_e.text)
            shared_n, has_digit = shared_signals(ref_e.text, cand_e.text)
            kind = "exact" if normalize(ref_e.text) == normalize(cand_e.text) else "fuzzy"
            ev_parts = [f"相似度={sc:.3f}", f"共有词={shared_n}"]
            if has_digit:
                ev_parts.append("含共有数字")
            ev_parts.append(f"基准#{i}↔候选#{j}")
            anchors.append(
                Anchor(
                    ref_index=i,
                    cand_index=j,
                    ref_mid=ref_e.mid,
                    cand_mid=cand_e.mid,
                    score=sc if kind == "fuzzy" else 1.0,
                    kind=kind,
                    evidence="；".join(ev_parts),
                )
            )
        # 以候选时刻为序（单调双射已保证基准序一致）。
        anchors.sort(key=lambda a: (a.cand_mid, a.ref_index))
        return self._cap_fuzzy(anchors, len(cand_entries))

    # ------------------------------------------------------------------ #
    def _candidate_matches(
        self, ref_entries: Sequence[Entry], cand_entries: Sequence[Entry]
    ) -> List[Tuple[float, int, int]]:
        """枚举所有达阈值的 (score, i, j)，精确匹配 score 记为 2 以绝对优先。"""
        out: List[Tuple[float, int, int]] = []
        norm_ref = [normalize(e.text) for e in ref_entries]
        for j, ce in enumerate(cand_entries):
            nj = normalize(ce.text)
            if not nj:
                continue
            for i, nri in enumerate(norm_ref):
                if nri == nj:
                    out.append((2.0, i, j))
                else:
                    sc = similarity(ref_entries[i].text, ce.text)
                    if sc >= self._threshold:
                        out.append((sc, i, j))
        return out

    def _monotone_bijection(
        self,
        candidates: List[Tuple[float, int, int]],
        n_ref: int,
        n_cand: int,
    ) -> List[Tuple[int, int]]:
        """在“基准索引、候选索引都严格递增”的约束下取总分最大的匹配集合。

        这是带两个递增约束的加权 LIS 问题，用 O(K^2) 动态规划求解
        （字幕条目规模下完全够用），并按 (score, i, j) 稳定排序打破平手，
        因此结果对锚点到达/枚举顺序不敏感。
        """
        if not candidates:
            return []
        # DP 要求候选按 (i, j) 有序；权重 (精确=2，模糊=相似度) 决定取舍，
        # 平手时由 DP 扫描顺序（即 (i,j) 字典序）裁决，因此与枚举顺序无关。
        cand = sorted(candidates, key=lambda c: (c[1], c[2]))

        k = len(cand)
        # dp[t] = 以第 t 个候选结尾的最优（总分, 前趋, 选中列表回溯用）
        best_score = [0.0] * k
        prev: List[Optional[int]] = [None] * k
        best_end = 0
        for t in range(k):
            st, it, jt = cand[t]
            best_score[t] = st
            for u in range(t):
                su, iu, ju = cand[u]
                if iu < it and ju < jt and best_score[u] + st > best_score[t]:
                    best_score[t] = best_score[u] + st
                    prev[t] = u
            if best_score[t] > best_score[best_end]:
                best_end = t

        chosen: List[Tuple[int, int]] = []
        t: Optional[int] = best_end
        while t is not None:
            _, i, j = cand[t]
            chosen.append((i, j))
            t = prev[t]
        chosen.reverse()
        return chosen

    def _cap_fuzzy(self, anchors: List[Anchor], n_cand: int) -> List[Anchor]:
        """限制模糊锚点总量，防止阈值偏低时大面积误锚（精确锚点不动）。

        上限取 ``max(min_anchors, floor(fuzzy_cap × 候选条目数))``：既保证
        纯模糊锚点的多语言轨（无完全相同文本）也能留下至少 2 个锚点拟合，
        又把模糊锚点控制在候选条目数的一定比例内。平手按索引裁决。
        """
        exact = [a for a in anchors if a.kind == "exact"]
        fuzzy = [a for a in anchors if a.kind != "exact"]
        if not fuzzy:
            return anchors
        import math

        max_fuzzy = max(self._min_anchors, math.floor(self._fuzzy_cap * n_cand + 1e-9))
        if len(fuzzy) <= max_fuzzy:
            return anchors
        fuzzy.sort(key=lambda a: (-a.score, a.ref_index, a.cand_index))
        kept = exact + fuzzy[:max_fuzzy]
        kept.sort(key=lambda a: (a.cand_mid, a.ref_index))
        return kept
