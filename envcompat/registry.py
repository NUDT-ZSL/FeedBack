"""用例登记：分组与用例（需求 2）。

登记为只追加的注册表；重复用例标识、引用不存在分组等问题在登记时
一次性拒绝，并在错误中给出 cases[i] 级别的位置。
"""
from __future__ import annotations

from typing import Iterable, Mapping, Sequence, Union

from .errors import DefinitionError, DuplicateCaseError, UnknownGroupError
from .models import Outcome, TestCase

CaseLike = Union[TestCase, Mapping[str, object], Sequence[object]]


class CaseRegistry:
    def __init__(self) -> None:
        self._groups: dict[str, set[str]] = {}
        self._cases: dict[str, TestCase] = {}

    # ---- 分组 -----------------------------------------------------------
    def add_group(self, name: str) -> None:
        if not isinstance(name, str) or not name.strip():
            raise DefinitionError("分组名必须是非空字符串", location="groups")
        name = name.strip()
        if name in self._groups:
            raise DefinitionError(f"分组 {name!r} 已存在，禁止重复定义", location=f"groups[{name!r}]")
        self._groups[name] = set()

    def add_groups(self, names: Iterable[str]) -> None:
        for i, name in enumerate(names):
            try:
                self.add_group(name)
            except DefinitionError as exc:
                if "已存在" in str(exc):
                    raise DefinitionError(str(exc).split("（位置")[0],
                                          location=f"groups[{i}]") from None
                raise

    @property
    def groups(self) -> tuple[str, ...]:
        return tuple(self._groups)

    def has_group(self, name: str) -> bool:
        return name in self._groups

    # ---- 用例 -----------------------------------------------------------
    def add_cases(self, cases: Iterable[CaseLike]) -> None:
        """批量登记；整批原子校验——任一条非法则一条都不会写入。"""
        coerced: list[tuple[int, TestCase]] = []
        batch_seen: dict[str, int] = {}

        for index, raw in enumerate(cases):
            case = self._coerce(raw, index)

            if case.case_id in self._cases:
                first = self._cases[case.case_id]
                raise DuplicateCaseError(
                    case.case_id,
                    first_index=-1,  # 已存在于此前批次
                    duplicate_index=index,
                )
            if case.case_id in batch_seen:
                raise DuplicateCaseError(case.case_id, batch_seen[case.case_id], index)
            batch_seen[case.case_id] = index

            if case.group not in self._groups:
                raise UnknownGroupError(
                    case.case_id, case.group, index, list(self._groups)
                )
            coerced.append((index, case))

        for _, case in coerced:
            self._cases[case.case_id] = case
            self._groups[case.group].add(case.case_id)

    @staticmethod
    def _coerce(raw: CaseLike, index: int) -> TestCase:
        if isinstance(raw, TestCase):
            return raw
        loc = f"cases[{index}]"
        try:
            if isinstance(raw, Mapping):
                case_id = raw.get("case_id", raw.get("id"))
                group = raw.get("group")
                expected = raw.get("expected", Outcome.PASS)
            elif isinstance(raw, (tuple, list)) and len(raw) in (3, 2):
                if len(raw) == 3:
                    case_id, group, expected = raw
                else:
                    case_id, group = raw
                    expected = Outcome.PASS
            else:
                raise DefinitionError(
                    f"用例定义必须是 TestCase、{{'case_id','group','expected'}} "
                    f"或 (case_id, group[, expected])，实际为 {type(raw).__name__}",
                    location=loc,
                )
            return TestCase(case_id=case_id, group=group, expected=Outcome.parse(expected))  # type: ignore[arg-type]
        except ValueError as exc:
            raise DefinitionError(str(exc), location=loc) from None

    @property
    def case_ids(self) -> tuple[str, ...]:
        return tuple(self._cases)

    def get(self, case_id: str) -> TestCase:
        return self._cases[case_id]

    def has_case(self, case_id: str) -> bool:
        return case_id in self._cases

    def cases_of_group(self, group: str) -> tuple[str, ...]:
        return tuple(sorted(self._groups[group]))

    def __len__(self) -> int:
        return len(self._cases)
