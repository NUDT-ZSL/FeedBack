"""区域仓网调拨求解核心。

核心机制：
1. 逐地点计算净头寸 = 现有存量 + 在途数量 - 安全库存 - 未来需求。
   净头寸 < 0 形成缺口（需求方），> 0 形成可支援量（供给方）。
2. 每条调拨线路的单位代价 = 距离 * 单位运费(元/件/公里)
   + 时效权重(元/件/天) * 运输时效(天)，时效由距离 / 日均运输速度推得。
3. 用最小费用流在“供给 -> 需求”网络中求满足缺口前提下总代价最小的方案。
4. 可支援总量不足时引入虚拟供给“未满足量”，其单位代价
   = 惩罚基数 * (1 + 缺口率)，缺口率 = 缺口 / (安全库存 + 未来需求)。
   缺口率越高的地点惩罚越大，会被优先满足——这是统一的优先级规则，
   同时保证“未满足”永远贵于任何真实调拨（先尽量调拨，再谈取舍）。
"""

import heapq

INF = 10 ** 12
PENALTY_BASE = 1_000_000.0
EPS = 1e-9

DEFAULT_WEIGHTS = {
    "freight_per_km": 0.8,      # 单位运费：元 / 件 / 公里
    "time_weight": 50.0,        # 时效权重：元 / 件 / 天
    "speed_km_per_day": 600.0,  # 日均运输速度：公里 / 天
}


class _Edge:
    __slots__ = ("to", "rev", "cap", "cost", "tag")

    def __init__(self, to, rev, cap, cost, tag=None):
        self.to = to
        self.rev = rev
        self.cap = cap
        self.cost = cost
        self.tag = tag


class _MinCostFlow:
    """连续最短路（Dijkstra + 势）最小费用流。"""

    def __init__(self, n):
        self.g = [[] for _ in range(n)]

    def add_edge(self, fr, to, cap, cost, tag=None):
        fwd = _Edge(to, len(self.g[to]), cap, cost, tag)
        rev = _Edge(fr, len(self.g[fr]), 0, -cost)
        self.g[fr].append(fwd)
        self.g[to].append(rev)
        return fwd

    def flow(self, s, t):
        n = len(self.g)
        potential = [0.0] * n
        while True:
            dist = [INF] * n
            prev_v = [-1] * n
            prev_e = [-1] * n
            dist[s] = 0.0
            pq = [(0.0, s)]
            while pq:
                d, v = heapq.heappop(pq)
                if d > dist[v] + EPS:
                    continue
                for i, e in enumerate(self.g[v]):
                    if e.cap <= EPS:
                        continue
                    nd = d + e.cost + potential[v] - potential[e.to]
                    if nd < dist[e.to] - EPS:
                        dist[e.to] = nd
                        prev_v[e.to] = v
                        prev_e[e.to] = i
                        heapq.heappush(pq, (nd, e.to))
            if dist[t] >= INF / 2:
                break
            for v in range(n):
                if dist[v] < INF / 2:
                    potential[v] += dist[v]
            add = INF
            v = t
            while v != s:
                add = min(add, self.g[prev_v[v]][prev_e[v]].cap)
                v = prev_v[v]
            v = t
            while v != s:
                e = self.g[prev_v[v]][prev_e[v]]
                e.cap -= add
                self.g[v][e.rev].cap += add
                v = prev_v[v]


def _num(value, default=0.0):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(v, 0.0)


def lane_metrics(dist_km, weights):
    """线路单位代价与运输时效。"""
    lead_time = dist_km / weights["speed_km_per_day"]
    unit_cost = dist_km * weights["freight_per_km"] + lead_time * weights["time_weight"]
    return lead_time, unit_cost


def compute_plan(locations, distances, weights=None):
    """根据各地点库存/需求与距离矩阵，生成全局调拨方案。"""
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        for key in w:
            if key in weights:
                w[key] = max(_num(weights[key], w[key]), 1e-6)

    n = len(locations)
    if n == 0:
        return {"locations": [], "transfers": [], "explanations": [],
                "total": _empty_total(), "weights": w}

    locs = []
    for i, loc in enumerate(locations):
        on_hand = _num(loc.get("on_hand"))
        in_transit = _num(loc.get("in_transit"))
        safety = _num(loc.get("safety_stock"))
        demand = _num(loc.get("demand"))
        net = on_hand + in_transit - safety - demand
        locs.append({
            "id": loc.get("id", i),
            "name": str(loc.get("name", f"地点{i + 1}")),
            "on_hand": on_hand,
            "in_transit": in_transit,
            "safety_stock": safety,
            "demand": demand,
            "net": net,
            "gap": max(-net, 0.0),
            "supply": max(net, 0.0),
        })

    dist = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                try:
                    dist[i][j] = max(float(distances[i][j]), 0.0)
                except (TypeError, ValueError, IndexError):
                    dist[i][j] = 0.0

    demanders = [i for i, l in enumerate(locs) if l["gap"] > EPS]
    suppliers = [i for i, l in enumerate(locs) if l["supply"] > EPS]

    # 节点：0=源点, 1..n=供给, n+1..2n=需求, 2n+1=虚拟供给, 2n+2=汇点
    dummy = 2 * n + 1
    sink = 2 * n + 2
    mcf = _MinCostFlow(2 * n + 3)
    lane_edges = []
    unmet_edges = {}

    for i in suppliers:
        mcf.add_edge(0, 1 + i, locs[i]["supply"], 0.0)
    for j in demanders:
        mcf.add_edge(1 + n + j, sink, locs[j]["gap"], 0.0)
    for i in suppliers:
        for j in demanders:
            _, unit_cost = lane_metrics(dist[i][j], w)
            e = mcf.add_edge(1 + i, 1 + n + j, INF, unit_cost, tag=("lane", i, j))
            lane_edges.append(e)
    total_gap = sum(locs[j]["gap"] for j in demanders)
    if total_gap > EPS:
        mcf.add_edge(0, dummy, total_gap, 0.0)
        for j in demanders:
            base = locs[j]["safety_stock"] + locs[j]["demand"]
            ratio = locs[j]["gap"] / base if base > EPS else 1.0
            locs[j]["gap_ratio"] = ratio
            penalty = PENALTY_BASE * (1.0 + ratio)
            e = mcf.add_edge(dummy, 1 + n + j, INF, penalty, tag=("unmet", j))
            unmet_edges[j] = e

    mcf.flow(0, sink)

    transfers = []
    transport_cost = 0.0
    time_cost = 0.0
    for e in lane_edges:
        used = mcf.g[e.to][e.rev].cap
        if used > EPS:
            _, i, j = e.tag
            lead_time, unit_cost = lane_metrics(dist[i][j], w)
            qty = round(used, 2)
            lane_transport = qty * dist[i][j] * w["freight_per_km"]
            lane_time = qty * lead_time * w["time_weight"]
            transport_cost += lane_transport
            time_cost += lane_time
            transfers.append({
                "from": locs[i]["name"], "to": locs[j]["name"],
                "from_id": locs[i]["id"], "to_id": locs[j]["id"],
                "qty": qty, "distance": round(dist[i][j], 1),
                "lead_time": round(lead_time, 2),
                "unit_cost": round(unit_cost, 2),
                "cost": round(lane_transport + lane_time, 2),
            })
    transfers.sort(key=lambda t: -t["qty"])

    sent = [0.0] * n
    received = [0.0] * n
    for t in transfers:
        for i, l in enumerate(locs):
            if l["id"] == t["from_id"]:
                sent[i] += t["qty"]
            if l["id"] == t["to_id"]:
                received[i] += t["qty"]

    unmet = {}
    unmet_penalty = 0.0
    for j, e in unmet_edges.items():
        used = mcf.g[e.to][e.rev].cap
        if used > EPS:
            unmet[j] = round(used, 2)
            ratio = locs[j].get("gap_ratio", 0.0)
            unmet_penalty += used * PENALTY_BASE * (1.0 + ratio)

    for i, l in enumerate(locs):
        l["sent"] = round(sent[i], 2)
        l["received"] = round(received[i], 2)
        l["unmet"] = unmet.get(i, 0.0)
        l["gap_ratio"] = round(l.get("gap_ratio", 0.0), 4)
        if l["gap"] > EPS and l["unmet"] > EPS:
            l["status"] = "shortage"
        elif l["gap"] > EPS:
            l["status"] = "covered"
        elif l["sent"] > EPS:
            l["status"] = "supporting"
        elif l["supply"] > EPS:
            l["status"] = "surplus"
        else:
            l["status"] = "balanced"
        for key in ("net", "gap", "supply"):
            l[key] = round(l[key], 2)

    total_unmet = round(sum(unmet.values()), 2)
    total = {
        "total_gap": round(total_gap, 2),
        "total_supply": round(sum(l["supply"] for l in locs), 2),
        "total_unmet": total_unmet,
        "transport_cost": round(transport_cost, 2),
        "time_cost": round(time_cost, 2),
        "unmet_penalty": round(unmet_penalty, 2),
        "balanced": total_unmet <= EPS,
    }

    return {
        "locations": locs,
        "transfers": transfers,
        "total": total,
        "weights": w,
        "explanations": _explain(locs, transfers, total),
    }


def _empty_total():
    return {"total_gap": 0.0, "total_supply": 0.0, "total_unmet": 0.0,
            "transport_cost": 0.0, "time_cost": 0.0, "unmet_penalty": 0.0,
            "balanced": True}


def _explain(locs, transfers, total):
    """生成可读的取舍理由与方案说明。"""
    notes = []
    gaps = [l for l in locs if l["gap"] > EPS]
    if not gaps:
        notes.append("所有地点均满足安全库存与未来需求，无需调拨。")
        return notes

    for l in gaps:
        inbound = [t for t in transfers if t["to_id"] == l["id"]]
        if inbound:
            src = "、".join(f"{t['from']} {t['qty']:g} 件" for t in inbound)
            notes.append(
                f"{l['name']} 缺口 {l['gap']:g} 件，由 {src} 补足"
                f"（缺口率 {l['gap_ratio'] * 100:.1f}%）。")
        if l["unmet"] > EPS:
            notes.append(
                f"{l['name']} 仍有 {l['unmet']:g} 件无法满足"
                f"（缺口率 {l['gap_ratio'] * 100:.1f}%）。")

    if not total["balanced"]:
        shortage = total["total_gap"] - total["total_supply"]
        notes.append(
            f"全网可支援量 {total['total_supply']:g} 件 < 总缺口 "
            f"{total['total_gap']:g} 件，硬缺口 {shortage:g} 件，无法完全平衡。")
        ordered = sorted(gaps, key=lambda l: -l["gap_ratio"])
        rank = " > ".join(f"{l['name']}({l['gap_ratio'] * 100:.0f}%)" for l in ordered)
        notes.append(f"优先级规则：缺口率（缺口 ÷ (安全库存 + 需求)）高者优先。排序：{rank}。")
        sacrificed = [l["name"] for l in gaps if l["unmet"] > EPS]
        saved = [l["name"] for l in gaps if l["unmet"] <= EPS]
        if saved and sacrificed:
            notes.append(
                f"取舍结果：优先保住 {'、'.join(saved)}；"
                f"{'、'.join(sacrificed)} 因缺口率较低且供给不足而承担缺货。")
        notes.append("建议：对无法满足的地点安排紧急补货或上调其他地点安全库存。")
    else:
        cost = total["transport_cost"] + total["time_cost"]
        notes.append(
            f"全部缺口已平衡，共 {len(transfers)} 条调拨路径，"
            f"总代价 {cost:,.2f} 元（运输 {total['transport_cost']:,.2f} + "
            f"时效 {total['time_cost']:,.2f}）。")
    return notes
