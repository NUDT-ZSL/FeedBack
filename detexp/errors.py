"""异常类型：错误信息中尽量携带实验/步骤/位置信息。"""

from __future__ import annotations

from typing import List, Optional


class DetexpError(Exception):
    """所有框架异常的基类。"""


class ValidationError(DetexpError):
    """单条配置非法。

    loc:   可读位置，例如 ``experiment.parameters[n]`` 或
           ``experiment.steps[2].params``。
    where: 实验/步骤标识，便于批量注册时定位。
    """

    def __init__(self, message: str, loc: Optional[str] = None,
                 where: Optional[str] = None):
        self.loc = loc
        self.where = where
        prefix = []
        if where is not None:
            prefix.append(f"[{where}]")
        if loc is not None:
            prefix.append(loc)
        super().__init__(": ".join(prefix + [message]) if prefix else message)


class MultiValidationError(DetexpError):
    """一次收集的所有校验错误（不遇到第一个就停）。"""

    def __init__(self, errors: List[ValidationError]):
        self.errors = list(errors)
        head = "发现 %d 处配置错误:\n" % len(errors)
        body = "\n".join("  %d) %s" % (i + 1, str(e))
                         for i, e in enumerate(errors))
        super().__init__(head + body)


class StreamExhaustedError(DetexpError):
    """步骤消耗的随机量超出其声明的切片。"""


class StepExecutionError(DetexpError):
    """步骤在所有重试之后仍然失败。"""

    def __init__(self, message: str, *, fn_name: str = "", step_id: str = "",
                 retries_used: int = 0, override_index: int = -1):
        self.fn_name = fn_name
        self.step_id = step_id
        self.retries_used = retries_used
        self.override_index = override_index
        super().__init__(message)


class ConflictPendingError(DetexpError):
    """实验存在未裁决的冲突，禁止直接执行（防止静默择一）。"""

    def __init__(self, experiment_id: str, conflict_ids: List[str]):
        self.experiment_id = experiment_id
        self.conflict_ids = list(conflict_ids)
        super().__init__(
            f"实验 {experiment_id!r} 存在 {len(conflict_ids)} 条未裁决冲突 "
            f"{conflict_ids}，请先 resolve_conflict 或 reject_conflict"
        )


class IntegrityError(DetexpError):
    """持久化文件损坏、缺字段或随机流不守恒。"""

    def __init__(self, message: str, path: Optional[str] = None):
        self.path = path
        if path:
            message = f"{path}: {message}"
        super().__init__(message)
