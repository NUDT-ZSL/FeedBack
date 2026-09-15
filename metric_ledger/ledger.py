"""经营指标台账核心:口径版本管理、依赖计算、幂等上报、可追溯查询。

设计要点:
- 数值一律使用 Fraction 精确运算,增量重算与从头全量重算可逐位比对;
- 每个指标持有一组按生效时刻排序的口径版本,同一时刻最多一个生效版本,
  版本号稳定(不随中间插入而变化);
- 计算结果物化在结果存储中,数据上报与口径变更只重算受影响的 (指标, 时刻),
  并全程记录重算日志;verify_consistency() 用从头全量计算校验物化结果;
- 缺失(无数据 / 冲突 / 除零 / 无生效口径)显式标注并沿依赖链传播,
  绝不当作零参与计算。
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from typing import Callable, Dict, List, Optional, Tuple

from .expressions import BinOp, Const, Expr, FormulaError, Neg, Ref, parse, refs, render


class LedgerError(ValueError):
    """非法配置或非法操作,信息中指出具体位置与涉及的指标链。"""


# 缺失原因
NO_DATA = "no_data"                     # 该时刻无上报数据
CONFLICT = "conflict"                   # 同一字段同一时刻存在矛盾来源
DIVISION_BY_ZERO = "division_by_zero"   # 除数为零
NO_SPEC_VERSION = "no_spec_version"     # 该时刻之前没有生效的口径版本


def _num(value: Optional[Fraction]):
    """Fraction 的确定性精确序列化:整数输出 int,其余输出 "p/q"。"""
    if value is None:
        return None
    if value.denominator == 1:
        return value.numerator
    return f"{value.numerator}/{value.denominator}"


def _to_fraction(value) -> Fraction:
    if isinstance(value, Fraction):
        return value
    if isinstance(value, bool):
        raise LedgerError(f"非法数值类型: {type(value).__name__}")
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, Decimal):
        return Fraction(value)
    if isinstance(value, float):
        return Fraction(str(value))
    if isinstance(value, str):
        try:
            return Fraction(value)
        except ValueError as exc:
            raise LedgerError(f"无法解析的数值: {value!r}") from exc
    raise LedgerError(f"非法数值类型: {type(value).__name__}")


@dataclass(frozen=True)
class Missing:
    """一处缺失的明确标注:原因、来源(指标或字段)、时刻与可读说明。"""

    reason: str
    source: str
    time: int
    detail: str

    def to_dict(self) -> dict:
        return {
            "reason": self.reason,
            "source": self.source,
            "time": self.time,
            "detail": self.detail,
        }


@dataclass(frozen=True)
class Provenance:
    """一次取值的完整来源链节点(不可变,保证重复查询结果与顺序一致)。"""

    kind: str                               # 'metric' | 'field'
    name: str
    time: int
    value: Optional[Fraction]
    version: Optional[int] = None           # 指标口径版本号(字段为 None)
    formula: Optional[str] = None           # 该版本公式的规范渲染
    children: Tuple["Provenance", ...] = ()  # 依赖贡献,按公式中引用顺序
    missing: Tuple[Missing, ...] = ()

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "name": self.name,
            "time": self.time,
            "value": _num(self.value),
            "version": self.version,
            "formula": self.formula,
            "contributions": [c.to_dict() for c in self.children],
            "missing": [m.to_dict() for m in self.missing],
        }


@dataclass(frozen=True)
class EvalResult:
    """一次计算的产出:取值(缺失时为 None)、缺失标注、来源链。"""

    value: Optional[Fraction]
    missing: Tuple[Missing, ...]
    provenance: Provenance

    @property
    def is_missing(self) -> bool:
        return self.value is None

    def to_dict(self) -> dict:
        return {
            "value": _num(self.value),
            "missing": [m.to_dict() for m in self.missing],
            "provenance": self.provenance.to_dict(),
        }


@dataclass(frozen=True)
class SpecVersion:
    """指标的一个口径版本。version 为稳定编号,不随插入位置变化。"""

    metric: str
    version: int
    effective_from: int
    formula: str        # 原始公式文本
    ast: Expr


class _MetricDef:
    def __init__(self, metric_id: str):
        self.id = metric_id
        self.versions: List[SpecVersion] = []   # 按 effective_from 升序
        self._counter = 0

    def next_version_no(self) -> int:
        self._counter += 1
        return self._counter

    def version_at(self, t: int) -> Optional[SpecVersion]:
        chosen = None
        for v in self.versions:
            if v.effective_from <= t:
                chosen = v
            else:
                break
        return chosen


class MetricLedger:
    """经营指标台账。

    clock: 可注入的逻辑时钟(无参可调用对象,返回 int),上报未显式给时刻时使用。
    """

    def __init__(self, clock: Optional[Callable[[], int]] = None):
        self._clock = clock or (lambda: 0)
        self._fields: Dict[str, Dict[int, List[Tuple[str, Fraction]]]] = {}
        self._metrics: Dict[str, _MetricDef] = {}
        self._results: Dict[Tuple[str, int], EvalResult] = {}
        self._observed_times: set = set()
        self._conflicts: Dict[Tuple[str, int], dict] = {}
        self._recompute_log: List[dict] = []
        self._seq = 0

    # ------------------------------------------------------------------
    # 1. 指标与口径版本维护
    # ------------------------------------------------------------------

    def declare_field(self, name: str) -> None:
        """声明一个原始数据字段。重复声明幂等;与指标同名则拒绝。"""
        if name in self._metrics:
            raise LedgerError(f"字段 {name!r} 与已声明的指标同名,命名空间必须互斥")
        self._fields.setdefault(name, {})

    def define_metric(self, metric_id: str, versions: List[Tuple[int, str]]) -> None:
        """定义指标及其口径版本组: versions 为 [(生效时刻, 公式), ...]。

        非法配置(重复生效时刻、公式错误、引用未声明对象、依赖成环)一律拒绝
        并指出位置。
        """
        if metric_id in self._metrics:
            raise LedgerError(f"指标 {metric_id!r} 已存在,不能重复定义")
        if metric_id in self._fields:
            raise LedgerError(f"指标 {metric_id!r} 与已声明的字段同名,命名空间必须互斥")
        if not versions:
            raise LedgerError(f"指标 {metric_id!r} 至少需要一个口径版本")
        parsed = [self._parse_version(metric_id, i, eff, formula)
                  for i, (eff, formula) in enumerate(versions)]
        parsed.sort(key=lambda item: item[1])
        for (i_a, eff_a, _, _), (i_b, eff_b, _, _) in zip(parsed, parsed[1:]):
            if eff_a == eff_b:
                raise LedgerError(
                    f"指标 {metric_id!r} 的第 {i_a} 个与第 {i_b} 个口径版本生效时刻相同"
                    f"(t={eff_a}),同一指标同一时刻最多一个生效版本"
                )
        mdef = _MetricDef(metric_id)
        self._metrics[metric_id] = mdef
        try:
            for _, eff, formula, ast in parsed:
                mdef.versions.append(self._make_version(mdef, eff, formula, ast))
            self._check_acyclic(metric_id)
        except LedgerError:
            del self._metrics[metric_id]
            raise
        # 数据可能先于指标定义到达,按已观测时刻补算该指标
        times = sorted(self._observed_times)
        changes = self._recompute_entries([metric_id], times)
        self._log("metric_defined", changes,
                  metric=metric_id, affected_metrics=[metric_id],
                  affected_times=times)

    def add_version(self, metric_id: str, effective_from: int, formula: str) -> dict:
        """为既有指标追加一个口径版本,只重算受影响的指标与时段,返回重算记录。"""
        mdef = self._require_metric(metric_id)
        _, _, _, ast = self._parse_version(
            metric_id, len(mdef.versions), effective_from, formula)
        for v in mdef.versions:
            if v.effective_from == effective_from:
                raise LedgerError(
                    f"指标 {metric_id!r} 在 t={effective_from} 已存在口径版本 "
                    f"v{v.version}(公式 {v.formula!r}),同一指标同一时刻最多一个生效版本"
                )
        version = self._make_version(mdef, effective_from, formula, ast)
        mdef.versions.append(version)
        mdef.versions.sort(key=lambda v: v.effective_from)
        try:
            self._check_acyclic(metric_id)
        except LedgerError:
            mdef.versions.remove(version)
            raise
        # 受影响时段: [effective_from, 后一个版本生效时刻)
        idx = mdef.versions.index(version)
        t_next = (mdef.versions[idx + 1].effective_from
                  if idx + 1 < len(mdef.versions) else None)
        candidate_times = sorted(
            t for t in self._observed_times | {k[1] for k in self._results}
            if t >= effective_from and (t_next is None or t < t_next)
        )
        affected_metrics = sorted(self._with_dependents(metric_id))
        changes = self._recompute_entries(affected_metrics, candidate_times)
        return self._log("spec_version_added", changes,
                         metric=metric_id, effective_from=effective_from,
                         new_version=version.version,
                         affected_metrics=affected_metrics,
                         affected_times=candidate_times)

    def spec_versions(self, metric_id: str) -> List[dict]:
        """指标的口径版本列表,按生效时刻升序。"""
        mdef = self._require_metric(metric_id)
        return [
            {"version": v.version, "effective_from": v.effective_from,
             "formula": v.formula, "canonical": render(v.ast)}
            for v in mdef.versions
        ]

    # ------------------------------------------------------------------
    # 3. 原始数据上报(幂等 + 冲突保留)
    # ------------------------------------------------------------------

    def ingest(self, field: str, value, time: Optional[int] = None,
               source: str = "default") -> dict:
        """上报一条原始数据。

        - 完全相同的 (字段, 时刻, 来源, 值) 重复上报为幂等空操作;
        - 同一字段同一时刻出现不同的值时,各方都保留并生成可读冲突记录,
          该字段在该时刻按缺失(冲突)参与计算,不静默选用任何一方。
        """
        if field not in self._fields:
            raise LedgerError(f"未声明的原始数据字段: {field!r},请先 declare_field")
        t = self._clock() if time is None else time
        if not isinstance(t, int) or isinstance(t, bool):
            raise LedgerError(f"逻辑时刻必须为整数,实际为 {t!r}")
        v = _to_fraction(value)
        reports = self._fields[field].setdefault(t, [])
        if (source, v) in reports:
            return {"status": "duplicate", "field": field, "time": t,
                    "value": _num(v), "source": source}
        reports.append((source, v))
        self._observed_times.add(t)
        status = "ok"
        if len({val for _, val in reports}) > 1:
            status = "conflict"
            self._conflicts[(field, t)] = self._make_conflict_record(field, t, reports)
        # 数据变化只影响该时刻、且(传递)依赖该字段的指标
        affected = sorted(self._dependents_of_field(field))
        changes = self._recompute_entries(affected, [t])
        self._log("data_ingested", changes,
                  field=field, time=t, affected_metrics=affected,
                  affected_times=[t])
        return {"status": status, "field": field, "time": t,
                "value": _num(v), "source": source}

    def conflicts(self) -> List[dict]:
        """全部冲突记录,按 (字段, 时刻) 排序,内容可读。"""
        return [self._conflicts[k] for k in sorted(self._conflicts)]

    # ------------------------------------------------------------------
    # 4 / 6. 取值查询与来源链
    # ------------------------------------------------------------------

    def query(self, metric_id: str, time: int) -> EvalResult:
        """查询指标在某逻辑时刻的取值,使用该时刻生效的口径沿依赖链逐层计算。"""
        self._require_metric(metric_id)
        key = (metric_id, time)
        if key not in self._results:
            self._results[key] = self._compute_metric(metric_id, time, {})
        return self._results[key]

    def explain(self, metric_id: str, time: int) -> dict:
        """回答完整计算来源链:用了哪个口径版本、依赖哪些指标、各贡献多少。

        返回结构顺序确定,重复查询结果完全一致。
        """
        return self.query(metric_id, time).to_dict()

    # ------------------------------------------------------------------
    # 7 / 8. 口径切换轨迹与不连续点
    # ------------------------------------------------------------------

    def trajectory(self, metric_id: str, start: int, end: int) -> List[dict]:
        """指标在 (start, end) 内的口径切换轨迹(首个版本不算切换)。

        每次切换给出:生效时刻、前后版本与公式、切换时刻分别按旧/新口径
        计算的取值与差值,以及可归因到具体依赖的差异分解。
        """
        mdef = self._require_metric(metric_id)
        out = []
        for i, ver in enumerate(mdef.versions):
            if i == 0:
                continue
            t = ver.effective_from
            if not (start < t < end):
                continue
            prev = mdef.versions[i - 1]
            before = self._compute_pinned(metric_id, t, prev)
            after = self.query(metric_id, t)
            diff = (after.value - before.value
                    if after.value is not None and before.value is not None else None)
            out.append({
                "metric": metric_id,
                "effective_from": t,
                "from_version": prev.version,
                "to_version": ver.version,
                "from_formula": render(prev.ast),
                "to_formula": render(ver.ast),
                "value_before": _num(before.value),
                "value_after": _num(after.value),
                "diff": _num(diff),
                "before_missing": [m.to_dict() for m in before.missing],
                "after_missing": [m.to_dict() for m in after.missing],
                "attribution": self._attribute(t, prev, ver),
            })
        return out

    def discontinuities(self, metric_id: str, start: int, end: int) -> List[dict]:
        """报告 (start, end) 内口径切换时刻附近的不连续点,绝不静默拼接。

        对每个切换时刻 T,比较 T-1(旧口径生效)与 T(新口径生效)的取值:
        一侧有值另一侧缺失,或两侧数值不等,即判定为不连续并给出差异归因。
        """
        self._require_metric(metric_id)
        out = []
        for switch in self.trajectory(metric_id, start, end):
            t = switch["effective_from"]
            prev_res = self.query(metric_id, t - 1)
            curr_res = self.query(metric_id, t)
            gap = self._value_gap(prev_res, curr_res)
            if gap is None:
                continue
            out.append({
                "metric": metric_id,
                "time": t,
                "kind": gap,
                "value_at_t-1": _num(prev_res.value),
                "value_at_t": _num(curr_res.value),
                "jump": _num(curr_res.value - prev_res.value)
                        if prev_res.value is not None and curr_res.value is not None
                        else None,
                "missing_at_t-1": [m.to_dict() for m in prev_res.missing],
                "missing_at_t": [m.to_dict() for m in curr_res.missing],
                "switch": switch,
            })
        return out

    # ------------------------------------------------------------------
    # 5. 一致性校验与重算日志
    # ------------------------------------------------------------------

    def verify_consistency(self) -> List[dict]:
        """用从头全量计算校验物化结果存储,返回不一致项列表(正常应为空)。"""
        times = sorted(self._observed_times | {k[1] for k in self._results})
        mismatches = []
        memo: dict = {}
        for metric_id in sorted(self._metrics):
            for t in times:
                fresh = self._compute_metric(metric_id, t, memo)
                stored = self._results.get((metric_id, t))
                if stored is None:
                    mismatches.append({"metric": metric_id, "time": t,
                                       "issue": "stored_missing"})
                elif stored.value != fresh.value or stored.missing != fresh.missing:
                    mismatches.append({
                        "metric": metric_id, "time": t, "issue": "value_mismatch",
                        "stored": _num(stored.value), "fresh": _num(fresh.value),
                    })
        return mismatches

    def recompute_log(self) -> List[dict]:
        """全部重算记录(指标定义 / 数据上报 / 口径变更),按发生顺序。"""
        return list(self._recompute_log)

    # ------------------------------------------------------------------
    # 内部:定义校验
    # ------------------------------------------------------------------

    def _require_metric(self, metric_id: str) -> _MetricDef:
        if metric_id not in self._metrics:
            raise LedgerError(f"未声明的指标: {metric_id!r}")
        return self._metrics[metric_id]

    def _parse_version(self, metric_id: str, index: int, effective_from, formula: str):
        if not isinstance(effective_from, int) or isinstance(effective_from, bool):
            raise LedgerError(
                f"指标 {metric_id!r} 第 {index} 个口径版本的生效时刻必须为整数,"
                f"实际为 {effective_from!r}"
            )
        try:
            ast = parse(formula)
        except FormulaError as exc:
            raise LedgerError(
                f"指标 {metric_id!r} 第 {index} 个口径版本公式非法: {exc}"
            ) from exc
        unknown = [n for n in refs(ast)
                   if n not in self._metrics and n not in self._fields]
        if unknown:
            raise LedgerError(
                f"指标 {metric_id!r} 第 {index} 个口径版本(t={effective_from})"
                f"引用了未声明的指标或字段: {', '.join(unknown)};"
                f"计算只能引用已声明指标、原始数据字段和常量"
            )
        return index, effective_from, formula, ast

    def _make_version(self, mdef: _MetricDef, effective_from: int,
                      formula: str, ast: Expr) -> SpecVersion:
        return SpecVersion(metric=mdef.id, version=mdef.next_version_no(),
                           effective_from=effective_from, formula=formula, ast=ast)

    def _metric_refs(self, metric_id: str) -> set:
        """该指标全部口径版本直接引用的其他指标集合。"""
        out = set()
        for v in self._metrics[metric_id].versions:
            for n in refs(v.ast):
                if n in self._metrics:
                    out.add(n)
        return out

    def _check_acyclic(self, start: str) -> None:
        """从 start 出发做依赖环检测,发现环时报出完整指标链。"""
        color: Dict[str, int] = {}
        stack: List[str] = []

        def dfs(u: str) -> Optional[List[str]]:
            color[u] = 1
            stack.append(u)
            for w in sorted(self._metric_refs(u)):
                if color.get(w) == 1:
                    return stack[stack.index(w):] + [w]
                if color.get(w, 0) == 0:
                    found = dfs(w)
                    if found:
                        return found
            stack.pop()
            color[u] = 2
            return None

        cycle = dfs(start)
        if cycle:
            raise LedgerError(
                f"指标依赖不允许成环,涉及指标链: {' -> '.join(cycle)}"
            )

    def _with_dependents(self, metric_id: str) -> set:
        """该指标及其全部传递下游(依赖它的指标)。"""
        reverse: Dict[str, set] = {}
        for m in self._metrics:
            for dep in self._metric_refs(m):
                reverse.setdefault(dep, set()).add(m)
        seen = {metric_id}
        stack = [metric_id]
        while stack:
            cur = stack.pop()
            for nxt in reverse.get(cur, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return seen

    def _dependents_of_field(self, field: str) -> set:
        """(传递)依赖该字段的全部指标。"""
        out: set = set()
        for m in self._metrics:
            if any(field in refs(v.ast) for v in self._metrics[m].versions):
                out |= self._with_dependents(m)
        return out

    # ------------------------------------------------------------------
    # 内部:计算
    # ------------------------------------------------------------------

    def _compute_metric(self, metric_id: str, t: int, memo: dict,
                        pinned: Optional[SpecVersion] = None) -> EvalResult:
        key = (metric_id, t, pinned.version if pinned else None)
        if key in memo:
            return memo[key]
        mdef = self._metrics[metric_id]
        ver = pinned if pinned is not None else mdef.version_at(t)
        if ver is None:
            missing = (Missing(NO_SPEC_VERSION, metric_id, t,
                               f"指标 {metric_id} 在 t={t} 没有生效的口径版本"),)
            res = EvalResult(None, missing,
                             Provenance("metric", metric_id, t, None,
                                        None, None, (), missing))
        else:
            children: Dict[str, EvalResult] = {}

            def resolve(name: str) -> EvalResult:
                if name in self._metrics:
                    r = self._compute_metric(name, t, memo)
                else:
                    r = self._compute_field(name, t)
                if name not in children:
                    children[name] = r
                return r

            value, missing = self._eval_ast(ver.ast, resolve, metric_id, t)
            child_prov = tuple(children[n].provenance for n in refs(ver.ast))
            prov = Provenance("metric", metric_id, t, value,
                              ver.version, render(ver.ast), child_prov, missing)
            res = EvalResult(value, missing, prov)
        memo[key] = res
        return res

    def _compute_pinned(self, metric_id: str, t: int,
                        ver: Optional[SpecVersion]) -> EvalResult:
        """用指定口径版本(而非该时刻生效版本)计算,用于切换前后对比。"""
        if ver is None:
            missing = (Missing(NO_SPEC_VERSION, metric_id, t,
                               f"指标 {metric_id} 在 t={t} 之前没有口径版本"),)
            return EvalResult(None, missing,
                              Provenance("metric", metric_id, t, None,
                                         None, None, (), missing))
        return self._compute_metric(metric_id, t, {}, pinned=ver)

    def _compute_field(self, name: str, t: int) -> EvalResult:
        reports = self._fields[name].get(t, [])
        distinct = sorted({v for _, v in reports})
        if not distinct:
            missing = (Missing(NO_DATA, name, t,
                               f"字段 {name} 在 t={t} 无上报数据"),)
            return EvalResult(None, missing,
                              Provenance("field", name, t, None,
                                         None, None, (), missing))
        if len(distinct) > 1:
            detail = "; ".join(f"{src}={_num(val)}" for src, val in reports)
            missing = (Missing(CONFLICT, name, t,
                               f"字段 {name} 在 t={t} 存在冲突上报: {detail}"),)
            return EvalResult(None, missing,
                              Provenance("field", name, t, None,
                                         None, None, (), missing))
        return EvalResult(distinct[0], (),
                          Provenance("field", name, t, distinct[0]))

    def _eval_ast(self, node: Expr, resolve, metric_id: str, t: int):
        """返回 (值或 None, 缺失元组)。任一操作数缺失则结果缺失,绝不当零。"""
        if isinstance(node, Const):
            return node.value, ()
        if isinstance(node, Ref):
            r = resolve(node.name)
            return r.value, r.missing
        if isinstance(node, Neg):
            v, ms = self._eval_ast(node.operand, resolve, metric_id, t)
            return (None if v is None else -v), ms
        assert isinstance(node, BinOp)
        lv, lm = self._eval_ast(node.left, resolve, metric_id, t)
        rv, rm = self._eval_ast(node.right, resolve, metric_id, t)
        ms = lm + rm
        if lv is None or rv is None:
            return None, ms
        if node.op == "+":
            return lv + rv, ms
        if node.op == "-":
            return lv - rv, ms
        if node.op == "*":
            return lv * rv, ms
        assert node.op == "/"
        if rv == 0:
            return None, ms + (Missing(
                DIVISION_BY_ZERO, metric_id, t,
                f"指标 {metric_id} 在 t={t} 计算时除数为 0"),)
        return lv / rv, ms

    # ------------------------------------------------------------------
    # 内部:重算与日志
    # ------------------------------------------------------------------

    def _recompute_entries(self, metric_ids: List[str], times: List[int]) -> List[dict]:
        """重算指定的 (指标, 时刻) 组合并写回物化存储,返回变化记录。

        不在列表内的 (指标, 时刻) 条目一律不触碰。
        """
        changes = []
        memo: dict = {}
        for m in metric_ids:
            for t in times:
                fresh = self._compute_metric(m, t, memo)
                key = (m, t)
                old = self._results.get(key)
                self._results[key] = fresh
                if old is None or old.value != fresh.value or old.missing != fresh.missing:
                    changes.append({
                        "metric": m, "time": t,
                        "before": _num(old.value) if old else None,
                        "after": _num(fresh.value),
                        "before_missing": [x.to_dict() for x in old.missing] if old else [],
                        "after_missing": [x.to_dict() for x in fresh.missing],
                    })
        return changes

    def _log(self, event: str, changes: List[dict], **kw) -> dict:
        self._seq += 1
        record = {"seq": self._seq, "event": event, "changes": changes}
        record.update(kw)
        self._recompute_log.append(record)
        return record

    @staticmethod
    def _make_conflict_record(field: str, t: int,
                              reports: List[Tuple[str, Fraction]]) -> dict:
        entries = [{"source": src, "value": _num(val)} for src, val in reports]
        detail = "; ".join(f"来源 {src} 上报 {_num(val)}" for src, val in reports)
        return {
            "field": field,
            "time": t,
            "reports": entries,
            "message": (f"字段 {field} 在 t={t} 收到 {len(reports)} 条相互矛盾的上报,"
                        f"已全部保留: {detail};该字段在该时刻按缺失(冲突)处理,"
                        f"不会静默选用任何一方"),
        }

    # ------------------------------------------------------------------
    # 内部:切换归因
    # ------------------------------------------------------------------

    def _attribute(self, t: int, prev: Optional[SpecVersion],
                   ver: SpecVersion) -> List[dict]:
        """把切换前后的取值差异归因到具体依赖:新增 / 移除 / 保留及各自数值。"""
        old_refs = refs(prev.ast) if prev else []
        new_refs = refs(ver.ast)
        ordered = list(old_refs) + [n for n in new_refs if n not in old_refs]
        out = []
        for name in ordered:
            if name in self._metrics:
                r = self.query(name, t)
                kind = "metric"
            else:
                r = self._compute_field(name, t)
                kind = "field"
            if name in old_refs and name in new_refs:
                status = "retained"
            elif name in new_refs:
                status = "added"
            else:
                status = "removed"
            out.append({
                "dependency": name,
                "kind": kind,
                "status": status,
                "value_at_switch": _num(r.value),
                "missing": [m.to_dict() for m in r.missing],
            })
        return out

    @staticmethod
    def _value_gap(a: EvalResult, b: EvalResult) -> Optional[str]:
        a_has, b_has = a.value is not None, b.value is not None
        if a_has and b_has:
            return "value_jump" if a.value != b.value else None
        if a_has != b_has:
            return "appears" if b_has else "vanishes"
        return None
