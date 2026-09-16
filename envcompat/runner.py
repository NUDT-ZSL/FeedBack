"""核心状态机：结果登记、幂等/冲突、环境不可用、汇总、增量重算（需求 3-7）。

数据组织
--------
- ``grid[combo_sig][case_id] -> _Cell``，每个单元格按来源保存“结论发生变化”的
  历次上报，*只追加、绝不覆盖*：
  * 同来源、与该来源最新结论相同的重复上报 -> 幂等忽略，不留痕；
  * 同来源、结论变化（如先 fail 后 pass）     -> 追加，新旧结论同时保留，记冲突；
  * 不同来源结论一致                         -> 相互印证，算一次通过/失败；
  * 不同来源结论矛盾                         -> 双方都保留，单元格 CONFLICTED，
                                              汇总时生成可读冲突记录。
  因此“后跑的通过结果盖掉先前失败”在结构上不可能发生。

- ``_event_log`` 是只追加的事件流（首条即初始矩阵定义，后续含矩阵变更），
  可在空白状态上从头重放。在线路径与重放路径共用同一组纯转移函数
  （``_apply_record`` / ``_apply_unavailable`` / ``_migrate_grid``），
  所以“增量维护的汇总”和“从头全量重算的汇总”天然逐格一致（需求 7）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Iterable, Optional, Sequence, Union

from .errors import (
    RegistrationError,
    UnknownCaseError,
    UnknownCombinationError,
)
from .matrix import Matrix, DimensionLike
from .models import (
    CellState,
    Combination,
    Conflict,
    Outcome,
    Report,
)
from .registry import CaseLike, CaseRegistry

CoordLike = Union[Sequence[str], Combination]


# --------------------------------------------------------------------------- 内部结构
@dataclass
class _Cell:
    """一个“组合 × 用例”的全部登记信息。"""

    runs: dict[str, list[Report]] = field(default_factory=dict)
    state: CellState = CellState.PENDING
    not_run_reason: str = ""
    not_run_source: str = ""

    def all_reports(self) -> list[Report]:
        reports = [r for hist in self.runs.values() for r in hist]
        return sorted(reports, key=lambda r: (r.sequence, r.source))

    def distinct_outcomes(self) -> list[Outcome]:
        seen: list[Outcome] = []
        for r in self.all_reports():
            if r.outcome not in seen:
                seen.append(r.outcome)
        return seen

    def sources(self) -> tuple[str, ...]:
        return tuple(sorted(self.runs))

    def fingerprint(self) -> tuple:
        """单元格的完整结构化指纹，用于断言“未受影响组合不得改变”。"""
        return (
            self.state.value,
            self.not_run_source,
            self.not_run_reason,
            tuple(
                sorted(
                    (s, r.sequence, r.outcome.value, r.reason)
                    for s, hist in self.runs.items() for r in hist
                )
            ),
        )


@dataclass(frozen=True)
class _RecordEvent:
    seq: int
    case_id: str
    sig: str
    source: str
    outcome: Outcome
    reason: str


@dataclass(frozen=True)
class _UnavailableEvent:
    seq: int
    sig: str
    reason: str
    source: str


@dataclass(frozen=True)
class _MatrixEvent:
    """矩阵定义变更：dimensions 为 ((维度名, (取值...)), ...) 的有序快照。"""

    seq: int
    dimensions: tuple[tuple[str, tuple[str, ...]], ...]


# --------------------------------------------------------------------------- 汇总输出体
@dataclass(frozen=True)
class FailureDetail:
    case_id: str
    group: str
    expected: Outcome
    combination: Combination
    combo_label: str
    outcome: Outcome
    reason: str
    sources: tuple[str, ...]


@dataclass(frozen=True)
class NotRunDetail:
    case_id: str
    group: str
    combination: Combination
    combo_label: str
    reason: str
    source: str


@dataclass(frozen=True)
class _RateMixin:
    passed: int
    executed: int

    @property
    def rate(self) -> Optional[Fraction]:
        """通过率 = 通过 / 已执行；未执行不进入分母。无已执行样本时为 None。"""
        return Fraction(self.passed, self.executed) if self.executed else None

    @property
    def rate_text(self) -> str:
        if not self.executed:
            return "N/A（无已执行样本）"
        return f"{self.passed}/{self.executed} = {float(self.rate) * 100:.1f}%"  # type: ignore[union-attr]


@dataclass(frozen=True)
class CaseStat(_RateMixin):
    case_id: str
    group: str
    expected: Outcome
    failed: int
    timeout: int
    skipped: int
    conflicted: int
    not_run: int
    pending: int
    failures: tuple[FailureDetail, ...]
    not_run_details: tuple[NotRunDetail, ...]
    conflicts: tuple[Conflict, ...] = ()


@dataclass(frozen=True)
class ComboStat(_RateMixin):
    combination: Combination
    combo_label: str
    failed: int
    timeout: int
    skipped: int
    conflicted: int
    not_run: int
    pending: int
    failures: tuple[FailureDetail, ...]
    not_run_details: tuple[NotRunDetail, ...]
    conflicts: tuple[Conflict, ...] = ()


@dataclass(frozen=True)
class Summary(_RateMixin):
    total_cells: int
    failed: int
    timeout: int
    skipped: int
    conflicted: int
    not_run: int
    pending: int
    by_case: tuple[CaseStat, ...]
    by_combo: tuple[ComboStat, ...]
    failures: tuple[FailureDetail, ...]
    not_run_details: tuple[NotRunDetail, ...]
    conflicts: tuple[Conflict, ...]
    pending_details: tuple[NotRunDetail, ...]  # 从未上报（疑似漏跑），单独列出

    def render_text(self) -> str:
        from .report import render_summary
        return render_summary(self)


@dataclass(frozen=True)
class MatrixChange:
    """一次矩阵定义变更的影响面。"""

    old_signatures: frozenset[str]
    new_signatures: frozenset[str]
    added: frozenset[str]
    removed: frozenset[str]
    unchanged: frozenset[str]

    @property
    def affected(self) -> frozenset[str]:
        return self.added | self.removed


# --------------------------------------------------------------------------- 纯状态转移
# 在线登记与“从头重放”共用这些函数，两条代码路径因此天然一致。

def _fill_not_run(cell: _Cell, reason: str, source: str) -> None:
    cell.state = CellState.NOT_RUN
    cell.not_run_reason = reason
    cell.not_run_source = source


def _apply_record(
    grid: dict[str, dict[str, _Cell]],
    *,
    seq: int,
    case_id: str,
    sig: str,
    source: str,
    outcome: Outcome,
    reason: str,
) -> None:
    """只追加一条上报；只要历史上出现过两种结论，单元格永久停留在 CONFLICTED。"""
    cell = grid[sig].setdefault(case_id, _Cell())
    cell.runs.setdefault(source, []).append(Report(source, outcome, reason, seq))
    distinct = cell.distinct_outcomes()
    cell.state = CellState.EXECUTED if len(distinct) == 1 else CellState.CONFLICTED


def _apply_unavailable(
    grid: dict[str, dict[str, _Cell]],
    unavailable: dict[str, _UnavailableEvent],
    case_ids: Sequence[str],
    *,
    seq: int,
    sig: str,
    reason: str,
    source: str,
) -> list[str]:
    """把该组合下尚未上报的用例标为未执行；已上报的结论一律不动。返回本次新标记列表。"""
    unavailable[sig] = _UnavailableEvent(seq, sig, reason, source)
    row = grid.setdefault(sig, {})
    newly_marked: list[str] = []
    for case_id in case_ids:
        cell = row.setdefault(case_id, _Cell())
        if cell.state is CellState.PENDING:
            _fill_not_run(cell, reason, source)
            newly_marked.append(case_id)
    return newly_marked


def _migrate_grid(
    old_grid: dict[str, dict[str, _Cell]],
    new_matrix: Matrix,
    unavailable: dict[str, _UnavailableEvent],
    case_ids: Sequence[str],
) -> dict[str, dict[str, _Cell]]:
    """矩阵变更后的网格迁移：保留组合原样搬用（同一对象），新增组合建空格。"""
    new_grid: dict[str, dict[str, _Cell]] = {}
    for combo in new_matrix.combinations:
        if combo.signature in old_grid:
            new_grid[combo.signature] = old_grid[combo.signature]  # 未受影响：同对象
        else:
            row: dict[str, _Cell] = {}
            event = unavailable.get(combo.signature)
            for case_id in case_ids:
                cell = _Cell()
                if event is not None:
                    _fill_not_run(cell, event.reason, event.source)
                row[case_id] = cell
            new_grid[combo.signature] = row
    return new_grid


# --------------------------------------------------------------------------- runner
class CompatibilityRunner:
    def __init__(
        self,
        matrix: Union[Matrix, Iterable[DimensionLike]],
        groups: Iterable[str] = (),
        cases: Iterable[CaseLike] = (),
    ):
        self._matrix = matrix if isinstance(matrix, Matrix) else Matrix(matrix)
        self._registry = CaseRegistry()
        if groups:
            self._registry.add_groups(groups)
        self._grid: dict[str, dict[str, _Cell]] = {
            combo.signature: {} for combo in self._matrix.combinations
        }
        self._unavailable: dict[str, _UnavailableEvent] = {}
        self._event_log: list[Union[_RecordEvent, _UnavailableEvent, _MatrixEvent]] = [
            _MatrixEvent(0, tuple((d.name, d.values) for d in self._matrix.dimensions))
        ]
        self._seq = 0
        if cases:
            self.add_cases(cases)

    # ---- 注册委托 -------------------------------------------------------
    def add_group(self, name: str) -> None:
        self._registry.add_group(name)

    def add_groups(self, names: Iterable[str]) -> None:
        self._registry.add_groups(names)

    def add_cases(self, cases: Iterable[CaseLike]) -> None:
        before = set(self._registry.case_ids)
        self._registry.add_cases(cases)  # 整批原子校验，失败则现状不变
        for case_id in self._registry.case_ids:
            if case_id in before:
                continue
            for sig, row in self._grid.items():
                cell = _Cell()
                event = self._unavailable.get(sig)
                if event is not None:  # 组合早已不可用：新登记用例直接置未执行
                    _fill_not_run(cell, event.reason, event.source)
                row[case_id] = cell

    @property
    def matrix(self) -> Matrix:
        return self._matrix

    @property
    def registry(self) -> CaseRegistry:
        return self._registry

    # ---- 坐标解析 -------------------------------------------------------
    def _resolve_combo(self, coords: CoordLike) -> Combination:
        if isinstance(coords, Combination):
            if coords.signature not in self._grid:
                raise UnknownCombinationError(coords.coords, self._matrix.combinations)
            return coords
        try:
            return self._matrix.resolve(coords)
        except Exception:
            raise UnknownCombinationError(tuple(coords), self._matrix.combinations) from None

    # ---- 需求 3/6：结果登记 --------------------------------------------
    def record(
        self,
        case_id: str,
        coords: CoordLike,
        outcome: Union[Outcome, str],
        *,
        source: str,
        reason: str = "",
    ) -> str:
        """登记一条执行结果，返回处置：'idempotent' | 'recorded' | 'conflict'。"""
        if not self._registry.has_case(case_id):
            raise UnknownCaseError(case_id, list(self._registry.case_ids))
        combo = self._resolve_combo(coords)
        outcome = Outcome.parse(outcome)
        Report(source=source, outcome=outcome, reason=reason)  # 参数校验

        cell = self._grid[combo.signature][case_id]
        if cell.state is CellState.NOT_RUN:
            raise RegistrationError(
                f"组合 {tuple(combo.coords)!r} 已被标记为环境不可用，用例 {case_id!r} "
                f"已记为未执行；拒绝补报，避免把不可用环境洗成通过",
                case_id=case_id, combination=combo.coords, source=source,
            )

        history = cell.runs.get(source)
        if history and history[-1].outcome is outcome:
            return "idempotent"  # 与该来源最新结论一致：完全幂等，不写日志、不留痕

        self._seq += 1
        _apply_record(
            self._grid, seq=self._seq, case_id=case_id, sig=combo.signature,
            source=source, outcome=outcome, reason=reason,
        )
        self._event_log.append(
            _RecordEvent(self._seq, case_id, combo.signature, source, outcome, reason)
        )
        return "conflict" if cell.state is CellState.CONFLICTED else "recorded"

    # ---- 需求 4：环境不可用 --------------------------------------------
    def mark_unavailable(
        self,
        coords: CoordLike,
        reason: str,
        *,
        source: str = "env-monitor",
    ) -> list[str]:
        """把某组合下“尚未上报”的用例标为未执行，返回本次新标记的用例 id。"""
        combo = self._resolve_combo(coords)
        if not reason or not str(reason).strip():
            raise RegistrationError("标记环境不可用必须给出原因", combination=combo.coords)
        reason = reason.strip()
        self._seq += 1
        newly = _apply_unavailable(
            self._grid, self._unavailable, tuple(self._registry.case_ids),
            seq=self._seq, sig=combo.signature, reason=reason, source=source,
        )
        self._event_log.append(_UnavailableEvent(self._seq, combo.signature, reason, source))
        return newly

    def mark_value_unavailable(
        self, dim_name: str, value: str, reason: str, *, source: str = "env-monitor"
    ) -> dict[str, list[str]]:
        """便捷操作：某维度取值（如整个操作系统）不可用，批量标记其全部组合。"""
        return {
            combo.signature: self.mark_unavailable(combo, reason, source=source)
            for combo in self._matrix.combinations_with(dim_name, value)
        }

    def unavailable_reason(self, coords: CoordLike) -> Optional[str]:
        combo = self._resolve_combo(coords)
        event = self._unavailable.get(combo.signature)
        return event.reason if event else None

    # ---- 需求 5：汇总 ---------------------------------------------------
    def summary(self) -> Summary:
        return self._build_summary(self._matrix, self._grid, tuple(self._registry.case_ids))

    def _build_summary(
        self,
        matrix: Matrix,
        grid: dict[str, dict[str, _Cell]],
        case_ids: Sequence[str],
    ) -> Summary:
        by_case_rows: list[CaseStat] = []
        by_combo_rows: list[ComboStat] = []
        all_failures: list[FailureDetail] = []
        all_not_run: list[NotRunDetail] = []
        all_pending: list[NotRunDetail] = []
        all_conflicts: list[Conflict] = []

        def cell_of(sig: str, case_id: str) -> _Cell:
            return grid.get(sig, {}).get(case_id, _Cell())

        # 全局冲突与明细，按“组合顺序 × 用例登记顺序”扫描，输出确定可复核。
        for combo in matrix.combinations:
            label = matrix.render_combination(combo)
            for case_id in case_ids:
                tc = self._registry.get(case_id)
                cell = cell_of(combo.signature, case_id)
                if cell.state is CellState.CONFLICTED:
                    all_conflicts.append(
                        Conflict(tc.case_id, tc.group, combo, tuple(cell.all_reports()))
                    )
                elif cell.state is CellState.EXECUTED and cell.distinct_outcomes()[0].is_failure:
                    all_failures.append(self._failure(tc, combo, label, cell))
                elif cell.state is CellState.NOT_RUN:
                    all_not_run.append(NotRunDetail(
                        tc.case_id, tc.group, combo, label,
                        cell.not_run_reason, cell.not_run_source))

        def conflicts_for(case_id: Optional[str], sig: Optional[str]) -> tuple[Conflict, ...]:
            return tuple(
                c for c in all_conflicts
                if (case_id is None or c.case_id == case_id)
                and (sig is None or c.combination.signature == sig)
            )

        # ---- 按用例维度 ----
        for case_id in case_ids:
            tc = self._registry.get(case_id)
            n = dict(passed=0, failed=0, timeout=0, skipped=0,
                     executed=0, not_run=0, pending=0)
            failures: list[FailureDetail] = []
            not_run_details: list[NotRunDetail] = []

            for combo in matrix.combinations:
                cell = cell_of(combo.signature, case_id)
                label = matrix.render_combination(combo)
                if cell.state is CellState.NOT_RUN:
                    n["not_run"] += 1
                    not_run_details.append(NotRunDetail(
                        tc.case_id, tc.group, combo, label,
                        cell.not_run_reason, cell.not_run_source))
                elif cell.state is CellState.PENDING:
                    n["pending"] += 1
                else:  # EXECUTED / CONFLICTED 均属“已执行”
                    n["executed"] += 1
                    if cell.state is CellState.EXECUTED:
                        outcome = cell.distinct_outcomes()[0]
                        if outcome.is_pass:
                            n["passed"] += 1
                        elif outcome is Outcome.SKIPPED:
                            n["skipped"] += 1
                        elif outcome is Outcome.TIMEOUT:
                            n["timeout"] += 1
                            failures.append(self._failure(tc, combo, label, cell))
                        else:
                            n["failed"] += 1
                            failures.append(self._failure(tc, combo, label, cell))

            by_case_rows.append(CaseStat(
                case_id=tc.case_id, group=tc.group, expected=tc.expected,
                passed=n["passed"], executed=n["executed"], failed=n["failed"],
                timeout=n["timeout"], skipped=n["skipped"],
                conflicted=len(conflicts_for(tc.case_id, None)),
                not_run=n["not_run"], pending=n["pending"],
                failures=tuple(failures), not_run_details=tuple(not_run_details),
                conflicts=conflicts_for(tc.case_id, None),
            ))

        # ---- 按组合维度 ----
        for combo in matrix.combinations:
            label = matrix.render_combination(combo)
            row = grid.get(combo.signature, {})
            n = dict(passed=0, failed=0, timeout=0, skipped=0,
                     executed=0, not_run=0, pending=0)
            failures: list[FailureDetail] = []
            not_run_details: list[NotRunDetail] = []

            for case_id in case_ids:
                tc = self._registry.get(case_id)
                cell = row.get(case_id, _Cell())
                if cell.state is CellState.NOT_RUN:
                    n["not_run"] += 1
                    not_run_details.append(NotRunDetail(
                        tc.case_id, tc.group, combo, label,
                        cell.not_run_reason, cell.not_run_source))
                elif cell.state is CellState.PENDING:
                    n["pending"] += 1
                    all_pending.append(NotRunDetail(
                        tc.case_id, tc.group, combo, label,
                        "未收到任何结果上报（疑似漏跑）", ""))
                else:
                    n["executed"] += 1
                    if cell.state is CellState.EXECUTED:
                        outcome = cell.distinct_outcomes()[0]
                        if outcome.is_pass:
                            n["passed"] += 1
                        elif outcome is Outcome.SKIPPED:
                            n["skipped"] += 1
                        elif outcome is Outcome.TIMEOUT:
                            n["timeout"] += 1
                            failures.append(self._failure(tc, combo, label, cell))
                        else:
                            n["failed"] += 1
                            failures.append(self._failure(tc, combo, label, cell))

            by_combo_rows.append(ComboStat(
                combination=combo, combo_label=label,
                passed=n["passed"], executed=n["executed"], failed=n["failed"],
                timeout=n["timeout"], skipped=n["skipped"],
                conflicted=len(conflicts_for(None, combo.signature)),
                not_run=n["not_run"], pending=n["pending"],
                failures=tuple(failures), not_run_details=tuple(not_run_details),
                conflicts=conflicts_for(None, combo.signature),
            ))

        return Summary(
            total_cells=len(matrix.combinations) * len(case_ids),
            passed=sum(s.passed for s in by_combo_rows),
            executed=sum(s.executed for s in by_combo_rows),
            failed=sum(s.failed for s in by_combo_rows),
            timeout=sum(s.timeout for s in by_combo_rows),
            skipped=sum(s.skipped for s in by_combo_rows),
            conflicted=len(all_conflicts),
            not_run=sum(s.not_run for s in by_combo_rows),
            pending=sum(s.pending for s in by_combo_rows),
            by_case=tuple(by_case_rows),
            by_combo=tuple(by_combo_rows),
            failures=tuple(all_failures),
            not_run_details=tuple(all_not_run),
            conflicts=tuple(all_conflicts),
            pending_details=tuple(all_pending),
        )

    @staticmethod
    def _failure(tc, combo: Combination, label: str, cell: _Cell) -> FailureDetail:
        outcome = cell.distinct_outcomes()[0]
        reason = next((r.reason for r in cell.all_reports() if r.reason), "")
        return FailureDetail(
            tc.case_id, tc.group, tc.expected, combo, label,
            outcome, reason, cell.sources(),
        )

    def conflicts(self) -> list[Conflict]:
        """需求 6 的直接读取入口。"""
        return list(self.summary().conflicts)

    def cell_state(self, case_id: str, coords: CoordLike) -> CellState:
        combo = self._resolve_combo(coords)
        return self._grid[combo.signature][case_id].state

    # ---- 需求 7：矩阵定义变更（增量）-----------------------------------
    def rebuild_matrix(self, dimensions: Iterable[DimensionLike]) -> MatrixChange:
        """修改维度定义 / 新增取值。

        - 新矩阵先完整校验，非法则抛错且现有状态保持不变；
        - 未受影响组合的单元格是同一对象（完全不触碰）；
        - 消失组合的结果随之失效；新增组合按既有不可用标记初始化。
        """
        new_matrix = Matrix(dimensions)  # 非法定义在此抛出，下面的状态不会改动
        old_sigs = frozenset(self._matrix.signatures)
        new_sigs = frozenset(new_matrix.signatures)

        self._grid = _migrate_grid(
            self._grid, new_matrix, self._unavailable, tuple(self._registry.case_ids)
        )
        self._matrix = new_matrix
        self._unavailable = {sig: ev for sig, ev in self._unavailable.items() if sig in new_sigs}

        self._seq += 1
        self._event_log.append(_MatrixEvent(
            self._seq, tuple((d.name, d.values) for d in new_matrix.dimensions)
        ))
        return MatrixChange(
            old_signatures=old_sigs,
            new_signatures=new_sigs,
            added=new_sigs - old_sigs,
            removed=old_sigs - new_sigs,
            unchanged=old_sigs & new_sigs,
        )

    # ---- 需求 7：从事件日志全量重放 ------------------------------------
    def replay_summary_from_scratch(self) -> Summary:
        """在空白状态上按事件日志完整重放（首条事件即初始矩阵定义）。"""
        matrix: Optional[Matrix] = None
        grid: dict[str, dict[str, _Cell]] = {}
        unavailable: dict[str, _UnavailableEvent] = {}
        case_ids = tuple(self._registry.case_ids)

        for event in self._event_log:
            if isinstance(event, _MatrixEvent):
                matrix = Matrix(list(event.dimensions))
                grid = _migrate_grid(grid, matrix, unavailable, case_ids)
                unavailable = {
                    sig: ev for sig, ev in unavailable.items() if sig in matrix.signatures
                }
            elif isinstance(event, _RecordEvent):
                assert matrix is not None
                if event.sig not in matrix.signatures or event.case_id not in case_ids:
                    continue
                if grid[event.sig].get(event.case_id, _Cell()).state is CellState.NOT_RUN:
                    continue  # 与在线规则一致：不可用后补报无效
                _apply_record(
                    grid, seq=event.seq, case_id=event.case_id, sig=event.sig,
                    source=event.source, outcome=event.outcome, reason=event.reason,
                )
            else:  # _UnavailableEvent
                assert matrix is not None
                if event.sig not in matrix.signatures:
                    continue
                _apply_unavailable(
                    grid, unavailable, case_ids,
                    seq=event.seq, sig=event.sig, reason=event.reason, source=event.source,
                )

        assert matrix is not None
        return self._build_summary(matrix, grid, case_ids)

    def verify_equivalence(self) -> tuple[bool, Summary, Summary]:
        """供复核：增量汇总与从头重放必须完全相等（Summary 为值对象，逐字段比较）。"""
        incremental = self.summary()
        from_scratch = self.replay_summary_from_scratch()
        return incremental == from_scratch, incremental, from_scratch

    def fingerprint(self) -> dict[str, dict[str, tuple]]:
        """全部单元格指纹，用于在矩阵变更前后断言未受影响组合保持不变。"""
        return {
            sig: {case_id: cell.fingerprint() for case_id, cell in row.items()}
            for sig, row in self._grid.items()
        }
