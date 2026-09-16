"""领域模型：维度 / 组合 / 分组 / 用例 / 上报记录 / 冲突。

这些类型都是不可变值对象（frozen dataclass），状态保存在 runner 中，
便于在“增量重算”和“从头重算”之间做逐格相等比较。
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field


class Outcome(str, enum.Enum):
    """一次执行的结论。

    PASS / FAIL / SKIPPED / TIMEOUT 均视为“已执行”；
    “未执行”不是上报出来的结果，而是环境不可用后系统补标的状态。
    """

    PASS = "pass"
    FAIL = "fail"
    SKIPPED = "skipped"
    TIMEOUT = "timeout"

    @property
    def is_executed(self) -> bool:
        return True

    @property
    def is_pass(self) -> bool:
        """是否计入通过。

        只有 PASS 算通过；SKIPPED 是执行后主动跳过（带原因），
        既不是通过也不是失败，计入分母但不算通过；TIMEOUT 视为失败。
        """
        return self is Outcome.PASS

    @property
    def is_failure(self) -> bool:
        return self is Outcome.FAIL or self is Outcome.TIMEOUT

    @classmethod
    def parse(cls, value: "Outcome | str") -> "Outcome":
        if isinstance(value, Outcome):
            return value
        try:
            return cls(str(value).strip().lower())
        except ValueError:
            allowed = ", ".join(o.value for o in cls)
            raise ValueError(f"无法识别的结果 {value!r}，允许: {allowed}")


class CellState(str, enum.Enum):
    """某个“组合 × 用例”单元格的聚合状态。"""

    PENDING = "pending"        # 尚无任何上报
    EXECUTED = "executed"      # 有一致的执行结论
    CONFLICTED = "conflicted"  # 多个来源结论矛盾
    NOT_RUN = "not_run"        # 环境不可用，未执行


@dataclass(frozen=True)
class Dimension:
    """一个环境维度，例如 name='os', values=('linux','windows')。"""

    name: str
    values: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("维度名必须是非空字符串")
        vals = tuple(self.values)
        if not vals:
            raise ValueError(f"维度 {self.name!r} 至少要有一个取值")
        seen: set[str] = set()
        for i, v in enumerate(vals):
            if not isinstance(v, str) or not v.strip():
                raise ValueError(
                    f"维度 {self.name!r} 的第 {i} 个取值非法：取值必须是非空字符串"
                )
            if v in seen:
                raise ValueError(
                    f"维度 {self.name!r} 的取值 {v!r} 重复（出现位置之一: index {i}）"
                )
            seen.add(v)
        object.__setattr__(self, "values", vals)


@dataclass(frozen=True)
class Combination:
    """矩阵中的一个环境组合：各维度取值的有序元组。

    coords 与矩阵的维度顺序一一对应；signature 是稳定的字符串键。
    """

    coords: tuple[str, ...]
    signature: str

    @staticmethod
    def make_signature(coords: tuple[str, ...]) -> str:
        # 用分隔符 + 每段长度，避免取值中含有分隔符导致碰撞。
        return "|".join(f"{len(c)}:{c}" for c in coords)

    @classmethod
    def create(cls, coords: tuple[str, ...]) -> "Combination":
        return cls(tuple(coords), cls.make_signature(tuple(coords)))

    def __str__(self) -> str:
        return "/".join(self.coords)


@dataclass(frozen=True)
class Group:
    """用例分组。"""

    name: str

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("分组名必须是非空字符串")
        object.__setattr__(self, "name", self.name.strip())


@dataclass(frozen=True)
class TestCase:
    """一条用例：唯一标识、所属分组、期望结果。"""

    case_id: str
    group: str
    expected: Outcome

    def __post_init__(self) -> None:
        if not isinstance(self.case_id, str) or not self.case_id.strip():
            raise ValueError("用例标识必须是非空字符串")
        object.__setattr__(self, "case_id", self.case_id.strip())
        expected = self.expected
        if not isinstance(expected, Outcome):
            expected = Outcome.parse(self.expected)  # type: ignore[arg-type]
            object.__setattr__(self, "expected", expected)


@dataclass(frozen=True)
class Report:
    """一次结果上报。

    source 标识上报来源（执行器/机器/任务编号），冲突记录靠它区分双方。
    """

    source: str
    outcome: Outcome
    reason: str = ""
    sequence: int = 0  # 上报先后序号，仅用于可读输出与排序

    def __post_init__(self) -> None:
        if not isinstance(self.source, str) or not self.source.strip():
            raise ValueError("上报来源 source 必须是非空字符串")
        object.__setattr__(self, "source", self.source.strip())
        if not isinstance(self.outcome, Outcome):
            object.__setattr__(self, "outcome", Outcome.parse(self.outcome))  # type: ignore[arg-type]


@dataclass(frozen=True)
class Conflict:
    """同一用例在同一组合下来自多个来源的矛盾结论。双方全部保留。"""

    case_id: str
    group: str
    combination: Combination
    reports: tuple[Report, ...] = field(default_factory=tuple)

    def outcomes_present(self) -> list[Outcome]:
        seen: list[Outcome] = []
        for r in self.reports:
            if r.outcome not in seen:
                seen.append(r.outcome)
        return seen

    def render(self) -> str:
        lines = [
            f"冲突：用例 {self.case_id!r}（分组 {self.group!r}）在组合 "
            f"{self.combination} 收到互相矛盾的结果："
        ]
        for r in self.reports:
            reason = f"，原因: {r.reason}" if r.reason else ""
            lines.append(f"  - 来源 {r.source!r}: {r.outcome.value}{reason}")
        lines.append("  双方结论均已保留，未静默择一；请人工复核。")
        return "\n".join(lines)
