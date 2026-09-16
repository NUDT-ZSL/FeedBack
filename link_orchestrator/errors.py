"""异常层次：所有业务错误都携带可读上下文，拒绝类错误指明位置。"""


class OrchestratorError(Exception):
    """所有编排器错误的基类。"""


class ValidationError(OrchestratorError):
    """字段校验失败（带宽非正、字段缺失、类型错误等）。

    location 用“点路径”指出出错位置，例如 ``links[2].bandwidth``。
    """

    def __init__(self, message, location=None):
        self.location = location
        if location:
            full = f"{message}（位置: {location}）"
        else:
            full = message
        super().__init__(full)


class DuplicateIdError(ValidationError):
    """唯一标识重复。"""

    def __init__(self, kind, identifier, location=None):
        super().__init__(f"{kind}标识重复: {identifier!r}", location)
        self.kind = kind
        self.identifier = identifier


class ClockRejectedError(ValidationError):
    """健康上报逻辑时刻倒退（未按非递减顺序到达）。"""

    def __init__(self, link_id, given_time, last_time, location=None):
        loc = location or f"links[{link_id}].reports"
        super().__init__(
            f"链路 {link_id!r} 健康上报时刻倒退: 收到 t={given_time}，"
            f"该链路已有上报时刻 t={last_time}，时刻必须非递减",
            loc,
        )
        self.link_id = link_id
        self.given_time = given_time
        self.last_time = last_time


class NotFoundError(OrchestratorError):
    """引用的对象不存在。"""

    def __init__(self, kind, identifier):
        super().__init__(f"{kind}不存在: {identifier!r}")
        self.kind = kind
        self.identifier = identifier


class MigrationRejectedError(OrchestratorError):
    """迁移被拒绝的基类（目标非法/失效或容量不足）。"""


class LinkUnavailableError(MigrationRejectedError):
    """迁移目标不存在或当前不可用（已失效）。"""

    def __init__(self, link_id, reason="不存在", action="迁移"):
        super().__init__(f"{action}被拒绝: 目标链路 {link_id!r} {reason}")
        self.link_id = link_id
        self.reason = reason
        self.action = action


class CapacityExceededError(MigrationRejectedError):
    """迁移会使目标链路在途字节数超过带宽上限。

    link_id 为 None 表示没有任何可用链路能容纳该会话，此时用 free_table
    给出各可用链路的剩余容量。
    """

    def __init__(self, link_id, bytes_inflight, free_capacity, need,
                 session_id=None, free_table=None, action="迁移"):
        self.link_id = link_id
        self.bytes_inflight = bytes_inflight
        self.free_capacity = free_capacity
        self.need = need
        self.session_id = session_id
        self.free_table = free_table
        who = f"（会话 {session_id!r}）" if session_id is not None else ""
        if link_id is None:
            table = free_table or {}
            table_text = "，".join(f"{k!r} 剩余 {v}" for k, v in sorted(table.items()))
            table_text = table_text or "当前没有可用链路"
            msg = (
                f"{action}被拒绝{who}: 没有任何可用链路能容纳 {need} 字节；"
                f"各链路剩余容量——{table_text}"
            )
        else:
            msg = (
                f"{action}被拒绝{who}: 链路 {link_id!r} 容量不足，"
                f"当前在途 {bytes_inflight} 字节，剩余容量 {free_capacity} 字节，"
                f"本次需要 {need} 字节"
            )
        super().__init__(msg)


class PersistenceError(OrchestratorError):
    """快照写入或载入失败（格式损坏、字段缺失、校验失败等）。"""

    def __init__(self, message, location=None):
        self.location = location
        super().__init__(f"{message}（位置: {location}）" if location else message)
