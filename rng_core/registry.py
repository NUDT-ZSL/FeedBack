"""实验登记处：多来源共存、冲突留痕与稳定查询。

同一实验可能由不同来源（本地配置、A 团队、B 团队……）给出。本模块**永不静默
择一**：

* 内容全部一致       → 多来源都保留，登记返回 'consistent'；
* 与任一方不一致     → 各方全部保留，同时为该实验维护一条累积式可读冲突记录，
                       写清实验、种子（若适用）、全部来源与各自内容；此后访问该
                       实验必须显式指定 ``source=``，否则抛出
                       :class:`AmbiguousReferenceError` 并列出全部候选。

结果以 (实验, 种子) 为键按来源保存，用引擎指纹判定是否一致。
所有列表类查询都按 id / 种子 / 步骤序号做稳定排序。
"""

from __future__ import annotations

import dataclasses
import hashlib
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .batch import BatchReport, BatchRunner, EstimatorSpec
from .engine import Engine, RunResult, canonical_json
from .handlers import build_default_registry
from .models import ExperimentSpec, spec_to_wire


# --------------------------------------------------------------------------- #
# 数据结构
# --------------------------------------------------------------------------- #

@dataclasses.dataclass
class ConflictRecord:
    conflict_id: str
    kind: str                    # config | result | report
    experiment_id: str
    sources: List[str]
    message: str
    contents: Dict[str, Any]     # source -> 该方内容快照
    seed: Optional[int] = None
    subject: str = ""            # 结果冲突时的估计量/批次标识

    def to_dict(self) -> Dict[str, Any]:
        return dataclasses.asdict(self)

    def render(self) -> str:
        head = (f"冲突 [{self.conflict_id}] 类型={self.kind} "
                f"实验={self.experiment_id}"
                + (f" 种子={self.seed}" if self.seed is not None else "")
                + (f" 对象={self.subject}" if self.subject else ""))
        lines = [head,
                 f"  来源：{', '.join(self.sources)}",
                 f"  说明：{self.message}",
                 "  各方内容："]
        for src in sorted(self.contents):
            body = canonical_json(self.contents[src])
            if len(body) > 2000:
                body = body[:2000] + f"...（截断，完整长度 {len(body)}）"
            lines.append(f"    - [{src}] {body}")
        return "\n".join(lines)


class AmbiguousReferenceError(Exception):
    """存在互相矛盾的多个来源、且调用方未显式指定 source。"""

    def __init__(self, kind: str, eid: str, sources: Sequence[str],
                 conflict_id: str, seed: Optional[int] = None):
        self.kind = kind
        self.eid = eid
        self.sources = sorted(sources)
        self.conflict_id = conflict_id
        self.seed = seed
        where = eid + (f"（种子 {seed}）" if seed is not None else "")
        super().__init__(
            f"{kind} {where} 存在互相矛盾的来源 {self.sources}"
            f"（冲突 {conflict_id}）；各方内容均已保留，"
            "请用 source= 显式指定，或查看 conflicts()")


class UnknownExperimentError(KeyError):
    pass


def _hash_id(*parts: Any) -> str:
    return hashlib.sha256(
        "|".join(p if isinstance(p, str) else canonical_json(p)
                 for p in parts).encode("utf-8")).hexdigest()[:12]


def _result_snapshot(run: RunResult) -> Dict[str, Any]:
    return {
        "experiment_id": run.experiment_id,
        "seed": run.seed,
        "status": run.status,
        "params": run.params,
        "fingerprint": run.fingerprint,
        "steps": [
            {
                "index": s.index, "id": s.sid, "handler": s.handler,
                "status": s.status,
                "attempts": [{"attempt": a.attempt, "status": a.status,
                              "category": a.category, "message": a.message}
                             for a in s.attempts],
                "declared_draws": s.declared_draws,
                "consumed_draws": s.consumed_draws,
                "blocks_read": s.blocks_read,
                "replayed_attempts": s.replayed_attempts,
                "output": s.output,
            }
            for s in sorted(run.steps, key=lambda s: s.index)
        ],
    }


# --------------------------------------------------------------------------- #
# 登记处
# --------------------------------------------------------------------------- #

class Registry:
    LOCAL_SOURCE = "local"

    def __init__(self, handler_registry=None):
        self.handlers = handler_registry or build_default_registry()
        self.engine = Engine(self.handlers)
        self.batch_runner = BatchRunner(self.engine)
        # eid -> {source: spec}
        self._experiments: Dict[str, Dict[str, ExperimentSpec]] = {}
        # (eid, seed) -> {source: RunResult}
        self._results: Dict[Tuple[str, int], Dict[str, RunResult]] = {}
        # (eid, 估计量名元组) -> {source: BatchReport}
        self._reports: Dict[Tuple[str, Tuple[str, ...]],
                            Dict[str, BatchReport]] = {}
        # 每个实验/结果对象一条累积式冲突记录
        self._config_conflict: Dict[str, ConflictRecord] = {}
        self._result_conflict: Dict[Tuple[str, int], ConflictRecord] = {}
        self._report_conflict: Dict[Tuple[str, Tuple[str, ...]], ConflictRecord] = {}
        # 实验运行时实际使用的参数取值（默认值展开后的完整集合，供持久化）
        self._param_values: Dict[str, Dict[str, Any]] = {}

    # ---- 配置注册 -------------------------------------------------------- #

    def register_experiment(self, spec: ExperimentSpec,
                            wire: Optional[Dict[str, Any]] = None) -> str:
        """登记实验配置。返回 'new' | 'consistent' | 'conflict'。

        wire 为该配置的原始 JSON 形态（由持久化层提供），用于冲突时展示
        "各自内容"；缺省时用数据类快照。
        """
        bucket = self._experiments.setdefault(spec.eid, {})
        is_first = not bucket
        snapshot = wire if wire is not None else spec_to_wire(spec)
        same = [dataclasses.replace(spec, source="") ==
                dataclasses.replace(existing, source="")
                for existing in bucket.values()]
        bucket[spec.source] = spec

        if is_first:
            return "new"
        if same and all(same):
            return "consistent"

        rec = self._config_conflict.get(spec.eid)
        if rec is None:
            rec = ConflictRecord(
                conflict_id=_hash_id("config", spec.eid),
                kind="config", experiment_id=spec.eid,
                sources=sorted(bucket),
                message=(
                    f"实验 {spec.eid!r} 的配置在多个来源之间不一致，"
                    "各方内容均已保留，访问该实验必须显式指定 source"),
                contents={src: spec_to_wire(s) for src, s in bucket.items()},
            )
            self._config_conflict[spec.eid] = rec
        rec.sources = sorted(set(rec.sources) | {spec.source})
        rec.contents[spec.source] = snapshot
        return "conflict"

    def experiment_ids(self) -> List[str]:
        return sorted(self._experiments)

    def sources_for(self, eid: str) -> List[str]:
        self._require(eid)
        return sorted(self._experiments[eid])

    def has_conflict(self, eid: str) -> bool:
        return eid in self._config_conflict or any(
            c.experiment_id == eid for c in
            list(self._result_conflict.values()) +
            list(self._report_conflict.values()))

    def get_experiment(self, eid: str,
                       source: Optional[str] = None) -> ExperimentSpec:
        self._require(eid)
        bucket = self._experiments[eid]
        if source is not None:
            if source not in bucket:
                raise UnknownExperimentError(
                    f"实验 {eid!r} 没有来源 {source!r}，可用：{sorted(bucket)}")
            return bucket[source]
        if eid in self._config_conflict:
            raise AmbiguousReferenceError(
                "实验配置", eid, list(bucket),
                self._config_conflict[eid].conflict_id)
        # 无冲突时各方内容一致，取排序稳定的一个。
        return bucket[sorted(bucket)[0]]

    # ---- 运行与结果登记 -------------------------------------------------- #

    def run(self, eid: str, seed: Optional[int] = None,
            param_values: Optional[Dict[str, Any]] = None, *,
            source: str = LOCAL_SOURCE, spec_source: Optional[str] = None,
            parallel: bool = False, store: bool = True) -> RunResult:
        spec = self.get_experiment(eid, spec_source)
        if seed is None:
            seed = spec.seed_policy.seeds(spec.eid)[0]
        resolved = self.engine._resolve_experiment_params(spec, param_values or {})
        self._param_values[eid] = resolved
        result = self.engine.run(spec, seed, param_values, parallel=parallel)
        if store:
            self.store_result(result, source)
        return result

    def run_policy(self, eid: str, param_values: Optional[Dict[str, Any]] = None,
                   *, source: str = LOCAL_SOURCE, spec_source: Optional[str] = None,
                   parallel: bool = False) -> List[RunResult]:
        spec = self.get_experiment(eid, spec_source)
        return [
            self.run(eid, seed, param_values, source=source,
                     spec_source=spec_source, parallel=parallel)
            for seed in spec.seed_policy.seeds(spec.eid)
        ]

    def run_batch(self, eid: str,
                  estimators: Sequence[Tuple[str, str, str]],
                  param_values: Optional[Dict[str, Any]] = None, *,
                  source: str = LOCAL_SOURCE, spec_source: Optional[str] = None,
                  parallel: bool = False, parallel_seeds: bool = False,
                  confidence_level: float = 0.95,
                  store_report: bool = True) -> BatchReport:
        spec = self.get_experiment(eid, spec_source)
        ests = [EstimatorSpec(name=n, step_id=s, field=f) for n, s, f in estimators]
        seeds = spec.seed_policy.seeds(spec.eid)
        resolved = self.engine._resolve_experiment_params(spec, param_values or {})
        self._param_values[eid] = resolved
        report = self.batch_runner.run_batch(
            spec, seeds, ests, param_values,
            confidence_level=confidence_level,
            parallel_seeds=parallel_seeds)
        # 批次内每次运行都是一次确定的执行，按同一来源补登结果，不重复计算。
        for seed, run in report.runs.items():
            self.store_result(run, source)
        if store_report:
            self.store_report(report, source)
        return report

    def store_result(self, result: RunResult, source: str) -> str:
        """登记运行结果（本地执行或外部来源提交皆可）。

        同来源重复提交但指纹不同，不允许覆盖旧值：自动分配 ``来源#v2`` 之类的
        新标签并照样作为冲突保留。返回 'new' | 'consistent' | 'conflict'。
        """
        key = (result.experiment_id, result.seed)
        bucket = self._results.setdefault(key, {})

        label, suffix = source, 2
        while label in bucket and bucket[label].fingerprint != result.fingerprint:
            label = f"{source}#v{suffix}"
            suffix += 1
        if label in bucket:  # 指纹相同
            return "consistent"

        equal_parties = [r.fingerprint == result.fingerprint for r in bucket.values()]
        bucket[label] = result
        if equal_parties and all(equal_parties):
            return "consistent"
        if not equal_parties:
            return "new"

        rec = self._result_conflict.get(key)
        if rec is None:
            rec = ConflictRecord(
                conflict_id=_hash_id("result", key[0], str(key[1])),
                kind="result", experiment_id=key[0], seed=key[1],
                sources=sorted(bucket),
                message=(
                    f"实验 {key[0]!r} 在种子 {key[1]} 下不同来源给出了不同结果，"
                    "各方结果均已保留，查询必须显式指定 source"),
                contents={src: _result_snapshot(r) for src, r in bucket.items()},
            )
            self._result_conflict[key] = rec
        rec.sources = sorted(set(rec.sources) | {label})
        rec.contents[label] = _result_snapshot(result)
        return "conflict"

    def store_report(self, report: BatchReport, source: str) -> str:
        key = (report.experiment_id,
               tuple(s.estimator for s in report.summaries))
        bucket = self._reports.setdefault(key, {})
        if source in bucket and canonical_json(bucket[source].to_dict()) == \
                canonical_json(report.to_dict()):
            return "consistent"
        equal = [canonical_json(r.to_dict()) == canonical_json(report.to_dict())
                 for r in bucket.values()]
        bucket[source] = report
        if not equal:
            return "new"
        if all(equal):
            return "consistent"

        rec = self._report_conflict.get(key)
        if rec is None:
            rec = ConflictRecord(
                conflict_id=_hash_id("report", key[0], key[1]),
                kind="report", experiment_id=key[0],
                subject=",".join(key[1]), sources=sorted(bucket),
                message=(
                    f"实验 {key[0]!r} 的批量汇总（{','.join(key[1])}）在来源间"
                    "不一致，双方均已保留"),
                contents={src: r.to_dict() for src, r in bucket.items()},
            )
            self._report_conflict[key] = rec
        rec.sources = sorted(set(rec.sources) | {source})
        rec.contents[source] = report.to_dict()
        return "conflict"

    # ---- 查询（全部稳定顺序）-------------------------------------------- #

    def get_result(self, eid: str, seed: int,
                   source: Optional[str] = None) -> RunResult:
        key = (eid, seed)
        if key not in self._results:
            raise UnknownExperimentError(f"没有实验 {eid!r} 种子 {seed} 的运行结果")
        bucket = self._results[key]
        if source is not None:
            if source not in bucket:
                raise UnknownExperimentError(
                    f"结果 {eid}/{seed} 没有来源 {source!r}，可用：{sorted(bucket)}")
            return bucket[source]
        if key in self._result_conflict:
            raise AmbiguousReferenceError(
                "运行结果", eid, list(bucket),
                self._result_conflict[key].conflict_id, seed)
        return bucket[sorted(bucket)[0]]

    def list_seeds(self, eid: str) -> List[int]:
        """已有运行结果的种子，升序稳定返回。"""
        self._require(eid)
        return sorted(seed for (x, seed) in self._results if x == eid)

    def seed_info(self, eid: str, source: Optional[str] = None) -> Dict[str, Any]:
        """所用种子全貌：策略种子、已执行种子、已有结果的种子。"""
        spec = self.get_experiment(eid, source)
        return {
            "experiment_id": eid,
            "policy_seeds": spec.seed_policy.seeds(eid),
            "executed_seeds": self.list_seeds(eid),
        }

    def list_results(self, eid: str) -> List[Tuple[int, str, str]]:
        """返回按种子、来源排序的 (seed, source, status)。"""
        self._require(eid)
        return sorted(
            (seed, source, run.status)
            for (x, seed), bucket in self._results.items() if x == eid
            for source, run in bucket.items())

    def consumed_draws(self, eid: str, seed: int,
                       source: Optional[str] = None) -> List[Dict[str, Any]]:
        """各步骤声明/实际消耗的随机量、读取块数、流键与重播次数。"""
        run = self.get_result(eid, seed, source)
        return [
            {
                "step_index": s.index,
                "step_id": s.sid,
                "handler": s.handler,
                "declared": dict(sorted(s.declared_draws.items())),
                "consumed": dict(sorted(s.consumed_draws.items())),
                "blocks_read": dict(sorted(s.blocks_read.items())),
                "replayed_attempts": s.replayed_attempts,
                "stream_keys": list(s.stream_keys),
            }
            for s in sorted(run.steps, key=lambda s: s.index)
        ]

    def confidence_interval(self, eid: str, estimator: str,
                            source: Optional[str] = None) -> Dict[str, Any]:
        report = self._get_report(eid, estimator, source)
        summary = next(s for s in report.summaries if s.estimator == estimator)
        return {
            "experiment_id": eid,
            "estimator": estimator,
            "n": summary.n,
            "mean": summary.mean,
            "variance": summary.variance,
            "std_error": summary.std_error,
            "confidence_level": summary.confidence_level,
            "ci_low": summary.ci_low,
            "ci_high": summary.ci_high,
            "seeds": list(report.seeds),
        }

    def explain_outlier(self, eid: str, estimator: str, seed: int,
                        source: Optional[str] = None) -> Dict[str, Any]:
        report = self._get_report(eid, estimator, source)
        summary = next(s for s in report.summaries if s.estimator == estimator)
        row = next((r for r in summary.rows if r.seed == seed), None)
        if row is None:
            raise UnknownExperimentError(
                f"估计量 {estimator!r} 下没有种子 {seed} 的记录")
        return {
            "experiment_id": eid, "estimator": estimator, "seed": seed,
            "status": row.status, "value": row.value,
            "is_outlier": row.is_outlier,
            "robust_z": row.robust_z, "classic_z": row.classic_z,
            "reason": row.reason,
        }

    def outliers(self, eid: str, estimator: str,
                 source: Optional[str] = None) -> List[Dict[str, Any]]:
        report = self._get_report(eid, estimator, source)
        summary = next(s for s in report.summaries if s.estimator == estimator)
        return [
            {"seed": r.seed, "value": r.value, "robust_z": r.robust_z,
             "classic_z": r.classic_z, "reason": r.reason}
            for r in sorted(summary.rows, key=lambda r: r.seed)
            if r.is_outlier
        ]

    def get_report(self, eid: str, source: Optional[str] = None) -> BatchReport:
        """获取该实验的批量汇总（估计量集合按登记顺序唯一定位）。"""
        keys = sorted({k for k in self._reports if k[0] == eid},
                      key=lambda k: k[1])
        if not keys:
            raise UnknownExperimentError(f"没有实验 {eid!r} 的批量汇总")
        if len(keys) > 1:
            raise AmbiguousReferenceError(
                "批量汇总", eid,
                sorted({s for k in keys for s in self._reports[k]}),
                "multi-batch")
        return self._get_report(eid, keys[0][1][0], source)

    def conflicts(self, eid: Optional[str] = None) -> List[ConflictRecord]:
        recs: List[ConflictRecord] = list(self._config_conflict.values()) \
            + list(self._result_conflict.values()) \
            + list(self._report_conflict.values())
        if eid is not None:
            recs = [c for c in recs if c.experiment_id == eid]
        return sorted(recs, key=lambda c: (c.experiment_id, c.kind,
                                           c.seed if c.seed is not None else -1,
                                           c.conflict_id))

    # ---- 内部 ------------------------------------------------------------ #

    def _get_report(self, eid: str, estimator: str,
                    source: Optional[str]) -> BatchReport:
        candidates = [(key, bucket) for key, bucket in self._reports.items()
                      if key[0] == eid and estimator in key[1]]
        if not candidates:
            raise UnknownExperimentError(
                f"没有实验 {eid!r} 估计量 {estimator!r} 的批量汇总")
        _key, bucket = candidates[0]
        if source is not None:
            if source not in bucket:
                raise UnknownExperimentError(f"汇总没有来源 {source!r}")
            return bucket[source]
        distinct = {canonical_json(r.to_dict()) for r in bucket.values()}
        if len(distinct) > 1:
            cid = next((c.conflict_id for c in self.conflicts(eid)
                        if c.kind == "report"), None)
            raise AmbiguousReferenceError(
                "批量汇总", eid, list(bucket), cid or "unknown")
        return bucket[sorted(bucket)[0]]

    def _require(self, eid: str) -> None:
        if eid not in self._experiments:
            raise UnknownExperimentError(f"未知实验 {eid!r}")
