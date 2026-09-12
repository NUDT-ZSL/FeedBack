"""有向无环图的自动分层布局（纯标准库）。

布局模型
--------
- 最长路径分层：节点层号 = 1 + 最长前驱链，层 0 为源点层；
- 同层节点共享 x、纵向堆叠，层内步进为“节点自身高度 + v_gap”，层 x
  坐标按“左侧层最大宽度 + h_gap”递推，矩形互不重叠；
- 同层排序键固定为 (当前 y, 节点 id)，同一输入多次布局结果完全一致。

边路由（正交折线，保证不穿过任何节点矩形）
----------------------------------------
关键几何事实：层间空隙（gap）对应的竖直 x 列，在任意 y 上都不与任何
层的节点矩形相交；所有节点行之上 / 之下的水平外总线在任意 x 上也都
无节点。因此：

- 相邻层边：H-V-H，竖直段走 gap 内按 y 区间染色分配的 lane，同 lane
  的竖直段不允许 y 区间重合，lane 按索引向右排列；
- 跨多层长边：首选“源 gap 竖段 → 中间层公共空闲水平带 → 目标 gap
  竖段”；任一侧 gap 拥塞，或找不到公共空闲带时，回退到顶层 / 底层
  外总线（竖直段仍走 gap 列，水平段走所有节点之外），通道按索引
  外扩，容量不限；
- 自环在节点右侧外扩一圈；
- scope 拼接产生的同层 / 反向边，用 gap 列 + 外总线绕行，同样不穿
  节点。

拓扑排序 / 环检测 / 可达闭包全部迭代实现，5000 层深链不爆栈。
"""

from __future__ import annotations

import bisect
from collections import deque
from typing import Dict, Iterable, List, Optional, Set, Tuple

from graph import Edge, Graph

# gap 内 lane 几何：开放间隙宽 h_gap=60。折线为 1px 线，按 lane 索引
# 向右外扩：2.00, 2.01, 2.02, ... 共 5800 条互不重合的竖直通道，x 严格
# 落在相邻两层节点矩形之间。极端稠密时超过容量会显式报错，绝不穿节点。
LANE_INSET = 2.0
LANE_PITCH_X = 0.01
LANES_PER_GAP = 5800
OUTSIDE_MARGIN = 24.0
OUTSIDE_PITCH = 20.0


def _node_key(graph: Graph, nid: str):
    """同层稳定排序键：先按当前 y，再按 id 字典序。"""
    return (graph.nodes[nid].position[1], nid)


def _intervals_overlap(a, b, eps: float = 1e-9) -> bool:
    return a[0] < b[1] - eps and b[0] < a[1] - eps


class LayoutEngine:
    def __init__(
        self,
        graph: Graph,
        node_size: Tuple[float, float] = (160.0, 80.0),
        h_gap: float = 60.0,
        v_gap: float = 40.0,
        clock=None,
    ):
        self.graph = graph
        self.node_size = (float(node_size[0]), float(node_size[1]))
        self.h_gap = float(h_gap)
        self.v_gap = float(v_gap)
        # 可注入时钟（无参可调用）。仅用于耗时统计，绝不参与坐标计算。
        self.clock = clock
        self.last_elapsed: Optional[float] = None

    def _now(self):
        return None if self.clock is None else self.clock()

    # ------------------------------------------------------------------ #
    # 图分析：迭代环检测 / Kahn 拓扑 / 最长路径分层
    # ------------------------------------------------------------------ #

    def _adjacency(self, node_ids: Optional[Set[str]] = None):
        """构建（子集内的）唯一邻接关系与入度，忽略自环。

        同一对节点间的多条边只计一次依赖（分层 / 环检测关心的是节点
        间的偏序，平行边不改变层号）。
        """
        g = self.graph
        if node_ids is None:
            node_ids = set(g.nodes)
        node_ids = set(node_ids)
        succ: Dict[str, List[str]] = {n: [] for n in node_ids}
        indeg = {n: 0 for n in node_ids}
        seen_pairs: Set[Tuple[str, str]] = set()
        for e in g.edges.values():
            if e.source == e.target:
                continue
            s, t = e.source, e.target
            if s in node_ids and t in node_ids and (s, t) not in seen_pairs:
                seen_pairs.add((s, t))
                succ[s].append(t)
                indeg[t] += 1
        for n in succ:
            succ[n].sort()
        return succ, indeg

    def _cycle_within(self, node_ids: Set[str]) -> Optional[List[str]]:
        """Kahn 迭代环检测；有环时沿剩余节点的出边追出一圈 id 列表。

        自环不作为分层意义上的环拦截（自环在路由阶段单独外绕处理）。
        """
        node_ids = set(node_ids)
        succ, indeg = self._adjacency(node_ids)
        queue = deque(nid for nid, d in indeg.items() if d == 0)
        seen = 0
        while queue:
            nid = queue.popleft()
            seen += 1
            for t in succ[nid]:
                indeg[t] -= 1
                if indeg[t] == 0:
                    queue.append(t)
        if seen == len(node_ids):
            return None

        remaining = {nid for nid, d in indeg.items() if d > 0}
        start = next(iter(remaining))
        cycle = [start]
        cur = start
        while True:
            nxt = next((t for t in succ[cur] if t in remaining), None)
            if nxt is None or nxt == start:
                break
            cycle.append(nxt)
            remaining.discard(cur)
            cur = nxt
        return cycle

    def _find_cycle(self) -> Optional[List[str]]:
        return self._cycle_within(set(self.graph.nodes))

    def _longest_path_layers(self, node_ids: Optional[Set[str]] = None
                             ) -> Dict[int, List[str]]:
        """最长路径分层（可选只在子集内、只看子集内部边）。"""
        g = self.graph
        if node_ids is None:
            node_ids = set(g.nodes)
        node_ids = set(node_ids)

        succ, indeg0 = self._adjacency(node_ids)
        indeg = dict(indeg0)
        preds: Dict[str, List[str]] = {n: [] for n in node_ids}
        for s, ts in succ.items():
            for t in ts:
                preds[t].append(s)

        ready = deque(sorted(nid for nid, d in indeg.items() if d == 0))
        order: List[str] = []
        enqueued = set(ready)
        while ready:
            nid = ready.popleft()
            order.append(nid)
            for t in succ[nid]:
                if t not in enqueued:
                    indeg[t] -= 1
                    if indeg[t] == 0:
                        enqueued.add(t)
                        ready.append(t)

        layer_of: Dict[str, int] = {}
        for nid in order:
            ps = preds[nid]
            layer_of[nid] = 0 if not ps else 1 + max(layer_of[p] for p in ps)

        layers: Dict[int, List[str]] = {}
        for nid, l in layer_of.items():
            layers.setdefault(l, []).append(nid)
        for l in layers:
            layers[l].sort(key=lambda n: _node_key(g, n))
        return layers

    # ------------------------------------------------------------------ #
    # 几何布局
    # ------------------------------------------------------------------ #

    def _size_of(self, nid: str) -> Tuple[float, float]:
        n = self.graph.nodes[nid]
        if n.size and n.size != (0.0, 0.0):
            return n.size
        return self.node_size

    def _stack_layers(self, layers: Dict[int, List[str]],
                      origin_x: float = 0.0, origin_y: float = 0.0
                      ) -> Dict[str, Tuple[float, float]]:
        positions: Dict[str, Tuple[float, float]] = {}
        if not layers:
            return positions

        max_layer = max(layers)
        max_width = {l: max(self._size_of(n)[0] for n in layers[l])
                     for l in layers}
        x_of: Dict[int, float] = {}
        x = origin_x
        for l in range(max_layer + 1):
            x_of[l] = x
            x += max_width.get(l, 0.0) + self.h_gap

        for l in range(max_layer + 1):
            y = origin_y
            for nid in layers.get(l, []):
                positions[nid] = (x_of[l], y)
                y += self._size_of(nid)[1] + self.v_gap
        return positions

    def _downstream_closure(self, seeds: Iterable[str]) -> Set[str]:
        """seeds 及其沿出边可达节点（迭代 BFS，不递归）。"""
        g = self.graph
        # 一次性建唯一后继表，避免逐节点全表扫描边。
        outmap: Dict[str, Set[str]] = {n: set() for n in g.nodes}
        for e in g.edges.values():
            if e.source in outmap and e.target in outmap:
                outmap[e.source].add(e.target)

        result: Set[str] = set()
        queue = deque()
        for s in seeds:
            if s in g.nodes and s not in result:
                result.add(s)
                queue.append(s)
        while queue:
            cur = queue.popleft()
            for nxt in outmap[cur]:
                if nxt not in result:
                    result.add(nxt)
                    queue.append(nxt)
        return result

    def layout(self, scope: Optional[Iterable[str]] = None
               ) -> Dict[str, Tuple[float, float]]:
        """整图 / 局部重排，返回 {节点 id: 左上角 (x, y)}。

        scope=None 整图重排；否则只重排 scope 中存在的节点及其下游
        可达节点，其他节点保持当前 position 原样返回。有环时抛
        ValueError 并附环上节点 id 列表，不产生布局结果。
        """
        t0 = self._now()
        g = self.graph

        if scope is None:
            cycle = self._find_cycle()
            if cycle is not None:
                raise ValueError(f"图中存在环，环上节点: {cycle}")
            positions = self._stack_layers(self._longest_path_layers())
        else:
            seeds = {s for s in scope if s in g.nodes}
            affected = self._downstream_closure(seeds)
            cycle = self._cycle_within(affected)
            if cycle is not None:
                raise ValueError(f"布局作用域内存在环，环上节点: {cycle}")

            positions = {nid: g.nodes[nid].position for nid in g.nodes
                         if nid not in affected}
            if affected:
                # 受影响节点沿用“整图分层”的列与槽位：对整图做一次最长
                # 路径分层并堆叠，只取受影响节点的新坐标。这样未参与
                # 节点若已在整图整理后的位置上，就不会与重排结果相交；
                # 仍有相交（例如画布从未整排过）由 incremental_relayout
                # 的扩圈机制处理。
                full_positions = self._stack_layers(
                    self._longest_path_layers())
                for nid in affected:
                    positions[nid] = full_positions[nid]

        if t0 is not None:
            self.last_elapsed = self._now() - t0
        return positions

    # ------------------------------------------------------------------ #
    # 增量布局：矩形冲突扩圈
    # ------------------------------------------------------------------ #

    def incremental_relayout(
        self, changed_ids: Iterable[str], max_rounds: int = 5
    ) -> Dict[str, Tuple[float, float]]:
        """局部重排 changed_ids 及其下游；新矩形与未参与节点相交时把
        冲突外部节点纳入受影响集合重算，直到无重叠或达到 max_rounds
        （默认 5）轮；达到上限仍有冲突时抛 RuntimeError 并列出冲突对。
        """
        g = self.graph
        seeds = {s for s in changed_ids if s in g.nodes}
        if not seeds:
            return {nid: g.nodes[nid].position for nid in g.nodes}

        conflicts: List[Tuple[str, str]] = []
        for _ in range(max_rounds):
            affected = self._downstream_closure(seeds)
            positions = self.layout(seeds)
            conflicts = self._rect_conflicts(affected, positions)
            if not conflicts:
                return positions
            for a, b in conflicts:
                outside = b if b not in affected else a
                if outside not in affected:
                    seeds.add(outside)

        raise RuntimeError(
            f"增量布局达到 {max_rounds} 轮上限，仍有 {len(conflicts)} 处矩形"
            f"冲突（受影响节点, 外部节点）: {conflicts[:10]}")

    @staticmethod
    def _rects_overlap(ax, ay, aw, ah, bx, by, bw, bh) -> bool:
        """严格重叠；共边 / 共点不算。"""
        return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah

    def _rect_conflicts(self, affected: Set[str],
                        positions: Dict[str, Tuple[float, float]]
                        ) -> List[Tuple[str, str]]:
        g = self.graph
        fixed = sorted(nid for nid in g.nodes if nid not in affected)
        conflicts: List[Tuple[str, str]] = []
        for a in sorted(affected):
            ax, ay = positions[a]
            aw, ah = self._size_of(a)
            for b in fixed:
                bx, by = g.nodes[b].position
                bw, bh = self._size_of(b)
                if self._rects_overlap(ax, ay, aw, ah, bx, by, bw, bh):
                    conflicts.append((a, b))
        return conflicts

    # ------------------------------------------------------------------ #
    # 边路由
    # ------------------------------------------------------------------ #

    def _layer_geometry(self, positions: Dict[str, Tuple[float, float]]):
        """按 x 聚类得到几何层（层号严格按 x 从小到大）。"""
        distinct_x = sorted({p[0] for p in positions.values()})
        x_to_layer = {x: i for i, x in enumerate(distinct_x)}

        layers = []
        node_layer: Dict[str, int] = {}
        for li, xv in enumerate(distinct_x):
            members = sorted(
                (n for n in positions if positions[n][0] == xv),
                key=lambda n: (positions[n][1], n))
            rects = []
            for n in members:
                w, h = self._size_of(n)
                x, y = positions[n]
                rects.append((n, x, y, x + w, y + h))
                node_layer[n] = li
            layers.append({
                "left": xv,
                "right": max(r[3] for r in rects),
                "top": min(r[2] for r in rects),
                "bottom": max(r[4] for r in rects),
                "rects": rects,
                "yspans": sorted((r[2], r[4]) for r in rects),
            })
        return layers, node_layer

    @staticmethod
    def _interval_free(spans, y: float, eps: float = 1e-9) -> bool:
        """y 是否在该层所有节点纵向区间之外。"""
        for lo, hi in spans:
            if lo - eps <= y <= hi + eps:
                return False
            if lo > y + eps:
                break
        return True

    def route_edges(self, positions: Dict[str, Tuple[float, float]]
                    ) -> Dict[str, List[Tuple[float, float]]]:
        """为每条边生成正交折线，返回 {edge_id: [(x, y), ...]}。

        起点为源节点右边界中点、终点为目标节点左边界中点；任何折线段
        都不经过节点矩形内部。结果只依赖 positions 与图结构，可复现。

        通道分配为离线两趟：
          1. 相邻边走 gap 内 H-V-H；长边优先占用“中间层公共空闲水平
             带”，其竖列需求登记为竖直作业；
          2. 放不下的长边 / 同层 / 反向边成为外总线乘客：馈线竖列先
             染色，再按 x 区间对总线电平做区间图染色（底侧优先，顶侧
             复用），最后统一输出点列。
        竖直作业按走廊（层间 gap / 层左 / 层右外通道）做区间图染色，
        每条 lane 内的竖段 y 区间互不重合。
        """
        g = self.graph
        routes: Dict[str, List[Tuple[float, float]]] = {}
        if not positions:
            return routes

        layers, node_layer = self._layer_geometry(positions)
        n_layers = len(layers)
        global_top = min(L["top"] for L in layers)
        global_bottom = max(L["bottom"] for L in layers)

        def mid_right(nid):
            x, y = positions[nid]
            w, h = self._size_of(nid)
            return (x + w, y + h / 2.0)

        def mid_left(nid):
            x, y = positions[nid]
            _, h = self._size_of(nid)
            return (x, y + h / 2.0)

        # -- 走廊定义 ----------------------------------------------------
        # 走廊 ("g", i)：层 i 与 i+1 之间的 gap；("L",) 层 0 左侧外通道；
        # ("R",) 末层右侧外通道。外通道容量不限。
        def corridor_x(cid, lane: int) -> float:
            if cid[0] == "g":
                return layers[cid[1]]["right"] + LANE_INSET + lane * LANE_PITCH_X
            if cid[0] == "L":
                return layers[0]["left"] - LANE_INSET - lane * LANE_PITCH_X
            return layers[n_layers - 1]["right"] + LANE_INSET + lane * LANE_PITCH_X

        def src_corridor(li: int):
            return ("g", li) if li < n_layers - 1 else ("R",)

        def dst_corridor(li: int):
            return ("g", li - 1) if li > 0 else ("L",)

        # 每条边的端点信息与分类（按 edge id 排序，保证可复现）。
        ordered = sorted(
            (eid for eid in g.edges
             if not g.edges[eid].is_self_loop
             and g.edges[eid].source in positions
             and g.edges[eid].target in positions))

        # 每条长边的中间层公共空闲带（只算一次）。
        def inner_band_candidates(sl: int, dl: int):
            middle = list(range(sl + 1, dl))
            band_top = min(layers[li]["top"] for li in middle)
            band_bottom = max(layers[li]["bottom"] for li in middle)
            cands = set()
            for li in middle:
                L = layers[li]
                cands.add(L["top"] - self.v_gap / 2.0)
                cands.add(L["bottom"] + self.v_gap / 2.0)
                spans = L["yspans"]
                for (_, hi), (lo, _) in zip(spans, spans[1:]):
                    cands.add((hi + lo) / 2.0)
            free = [y for y in cands
                    if band_top <= y <= band_bottom
                    and all(self._interval_free(layers[li]["yspans"], y)
                            for li in middle)]
            return sorted(free)

        # 水平空闲带占用：band y -> 已占 (xlo, xhi) 有序不相交区间。
        h_bands: Dict[float, List[Tuple[float, float]]] = {}

        def band_take(y0: float, xlo: float, xhi: float) -> bool:
            """在水平空闲带 y0 占用 [xlo, xhi]。

            occ 保持按 xlo 有序且互不相交；与既有区间重合则拒绝。
            """
            occ = h_bands.setdefault(y0, [])
            pos = bisect.bisect_right([v[0] for v in occ], xlo)
            # 前驱可能向右覆盖 xlo；后继起点若 < xhi 也冲突（不相交性
            # 保证至多一个后继需要检查）。
            if pos > 0 and occ[pos - 1][1] > xlo + 1e-9:
                return False
            if pos < len(occ) and occ[pos][0] < xhi - 1e-9:
                return False
            occ.insert(pos, (xlo, xhi))
            return True

        # 竖直作业：(走廊, ylo, yhi, eid)。
        vjobs: List[Tuple[tuple, float, float, str]] = []
        # 已在第一趟定稿的边（相邻边 / 内带长边）：记录生成点列所需信息。
        direct: Dict[str, tuple] = {}
        # 外总线乘客：(eid, 源走廊, 目标走廊, sy, ty, sx, tx)
        bus_passengers: List[tuple] = []

        for eid in ordered:
            e = g.edges[eid]
            sl, dl = node_layer[e.source], node_layer[e.target]
            sx, sy = mid_right(e.source)
            tx, ty = mid_left(e.target)

            if sl + 1 == dl:
                # 相邻层：H-V-H，竖段在 gap sl。
                vjobs.append((("g", sl), min(sy, ty), max(sy, ty), eid))
                direct[eid] = ("adj", ("g", sl), sy, ty, sx, tx)
            elif sl < dl:
                # 长边：尝试中间层公共空闲带（按到端点包围盒距离排序）。
                xlo = layers[sl]["right"] + LANE_INSET
                xhi = layers[dl]["left"] - LANE_INSET
                cands = inner_band_candidates(sl, dl)
                lo_y, hi_y = sorted((sy, ty))
                cands.sort(key=lambda y: (
                    0.0 if lo_y <= y <= hi_y
                    else min(abs(lo_y - y), abs(hi_y - y)), y))
                placed = False
                for y0 in cands:
                    if band_take(y0, xlo, xhi):
                        c1, c2 = ("g", sl), ("g", dl - 1)
                        vjobs.append((c1, min(sy, y0), max(sy, y0), eid))
                        vjobs.append((c2, min(y0, ty), max(y0, ty), eid))
                        direct[eid] = ("inner", c1, c2, y0, sy, ty, sx, tx)
                        placed = True
                        break
                if not placed:
                    bus_passengers.append(
                        (eid, ("g", sl), ("g", dl - 1), sy, ty, sx, tx))
            else:
                # 同层 / 反向：源走右侧走廊，目标走左侧走廊，上总线。
                bus_passengers.append(
                    (eid, src_corridor(sl), dst_corridor(dl), sy, ty, sx, tx))

        # -- 总线电平染色（先于馈线 lane）--------------------------------
        # 馈线真实 x 取决于稍后的走廊 lane 编号；同一走廊 lane 偏移上界
        # 为 (LANES_PER_GAP-1)*LANE_PITCH_X。用该上界把总线 x 区间向两侧
        # 膨胀后做区间图染色：真实区间必被膨胀区间包含，故同一电平上的
        # 真实水平段必然不相交，被拒绝的共线只是多占一个电平，不影响
        # 正确性。底侧电平和顶侧电平各自独立染色，底侧优先。
        margin = LANES_PER_GAP * LANE_PITCH_X

        def base_x(cid) -> float:
            return corridor_x(cid, 0)

        bus_rows = []
        for (eid, c1, c2, sy, ty, sx, tx) in bus_passengers:
            x1, x2 = base_x(c1), base_x(c2)
            bus_rows.append((min(x1, x2) - margin,
                             max(x1, x2) + margin,
                             eid, c1, c2, sy, ty, sx, tx))
        bus_rows.sort(key=lambda r: (r[0], r[1], r[2]))

        bot_end: List[float] = []
        top_end: List[float] = []
        bus_info: Dict[str, Tuple[str, int, tuple, tuple, float, float,
                                  float, float]] = {}
        for lo, hi, eid, c1, c2, sy, ty, sx, tx in bus_rows:
            # 底侧优先：已有电平能放下就放底侧；否则尝试顶侧；都不行
            # 就在底侧新开电平。
            reuse_b = next((k for k, end in enumerate(bot_end)
                            if end <= lo + 1e-9), None)
            reuse_t = next((k for k, end in enumerate(top_end)
                            if end <= lo + 1e-9), None)
            if reuse_b is not None:
                side, level = "B", reuse_b
                bot_end[reuse_b] = hi
            elif reuse_t is not None:
                side, level = "T", reuse_t
                top_end[reuse_t] = hi
            else:
                side, level = "B", len(bot_end)
                bot_end.append(hi)
            bus_info[eid] = (side, level, c1, c2, sy, ty, sx, tx)

        # 按已选定的侧 / 电平，只登记该侧真正使用的馈线竖段。
        for eid, (side, level, c1, c2, sy, ty, _sx, _tx) in bus_info.items():
            if side == "B":
                by = global_bottom + OUTSIDE_MARGIN + level * OUTSIDE_PITCH
            else:
                by = global_top - OUTSIDE_MARGIN - level * OUTSIDE_PITCH
            vjobs.append((c1, min(sy, by), max(sy, by), eid))
            vjobs.append((c2, min(ty, by), max(ty, by), eid))

        # -- 走廊区间图染色（离线 sweep）---------------------------------
        # 每个走廊把作业按 (ylo, yhi, tag) 排序，贪心上最低可用 lane：
        # lane 末尾区间 hi <= ylo（端点相接不算重合）即可复用。
        corridor_jobs: Dict[tuple, List[tuple]] = {}
        for job in vjobs:
            corridor_jobs.setdefault(job[0], []).append(job)

        job_lane: Dict[tuple, int] = {}
        for cid, jobs in corridor_jobs.items():
            jobs.sort(key=lambda j: (j[1], j[2], j[3]))
            lane_end: List[float] = []  # 每条 lane 当前最后区间的 hi
            for _, ylo, yhi, tag in jobs:
                assigned = None
                for k, end in enumerate(lane_end):
                    if end <= ylo + 1e-9:
                        assigned = k
                        lane_end[k] = yhi
                        break
                if assigned is None:
                    assigned = len(lane_end)
                    lane_end.append(yhi)
                job_lane[(cid, tag)] = assigned
            if cid[0] == "g" and len(lane_end) > LANES_PER_GAP:
                raise RuntimeError(
                    f"层间通道 {cid[1]} 拥塞：需要 {len(lane_end)} 条竖直 "
                    f"lane，超过容量 {LANES_PER_GAP}")

        # -- 统一输出点列 -------------------------------------------------
        for eid in ordered:
            e = g.edges[eid]
            if eid in direct:
                info = direct[eid]
                if info[0] == "adj":
                    _, cid, sy, ty, sx, tx = info
                    vx = corridor_x(cid, job_lane[(cid, eid)])
                    pts = [(sx, sy), (vx, sy), (vx, ty), (tx, ty)]
                else:
                    _, c1, c2, y0, sy, ty, sx, tx = info
                    x1 = corridor_x(c1, job_lane[(c1, eid)])
                    x2 = corridor_x(c2, job_lane[(c2, eid)])
                    pts = [(sx, sy), (x1, sy), (x1, y0), (x2, y0),
                           (x2, ty), (tx, ty)]
            else:
                side, level, c1, c2, sy, ty, sx, tx = bus_info[eid]
                if side == "B":
                    by = global_bottom + OUTSIDE_MARGIN + level * OUTSIDE_PITCH
                else:
                    by = global_top - OUTSIDE_MARGIN - level * OUTSIDE_PITCH
                x1 = corridor_x(c1, job_lane[(c1, eid)])
                x2 = corridor_x(c2, job_lane[(c2, eid)])
                pts = [(sx, sy), (x1, sy), (x1, by), (x2, by),
                       (x2, ty), (tx, ty)]

            # 压缩连续重复折点。
            deduped = [pts[0]]
            for p in pts[1:]:
                if abs(p[0] - deduped[-1][0]) > 1e-9 \
                        or abs(p[1] - deduped[-1][1]) > 1e-9:
                    deduped.append(p)
            routes[eid] = deduped

        # 自环不参与通道竞争：节点右侧外扩一圈。
        for eid, e in g.edges.items():
            if e.is_self_loop and e.source in positions:
                routes[eid] = self._self_loop_route(e, positions)
        return routes

    def _self_loop_route(self, edge: Edge,
                         positions: Dict[str, Tuple[float, float]]
                         ) -> List[Tuple[float, float]]:
        """自环：节点右侧外扩一圈，起止点都在右边界上。"""
        x, y = positions[edge.source]
        w, h = self._size_of(edge.source)
        mid_y = y + h / 2.0
        off = min(6.0, h / 4.0)
        bump_x = x + w + 30.0
        return [
            (x + w, mid_y - off),
            (bump_x, mid_y - off),
            (bump_x, mid_y + off),
            (x + w, mid_y + off),
        ]
