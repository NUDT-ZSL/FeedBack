"""履约协同核心：需求拆分、节点承接、依赖推进、异常改派与查询。

设计要点
--------
* 拆分是确定性的：同一输入永远得到同一批次划分；对已拆分的需求重复提交
  相同方案是幂等 no-op，提交不同方案则报错。
* 节点已承接量按累计口径计量：每次成功承接 +1，只增不减，批次完成
  或改派出去都不扣减；剩余可承接量 = 容量上限 - 累计已承接量。
* 批次归属以 batch.node_id 为唯一事实来源，改派在校验通过后一次性
  切换归属并给新节点计数，是原子操作，任何时刻同一批次只属于一个节点。
* 推进只沿直接后继传播：批次完成时仅检查直接依赖它的批次，
  是否解除阻塞由"全部前置是否已完成"重新判定，因此任意时刻的
  ready/pending 集合与从头推导的结果一致。
* 所有会改变状态的操作先完整校验、后落库，校验失败不产生任何中间态。
* 每一次状态变化都追加一条带序号的推进记录（事件日志），可整体
  序列化、重放比对。
"""

from __future__ import annotations

import heapq

from .errors import CapacityError, NotFoundError, StateError, ValidationError
from .models import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    STATUS_PENDING,
    STATUS_READY,
    Batch,
    Demand,
    Node,
)

# 推进类事件：用于验收时比对"推进记录是否与逐步推导一致"
_ADVANCEMENT_EVENTS = ("batch_started", "batch_completed", "batch_promoted")


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _require_id(kind, value):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{kind}标识必须是非空字符串，收到: {value!r}")


def _require_positive_int(kind, value):
    if not _is_int(value) or value <= 0:
        raise ValidationError(f"{kind}必须是正整数，收到: {value!r}")


class FulfillmentSystem:
    """供应链履约协同系统。"""

    def __init__(self):
        self._demands = {}
        self._batches = {}
        self._nodes = {}
        self._events = []
        self._seq = 0

    # ------------------------------------------------------------------
    # 只读视图
    # ------------------------------------------------------------------
    @property
    def demands(self):
        return tuple(sorted(self._demands.values(), key=lambda d: d.id))

    @property
    def batches(self):
        return tuple(sorted(self._batches.values(), key=lambda b: b.id))

    @property
    def nodes(self):
        return tuple(sorted(self._nodes.values(), key=lambda n: n.id))

    @property
    def events(self):
        """全部推进/变更记录，按发生顺序。"""
        return [dict(e) for e in self._events]

    def advancement_log(self):
        """推进记录子集：开工、完成、解除阻塞三类事件。"""
        return [dict(e) for e in self._events if e["type"] in _ADVANCEMENT_EVENTS]

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    def _record(self, event_type, **payload):
        self._seq += 1
        event = {"seq": self._seq, "type": event_type}
        event.update(payload)
        self._events.append(event)

    def _get_demand(self, demand_id):
        try:
            return self._demands[demand_id]
        except KeyError:
            raise NotFoundError(f"需求 {demand_id!r} 不存在") from None

    def _get_batch(self, batch_id):
        try:
            return self._batches[batch_id]
        except KeyError:
            raise NotFoundError(f"批次 {batch_id!r} 不存在") from None

    def _get_node(self, node_id):
        try:
            return self._nodes[node_id]
        except KeyError:
            raise NotFoundError(f"节点 {node_id!r} 不存在") from None

    @staticmethod
    def _node_remaining(node):
        """剩余可承接量 = 容量上限 - 累计已承接量（与累计口径自洽）。"""
        return node.capacity - node.accepted

    @staticmethod
    def _topo_order(prereq_map):
        """对 {批次id: 前置集合} 做拓扑排序。

        使用最小堆做同层 tie-break，保证结果稳定；检测到环时抛出
        ValidationError 并列出卷入环的批次。
        """
        indegree = {b: 0 for b in prereq_map}
        dependents = {b: [] for b in prereq_map}
        for batch_id, prereqs in prereq_map.items():
            for p in prereqs:
                if p in indegree:
                    indegree[batch_id] += 1
                    dependents[p].append(batch_id)
        heap = [b for b, d in indegree.items() if d == 0]
        heapq.heapify(heap)
        order = []
        while heap:
            current = heapq.heappop(heap)
            order.append(current)
            for nxt in dependents[current]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    heapq.heappush(heap, nxt)
        if len(order) != len(prereq_map):
            cyclic = sorted(b for b, d in indegree.items() if d > 0)
            raise ValidationError(f"前置依赖存在环，涉及批次: {cyclic}")
        return order

    # ------------------------------------------------------------------
    # 需求与拆分
    # ------------------------------------------------------------------
    def create_demand(self, demand_id, total_quantity):
        _require_id("需求", demand_id)
        if demand_id in self._demands:
            raise ValidationError(f"需求 {demand_id!r} 已存在")
        _require_positive_int(f"需求 {demand_id!r} 总量", total_quantity)
        demand = Demand(id=demand_id, total_quantity=total_quantity)
        self._demands[demand_id] = demand
        self._record("demand_created", demand_id=demand_id, total_quantity=total_quantity)
        return demand

    def split_demand(self, demand_id, plan):
        """把需求拆分为若干批次。

        plan 为字典列表，每项支持键：
          id            批次标识（缺省时按位置生成 "<需求id>-B001" 形式）
          quantity      正整数，必填
          prerequisites 前置批次标识列表，可选
          node_id       初始承接节点，可选

        校验全部通过后才落库；同一需求重复提交相同方案为幂等 no-op。
        """
        demand = self._get_demand(demand_id)
        if not isinstance(plan, (list, tuple)) or not plan:
            raise ValidationError("拆分方案必须是非空列表")

        normalized = []
        seen_ids = set()
        for index, entry in enumerate(plan):
            if not isinstance(entry, dict):
                raise ValidationError(f"拆分方案第 {index + 1} 项必须是字典，收到: {entry!r}")
            batch_id = entry.get("id") or f"{demand_id}-B{index + 1:03d}"
            _require_id("批次", batch_id)
            if batch_id in seen_ids:
                raise ValidationError(f"拆分方案中批次标识重复: {batch_id!r}")
            seen_ids.add(batch_id)
            _require_positive_int(f"批次 {batch_id!r} 数量", entry.get("quantity"))
            quantity = entry["quantity"]
            prereqs = entry.get("prerequisites") or []
            if not isinstance(prereqs, (list, tuple)):
                raise ValidationError(f"批次 {batch_id!r} 的前置批次必须是列表")
            prereqs = list(prereqs)
            for p in prereqs:
                _require_id("前置批次", p)
            if len(set(prereqs)) != len(prereqs):
                raise ValidationError(f"批次 {batch_id!r} 的前置批次存在重复")
            node_id = entry.get("node_id")
            if node_id is not None:
                _require_id("节点", node_id)
            normalized.append((batch_id, quantity, tuple(sorted(prereqs)), node_id))

        total = sum(q for _, q, _, _ in normalized)
        if total != demand.total_quantity:
            raise ValidationError(
                f"拆分数量之和 {total} 与需求 {demand_id!r} 总量 "
                f"{demand.total_quantity} 不一致，不允许遗漏或多出"
            )

        # 幂等：已拆分的需求，方案一致直接返回现状，不一致则拒绝
        canonical = tuple(sorted((bid, q, ps) for bid, q, ps, _ in normalized))
        existing = self.demand_batches(demand_id)
        if existing:
            current = tuple(
                sorted((b.id, b.quantity, tuple(sorted(b.prerequisites))) for b in existing)
            )
            if current == canonical:
                return existing
            raise ValidationError(f"需求 {demand_id!r} 已拆分，新方案与现有批次不一致")

        for batch_id, _, _, _ in normalized:
            if batch_id in self._batches:
                raise ValidationError(f"批次标识 {batch_id!r} 已被占用")

        plan_ids = {bid for bid, _, _, _ in normalized}
        for batch_id, _, prereqs, _ in normalized:
            for p in prereqs:
                if p == batch_id:
                    raise ValidationError(f"批次 {batch_id!r} 不能以自己为前置")
                if p not in plan_ids:
                    raise NotFoundError(
                        f"批次 {batch_id!r} 的前置批次 {p!r} 不存在于拆分方案中"
                    )

        # 无环校验（对完整方案做拓扑排序）
        self._topo_order({bid: ps for bid, _, ps, _ in normalized})

        # 节点与容量预校验：全部通过后才创建批次，保证不产生中间态
        per_node = {}
        for batch_id, _, _, node_id in normalized:
            if node_id is not None:
                per_node.setdefault(node_id, []).append(batch_id)
        for node_id, batch_ids in per_node.items():
            node = self._nodes.get(node_id)
            if node is None:
                raise NotFoundError(f"节点 {node_id!r} 不存在")
            if not node.online:
                raise StateError(f"节点 {node_id!r} 已下线，无法承接批次")
            remaining = self._node_remaining(node)
            if len(batch_ids) > remaining:
                raise CapacityError(
                    f"节点 {node_id!r} 容量不足：剩余可承接量 {remaining}，"
                    f"拆分方案需要 {len(batch_ids)}",
                    node_id=node_id,
                    remaining=remaining,
                )

        created = []
        for batch_id, quantity, prereqs, node_id in normalized:
            batch = Batch(
                id=batch_id,
                demand_id=demand_id,
                quantity=quantity,
                prerequisites=prereqs,
                node_id=node_id,
                status=STATUS_READY if not prereqs else STATUS_PENDING,
            )
            self._batches[batch_id] = batch
            if node_id is not None:
                self._nodes[node_id].accepted += 1
            created.append(batch)
        created.sort(key=lambda b: b.id)
        self._record(
            "demand_split",
            demand_id=demand_id,
            batches=[
                {
                    "id": b.id,
                    "quantity": b.quantity,
                    "prerequisites": list(b.prerequisites),
                    "node_id": b.node_id,
                }
                for b in created
            ],
        )
        return created

    def split_evenly(self, demand_id, parts):
        """确定性均分：余数依次分给排在前面的批次，同一输入结果完全一致。"""
        demand = self._get_demand(demand_id)
        _require_positive_int("拆分份数", parts)
        if parts > demand.total_quantity:
            raise ValidationError(
                f"拆分份数 {parts} 超过需求 {demand_id!r} 总量 "
                f"{demand.total_quantity}，会出现数量为 0 的批次"
            )
        base, remainder = divmod(demand.total_quantity, parts)
        plan = [
            {"quantity": base + (1 if i < remainder else 0)} for i in range(parts)
        ]
        return self.split_demand(demand_id, plan)

    # ------------------------------------------------------------------
    # 节点
    # ------------------------------------------------------------------
    def add_node(self, node_id, capacity):
        _require_id("节点", node_id)
        if node_id in self._nodes:
            raise ValidationError(f"节点 {node_id!r} 已存在")
        _require_positive_int(f"节点 {node_id!r} 容量上限", capacity)
        node = Node(id=node_id, capacity=capacity)
        self._nodes[node_id] = node
        self._record("node_added", node_id=node_id, capacity=capacity)
        return node

    def set_node_online(self, node_id, online):
        node = self._get_node(node_id)
        online = bool(online)
        if node.online == online:
            return node
        node.online = online
        self._record("node_online" if online else "node_offline", node_id=node_id)
        return node

    # ------------------------------------------------------------------
    # 承接与改派
    # ------------------------------------------------------------------
    def _ensure_assignable(self, node, batch_id):
        if not node.online:
            raise StateError(f"节点 {node.id!r} 已下线，无法承接批次 {batch_id!r}")
        remaining = self._node_remaining(node)
        if remaining <= 0:
            raise CapacityError(
                f"节点 {node.id!r} 容量不足：剩余可承接量 0，"
                f"批次 {batch_id!r} 无法承接",
                node_id=node.id,
                remaining=0,
            )

    def assign_batch(self, batch_id, node_id):
        """节点承接一个未分配的批次。超容量拒绝且不改变任何已有承接。"""
        batch = self._get_batch(batch_id)
        node = self._get_node(node_id)
        if batch.status == STATUS_COMPLETED:
            raise StateError(f"批次 {batch_id!r} 已完成，不能再被承接")
        if batch.node_id == node_id:
            return batch
        if batch.node_id is not None:
            raise StateError(
                f"批次 {batch_id!r} 已由节点 {batch.node_id!r} 承接，"
                f"请使用 reassign_batch 改派"
            )
        self._ensure_assignable(node, batch_id)
        node.accepted += 1
        batch.node_id = node_id
        self._record("batch_assigned", batch_id=batch_id, node_id=node_id)
        return batch

    def reassign_batch(self, batch_id, node_id):
        """把批次改派到另一个节点（原子操作）。

        先完成全部校验，再一次性切换归属并给新节点计数：改派完成后
        批次只属于新节点，原节点不再持有它；前置约束与数量保持不变；
        原节点的累计已承接量按口径不扣减。
        """
        batch = self._get_batch(batch_id)
        node = self._get_node(node_id)
        if batch.status == STATUS_COMPLETED:
            raise StateError(f"批次 {batch_id!r} 已完成，不能改派")
        if batch.node_id == node_id:
            return batch
        self._ensure_assignable(node, batch_id)
        old_node_id = batch.node_id
        # 原子切换：归属字段单点赋值，任何时刻批次只挂在一个节点名下
        node.accepted += 1
        batch.node_id = node_id
        self._record(
            "batch_reassigned",
            batch_id=batch_id,
            from_node_id=old_node_id,
            to_node_id=node_id,
        )
        return batch

    def auto_reassign(self, batch_id):
        """按固定规则自动改派：在线且剩余容量最大的节点，并列时取标识最小者。"""
        batch = self._get_batch(batch_id)
        candidates = []
        for node in self._nodes.values():
            if node.id == batch.node_id or not node.online:
                continue
            remaining = self._node_remaining(node)
            if remaining > 0:
                candidates.append((-remaining, node.id))
        if not candidates:
            raise CapacityError(
                f"没有可承接批次 {batch_id!r} 的在线节点",
                node_id=batch.node_id,
                remaining=0,
            )
        candidates.sort()
        return self.reassign_batch(batch_id, candidates[0][1])

    # ------------------------------------------------------------------
    # 推进
    # ------------------------------------------------------------------
    def start_batch(self, batch_id):
        batch = self._get_batch(batch_id)
        if batch.status == STATUS_PENDING:
            unfinished = [
                p
                for p in batch.prerequisites
                if self._batches[p].status != STATUS_COMPLETED
            ]
            raise StateError(
                f"批次 {batch_id!r} 的前置批次尚未完成: {unfinished}，不能开始"
            )
        if batch.status != STATUS_READY:
            raise StateError(f"批次 {batch_id!r} 当前状态为 {batch.status}，不能开始")
        if batch.node_id is None:
            raise StateError(f"批次 {batch_id!r} 尚未被任何节点承接，不能开始")
        if not self._nodes[batch.node_id].online:
            raise StateError(
                f"节点 {batch.node_id!r} 已下线，请先改派批次 {batch_id!r}"
            )
        batch.status = STATUS_IN_PROGRESS
        self._record("batch_started", batch_id=batch_id, node_id=batch.node_id)
        return batch

    def complete_batch(self, batch_id):
        """完成批次，并只推进直接受它约束的后续批次。

        返回本次被解除阻塞（pending -> ready）的批次列表，按标识排序。
        """
        batch = self._get_batch(batch_id)
        if batch.status != STATUS_IN_PROGRESS:
            raise StateError(f"批次 {batch_id!r} 未在进行中（状态 {batch.status}），不能完成")
        batch.status = STATUS_COMPLETED
        self._record("batch_completed", batch_id=batch_id)
        promoted = []
        for other in self.demand_batches(batch.demand_id):
            if other.status != STATUS_PENDING or batch_id not in other.prerequisites:
                continue
            if all(self._batches[p].status == STATUS_COMPLETED for p in other.prerequisites):
                other.status = STATUS_READY
                promoted.append(other)
                self._record("batch_promoted", batch_id=other.id, triggered_by=batch_id)
        return promoted

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def demand_batches(self, demand_id):
        """需求的全部批次，按标识稳定排序。"""
        self._get_demand(demand_id)
        return sorted(
            (b for b in self._batches.values() if b.demand_id == demand_id),
            key=lambda b: b.id,
        )

    def batch_info(self, batch_id):
        b = self._get_batch(batch_id)
        return {
            "id": b.id,
            "demand_id": b.demand_id,
            "quantity": b.quantity,
            "status": b.status,
            "node_id": b.node_id,
            "prerequisites": sorted(b.prerequisites),
        }

    def node_status(self, node_id):
        """节点承接情况。

        load 为累计已承接量（只增不减，完成/改派出不扣减）；
        remaining = capacity - load，与累计口径自洽；
        batches 为当前仍挂在该节点名下的在途（未完成）批次，
        由 batch.node_id 派生，同一批次只会出现在一个节点的列表里。
        """
        node = self._get_node(node_id)
        in_flight = sorted(
            b.id
            for b in self._batches.values()
            if b.node_id == node_id and b.status != STATUS_COMPLETED
        )
        return {
            "node_id": node_id,
            "capacity": node.capacity,
            "load": node.accepted,
            "remaining": self._node_remaining(node),
            "online": node.online,
            "batches": in_flight,
        }

    def prerequisite_chain(self, batch_id):
        """批次到需求根的完整前置链，按拓扑序（根在前）稳定返回。"""
        self._get_batch(batch_id)
        ancestors = set()
        stack = [batch_id]
        while stack:
            for p in self._batches[stack.pop()].prerequisites:
                if p not in ancestors:
                    ancestors.add(p)
                    stack.append(p)
        return self._topo_order({b: self._batches[b].prerequisites for b in ancestors})

    def executable_order(self, demand_id):
        """从零推导的可执行顺序（确定性拓扑序），用于与增量推进结果比对。"""
        self._get_demand(demand_id)
        return self._topo_order(
            {b.id: b.prerequisites for b in self.demand_batches(demand_id)}
        )

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------
    def dump(self):
        """导出为可 JSON 序列化的字典（确定性排序）。"""
        from .persistence import dump_system

        return dump_system(self)

    def save(self, path):
        """把全部状态原子写入 JSON 文件。"""
        from .persistence import save_system

        save_system(self, path)

    @classmethod
    def load(cls, path):
        """从 JSON 文件载入并完整校验。

        校验失败抛出 PersistenceError；载入在全新实例上进行，
        失败不会影响任何已有系统的状态。
        """
        from .persistence import load_system

        return load_system(path)
