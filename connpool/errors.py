"""错误类型与拒绝原因码。

每次拒绝都携带：
    reason   机器可读的原因码（Reason 枚举）
    pool_id  涉及的池（可能为 None）
    tenant   涉及的租户（可能为 None）
    detail   人类可读的中文说明

这样调用方可以按原因码分支处理，日志也能明确追溯“哪个池、哪种原因”。
"""

from __future__ import annotations

from enum import Enum


class Reason(str, Enum):
    """所有可被拒绝/失败的原因。字符串值直接进入 JSON 快照。"""

    # 配置类
    POOL_EXISTS = "pool_exists"
    POOL_NOT_FOUND = "pool_not_found"
    INVALID_CONFIG = "invalid_config"
    INVALID_QUOTA = "invalid_quota"

    # 借出类
    POOL_UNHEALTHY = "pool_unhealthy"          # 后端不健康/下线
    POOL_SATURATED = "pool_saturated"          # 池容量打满且不排队
    TENANT_QUOTA_EXCEEDED = "tenant_quota_exceeded"  # 租户配额打满
    QUEUE_FULL = "queue_full"                    # 排队队列达到上限
    QUEUE_CLOSED = "queue_closed"               # 池被摘流/收缩清队
    QUEUE_TIMEOUT = "queue_timeout"             # 排队等待超过截止时刻

    # 归还类
    CONNECTION_NOT_FOUND = "connection_not_found"
    DOUBLE_RELEASE = "double_release"           # 重复归还
    WRONG_TENANT = "wrong_tenant"               # 归还租户与持有租户不符
    POOL_MISMATCH = "pool_mismatch"             # 连接不属于该池

    # 快照类
    SNAPSHOT_CORRUPT = "snapshot_corrupt"       # JSON 损坏/类型错误
    SNAPSHOT_MISSING_FIELD = "snapshot_missing_field"
    SNAPSHOT_INCONSISTENT = "snapshot_inconsistent"


class PoolError(Exception):
    """所有内核错误的基类。"""

    def __init__(self, reason: Reason, detail: str,
                 pool_id: str | None = None,
                 tenant: str | None = None):
        self.reason = reason
        self.pool_id = pool_id
        self.tenant = tenant
        self.detail = detail
        prefix = f"[{reason.value}]"
        if pool_id is not None:
            prefix += f" pool={pool_id!r}"
        if tenant is not None:
            prefix += f" tenant={tenant!r}"
        super().__init__(f"{prefix}: {detail}")


class PoolExistsError(PoolError):
    def __init__(self, pool_id: str):
        super().__init__(
            Reason.POOL_EXISTS,
            f"连接池 {pool_id!r} 已存在，池标识必须全局唯一，不允许重复创建",
            pool_id=pool_id,
        )


class PoolNotFoundError(PoolError):
    def __init__(self, pool_id: str):
        super().__init__(
            Reason.POOL_NOT_FOUND,
            f"连接池 {pool_id!r} 不存在",
            pool_id=pool_id,
        )


class InvalidConfigError(PoolError):
    def __init__(self, detail: str, pool_id: str | None = None,
                 reason: Reason = Reason.INVALID_CONFIG,
                 tenant: str | None = None):
        super().__init__(reason, detail, pool_id=pool_id, tenant=tenant)


class PoolUnhealthyError(PoolError):
    def __init__(self, pool_id: str, state: str):
        word = {"down": "已下线", "unhealthy": "处于不健康状态"}.get(
            state, f"状态为 {state}")
        super().__init__(
            Reason.POOL_UNHEALTHY,
            f"池 {pool_id!r} {word}，停止借出连接",
            pool_id=pool_id,
        )


class PoolSaturatedError(PoolError):
    def __init__(self, pool_id: str, capacity: int, in_use: int):
        super().__init__(
            Reason.POOL_SATURATED,
            f"池 {pool_id!r} 容量已打满（容量 {capacity}，已借出 {in_use}），"
            f"既无同租户空闲连接可复用，也不允许排队等待",
            pool_id=pool_id,
        )


class TenantQuotaExceededError(PoolError):
    def __init__(self, pool_id: str, tenant: str, quota: int):
        super().__init__(
            Reason.TENANT_QUOTA_EXCEEDED,
            f"租户 {tenant!r} 在池 {pool_id!r} 的配额已打满"
            f"（配额 {quota}），不得占用其他租户份额",
            pool_id=pool_id, tenant=tenant,
        )


class QueueRejectedError(PoolError):
    def __init__(self, pool_id: str, tenant: str, reason: Reason, detail: str):
        super().__init__(reason, detail, pool_id=pool_id, tenant=tenant)


class InvalidReleaseError(PoolError):
    def __init__(self, detail: str, reason: Reason,
                 pool_id: str | None = None, tenant: str | None = None):
        super().__init__(reason, detail, pool_id=pool_id, tenant=tenant)


class ConnectionNotFoundError(PoolError):
    def __init__(self, conn_id: str, pool_id: str | None = None):
        super().__init__(
            Reason.CONNECTION_NOT_FOUND,
            f"连接 {conn_id!r} 不存在或不属于目标池",
            pool_id=pool_id,
        )
        self.conn_id = conn_id


class SnapshotError(PoolError):
    def __init__(self, reason: Reason, detail: str):
        super().__init__(reason, detail)
