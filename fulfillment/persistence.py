"""JSON 持久化：导出、原子写入、载入与完整校验。

载入时的校验顺序：结构 -> 标识唯一 -> 数量为正 -> 前置存在 -> 无环 ->
数量守恒 -> 在途持有不超容量、累计口径自洽 -> 推进记录合法。任何一步
失败都抛出带明确原因的 PersistenceError，且载入在全新实例上构建，
不会污染现有状态。
"""

import json
import os

from .errors import PersistenceError, ValidationError
from .models import STATUSES, Batch, Demand, Node
from .system import FulfillmentSystem

SCHEMA_VERSION = 2


# ----------------------------------------------------------------------
# 导出
# ----------------------------------------------------------------------
def dump_system(system):
    return {
        "version": SCHEMA_VERSION,
        "demands": [
            {"id": d.id, "total_quantity": d.total_quantity} for d in system.demands
        ],
        "nodes": [
            {
                "id": n.id,
                "capacity": n.capacity,
                "online": n.online,
                "accepted": n.accepted,
            }
            for n in system.nodes
        ],
        "batches": [
            {
                "id": b.id,
                "demand_id": b.demand_id,
                "quantity": b.quantity,
                "node_id": b.node_id,
                "status": b.status,
                "prerequisites": sorted(b.prerequisites),
            }
            for b in system.batches
        ],
        "events": [dict(e) for e in system.events],
    }


def save_system(system, path):
    """先写临时文件再原子替换，避免写一半留下损坏文件。"""
    payload = json.dumps(dump_system(system), ensure_ascii=False, indent=2, sort_keys=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        fh.write(payload)
    os.replace(tmp_path, path)


# ----------------------------------------------------------------------
# 载入
# ----------------------------------------------------------------------
def load_system(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as exc:
        raise PersistenceError(f"无法读取文件 {path!r}: {exc}") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PersistenceError(f"文件 {path!r} 不是合法 JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise PersistenceError("文件顶层必须是 JSON 对象")
    for key in ("version", "demands", "nodes", "batches", "events"):
        if key not in data:
            raise PersistenceError(f"文件缺少必需字段 {key!r}")
    if data["version"] != SCHEMA_VERSION:
        raise PersistenceError(
            f"不支持的文件版本 {data['version']!r}，当前支持 {SCHEMA_VERSION}"
        )
    for key in ("demands", "nodes", "batches", "events"):
        if not isinstance(data[key], list):
            raise PersistenceError(f"字段 {key!r} 必须是列表")

    demands = _parse_demands(data["demands"])
    nodes = _parse_nodes(data["nodes"])
    batches = _parse_batches(data["batches"], demands, nodes)
    _check_conservation(demands, batches)
    _check_acyclic(batches)
    _check_capacity(nodes, batches)
    events, seq = _parse_events(data["events"])

    system = FulfillmentSystem()
    system._demands.update(demands)
    system._nodes.update(nodes)
    system._batches.update(batches)
    system._events = events
    system._seq = seq
    return system


# ----------------------------------------------------------------------
# 字段级校验工具
# ----------------------------------------------------------------------
def _expect_object(item, where):
    if not isinstance(item, dict):
        raise PersistenceError(f"{where} 必须是对象，收到: {item!r}")
    return item


def _expect_field(obj, key, where):
    if key not in obj:
        raise PersistenceError(f"{where} 缺少字段 {key!r}")
    return obj[key]


def _expect_id(obj, key, where):
    value = _expect_field(obj, key, where)
    if not isinstance(value, str) or not value:
        raise PersistenceError(f"{where}.{key} 必须是非空字符串，收到: {value!r}")
    return value


def _expect_positive_int(obj, key, where):
    value = _expect_field(obj, key, where)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise PersistenceError(f"{where}.{key} 必须是正整数，收到: {value!r}")
    return value


def _expect_non_negative_int(obj, key, where):
    value = _expect_field(obj, key, where)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise PersistenceError(f"{where}.{key} 必须是非负整数，收到: {value!r}")
    return value


def _parse_demands(items):
    demands = {}
    for i, item in enumerate(items):
        where = f"demands[{i}]"
        obj = _expect_object(item, where)
        demand_id = _expect_id(obj, "id", where)
        total = _expect_positive_int(obj, "total_quantity", where)
        if demand_id in demands:
            raise PersistenceError(f"需求标识重复: {demand_id!r}")
        demands[demand_id] = Demand(id=demand_id, total_quantity=total)
    return demands


def _parse_nodes(items):
    nodes = {}
    for i, item in enumerate(items):
        where = f"nodes[{i}]"
        obj = _expect_object(item, where)
        node_id = _expect_id(obj, "id", where)
        capacity = _expect_positive_int(obj, "capacity", where)
        online = _expect_field(obj, "online", where)
        if not isinstance(online, bool):
            raise PersistenceError(f"{where}.online 必须是布尔值，收到: {online!r}")
        accepted = _expect_non_negative_int(obj, "accepted", where)
        if node_id in nodes:
            raise PersistenceError(f"节点标识重复: {node_id!r}")
        nodes[node_id] = Node(
            id=node_id, capacity=capacity, online=online, accepted=accepted
        )
    return nodes


def _parse_batches(items, demands, nodes):
    batches = {}
    raw_prereqs = {}
    for i, item in enumerate(items):
        where = f"batches[{i}]"
        obj = _expect_object(item, where)
        batch_id = _expect_id(obj, "id", where)
        demand_id = _expect_id(obj, "demand_id", where)
        if demand_id not in demands:
            raise PersistenceError(f"{where} 引用的需求 {demand_id!r} 不存在")
        quantity = _expect_positive_int(obj, "quantity", where)
        node_id = _expect_field(obj, "node_id", where)
        if node_id is not None:
            if not isinstance(node_id, str) or node_id not in nodes:
                raise PersistenceError(f"{where} 引用的节点 {node_id!r} 不存在")
        status = _expect_field(obj, "status", where)
        if status not in STATUSES:
            raise PersistenceError(
                f"{where}.status 非法: {status!r}，允许值: {list(STATUSES)}"
            )
        prereqs = _expect_field(obj, "prerequisites", where)
        if not isinstance(prereqs, list) or not all(isinstance(p, str) for p in prereqs):
            raise PersistenceError(f"{where}.prerequisites 必须是字符串列表")
        if len(set(prereqs)) != len(prereqs):
            raise PersistenceError(f"{where}.prerequisites 存在重复项")
        if batch_id in batches:
            raise PersistenceError(f"批次标识重复: {batch_id!r}")
        batches[batch_id] = Batch(
            id=batch_id,
            demand_id=demand_id,
            quantity=quantity,
            prerequisites=tuple(sorted(prereqs)),
            node_id=node_id,
            status=status,
        )
        raw_prereqs[batch_id] = prereqs
    # 第二遍：前置引用必须存在、属于同一需求、不能自指
    for batch_id, prereqs in raw_prereqs.items():
        for p in prereqs:
            if p == batch_id:
                raise PersistenceError(f"批次 {batch_id!r} 不能以自己为前置")
            if p not in batches:
                raise PersistenceError(
                    f"批次 {batch_id!r} 的前置批次 {p!r} 不存在"
                )
            if batches[p].demand_id != batches[batch_id].demand_id:
                raise PersistenceError(
                    f"批次 {batch_id!r} 的前置批次 {p!r} 属于其他需求"
                )
    return batches


def _check_conservation(demands, batches):
    """数量守恒：已拆分需求的批次数量之和必须精确等于需求总量。"""
    sums = {}
    for b in batches.values():
        sums[b.demand_id] = sums.get(b.demand_id, 0) + b.quantity
    for demand_id, total in sums.items():
        expected = demands[demand_id].total_quantity
        if total != expected:
            raise PersistenceError(
                f"需求 {demand_id!r} 数量不守恒：批次数量之和 {total} "
                f"与需求总量 {expected} 不一致"
            )


def _check_acyclic(batches):
    per_demand = {}
    for b in batches.values():
        per_demand.setdefault(b.demand_id, {})[b.id] = b.prerequisites
    for demand_id, prereq_map in per_demand.items():
        try:
            FulfillmentSystem._topo_order(prereq_map)
        except ValidationError as exc:
            raise PersistenceError(f"需求 {demand_id!r} 的前置依赖校验失败: {exc}") from exc


def _check_capacity(nodes, batches):
    """口径校验：在途持有不超容量上限；累计承接量不小于挂载批次数。"""
    mounted = {}    # 当前挂在节点名下的批次（含已完成）
    in_flight = {}  # 其中未完成（实际占用额度）的
    for b in batches.values():
        if b.node_id is not None:
            mounted[b.node_id] = mounted.get(b.node_id, 0) + 1
            if b.status != "completed":
                in_flight[b.node_id] = in_flight.get(b.node_id, 0) + 1
    for node_id, node in nodes.items():
        held = in_flight.get(node_id, 0)
        if held > node.capacity:
            raise PersistenceError(
                f"节点 {node_id!r} 当前持有 {held} 批，"
                f"超过容量上限 {node.capacity}"
            )
        current = mounted.get(node_id, 0)
        if node.accepted < current:
            raise PersistenceError(
                f"节点 {node_id!r} 累计承接量 {node.accepted} "
                f"小于当前挂载批次数 {current}，数据不一致"
            )


def _parse_events(items):
    events = []
    last_seq = 0
    for i, item in enumerate(items):
        where = f"events[{i}]"
        obj = _expect_object(item, where)
        seq = _expect_positive_int(obj, "seq", where)
        if seq <= last_seq:
            raise PersistenceError(f"{where}.seq 必须严格递增，收到: {seq}")
        event_type = _expect_id(obj, "type", where)
        last_seq = seq
        events.append(dict(obj, seq=seq, type=event_type))
    return events, last_seq
