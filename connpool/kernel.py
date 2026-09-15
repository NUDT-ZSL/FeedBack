"""连接池与通道复用内核。

线程安全（一把可重入锁 + 条件变量），所有时间判断走注入的 Clock。
每条连接的生命周期变化都同时记录审计事件（events），保证占用与释放可追溯；
状态 + 时钟 + 事件可整体序列化为 JSON 并精确复现。

关键规则
--------
1. add_pool：标识全局唯一，容量必须为正，配额必须非负，否则拒绝。
2. acquire：同租户空闲优先复用 -> 新建（未达容量）-> 排队或拒绝。
   每一步都先校验池健康与租户配额，配额打满绝不占用其他租户份额。
3. release：校验连接存在、处于借出态、归还租户与持有租户一致；
   重复归还或错归属归还一律拒绝，且不改变任何状态。
4. 回收（TTL / 收缩 / 摘流）只动空闲连接；借出中的连接打 retire_on_return
   标记，归还后关闭，绝不中断在用连接，计数只在关闭时减一。
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Optional

from .clock import Clock, ManualClock
from .errors import (
    InvalidConfigError,
    InvalidReleaseError,
    PoolExistsError,
    PoolNotFoundError,
    PoolSaturatedError,
    PoolUnhealthyError,
    QueueRejectedError,
    Reason,
    TenantQuotaExceededError,
)
from .model import (
    CONN_BORROWED,
    CONN_IDLE,
    HEALTHY,
    REQ_CANCELLED,
    REQ_EXPIRED,
    REQ_FULFILLED,
    REQ_WAITING,
    UNHEALTHY,
    DOWN,
    AcquireResult,
    Connection,
    ConnectionView,
    PoolConfig,
    PoolStats,
    QueuedRequest,
    TenantUsage,
    WaitTicket,
)


class _PoolState:
    """单个池的全部可变状态。"""

    __slots__ = ("config", "health", "connections", "idle_order", "queue",
                 "tenant_in_use", "next_seq")

    def __init__(self, config: PoolConfig):
        self.config = config
        self.health: str = HEALTHY
        self.connections: dict[str, Connection] = {}
        # 空闲连接按 idle_since 升序排列（最老在前，便于 TTL 优先回收）
        self.idle_order: deque[str] = deque()
        self.queue: deque[QueuedRequest] = deque()
        # 租户 -> 当前借出连接数
        self.tenant_in_use: dict[str, int] = {}
        self.next_seq: int = 1

    # ---- 计数口径（调用方持锁）----
    @property
    def used(self) -> int:
        return sum(self.tenant_in_use.values())

    @property
    def idle_count(self) -> int:
        return len(self.idle_order)

    @property
    def total(self) -> int:
        return len(self.connections)

    @property
    def waiting(self) -> int:
        return sum(1 for r in self.queue if r.status == REQ_WAITING)

    def tenant_used(self, tenant: str) -> int:
        return self.tenant_in_use.get(tenant, 0)

    def tenant_quota(self, tenant: str) -> int:
        return self.config.quotas.get(tenant, 0)

    def idle_for(self, tenant: str) -> Optional[Connection]:
        """取该租户亲缘的空闲连接（取最近空闲的一条）。"""
        for cid in reversed(self.idle_order):
            conn = self.connections[cid]
            if conn.last_tenant == tenant:
                return conn
        return None

    def oldest_idle(self) -> Optional[Connection]:
        while self.idle_order:
            cid = self.idle_order[0]
            conn = self.connections.get(cid)
            if conn is None:
                self.idle_order.popleft()
                continue
            return conn
        return None


class PoolKernel:
    """多租户连接池内核。

    Parameters
    ----------
    clock: 逻辑时钟，默认 ManualClock(0)。
    """

    def __init__(self, clock: Optional[Clock] = None):
        self._clock: Clock = clock if clock is not None else ManualClock(0)
        self._lock = threading.RLock()
        self._cond = threading.Condition(self._lock)
        self._pools: dict[str, _PoolState] = {}
        # 审计事件：每个事件都是不可变 dict，按发生顺序追加
        self._events: list[dict] = []
        self._event_seq: int = 1
        # 逻辑时钟每跳一次就做一轮 TTL 回收与队列驱动（回调在时钟锁外，
        # 与内核锁无固定获取顺序的倒置风险）
        if isinstance(self._clock, ManualClock):
            self._clock.add_listener(self._on_clock_jump)

    def _on_clock_jump(self, now: int) -> None:
        self.tick()

    # ============================ 审计事件 ============================

    def _audit(self, kind: str, pool_id: str, **fields) -> None:
        event = {
            "seq": self._event_seq,
            "at": self._clock.now(),
            "kind": kind,
            "pool_id": pool_id,
        }
        event.update(fields)
        self._events.append(event)
        self._event_seq += 1

    def events(self, pool_id: Optional[str] = None) -> list[dict]:
        """按发生顺序返回审计事件副本；可按池过滤。"""
        with self._lock:
            if pool_id is None:
                return [dict(e) for e in self._events]
            return [dict(e) for e in self._events if e["pool_id"] == pool_id]

    @property
    def clock(self) -> Clock:
        return self._clock

    # ============================ 池管理 ============================

    def add_pool(self, config: PoolConfig) -> None:
        """创建连接池。容量 <=0、配额为负、标识重复都拒绝并说明原因。"""
        if not isinstance(config, PoolConfig):
            raise InvalidConfigError("add_pool 需要 PoolConfig 对象")
        try:
            config.validate()
        except ValueError as exc:
            raise InvalidConfigError(str(exc), pool_id=config.pool_id)
        with self._lock:
            if config.pool_id in self._pools:
                raise PoolExistsError(config.pool_id)
            self._pools[config.pool_id] = _PoolState(config)
            self._audit("pool_created", config.pool_id,
                        capacity=config.capacity,
                        idle_ttl=config.idle_ttl,
                        max_queue=config.max_queue,
                        quotas=dict(sorted(config.quotas.items())))

    def set_quotas(self, pool_id: str, quotas: dict[str, int]) -> None:
        """更新某池的租户配额（整体替换）。非负校验，配置变更入审计。"""
        for tenant, quota in quotas.items():
            if not isinstance(tenant, str) or not tenant:
                raise InvalidConfigError("租户标识必须是非空字符串", pool_id)
            if not isinstance(quota, int) or isinstance(quota, bool) or quota < 0:
                raise InvalidConfigError(
                    f"租户 {tenant!r} 配额必须是非负整数（当前 {quota!r}）",
                    pool_id, reason=Reason.INVALID_QUOTA)
        with self._lock:
            st = self._require_pool(pool_id)
            # 不允许把在用租户的配额缩到其当前占用以下
            for tenant, used in st.tenant_in_use.items():
                if quotas.get(tenant, 0) < used:
                    raise InvalidConfigError(
                        f"租户 {tenant!r} 当前占用 {used} 条连接，"
                        f"新配额 {quotas.get(tenant, 0)} 低于占用，拒绝缩配",
                        pool_id, reason=Reason.INVALID_QUOTA, tenant=tenant)
            # 不允许删除仍有等待请求的租户配额（否则票据永远无法兑现）
            waiting_tenants = {r.tenant for r in st.queue
                               if r.status == REQ_WAITING}
            missing = waiting_tenants - set(quotas)
            if missing:
                raise InvalidConfigError(
                    f"租户 {sorted(missing)} 仍有排队请求，不能删除其配额",
                    pool_id, reason=Reason.INVALID_QUOTA)
            st.config.quotas = dict(quotas)
            self._audit("quotas_updated", pool_id,
                        quotas=dict(sorted(quotas.items())))
            # 放宽配额可能让队首请求立即可服务
            self._pump_locked(st)

    def _require_pool(self, pool_id: str) -> _PoolState:
        st = self._pools.get(pool_id)
        if st is None:
            raise PoolNotFoundError(pool_id)
        return st

    # ============================ 借出 ============================

    def acquire(self, pool_id: str, tenant: str, purpose: str = "",
                *, wait: bool = False, timeout: Optional[int] = None
                ) -> AcquireResult:
        """请求一条连接。

        顺序：摘流检查 -> 同租户空闲复用 -> 配额/容量检查后新建
              -> 排队（wait=True）或拒绝。

        wait=False（默认）: 不能立即满足时入队（池允许排队）或直接抛异常，
            返回的 AcquireResult.status 为 "acquired" 或 "queued"。
        wait=True: 阻塞直到拿到连接；超时抛 QueueRejectedError(QUEUE_TIMEOUT)。
            与 ManualClock 配合时，由其他线程 release/advance 驱动。
        """
        self._check_request_args(pool_id, tenant, purpose)
        with self._lock:
            st = self._require_pool(pool_id)
            # 摘流：不健康/下线一律不借
            if st.health != HEALTHY:
                raise PoolUnhealthyError(pool_id, st.health)

            conn = self._try_serve_locked(st, tenant)
            if conn is not None:
                self._borrow_locked(st, conn, tenant, purpose)
                return AcquireResult("acquired", connection=conn)

            # 无法立即满足：尝试排队
            ticket = self._enqueue_locked(st, tenant, purpose, wait, timeout)
            if ticket is None:
                # 不允许排队：区分“租户配额打满”与“池容量打满”
                self._raise_saturated_locked(st, tenant)
            result = AcquireResult("queued", ticket=ticket)

        if not wait:
            return result

        return self._wait_for_ticket(ticket)

    def _check_request_args(self, pool_id: str, tenant: str, purpose: str) -> None:
        if not isinstance(tenant, str) or not tenant:
            raise InvalidConfigError("租户标识必须是非空字符串", pool_id)
        if not isinstance(purpose, str):
            raise InvalidConfigError("用途标记 purpose 必须是字符串", pool_id, tenant)

    def _try_serve_locked(self, st: _PoolState, tenant: str,
                          *, from_queue: bool = False) -> Optional[Connection]:
        """在当前状态下尝试为该租户找/建一条可用连接，不做借出动作。

        优先级：
        1. 同租户亲缘的空闲连接（需求 2 的“优先复用同租户”）；
        2. 租户有剩余配额且物理容量未满 -> 新建；
        3. 池已满但存在其他租户归还的空闲通道：
           - 排队兑现（from_queue=True）时按 FIFO 复用它，避免“通道空闲
             却永久排队”；空闲通道不占任何租户配额，不违反隔离；
           - 直接请求只有在队列为空时才允许复用，不得插到排队者前面。
        """
        now = self._clock.now()
        self._reap_idle_locked(st, now)
        if st.health != HEALTHY:
            return None

        # 1) 同租户空闲连接优先复用
        conn = st.idle_for(tenant)
        if conn is not None:
            return conn

        quota = st.tenant_quota(tenant)
        if st.tenant_used(tenant) >= quota:
            return None  # 配额打满：不得新建，也不得动用别人的空闲连接

        # 2) 还有物理容量 -> 新建
        if st.total < st.config.capacity:
            conn = Connection(
                conn_id=self._new_conn_id(st),
                pool_id=st.config.pool_id,
                born_at=now,
            )
            st.connections[conn.conn_id] = conn
            self._audit("connection_created", st.config.pool_id,
                        conn_id=conn.conn_id, tenant=tenant)
            return conn

        # 3) 池满：复用其他租户归还的空闲通道
        if from_queue or st.waiting == 0:
            return st.oldest_idle()
        return None

    def _borrow_locked(self, st: _PoolState, conn: Connection,
                       tenant: str, purpose: str) -> None:
        now = self._clock.now()
        was_idle = conn.idle_since is not None  # 新建连接 tenant=None 但不在空闲集
        if was_idle:
            st.idle_order.remove(conn.conn_id)
        conn.tenant = tenant
        conn.borrowed_at = now
        conn.purpose = purpose
        conn.idle_since = None
        st.tenant_in_use[tenant] = st.tenant_in_use.get(tenant, 0) + 1
        self._audit("connection_borrowed", st.config.pool_id,
                    conn_id=conn.conn_id, tenant=tenant, purpose=purpose,
                    reused=was_idle)

    def _enqueue_locked(self, st: _PoolState, tenant: str, purpose: str,
                        wait: bool, timeout: Optional[int]) -> Optional[WaitTicket]:
        cfg = st.config
        if cfg.max_queue == 0:
            return None
        if st.health != HEALTHY:
            return None
        waiting = st.waiting
        if cfg.max_queue > 0 and waiting >= cfg.max_queue:
            raise QueueRejectedError(
                st.config.pool_id, tenant, Reason.QUEUE_FULL,
                f"池 {st.config.pool_id!r} 排队队列已满（上限 {cfg.max_queue}，"
                f"当前等待 {waiting}），请求被拒绝")
        now = self._clock.now()
        deadline = None
        if wait and timeout is not None:
            if not isinstance(timeout, int) or isinstance(timeout, bool) or timeout <= 0:
                raise InvalidConfigError("timeout 必须是正整数（逻辑 tick）",
                                         st.config.pool_id, tenant)
            deadline = now + timeout
        req = QueuedRequest(
            ticket_id=self._next_seq(st),
            pool_id=st.config.pool_id,
            tenant=tenant,
            purpose=purpose,
            enqueued_at=now,
            deadline=deadline,
        )
        st.queue.append(req)
        self._audit("request_queued", st.config.pool_id,
                    ticket_id=req.ticket_id, tenant=tenant, purpose=purpose,
                    deadline=deadline, queue_position=st.waiting)
        return WaitTicket(req.ticket_id, req.pool_id, tenant, now)

    def _next_seq(self, st: _PoolState) -> int:
        """池内统一取号：连接 ID 后缀与排队票据号共用同一单调序列。"""
        seq = st.next_seq
        st.next_seq += 1
        return seq

    def _new_conn_id(self, st: _PoolState) -> str:
        # 形如 "orders-1"，池内自增；池标识唯一故全局唯一
        return f"{st.config.pool_id}-{self._next_seq(st)}"

    def _raise_saturated_locked(self, st: _PoolState, tenant: str) -> None:
        quota = st.tenant_quota(tenant)
        if st.tenant_used(tenant) >= quota:
            raise TenantQuotaExceededError(st.config.pool_id, tenant, quota)
        raise PoolSaturatedError(st.config.pool_id, st.config.capacity, st.used)

    def _wait_for_ticket(self, ticket: WaitTicket) -> AcquireResult:
        """阻塞等待排队票据被兑现。ManualClock 下用时钟推进唤醒，SystemClock 轮询。"""
        is_manual = bool(getattr(self._clock, "is_manual", False))
        with self._cond:
            while True:
                req = self._find_ticket_locked(ticket.pool_id, ticket.ticket_id)
                if req is None:
                    raise QueueRejectedError(
                        ticket.pool_id, ticket.tenant, Reason.QUEUE_CLOSED,
                        f"票据 #{ticket.ticket_id} 已不存在（队列可能已被清理）")
                if req.status == REQ_FULFILLED:
                    conn = self._pools[ticket.pool_id].connections.get(req.conn_id)
                    return AcquireResult("acquired", connection=conn)
                if req.status in (REQ_CANCELLED, REQ_EXPIRED):
                    raise QueueRejectedError(
                        ticket.pool_id, ticket.tenant,
                        Reason.QUEUE_CLOSED if req.status == REQ_CANCELLED
                        else Reason.QUEUE_TIMEOUT,
                        f"票据 #{ticket.ticket_id} 已{req.status}")
                # 超时自检（SystemClock 下 deadline 用逻辑时间，配合 tick() 推进）
                if req.deadline is not None and self._clock.now() >= req.deadline:
                    req.status = REQ_EXPIRED
                    self._audit("request_expired", ticket.pool_id,
                                ticket_id=req.ticket_id, tenant=req.tenant)
                    self._cond.notify_all()
                    raise QueueRejectedError(
                        ticket.pool_id, ticket.tenant, Reason.QUEUE_TIMEOUT,
                        f"票据 #{ticket.ticket_id} 排队超过截止时刻 {req.deadline}")
                if is_manual:
                    self._cond.wait(timeout=None)
                else:
                    self._cond.wait(timeout=0.01)

    def _find_ticket_locked(self, pool_id: str, ticket_id: int) -> Optional[QueuedRequest]:
        st = self._pools.get(pool_id)
        if st is None:
            return None
        for req in st.queue:
            if req.ticket_id == ticket_id:
                return req
        return None

    # ============================ 归还 ============================

    def release(self, pool_id: str, conn_id: str, tenant: str) -> None:
        """归还连接。

        - 连接不存在/不属于该池：CONNECTION_NOT_FOUND；
        - 连接当前未借出：DOUBLE_RELEASE（重复归还）；
        - 归还租户与持有租户不一致：WRONG_TENANT（错归属归还）。
        任何拒绝路径都不改变状态。
        """
        with self._lock:
            st = self._pools.get(pool_id)
            if st is None or conn_id not in st.connections:
                from .errors import ConnectionNotFoundError
                raise ConnectionNotFoundError(conn_id, pool_id=pool_id)
            conn = st.connections[conn_id]
            if conn.state == CONN_IDLE:
                raise InvalidReleaseError(
                    f"连接 {conn_id!r} 当前并未借出，属于重复归还；"
                    f"状态保持不变（空闲自 {conn.idle_since}）",
                    Reason.DOUBLE_RELEASE, pool_id=pool_id,
                    tenant=conn.last_tenant)
            if conn.tenant != tenant:
                raise InvalidReleaseError(
                    f"连接 {conn_id!r} 由租户 {conn.tenant!r} 持有，"
                    f"租户 {tenant!r} 无权归还，拒绝且状态不变",
                    Reason.WRONG_TENANT, pool_id=pool_id, tenant=tenant)

            holder = conn.tenant
            purpose = conn.purpose
            st.tenant_in_use[holder] -= 1
            if st.tenant_in_use[holder] == 0:
                del st.tenant_in_use[holder]

            now = self._clock.now()
            borrowed_at = conn.borrowed_at
            self._audit("connection_released", pool_id,
                        conn_id=conn_id, tenant=holder, purpose=purpose,
                        borrow_duration=now - borrowed_at if borrowed_at is not None else 0)

            conn.tenant = None
            conn.borrowed_at = None
            conn.purpose = None
            conn.last_tenant = holder

            # 归还后不再复用：TTL/收缩/摘流打的标记
            if conn.retire_on_return or st.health != HEALTHY:
                self._close_locked(st, conn, reason="retire_on_return"
                                    if conn.retire_on_return else "pool_unhealthy")
            else:
                conn.idle_since = now
                st.idle_order.append(conn_id)
                self._audit("connection_idled", pool_id,
                            conn_id=conn_id, tenant=holder)
                self._pump_locked(st)
            self._cond.notify_all()

    # ============================ 队列出队 ============================

    def _pump_locked(self, st: _PoolState) -> int:
        """连接回归空闲后尝试按 FIFO 兑现等待中的请求。返回兑现数量。

        队首若因自身租户配额打满而无法服务，则保留位置继续等（不让后面的
        请求插队），因为租户外的空闲连接本就不允许跨租户复用；
        只有“任意一条可服务”或“无可用物理连接”时才停止扫描。
        """
        served = 0
        while True:
            self._expire_queue_locked(st)
            head: Optional[QueuedRequest] = None
            for req in st.queue:
                if req.status == REQ_WAITING:
                    head = req
                    break
            if head is None:
                break
            conn = self._try_serve_locked(st, head.tenant, from_queue=True)
            if conn is None:
                break
            self._borrow_locked(st, conn, head.tenant, head.purpose)
            head.status = REQ_FULFILLED
            head.conn_id = conn.conn_id
            served += 1
            self._audit("request_fulfilled", st.config.pool_id,
                        ticket_id=head.ticket_id, tenant=head.tenant,
                        conn_id=conn.conn_id)
        return served

    def _expire_queue_locked(self, st: _PoolState) -> None:
        now = self._clock.now()
        for req in st.queue:
            if (req.status == REQ_WAITING and req.deadline is not None
                    and now >= req.deadline):
                req.status = REQ_EXPIRED
                self._audit("request_expired", st.config.pool_id,
                            ticket_id=req.ticket_id, tenant=req.tenant)

    def poll_queue(self, pool_id: str) -> int:
        """显式驱动队列（推进逻辑时间后调用）：处理超时并尝试兑现。"""
        with self._lock:
            st = self._require_pool(pool_id)
            n = self._pump_locked(st)
            self._cond.notify_all()
            return n

    def cancel_ticket(self, pool_id: str, ticket_id: int) -> bool:
        """取消排队请求。已兑现的不能取消，返回 False。"""
        with self._lock:
            req = self._find_ticket_locked(pool_id, ticket_id)
            if req is None or req.status != REQ_WAITING:
                return False
            req.status = REQ_CANCELLED
            self._audit("request_cancelled", pool_id,
                        ticket_id=ticket_id, tenant=req.tenant)
            self._cond.notify_all()
            return True

    def ticket_status(self, pool_id: str, ticket_id: int) -> Optional[dict]:
        with self._lock:
            req = self._find_ticket_locked(pool_id, ticket_id)
            return dict(req.to_dict()) if req is not None else None

    # ============================ 回收 ============================

    def _close_locked(self, st: _PoolState, conn: Connection, *,
                      reason: str) -> None:
        """物理删除一条连接。只能关闭空闲连接。"""
        if conn.state == CONN_BORROWED:
            raise AssertionError(
                f"内部错误：不得关闭借出中的连接 {conn.conn_id!r}")
        if conn.conn_id in st.idle_order:
            st.idle_order.remove(conn.conn_id)
        del st.connections[conn.conn_id]
        self._audit("connection_closed", st.config.pool_id,
                    conn_id=conn.conn_id, reason=reason,
                    last_tenant=conn.last_tenant)

    def _reap_idle_locked(self, st: _PoolState, now: int) -> int:
        """回收 TTL 过期的空闲连接，返回回收数量。"""
        ttl = st.config.idle_ttl
        if ttl < 0:
            return 0
        reaped = 0
        # idle_order 按空闲起始升序，从头扫到第一条未过期即可停
        while st.idle_order:
            conn = st.connections.get(st.idle_order[0])
            if conn is None:
                st.idle_order.popleft()
                continue
            if not conn.is_idle_expired(now, ttl):
                break
            self._close_locked(st, conn, reason="idle_ttl")
            reaped += 1
        return reaped

    def reap_idle(self, pool_id: str) -> int:
        """显式回收某池中超过空闲存活时长的连接。"""
        with self._lock:
            st = self._require_pool(pool_id)
            n = self._reap_idle_locked(st, self._clock.now())
            if n:
                self._cond.notify_all()
            return n

    def retire_connection(self, pool_id: str, conn_id: str) -> None:
        """标记单条连接在归还后关闭（若空闲则立即回收）。"""
        with self._lock:
            st = self._require_pool(pool_id)
            conn = st.connections.get(conn_id)
            if conn is None:
                from .errors import ConnectionNotFoundError
                raise ConnectionNotFoundError(conn_id, pool_id=pool_id)
            if conn.state == CONN_BORROWED:
                conn.retire_on_return = True
                self._audit("connection_marked_retire", pool_id,
                            conn_id=conn_id, tenant=conn.tenant)
            else:
                self._close_locked(st, conn, reason="manual_retire")
                self._cond.notify_all()

    def shrink_pool(self, pool_id: str, new_capacity: int) -> dict:
        """整体收缩（也可扩容）池容量。

        - new_capacity 必须为正整数；不得低于当前“借出中”的连接数；
        - 超出新容量的空闲连接按最老优先立即回收；
        - 还需淘汰但正借出的连接打 retire_on_return，归还后自动关闭；
        - 容量打满后排队请求继续等待，不会被误兑现到超额连接。
        """
        if not isinstance(new_capacity, int) or isinstance(new_capacity, bool):
            raise InvalidConfigError("容量必须是整数", pool_id)
        if new_capacity <= 0:
            raise InvalidConfigError(
                f"容量必须为正整数，零容量拒绝（当前 {new_capacity}）", pool_id)
        with self._lock:
            st = self._require_pool(pool_id)
            old = st.config.capacity
            # 允许收缩到低于当前借出数：在用连接不可中断，超额部分打
            # retire_on_return，归还后关闭；容量作为“稳态上限”立即生效，
            # 在总连接数回落到容量以下之前不会新建连接。
            st.config.capacity = new_capacity
            self._audit("pool_resized", pool_id,
                        old_capacity=old, new_capacity=new_capacity)

            closed = 0
            # 先回收空闲连接直到“非退役连接数”不超过新容量（最老优先）
            while st.idle_order:
                active = sum(1 for c in st.connections.values()
                             if not c.retire_on_return)
                if active <= new_capacity:
                    break
                conn = st.connections[st.idle_order[0]]
                self._close_locked(st, conn, reason="shrink")
                closed += 1
            # 仍超额的都是借出连接：打归还即关标记
            marked = 0
            excess = sum(1 for c in st.connections.values()
                         if not c.retire_on_return) - new_capacity
            if excess > 0:
                for conn in sorted(st.connections.values(),
                                   key=lambda c: c.borrowed_at or 0):
                    if excess == 0:
                        break
                    if conn.state == CONN_BORROWED and not conn.retire_on_return:
                        conn.retire_on_return = True
                        marked += 1
                        excess -= 1
                self._audit("connections_marked_by_shrink", pool_id,
                            marked=marked)
            self._pump_locked(st)
            self._cond.notify_all()
            return {"closed_idle": closed, "marked_borrowed": marked,
                    "old_capacity": old, "new_capacity": new_capacity}

    # ============================ 健康状态 ============================

    def mark_unhealthy(self, pool_id: str) -> None:
        """标记不健康：停止借出，逐步回收空闲连接，借出的归还后不复用。"""
        self._set_health(pool_id, UNHEALTHY)

    def mark_down(self, pool_id: str) -> None:
        """标记下线：同不健康语义（空闲立即回收、拒绝新借出）。"""
        self._set_health(pool_id, DOWN)

    def mark_healthy(self, pool_id: str) -> None:
        """恢复健康：重新接受请求并尝试兑现排队队列。"""
        with self._lock:
            st = self._require_pool(pool_id)
            old = st.health
            st.health = HEALTHY
            self._audit("pool_health_changed", pool_id,
                        old=old, new=HEALTHY)
            self._pump_locked(st)
            self._cond.notify_all()

    def _set_health(self, pool_id: str, health: str) -> None:
        with self._lock:
            st = self._require_pool(pool_id)
            old = st.health
            st.health = health
            self._audit("pool_health_changed", pool_id, old=old, new=health)
            # 逐步回收所有空闲连接
            closed = 0
            while st.idle_order:
                conn = st.connections[st.idle_order[0]]
                self._close_locked(st, conn, reason=f"pool_{health}")
                closed += 1
            # 借出中的连接：归还后不再复用
            for conn in st.connections.values():
                conn.retire_on_return = True
            self._cond.notify_all()

    def pool_health(self, pool_id: str) -> str:
        with self._lock:
            return self._require_pool(pool_id).health

    # ============================ 时间推进 ============================

    def tick(self) -> int:
        """推进内核视角的维护动作：TTL 回收 + 队列超时/兑现。

        不改变时钟（时钟由持有方注入并推进），仅在当前时刻做一次清扫，
        供 SystemClock 或外部调度周期调用。返回当前时钟值。
        """
        with self._lock:
            now = self._clock.now()
            for st in self._pools.values():
                self._reap_idle_locked(st, now)
                self._pump_locked(st)
            self._cond.notify_all()
            return now

    # ============================ 查询 ============================

    def pool_stats(self, pool_id: str) -> PoolStats:
        with self._lock:
            st = self._require_pool(pool_id)
            return PoolStats(
                pool_id=pool_id,
                capacity=st.config.capacity,
                used=st.used,
                idle=st.idle_count,
                queued=st.waiting,
                health=st.health,
            )

    def all_pool_stats(self) -> list[PoolStats]:
        """所有池的统计，按 pool_id 字典序稳定返回。"""
        with self._lock:
            return [self.pool_stats(pid) for pid in sorted(self._pools)]

    def tenant_usage(self, pool_id: str, tenant: str) -> TenantUsage:
        with self._lock:
            st = self._require_pool(pool_id)
            if tenant not in st.config.quotas:
                raise InvalidConfigError(
                    f"租户 {tenant!r} 在池 {pool_id!r} 中没有配额配置",
                    pool_id, tenant=tenant)
            return TenantUsage(pool_id, tenant,
                               st.tenant_quota(tenant), st.tenant_used(tenant))

    def all_tenant_usage(self, pool_id: Optional[str] = None) -> list[TenantUsage]:
        """租户占用视图，按 (pool_id, tenant) 稳定排序。

        已配置但当前占用为 0 的租户也会列出；实际曾借用但配额已被删除的
        租户以 quota=0 列出（这种状态只能由 set_quotas 缩配产生）。
        """
        with self._lock:
            out: list[TenantUsage] = []
            pool_ids = sorted(self._pools) if pool_id is None else [pool_id]
            for pid in pool_ids:
                st = self._require_pool(pid)
                tenants = set(st.config.quotas) | set(st.tenant_in_use)
                for t in sorted(tenants):
                    out.append(TenantUsage(
                        pid, t, st.tenant_quota(t), st.tenant_used(t)))
            return out

    def connection_view(self, pool_id: str, conn_id: str) -> ConnectionView:
        with self._lock:
            st = self._require_pool(pool_id)
            conn = st.connections.get(conn_id)
            if conn is None:
                from .errors import ConnectionNotFoundError
                raise ConnectionNotFoundError(conn_id, pool_id=pool_id)
            return self._view_locked(conn)

    def all_connections(self, pool_id: Optional[str] = None) -> list[ConnectionView]:
        """全部连接视图，按 (pool_id, conn_id) 稳定排序。"""
        with self._lock:
            out: list[ConnectionView] = []
            pool_ids = sorted(self._pools) if pool_id is None else [pool_id]
            for pid in pool_ids:
                st = self._require_pool(pid)
                for cid in sorted(st.connections):
                    out.append(self._view_locked(st.connections[cid]))
            return out

    def _view_locked(self, conn: Connection) -> ConnectionView:
        now = self._clock.now()
        return ConnectionView(
            conn_id=conn.conn_id,
            pool_id=conn.pool_id,
            state=conn.state,
            tenant=conn.tenant,
            purpose=conn.purpose,
            born_at=conn.born_at,
            borrowed_at=conn.borrowed_at,
            borrow_duration=conn.borrow_duration(now),
            idle_since=conn.idle_since,
            idle_duration=conn.idle_duration(now),
            last_tenant=conn.last_tenant,
            retire_on_return=conn.retire_on_return,
        )

    def queued_requests(self, pool_id: str) -> list[dict]:
        """排队请求（含历史票据），按入队顺序返回副本。"""
        with self._lock:
            st = self._require_pool(pool_id)
            return [r.to_dict() for r in st.queue]

    def list_pools(self) -> list[str]:
        with self._lock:
            return sorted(self._pools)

    # ============================ 快照挂钩 ============================

    def _load_state(self, pools: dict[str, _PoolState], clock_now: int,
                    events: list[dict], event_seq: int,
                    pool_seq: dict[str, int]) -> None:
        """由 snapshot 模块在完整校验后调用，整体替换内存状态。"""
        with self._lock:
            self._pools = pools
            self._events = events
            self._event_seq = event_seq
            if isinstance(self._clock, ManualClock):
                self._clock.set(clock_now)
            for pid, seq in pool_seq.items():
                if pid in pools:
                    pools[pid].next_seq = seq
            self._cond.notify_all()
