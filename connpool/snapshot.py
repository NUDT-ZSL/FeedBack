"""JSON 快照：保存全部可恢复状态，并在载入时做严格一致性校验。

快照内容（schema_version=1）：
    schema_version、clock_now、pools（含配置/连接/队列/租户占用/自增序号）、
    events（审计轨迹，保证占用与释放可复现）。

载入采用“先完整解析+校验，通过后整体替换”的两阶段策略：
任何字段缺失、类型错误、重复标识、归属不自洽都会抛 SnapshotError，
而调用 load_into（载入进已有内核）失败时，原实例的内存状态保持不变。
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Optional, Union

from .clock import ManualClock
from .kernel import PoolKernel, _PoolState
from .errors import Reason, SnapshotError
from .model import (
    CONN_BORROWED,
    CONN_IDLE,
    REQ_FULFILLED,
    REQ_WAITING,
    Connection,
    PoolConfig,
    QueuedRequest,
)

SCHEMA_VERSION = 1
_VALID_HEALTH = {"healthy", "unhealthy", "down"}
_VALID_CONN_STATE = {CONN_IDLE, CONN_BORROWED}
_VALID_REQ_STATUS = {"waiting", "fulfilled", "cancelled", "expired"}

# save_json/load_json 的通用参数类型
PathLike = Union[str, os.PathLike]


# ============================ 保存 ============================

def kernel_to_dict(kernel: PoolKernel) -> dict:
    """把内核状态序列化为可 json.dump 的普通 dict。"""
    with kernel._lock:
        pools_out = {}
        for pid in sorted(kernel._pools):
            st = kernel._pools[pid]
            pools_out[pid] = {
                "config": st.config.to_dict(),
                "health": st.health,
                "connections": [
                    st.connections[cid].to_dict()
                    for cid in sorted(st.connections)
                ],
                "tenant_in_use": dict(sorted(st.tenant_in_use.items())),
                "next_seq": st.next_seq,
                "queue": [r.to_dict() for r in st.queue],
            }
        return {
            "schema_version": SCHEMA_VERSION,
            "clock_now": kernel.clock.now(),
            "pools": pools_out,
            "events": kernel.events(),
        }


def save_json(kernel: PoolKernel, path: PathLike) -> None:
    """原子写：先写临时文件再替换，避免崩溃留下半截快照。"""
    data = kernel_to_dict(kernel)
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".connpool-snap-", suffix=".json",
                               dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ============================ 载入 ============================

class _R:
    """字段读取助手：把缺失/类型错误统一转成 SnapshotError，信息带路径。"""

    def __init__(self, ctx: str):
        # ctx 例：pools['orders'].connections[2]
        self.ctx = ctx

    def field(self, obj: dict, name: str, typ, *, optional=False, default=None,
              nullable=False):
        if not isinstance(obj, dict):
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT,
                f"{self.ctx} 应为 JSON 对象，实际为 {type(obj).__name__}")
        if name not in obj:
            if optional:
                return default
            raise SnapshotError(
                Reason.SNAPSHOT_MISSING_FIELD,
                f"{self.ctx} 缺少必填字段 {name!r}")
        value = obj[name]
        if value is None and nullable:
            return None
        is_bool_bad = typ is int and isinstance(value, bool)
        if not isinstance(value, typ) or is_bool_bad:
            want = typ.__name__ if not isinstance(typ, tuple) else "/".join(
                t.__name__ for t in typ)
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT,
                f"{self.ctx}.{name} 应为 {want} 类型，实际为 "
                f"{type(value).__name__}（值={value!r}）")
        return value

    def sub(self, path: str) -> "_R":
        return _R(f"{self.ctx}.{path}")

    def at(self, index: int) -> "_R":
        return _R(f"{self.ctx}[{index}]")


def load_json(path: PathLike, kernel: Optional[PoolKernel] = None) -> PoolKernel:
    """从 JSON 文件恢复内核。

    新建内核则创建并返回；传入已有内核时，校验通过后整体替换其状态，
    失败时该内核的内存状态完全不变。
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as exc:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, f"无法读取快照文件 {path!r}：{exc}")
    return restore_from_text(text, kernel=kernel)


def restore_from_text(text: str, kernel: Optional[PoolKernel] = None) -> PoolKernel:
    """从 JSON 文本恢复（测试与离线复现直接用这个）。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT,
            f"快照不是合法 JSON：第 {exc.lineno} 行第 {exc.colno} 列附近"
            f"（{exc.msg}）")
    return _restore(data, kernel=kernel)


def _restore(data: dict, kernel: Optional[PoolKernel]) -> PoolKernel:
    """两阶段恢复：本地构建并完整校验 -> 一次性装入内核。"""
    if not isinstance(data, dict):
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, "快照顶层必须是 JSON 对象")

    r = _R("snapshot")
    version = r.field(data, "schema_version", int)
    if version != SCHEMA_VERSION:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT,
            f"不支持的快照版本 schema_version={version}，"
            f"本内核只支持 {SCHEMA_VERSION}")
    clock_now = r.field(data, "clock_now", int)
    pools_raw = r.field(data, "pools", dict)
    if "events" not in data or not isinstance(data["events"], list):
        raise SnapshotError(
            Reason.SNAPSHOT_MISSING_FIELD, "snapshot.events 必须存在且为数组")

    if kernel is None:
        kernel = PoolKernel(ManualClock(clock_now))
    # 注意：此时不改动 kernel 的任何状态（包括时钟）；
    # 全部校验通过后由 _load_state 一次性提交。

    # ---- 第一阶段：在本地变量里构建，绝不触碰 kernel 现有状态 ----
    new_pools: dict[str, _PoolState] = {}
    new_seq: dict[str, int] = {}

    for pid, pdata in pools_raw.items():
        pr = _R(f"pools[{pid!r}]")
        if not isinstance(pdata, dict):
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT, f"{pr.ctx} 必须是对象")
        cfg_dict = pr.field(pdata, "config", dict)
        cfg = _parse_config(pid, cfg_dict)
        if cfg.pool_id != pid:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} 的键名 {pid!r} 与 config.pool_id "
                f"{cfg.pool_id!r} 不一致")

        health = pr.field(pdata, "health", str)
        if health not in _VALID_HEALTH:
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT,
                f"{pr.ctx}.health 非法：{health!r}，"
                f"合法值为 {sorted(_VALID_HEALTH)}")

        st = _PoolState(cfg)
        st.health = health

        # ---- 连接 ----
        conns_raw = pr.field(pdata, "connections", list)
        seen_conn: set[str] = set()
        for i, cdata in enumerate(conns_raw):
            cr = _R(f"{pr.ctx}.connections[{i}]")
            conn = _parse_connection(cr, cdata, pid)
            if conn.conn_id in seen_conn:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{cr.ctx} 连接标识重复：{conn.conn_id!r}")
            seen_conn.add(conn.conn_id)
            st.connections[conn.conn_id] = conn
            if conn.state == CONN_IDLE:
                if conn.idle_since is None:
                    raise SnapshotError(
                        Reason.SNAPSHOT_INCONSISTENT,
                        f"{cr.ctx} 空闲连接 {conn.conn_id!r} 必须有 idle_since")
                if conn.retire_on_return:
                    raise SnapshotError(
                        Reason.SNAPSHOT_INCONSISTENT,
                        f"{cr.ctx} 空闲连接 {conn.conn_id!r} 不应带着 "
                        f"retire_on_return 标记（退役空闲连接必须立即关闭）")
                st.idle_order.append(conn.conn_id)
            else:
                if conn.tenant is None or conn.borrowed_at is None:
                    raise SnapshotError(
                        Reason.SNAPSHOT_INCONSISTENT,
                        f"{cr.ctx} 借出连接 {conn.conn_id!r} 必须有持有租户与借出时刻")

        # idle_order 必须按 idle_since 升序（与内核维护方式一致）
        prev = None
        for cid in st.idle_order:
            ts = st.connections[cid].idle_since
            if prev is not None and ts < prev:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{pr.ctx} 空闲连接顺序不是按 idle_since 升序：{cid!r}")
            prev = ts

        # ---- 租户占用 ----
        in_use_raw = pr.field(pdata, "tenant_in_use", dict)
        counted: dict[str, int] = {}
        for conn in st.connections.values():
            if conn.tenant is not None:
                counted[conn.tenant] = counted.get(conn.tenant, 0) + 1
        for t, n in in_use_raw.items():
            if not isinstance(t, str) or not t:
                raise SnapshotError(
                    Reason.SNAPSHOT_CORRUPT,
                    f"{pr.ctx}.tenant_in_use 的租户名必须是非空字符串")
            if not isinstance(n, int) or isinstance(n, bool) or n < 0:
                raise SnapshotError(
                    Reason.SNAPSHOT_CORRUPT,
                    f"{pr.ctx}.tenant_in_use[{t!r}] 必须是非负整数")
        # 校验通过后以“按连接实际归属统计”为准重建计数器
        st.tenant_in_use = counted
        if dict(sorted(in_use_raw.items())) != dict(sorted(counted.items())):
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} tenant_in_use={dict(sorted(in_use_raw.items()))} "
                f"与连接实际归属统计 {dict(sorted(counted.items()))} 不一致")

        # 配额与占用自洽
        for t, n in counted.items():
            quota = cfg.quotas.get(t)
            if quota is None:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{pr.ctx} 租户 {t!r} 持有 {n} 条连接但没有配额配置")
            if n > quota:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{pr.ctx} 租户 {t!r} 占用 {n} 超过其配额 {quota}")

        # 物理容量约束：总数允许瞬时超过容量，但超额部分必须是“借出中且
        # 已标记归还即关”的连接（来自收缩/摘流，等归还后回落）
        active = [c for c in st.connections.values()
                  if not c.retire_on_return]
        retired_borrowed = [c for c in st.connections.values()
                            if c.retire_on_return and c.state == CONN_BORROWED]
        n_idle = len(st.idle_order)
        if n_idle > cfg.capacity:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} 空闲连接数 {n_idle} 超过容量 {cfg.capacity}")
        if len(active) > cfg.capacity:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} 未退役连接数 {len(active)} 超过容量 "
                f"{cfg.capacity}，且无合法退役标记")
        if len(active) + len(retired_borrowed) != st.total:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} 存在既未退役、又无法计入活跃集合的连接，"
                f"归属不自洽（total={st.total}）")
        # 实际占用（借出数）不得超过容量
        borrowed_count = sum(1 for c in st.connections.values()
                             if c.state == CONN_BORROWED)
        if borrowed_count > cfg.capacity:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{pr.ctx} 借出连接数 {borrowed_count} 超过容量 {cfg.capacity}")

        # ---- 排队请求 ----
        queue_raw = pr.field(pdata, "queue", list)
        seen_ticket: set[int] = set()
        for i, qdata in enumerate(queue_raw):
            qr = _R(f"{pr.ctx}.queue[{i}]")
            req = _parse_queue(qr, qdata, pid, st)
            if req.ticket_id in seen_ticket:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{qr.ctx} 票据号重复：#{req.ticket_id}")
            seen_ticket.add(req.ticket_id)
            st.queue.append(req)

        # ---- 自增序号 ----
        next_seq = pr.field(pdata, "next_seq", int)
        if next_seq < 1:
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT,
                f"{pr.ctx}.next_seq 必须 >= 1")
        for conn in st.connections.values():
            suffix = conn.conn_id.rsplit("-", 1)
            # 形如 pool-3 -> 已用序号 3（不强制前缀等于 pool_id，只校验数值不越界）
            if suffix[-1].isdigit():
                used_seq = int(suffix[-1])
                if used_seq >= next_seq:
                    raise SnapshotError(
                        Reason.SNAPSHOT_INCONSISTENT,
                        f"{pr.ctx} 连接 {conn.conn_id!r} 的序号 {used_seq} "
                        f"不小于 next_seq={next_seq}，会产生重复 ID")
        for req in st.queue:
            if req.ticket_id >= next_seq:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{pr.ctx} 票据 #{req.ticket_id} 不小于 next_seq={next_seq}")
        new_seq[pid] = next_seq
        new_pools[pid] = st

    # ---- events 轻量校验（轨迹只做回放参考，不参与运行态不变量）----
    events = data["events"]
    if not isinstance(events, list):
        raise SnapshotError(Reason.SNAPSHOT_CORRUPT, "events 必须是数组")
    prev_seq = 0
    for i, ev in enumerate(events):
        er = _R(f"events[{i}]")
        if not isinstance(ev, dict):
            raise SnapshotError(Reason.SNAPSHOT_CORRUPT, f"{er.ctx} 必须是对象")
        seq = er.field(ev, "seq", int)
        if seq != prev_seq + 1:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{er.ctx} 事件序号不连续：期望 {prev_seq + 1}，实际 {seq}")
        prev_seq = seq
        er.field(ev, "at", int)
        er.field(ev, "kind", str)
        er.field(ev, "pool_id", str)

    # ---- 第二阶段：全部校验通过，整体提交 ----
    event_seq = prev_seq + 1
    if kernel is None:
        kernel = PoolKernel(ManualClock(clock_now))
    kernel._load_state(new_pools, clock_now,
                       [dict(e) for e in events], event_seq, new_seq)
    return kernel


def _parse_config(pid: str, data: dict) -> PoolConfig:
    cr = _R(f"pools[{pid!r}].config")
    pool_id = cr.field(data, "pool_id", str)
    if not pool_id:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, f"{cr.ctx}.pool_id 不能为空字符串")
    capacity = cr.field(data, "capacity", int)
    if capacity <= 0:
        raise SnapshotError(
            Reason.SNAPSHOT_INCONSISTENT,
            f"{cr.ctx} 容量必须为正整数（capacity={capacity}），零/负容量非法")
    idle_ttl = cr.field(data, "idle_ttl", int)
    max_queue = cr.field(data, "max_queue", int)
    if max_queue < -1:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT,
            f"{cr.ctx}.max_queue 只能是 -1/0/正整数，实际 {max_queue}")
    quotas_raw = cr.field(data, "quotas", dict)
    quotas: dict[str, int] = {}
    for t, q in quotas_raw.items():
        if not isinstance(t, str) or not t:
            raise SnapshotError(
                Reason.SNAPSHOT_CORRUPT,
                f"{cr.ctx}.quotas 的租户名必须是非空字符串")
        if not isinstance(q, int) or isinstance(q, bool) or q < 0:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{cr.ctx}.quotas[{t!r}] 必须是非负整数，实际 {q!r}")
        quotas[t] = q
    return PoolConfig(pool_id=pool_id, capacity=capacity, idle_ttl=idle_ttl,
                      max_queue=max_queue, quotas=quotas)


def _parse_connection(r: _R, data: dict, pool_id: str) -> Connection:
    conn_id = r.field(data, "conn_id", str)
    if not conn_id:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, f"{r.ctx}.conn_id 不能为空")
    c_pool = r.field(data, "pool_id", str)
    if c_pool != pool_id:
        raise SnapshotError(
            Reason.SNAPSHOT_INCONSISTENT,
            f"{r.ctx} 连接 {conn_id!r} 的 pool_id={c_pool!r} 与其所在池 "
            f"{pool_id!r} 不一致")
    born_at = r.field(data, "born_at", int)

    tenant = r.field(data, "tenant", str, optional=True, nullable=True,
                     default=None)
    borrowed_at = r.field(data, "borrowed_at", int, optional=True,
                          nullable=True, default=None)
    idle_since = r.field(data, "idle_since", int, optional=True,
                         nullable=True, default=None)
    purpose = r.field(data, "purpose", str, optional=True, nullable=True,
                      default=None)
    last_tenant = r.field(data, "last_tenant", str, optional=True,
                          nullable=True, default=None)
    retire = r.field(data, "retire_on_return", bool, optional=True, default=False)

    # 状态自洽：tenant 是否为 None 决定 idle/borrowed
    state_is_borrowed = tenant is not None
    if tenant is not None and not tenant:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, f"{r.ctx}.tenant 不能为空字符串")
    if state_is_borrowed:
        if borrowed_at is None:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 借出连接 {conn_id!r} 缺少 borrowed_at")
        if idle_since is not None:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 借出连接 {conn_id!r} 不应有 idle_since")
    else:
        if borrowed_at is not None or purpose is not None:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 空闲连接 {conn_id!r} 不应带有 borrowed_at/purpose")
    if borrowed_at is not None and borrowed_at < born_at:
        raise SnapshotError(
            Reason.SNAPSHOT_INCONSISTENT,
            f"{r.ctx} 连接 {conn_id!r} 的借出时刻早于创建时刻")
    return Connection(
        conn_id=conn_id, pool_id=pool_id, born_at=born_at,
        idle_since=idle_since, last_tenant=last_tenant,
        tenant=tenant, borrowed_at=borrowed_at, purpose=purpose,
        retire_on_return=retire)


def _parse_queue(r: _R, data: dict, pool_id: str,
                 st: _PoolState) -> QueuedRequest:
    ticket_id = r.field(data, "ticket_id", int)
    q_pool = r.field(data, "pool_id", str)
    if q_pool != pool_id:
        raise SnapshotError(
            Reason.SNAPSHOT_INCONSISTENT,
            f"{r.ctx} 票据 #{ticket_id} 的 pool_id={q_pool!r} 与所在池不一致")
    tenant = r.field(data, "tenant", str)
    if not tenant:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT, f"{r.ctx}.tenant 不能为空字符串")
    purpose = r.field(data, "purpose", str)
    enqueued_at = r.field(data, "enqueued_at", int)
    deadline = r.field(data, "deadline", int, optional=True, nullable=True,
                       default=None)
    if deadline is not None and deadline < enqueued_at:
        raise SnapshotError(
            Reason.SNAPSHOT_INCONSISTENT,
            f"{r.ctx} 票据 #{ticket_id} 的 deadline 早于入队时刻")
    status = r.field(data, "status", str)
    if status not in _VALID_REQ_STATUS:
        raise SnapshotError(
            Reason.SNAPSHOT_CORRUPT,
            f"{r.ctx}.status 非法：{status!r}")
    conn_id = r.field(data, "conn_id", str, optional=True, nullable=True,
                      default=None)

    if status == REQ_WAITING:
        if tenant not in st.config.quotas:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 等待中的票据 #{ticket_id} 的租户 {tenant!r} "
                f"没有配额配置")
        if conn_id is not None:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 等待中的票据 #{ticket_id} 不应绑定连接")
    if status == REQ_FULFILLED:
        if conn_id is None:
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 已兑现票据 #{ticket_id} 必须绑定 conn_id")
        conn = st.connections.get(conn_id)
        if conn is None:
            # 历史票据：绑定的连接之后已被正常关闭，允许保留记录；
            # 但 conn_id 不能为空的情况已在上面拦截
            pass
        elif conn.tenant is not None:
            # 连接仍被借出：持有者必须就是票据租户，否则归属乱填
            if conn.tenant != tenant:
                raise SnapshotError(
                    Reason.SNAPSHOT_INCONSISTENT,
                    f"{r.ctx} 已兑现票据 #{ticket_id} 绑定连接当前由 "
                    f"{conn.tenant!r} 持有，与票据租户 {tenant!r} 不一致")
        elif conn.last_tenant != tenant:
            # 连接已空闲：亲缘租户必须对得上
            raise SnapshotError(
                Reason.SNAPSHOT_INCONSISTENT,
                f"{r.ctx} 已兑现票据 #{ticket_id} 绑定空闲连接的 "
                f"last_tenant={conn.last_tenant!r}，与票据租户 "
                f"{tenant!r} 不一致")
    return QueuedRequest(
        ticket_id=ticket_id, pool_id=pool_id, tenant=tenant, purpose=purpose,
        enqueued_at=enqueued_at, deadline=deadline, status=status,
        conn_id=conn_id)
