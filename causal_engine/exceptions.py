"""引擎使用的异常类型。

所有异常都继承自 :class:`CausalEngineError`，调用方既可以按具体类型
捕获，也可以统一捕获基类。异常消息中会指出违反约束的进程、事件或值。
"""

from __future__ import annotations


class CausalEngineError(Exception):
    """引擎所有异常的基类。"""


class DuplicateProcessError(CausalEngineError):
    """重复注册同一个 ``process_id``。

    :param process_id: 冲突的进程标识。
    """

    def __init__(self, process_id: str) -> None:
        self.process_id = process_id
        super().__init__(f"process already registered: {process_id!r}")


class UnknownProcessError(CausalEngineError):
    """引用了未注册的进程。

    :param process_id: 未注册的进程标识。
    :param context: 错误发生的场景（如 ``"append"``、``"vector"``），
        用于拼出更清晰的错误消息。
    """

    def __init__(self, process_id: str, context: str = "reference") -> None:
        self.process_id = process_id
        self.context = context
        super().__init__(f"unknown process {process_id!r} in {context}")


class InvalidEventError(CausalEngineError):
    """事件字段或向量时钟不合法。"""


class DuplicateEventError(CausalEngineError):
    """``event_id`` 全局唯一约束被破坏（通常出现在 load 校验时）。

    :param event_id: 重复的事件标识。
    """

    def __init__(self, event_id: str) -> None:
        self.event_id = event_id
        super().__init__(f"duplicate event_id: {event_id!r}")


class UnknownEventError(CausalEngineError):
    """``replay_closure`` 的 seed 引用了不存在的事件。

    注意 ``get_event`` 按需求约定对不存在的事件返回 ``None``，本异常
    仅由 ``replay_closure`` 抛出。

    :param missing_ids: 所有不存在的 seed 标识（已去重、保持输入顺序）。
    """

    def __init__(self, missing_ids: list[str]) -> None:
        self.missing_ids = list(missing_ids)
        super().__init__(
            "unknown event_id(s): " + ", ".join(repr(i) for i in self.missing_ids)
        )


class InconsistentSnapshotError(CausalEngineError):
    """快照在给定 cut 下无法因果闭合，即缺失因果前驱。

    :param missing_predecessors: 被依赖但不在 cut 内的事件标识列表。
    :param required_by: 缺失事件 -> 依赖它的事件列表（用于诊断）。
    """

    def __init__(
        self,
        missing_predecessors: list[str],
        required_by: dict[str, list[str]] | None = None,
    ) -> None:
        self.missing_predecessors = list(missing_predecessors)
        self.required_by = required_by or {}
        detail = ", ".join(self.missing_predecessors)
        super().__init__(
            f"snapshot is not causally complete; missing predecessor(s): {detail}"
        )


class InvalidCutError(CausalEngineError):
    """``consistent_snapshot`` 的 cut 非法。

    包括值不是非负整数、引用未注册进程、seq 超过该进程当前最大 seq。
    """


class PersistenceError(CausalEngineError):
    """保存/加载 JSON 快照文件失败（文件损坏、字段缺失、内容不一致）。"""
