"""内核错误类型。

所有错误都继承 :class:`KernelError`，调用方只需捕获这一个基类即可兜底。
错误信息均为中文、面向现场排障，尽量带上出错的具体上下文（型号、字段路径、
期望值、实际值等）。
"""

from __future__ import annotations

from typing import Any, List, Sequence


class KernelError(Exception):
    """cfgkernel 所有错误的基类。"""


class RegistrationError(KernelError):
    """登记型号 / 能力 / 字段规则 / 迁移操作时发现重复或非法定义。"""


class LoadError(KernelError):
    """从 JSON 文件恢复内核状态失败：文件损坏、字段缺失、校验和不符等。"""


class FieldProblem:
    """单个字段的校验问题（不可变值对象）。

    属性：

    path     点分字段路径，如 ``net.wifi.power``
    kind     问题类别，见下方 KIND_* 常量
    expected 期望值的人类可读描述（类型、范围、枚举成员……）
    actual   实际值的人类可读描述
    message  完整说明（通常直接包含上述字段）
    """

    KIND_TYPE = "type"                    # 类型不符
    KIND_RANGE = "range"                  # 数值 / 长度 / 成员数越界
    KIND_ENUM = "enum"                    # 枚举取值非法
    KIND_REQUIRED = "required"            # 必填字段缺失
    KIND_UNKNOWN_FIELD = "unknown_field"  # 当前版本不认识该字段（老读新）
    KIND_CAPABILITY = "capability"        # 设备不具备字段所需能力
    KIND_CANNOT_CONVERT = "cannot_convert"  # 类型迁移无法表示
    KIND_CHOICE = "choice"                # 值不在允许集合内

    __slots__ = ("path", "kind", "expected", "actual", "message")

    def __init__(self, path: str, kind: str, expected: str,
                 actual: Any, message: str = "") -> None:
        self.path = path
        self.kind = kind
        self.expected = expected
        self.actual = actual
        self.message = message or self._compose()

    def _compose(self) -> str:
        return (
            f"字段 '{self.path}' {self.kind} 校验失败："
            f"期望 {self.expected}，实际 {_describe(self.actual)}"
        )

    def __str__(self) -> str:
        return self.message

    def __repr__(self) -> str:
        return f"FieldProblem(path={self.path!r}, kind={self.kind!r}, message={self.message!r})"

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, FieldProblem):
            return NotImplemented
        return (
            self.path == other.path
            and self.kind == other.kind
            and self.expected == other.expected
            and self.actual == other.actual
        )

    def __hash__(self) -> int:
        return hash((self.path, self.kind, self.expected, repr(self.actual)))


def _describe(value: Any) -> str:
    """把实际值渲染成稳定、可读的字符串。"""
    if value is None:
        return "<缺失>"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f"字符串 {value!r}"
    if isinstance(value, (int, float)):
        return f"{type(value).__name__}({value})"
    if isinstance(value, (list, tuple)):
        return f"{type(value).__name__}({list(value)!r})"
    return f"{type(value).__name__}({value!r})"


class _ProblemListError(KernelError):
    """携带若干 :class:`FieldProblem` 的错误基类。"""

    def __init__(self, problems: Sequence[FieldProblem], prefix: str) -> None:
        self.problems: List[FieldProblem] = list(problems)
        detail = "; ".join(p.message for p in self.problems)
        super().__init__(f"{prefix}（共 {len(self.problems)} 项）：{detail}")


class ValidationError(_ProblemListError):
    """应用配置时一个或多个字段校验失败。

    内核采取“一次性收集全部问题”的策略，避免现场改一个错再冒出下一个。
    """

    def __init__(self, problems: Sequence[FieldProblem]) -> None:
        super().__init__(problems, "配置校验失败")


class MigrationError(KernelError):
    """沿演进链迁移配置时在某一步失败。

    属性：

    step        失败的迁移步（``1.0.0 -> 1.1.0`` 这样的元组）
    reason      失败原因（可能是 :class:`ValidationError` 或普通异常）
    rollback_ok 内核是否已把配置整体回滚到迁移前状态（必须恒为 True）
    """

    def __init__(self, step: str, reason: BaseException) -> None:
        self.step = step
        self.reason = reason
        self.rollback_ok = True
        problems = getattr(reason, "problems", None)
        if problems:
            detail = "; ".join(p.message for p in problems)
        else:
            detail = str(reason)
        super().__init__(
            f"配置迁移在步骤 {step} 失败：{detail}；已整体回滚到迁移前状态，"
            "未留下半新半旧的配置"
        )


class RollbackError(KernelError):
    """按迁移记录回滚时无法恢复（记录损坏 / 校验和不符 / 配置已分叉）。"""
