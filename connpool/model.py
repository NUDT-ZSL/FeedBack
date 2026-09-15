"""内核数据模型。

设计约定（计数口径）：
    物理连接数 = 空闲数 + 借出数，受池容量 capacity 约束；
    租户配额只约束“借出中（in-use）”的连接数；
    空闲连接不占租户配额，但保留 last_tenant 亲缘，供同租户优先复用。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# 池健康状态
HEALTHY = "healthy"
UNHEALTHY = "unhealthy"
DOWN = "down"

# 连接生命周期状态
CONN_IDLE = "idle"
CONN_BORROWED = "borrowed"

# 排队请求状态
REQ_WAITING = "waiting"
REQ_FULFILLED = "fulfilled"
REQ_CANCELLED = "cancelled"
REQ_EXPIRED = "expired"


@dataclass
class PoolConfig:
    """单个后端连接池的配置。

    capacity   容量上限（物理连接数），必须 >= 1，零容量拒绝创建；
    idle_ttl   空闲存活时长（逻辑 tick），0 表示空闲立即过期，<0 表示永不过期；
    max_queue  排队上限：0 不允许排队，-1 无上限，正整数为最大排队请求数；
    quotas     租户 -> 该租户在此池的借出配额，必须显式配置，值 >= 0。
    """

    pool_id: str
    capacity: int
    idle_ttl: int = -1
    max_queue: int = 0
    quotas: dict[str, int] = field(default_factory=dict)

    def validate(self) -> None:
        if not isinstance(self.pool_id, str) or not self.pool_id:
            raise ValueError("池标识必须是非空字符串")
        if not isinstance(self.capacity, int) or isinstance(self.capacity, bool):
            raise ValueError(f"池 {self.pool_id!r} 容量必须是整数")
        if self.capacity <= 0:
            raise ValueError(
                f"池 {self.pool_id!r} 容量必须为正整数，零容量或负容量拒绝创建"
                f"（当前 capacity={self.capacity}）")
        if not isinstance(self.idle_ttl, int) or isinstance(self.idle_ttl, bool):
            raise ValueError(f"池 {self.pool_id!r} idle_ttl 必须是整数")
        if not isinstance(self.max_queue, int) or isinstance(self.max_queue, bool):
            raise ValueError(f"池 {self.pool_id!r} max_queue 必须是整数")
        if self.max_queue < -1:
            raise ValueError(f"池 {self.pool_id!r} max_queue 只能是 -1(无限)/0(不排队)/正整数")
        if not isinstance(self.quotas, dict):
            raise ValueError(f"池 {self.pool_id!r} 的配额必须是 dict")
        for tenant, quota in self.quotas.items():
            if not isinstance(tenant, str) or not tenant:
                raise ValueError(f"池 {self.pool_id!r} 的租户标识必须是非空字符串")
            if not isinstance(quota, int) or isinstance(quota, bool) or quota < 0:
                raise ValueError(
                    f"池 {self.pool_id!r} 中租户 {tenant!r} 的配额必须是非负整数"
                    f"（当前 {quota!r}）")

    def to_dict(self) -> dict:
        return {
            "pool_id": self.pool_id,
            "capacity": self.capacity,
            "idle_ttl": self.idle_ttl,
            "max_queue": self.max_queue,
            "quotas": dict(sorted(self.quotas.items())),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PoolConfig":
        return cls(
            pool_id=data["pool_id"],
            capacity=data["capacity"],
            idle_ttl=data["idle_ttl"],
            max_queue=data["max_queue"],
            quotas=dict(data["quotas"]),
        )


@dataclass
class Connection:
    """一条到后端的逻辑连接（不接真实网络，只是可审计的通道句柄）。"""

    conn_id: str
    pool_id: str
    born_at: int
    idle_since: Optional[int] = None      # 空闲起始时刻；借出中为 None
    last_tenant: Optional[str] = None     # 最近一次持有租户（空闲亲缘）
    tenant: Optional[str] = None          # 当前持有租户；None 表示空闲
    borrowed_at: Optional[int] = None     # 借出时刻
    purpose: Optional[str] = None         # 用途标记
    retire_on_return: bool = False        # 归还后不再入空闲集，直接关闭

    @property
    def state(self) -> str:
        return CONN_BORROWED if self.tenant is not None else CONN_IDLE

    def borrow_duration(self, now: int) -> Optional[int]:
        """已借出时长；空闲连接返回 None。"""
        if self.borrowed_at is None:
            return None
        return now - self.borrowed_at

    def idle_duration(self, now: int) -> Optional[int]:
        if self.idle_since is None:
            return None
        return now - self.idle_since

    def is_idle_expired(self, now: int, idle_ttl: int) -> bool:
        if idle_ttl < 0 or self.idle_since is None:
            return False
        return now - self.idle_since >= idle_ttl

    def to_dict(self) -> dict:
        return {
            "conn_id": self.conn_id,
            "pool_id": self.pool_id,
            "born_at": self.born_at,
            "idle_since": self.idle_since,
            "last_tenant": self.last_tenant,
            "tenant": self.tenant,
            "borrowed_at": self.borrowed_at,
            "purpose": self.purpose,
            "retire_on_return": self.retire_on_return,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Connection":
        return cls(
            conn_id=data["conn_id"],
            pool_id=data["pool_id"],
            born_at=data["born_at"],
            idle_since=data.get("idle_since"),
            last_tenant=data.get("last_tenant"),
            tenant=data.get("tenant"),
            borrowed_at=data.get("borrowed_at"),
            purpose=data.get("purpose"),
            retire_on_return=bool(data.get("retire_on_return", False)),
        )


@dataclass
class QueuedRequest:
    """排队等待连接的请求。"""

    ticket_id: int
    pool_id: str
    tenant: str
    purpose: str
    enqueued_at: int
    deadline: Optional[int] = None        # 逻辑时刻；None 表示无限等待
    status: str = REQ_WAITING
    conn_id: Optional[str] = None         # 兑现后绑定的连接

    def to_dict(self) -> dict:
        return {
            "ticket_id": self.ticket_id,
            "pool_id": self.pool_id,
            "tenant": self.tenant,
            "purpose": self.purpose,
            "enqueued_at": self.enqueued_at,
            "deadline": self.deadline,
            "status": self.status,
            "conn_id": self.conn_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "QueuedRequest":
        return cls(
            ticket_id=data["ticket_id"],
            pool_id=data["pool_id"],
            tenant=data["tenant"],
            purpose=data["purpose"],
            enqueued_at=data["enqueued_at"],
            deadline=data.get("deadline"),
            status=data["status"],
            conn_id=data.get("conn_id"),
        )


@dataclass
class WaitTicket:
    """返回给调用方的排队票据（非阻塞模式）。"""

    ticket_id: int
    pool_id: str
    tenant: str
    enqueued_at: int

    def to_dict(self) -> dict:
        return {
            "ticket_id": self.ticket_id,
            "pool_id": self.pool_id,
            "tenant": self.tenant,
            "enqueued_at": self.enqueued_at,
        }


@dataclass
class AcquireResult:
    """acquire 的结果：立即拿到、排队中、或被拒绝。"""

    status: str                     # "acquired" | "queued"
    connection: Optional[Connection] = None
    ticket: Optional[WaitTicket] = None

    @property
    def connection_id(self) -> Optional[str]:
        return self.connection.conn_id if self.connection else None

    @property
    def is_acquired(self) -> bool:
        return self.status == "acquired"

    @property
    def is_queued(self) -> bool:
        return self.status == "queued"


@dataclass(frozen=True)
class PoolStats:
    pool_id: str
    capacity: int
    used: int           # 借出中
    idle: int           # 空闲
    queued: int         # 等待中的排队请求
    health: str

    def to_dict(self) -> dict:
        return {
            "pool_id": self.pool_id,
            "capacity": self.capacity,
            "used": self.used,
            "idle": self.idle,
            "queued": self.queued,
            "health": self.health,
        }


@dataclass(frozen=True)
class TenantUsage:
    pool_id: str
    tenant: str
    quota: int
    used: int

    @property
    def available(self) -> int:
        return self.quota - self.used

    def to_dict(self) -> dict:
        return {
            "pool_id": self.pool_id,
            "tenant": self.tenant,
            "quota": self.quota,
            "used": self.used,
            "available": self.available,
        }


@dataclass(frozen=True)
class ConnectionView:
    """连接查询视图（快照副本，值不可变）。"""

    conn_id: str
    pool_id: str
    state: str
    tenant: Optional[str]
    purpose: Optional[str]
    born_at: int
    borrowed_at: Optional[int]
    borrow_duration: Optional[int]
    idle_since: Optional[int]
    idle_duration: Optional[int]
    last_tenant: Optional[str]
    retire_on_return: bool

    def to_dict(self) -> dict:
        return {
            "conn_id": self.conn_id,
            "pool_id": self.pool_id,
            "state": self.state,
            "tenant": self.tenant,
            "purpose": self.purpose,
            "born_at": self.born_at,
            "borrowed_at": self.borrowed_at,
            "borrow_duration": self.borrow_duration,
            "idle_since": self.idle_since,
            "idle_duration": self.idle_duration,
            "last_tenant": self.last_tenant,
            "retire_on_return": self.retire_on_return,
        }
