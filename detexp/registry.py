"""系统门面：实验注册、冲突留档、执行、批量分析、查询、保存/载入。"""

from __future__ import annotations

import copy
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .analysis import analyze_estimates, build_seed_list, runs_to_values
from .engine import Executor, fingerprint
from .errors import (
    ConflictPendingError,
    DetexpError,
    IntegrityError,
)
from .models import (
    BatchSummary,
    ConflictRecord,
    Experiment,
    RunRecord,
)
from .persistence import load_bundle, save_bundle
from .steps import REGISTRY

LOCAL_SOURCE = "local"
RESULT_TOL = 1e-12


def _results_close(a: Optional[float], b: Optional[float]) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if math.isnan(a) or math.isnan(b):
        return False
    scale = max(1.0, abs(a), abs(b))
    return abs(a - b) <= RESULT_TOL * scale


class ExperimentSystem:
    """所有 API 的入口。除显式执行外，方法均为确定性纯内存操作。"""

    def __init__(self, executor: Optional[Executor] = None):
        self._experiments: Dict[str, Experiment] = {}
        self._variants: Dict[str, Dict[str, Experiment]] = {}
        self._runs: Dict[Tuple[str, int], RunRecord] = {}
        self._claims: Dict[Tuple[str, int, str], Dict[str, Any]] = {}
        self._summaries: Dict[str, BatchSummary] = {}
        self._conflicts: List[ConflictRecord] = []
        self._active_fp: Dict[str, str] = {}
        self._executor = executor or Executor()

    # ==================================================================
    # 1) 实验注册与配置冲突
    # ==================================================================
    def register_experiment(self, experiment: Experiment,
                            source: str = LOCAL_SOURCE) -> str:
        """登记实验。

        返回 ``registered`` / ``unchanged`` / ``conflict``。
        矛盾配置绝不静默覆盖：双方配置都会保留并产生 open 冲突。
        """
        if not source or not isinstance(source, str):
            raise ValueError("source 必须是非空字符串")
        experiment.validate(fn_names=list(REGISTRY))
        experiment.source = source
        new_fp = fingerprint(experiment.config_dict())
        eid = experiment.experiment_id

        if eid not in self._experiments:
            experiment.source = source
            self._experiments[eid] = experiment
            self._variants[eid] = {}
            self._active_fp[eid] = new_fp
            return "registered"

        configs = self._all_configs(eid)
        if any(fp == new_fp for fp, _ in configs):
            return "unchanged"  # 与已保留的某一方完全一致

        # 与已保留的每一份不同配置都产生一条冲突（含同一来源的旧配置）
        variants = self._variants.setdefault(eid, {})
        made_conflict = False
        canonical = self._experiments[eid]
        existing: List[Tuple[str, Experiment]] = [
            (canonical.source, canonical)]
        for other_source, other in variants.items():
            if other_source == canonical.source:
                continue
            existing.append((other_source, other))
        old_same = variants.get(source)
        if old_same is not None:
            existing.append((source, old_same))
        for other_source, other in existing:
            if fingerprint(other.config_dict()) == new_fp:
                continue
            same = other_source == source
            self._record_config_conflict(
                eid, other_source, other, source, experiment,
                same_source=same)
            made_conflict = True
        variants[source] = copy.deepcopy(experiment)
        return "conflict" if made_conflict else "unchanged"

    def _all_configs(self, eid: str) -> List[Tuple[str, Experiment]]:
        out: List[Tuple[str, Experiment]] = []
        canonical = self._experiments[eid]
        out.append((fingerprint(canonical.config_dict()), canonical))
        for src, exp in self._variants.get(eid, {}).items():
            out.append((fingerprint(exp.config_dict()), exp))
        return out

    def _config_by_fp(self, eid: str) -> Dict[str, Experiment]:
        return {fp: exp for fp, exp in self._all_configs(eid)}

    def _record_config_conflict(self, eid: str, sa: str, exp_a: Experiment,
                                sb: str, exp_b: Experiment,
                                same_source: bool = False) -> ConflictRecord:
        fp_a = fingerprint(exp_a.config_dict())
        fp_b = fingerprint(exp_b.config_dict())
        detail = self._config_diff_detail(eid, sa, exp_a, sb, exp_b,
                                          same_source)
        cid = self._next_conflict_id()
        rec = ConflictRecord(
            conflict_id=cid, experiment_id=eid, kind="config",
            source_a=sa, source_b=sb,
            content_a={"source": sa, "fingerprint": fp_a,
                       "experiment": exp_a.to_dict()},
            content_b={"source": sb, "fingerprint": fp_b,
                       "experiment": exp_b.to_dict()},
            detail=detail, seq=len(self._conflicts))
        self._conflicts.append(rec)
        return rec

    @staticmethod
    def _config_diff_detail(eid: str, sa: str, a: Experiment, sb: str,
                            b: Experiment, same_source: bool) -> str:
        diffs: List[str] = []
        if a.default_retries != b.default_retries:
            diffs.append(f"default_retries: {a.default_retries} vs "
                         f"{b.default_retries}")
        if a.seed_policy != b.seed_policy:
            diffs.append(f"seed_policy: {a.seed_policy} vs {b.seed_policy}")
        va, vb = a.values, b.values
        for k in sorted(set(va) | set(vb)):
            if va.get(k) != vb.get(k):
                diffs.append(f"参数 {k!r}: {va.get(k)!r} vs {vb.get(k)!r}")
        sa_steps = [s.to_dict() for s in a.steps]
        sb_steps = [s.to_dict() for s in b.steps]
        if sa_steps != sb_steps:
            diffs.append(
                f"步骤定义不同：{len(a.steps)} 个 vs {len(b.steps)} 个"
                f"（A 顺序 {[s.step_id for s in a.steps]}，"
                f"B 顺序 {[s.step_id for s in b.steps]}）")
            by_id_a = {s.step_id: s for s in a.steps}
            for sb_step in b.steps:
                sa_step = by_id_a.get(sb_step.step_id)
                if sa_step is None:
                    diffs.append(f"步骤 {sb_step.step_id!r} 仅 B 中存在")
                    continue
                if sa_step.params != sb_step.params:
                    diffs.append(
                        f"步骤 {sb_step.step_id!r} 参数不同："
                        f"{sa_step.params} vs {sb_step.params}")
                if sa_step.slices != sb_step.slices:
                    sa_desc = [(sl.kind, sl.count, sl.draw_params)
                               for sl in sa_step.slices]
                    sb_desc = [(sl.kind, sl.count, sl.draw_params)
                               for sl in sb_step.slices]
                    diffs.append(
                        f"步骤 {sb_step.step_id!r} 随机量声明不同："
                        f"{sa_desc} vs {sb_desc}")
                if sa_step.fn != sb_step.fn:
                    diffs.append(
                        f"步骤 {sb_step.step_id!r} 计算函数不同："
                        f"{sa_step.fn!r} vs {sb_step.fn!r}")
        who = "同一来源先后给出" if same_source else "两个不同来源给出"
        return (f"实验 {eid!r} 存在互相矛盾的配置：{who} "
                f"{sa!r} 与 {sb!r}。差异："
                + ("；".join(diffs) if diffs else "配置内容不同")
                + "。双方配置均已保留，未做选择。")

    # ==================================================================
    # 冲突裁决
    # ==================================================================
    def list_conflicts(self, experiment_id: Optional[str] = None,
                       status: Optional[str] = None,
                       kind: Optional[str] = None) -> List[ConflictRecord]:
        out = [c for c in self._conflicts
               if (experiment_id is None or c.experiment_id == experiment_id)
               and (status is None or c.status == status)
               and (kind is None or c.kind == kind)]
        return sorted(out, key=lambda c: (c.experiment_id, c.seq))

    def get_conflict(self, conflict_id: str) -> ConflictRecord:
        for c in self._conflicts:
            if c.conflict_id == conflict_id:
                return c
        raise KeyError(f"冲突 {conflict_id!r} 不存在")

    def open_conflicts(self, eid: str, kind: Optional[str] = None
                       ) -> List[ConflictRecord]:
        return [c for c in self._conflicts
                if c.experiment_id == eid and c.status == "open"
                and (kind is None or c.kind == kind)]

    def resolve_conflict(self, conflict_id: str, winner: str) -> ConflictRecord:
        """裁决冲突，winner 为 ``"a"`` 或 ``"b"``；双方内容仍保留。"""
        if winner not in ("a", "b"):
            raise ValueError("winner 必须是 'a' 或 'b'")
        c = self.get_conflict(conflict_id)
        if c.status != "open":
            raise DetexpError(f"冲突 {conflict_id} 已裁决（{c.status}）")
        chosen = c.content_a if winner == "a" else c.content_b
        c.status = "resolved_a" if winner == "a" else "resolved_b"
        c.resolution = (
            f"winner={winner};source={chosen['source']};"
            f"fingerprint={chosen['fingerprint']}")
        if c.kind == "config":
            self._active_fp[c.experiment_id] = chosen["fingerprint"]
        return c

    def reject_conflict(self, conflict_id: str,
                        reason: str = "") -> ConflictRecord:
        """驳回冲突（声明双方差异可忽略），不选择任何一方。"""
        c = self.get_conflict(conflict_id)
        if c.status != "open":
            raise DetexpError(f"冲突 {conflict_id} 已裁决（{c.status}）")
        c.status = "rejected"
        c.resolution = f"rejected:{reason}" if reason else "rejected"
        return c

    # ==================================================================
    # 2/3/5) 执行：顺序无关、重试复用随机流
    # ==================================================================
    def active_experiment(self, eid: str, *, allow_open: bool = False
                          ) -> Experiment:
        if eid not in self._experiments:
            raise KeyError(f"实验 {eid!r} 未注册")
        open_cfg = self.open_conflicts(eid, kind="config")
        if open_cfg and not allow_open:
            raise ConflictPendingError(eid, [c.conflict_id
                                             for c in open_cfg])
        fp = self._active_fp.get(eid)
        cfgs = self._config_by_fp(eid)
        if fp is not None and fp in cfgs:
            return cfgs[fp]
        return self._experiments[eid]

    def run(self, eid: str, seed: Any = None,
            scheduling: str = "sequential",
            *, check_reproducibility: bool = True) -> RunRecord:
        exp = self.active_experiment(eid)
        rec = self._executor.run(exp, seed=seed, scheduling=scheduling)
        key = (eid, rec.seed)
        prev = self._runs.get(key)
        if prev is not None:
            rec.reproduced = (prev.result_fingerprint
                              == rec.result_fingerprint)
            if check_reproducibility and prev.status == "ok" \
                    and rec.status == "ok" and not rec.reproduced:
                raise DetexpError(
                    f"确定性自检失败：实验 {eid!r} 种子 {rec.seed} 重复执行"
                    f"结果不同（{prev.result_fingerprint[:12]} vs "
                    f"{rec.result_fingerprint[:12]}）")
        self._runs[key] = rec
        return rec

    def verify_scheduling_invariance(self, eid: str, seed: Any = None
                                     ) -> Dict[str, Any]:
        """顺序/并行/逆序三种调度各跑一遍并逐字节比对（不落库）。"""
        exp = self.active_experiment(eid)
        return self._executor.reproducibility_check(exp, seed=seed)

    # ==================================================================
    # 4) 多种子批量
    # ==================================================================
    def batch_run(self, eid: str, seeds: Optional[Sequence[int]] = None,
                  ci_level: float = 0.95,
                  scheduling: str = "sequential") -> BatchSummary:
        if not 0.0 < ci_level < 1.0:
            raise ValueError("ci_level 必须在 (0,1) 内")
        exp = self.active_experiment(eid)
        seed_list = build_seed_list(exp, seeds)
        runs = [self._executor.run(exp, seed=s, scheduling=scheduling)
                for s in seed_list]
        failed = [r for r in runs if r.status != "ok"]
        if failed:
            raise DetexpError(
                "批量运行中存在失败种子: "
                + ", ".join(f"{r.seed}({r.error})" for r in failed))
        for r in runs:
            self._runs[(eid, r.seed)] = r
        values = runs_to_values(runs)
        summary = analyze_estimates(eid, seed_list, values, ci_level)
        self._summaries[eid] = summary
        return summary

    def get_batch_summary(self, eid: str) -> Optional[BatchSummary]:
        return self._summaries.get(eid)

    # ==================================================================
    # 6) 外部结果声明与结果冲突
    # ==================================================================
    def submit_result(self, eid: str, seed: int, source: str,
                      status: str = "ok", estimate: Optional[float] = None,
                      detail: Optional[str] = None) -> str:
        if eid not in self._experiments:
            raise KeyError(f"实验 {eid!r} 未注册")
        if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
            raise ValueError("seed 必须是非负整数")
        if not source or source == LOCAL_SOURCE:
            raise ValueError(f"外部来源不能使用保留名称 {LOCAL_SOURCE!r}")
        if status not in ("ok", "failed"):
            raise ValueError("status 必须是 ok/failed")
        claim = {"experiment_id": eid, "seed": seed, "source": source,
                 "status": status, "estimate": estimate, "detail": detail}
        key = (eid, seed, source)

        old = self._claims.get(key)
        if old is not None:
            if old["status"] == status and _results_close(
                    old["estimate"], estimate):
                return "unchanged"
            self._record_result_conflict(
                eid, seed,
                f"{source}（先前声明）", old,
                f"{source}（最新声明）", claim, same_source=True)

        local = self._runs.get((eid, seed))
        if local is not None:
            self._compare_external_with_local(eid, seed, source, claim, local)
        for other_key, other in self._claims.items():
            if other_key[0] != eid or other_key[1] != seed \
                    or other_key[2] == source:
                continue
            if other["status"] != status or not _results_close(
                    other["estimate"], estimate):
                self._record_result_conflict(
                    eid, seed, other["source"], other, source, claim)
        self._claims[key] = claim
        return "recorded"

    def _compare_external_with_local(self, eid: str, seed: int,
                                     source: str, claim: Dict[str, Any],
                                     local: RunRecord) -> None:
        if claim["status"] != local.status:
            self._record_result_conflict(
                eid, seed, LOCAL_SOURCE,
                self._run_as_claim(local), source, claim)
            return
        if local.status == "ok" and not _results_close(
                local.estimate if isinstance(local.estimate, (int, float))
                else None, claim["estimate"]):
            self._record_result_conflict(
                eid, seed, LOCAL_SOURCE,
                self._run_as_claim(local), source, claim)

    @staticmethod
    def _run_as_claim(run: RunRecord) -> Dict[str, Any]:
        return {"experiment_id": run.experiment_id, "seed": run.seed,
                "source": LOCAL_SOURCE, "status": run.status,
                "estimate": run.estimate,
                "detail": f"本地 {run.scheduling} 运行，指纹 "
                          f"{run.result_fingerprint[:12]}"}

    def _record_result_conflict(self, eid: str, seed: int,
                                sa: str, a: Dict[str, Any],
                                sb: str, b: Dict[str, Any],
                                same_source: bool = False) -> ConflictRecord:
        existing = self._find_open_result_conflict(eid, seed, sa, sb)
        if existing is not None:
            # 同一对来源在同一种子下已有未裁决冲突：更新双方最新内容，
            # 不再新增重复记录。
            existing.content_a, existing.content_b = dict(a), dict(b)
            return existing
        who = "同一来源先后给出" if same_source else "两个来源给出"
        detail = (
            f"实验 {eid!r} 在种子 {seed} 下存在互相矛盾的结果：{who} "
            f"{sa!r} 与 {sb!r}。"
            f"{sa!r} 称 status={a.get('status')}, estimate={a.get('estimate')}；"
            f"{sb!r} 称 status={b.get('status')}, estimate={b.get('estimate')}。"
            f"双方结果均已保留，未静默择一。")
        cid = self._next_conflict_id()
        rec = ConflictRecord(
            conflict_id=cid, experiment_id=eid, kind="result",
            source_a=sa, source_b=sb, content_a=dict(a), content_b=dict(b),
            detail=detail, seq=len(self._conflicts))
        self._conflicts.append(rec)
        return rec

    def _find_open_result_conflict(self, eid: str, seed: int,
                                   sa: str, sb: str
                                   ) -> Optional[ConflictRecord]:
        base = lambda s: s.split("（", 1)[0]
        pair = {base(sa), base(sb)}
        for c in self._conflicts:
            if c.kind != "result" or c.status != "open" \
                    or c.experiment_id != eid:
                continue
            seeds = {c.content_a.get("seed"), c.content_b.get("seed")}
            if seed in seeds and {base(c.source_a),
                                 base(c.source_b)} == pair:
                return c
        return None

    def _next_conflict_id(self) -> str:
        return f"C{len(self._conflicts) + 1:04d}"

    # ==================================================================
    # 7) 查询（全部稳定顺序）
    # ==================================================================
    def list_experiment_ids(self) -> List[str]:
        return sorted(self._experiments)

    def get_result(self, eid: str, seed: Optional[int] = None) -> Dict[str, Any]:
        """返回当前结果；有多种子时按种子升序。结果冲突一并列出。"""
        if eid not in self._experiments:
            raise KeyError(f"实验 {eid!r} 未注册")
        keys = sorted(k for k in self._runs if k[0] == eid)
        if seed is not None:
            keys = [k for k in keys if k[1] == seed]
            if not keys:
                raise KeyError(f"实验 {eid!r} 种子 {seed} 尚无运行记录")
        results = []
        for _, s in keys:
            r = self._runs[(eid, s)]
            results.append({
                "seed": s, "status": r.status, "estimate": r.estimate,
                "estimate_step": r.estimate_step,
                "scheduling": r.scheduling,
                "reproduced": r.reproduced,
                "attempts_total": r.attempts_total,
                "retries_total": r.retries_total,
                "steps": [{"order": sr.order, "step_id": sr.step_id,
                           "fn": sr.fn, "status": sr.status,
                           "result": sr.result,
                           "attempts": len(sr.attempts)}
                          for sr in sorted(r.step_records,
                                          key=lambda x: x.order)],
            })
        return {
            "experiment_id": eid,
            "open_config_conflicts": [c.conflict_id
                                      for c in self.open_conflicts(
                                          eid, kind="config")],
            "open_result_conflicts": [c.conflict_id
                                      for c in self.open_conflicts(
                                          eid, kind="result")],
            "external_claims": [self._claims[k]
                                for k in sorted(self._claims)
                                if k[0] == eid],
            "runs": results,
        }

    def get_stream_usage(self, eid: str,
                         seed: Optional[int] = None) -> Dict[str, Any]:
        """每个种子下各步骤切片的声明量/消耗量（按步骤顺序）。"""
        exp = self.active_experiment(eid, allow_open=True)
        layout = exp.lay_out_stream()
        keys = sorted(k for k in self._runs if k[0] == eid)
        if seed is not None:
            keys = [k for k in keys if k[1] == seed]
        per_seed = []
        for _, s in keys:
            r = self._runs[(eid, s)]
            steps: Dict[str, List[Dict[str, Any]]] = {
                sr.step_id: [
                    {"slice_index": sl.slice_index, "kind": sl.kind,
                     "offset": sl.offset, "declared": sl.count,
                     "consumed": sl.consumed,
                     "balanced": sl.consumed == sl.count}
                    for sl in sorted(sr.slices, key=lambda x: x.slice_index)]
                for sr in r.step_records}
            declared_total = sum(l.count for l in layout)
            consumed_total = sum(sl.consumed for sr in r.step_records
                                 for sl in sr.slices)
            per_seed.append({
                "seed": s,
                "steps": [{"step_id": l.step_id,
                           "slices": steps.get(l.step_id, [])}
                          for l in self._dedent_layout(layout)],
                "declared_total": declared_total,
                "consumed_total": consumed_total,
                "conserved": all(
                    0 <= sl.consumed <= sl.count
                    for sr in r.step_records for sl in sr.slices),
            })
        return {"experiment_id": eid, "stream_id": eid,
                "total_declared": exp.total_draws(), "seeds": per_seed}

    @staticmethod
    def _dedent_layout(layout):
        seen = set()
        out = []
        for l in layout:
            if l.step_id not in seen:
                seen.add(l.step_id)
                out.append(l)
        return out

    def get_seeds(self, eid: str) -> List[int]:
        return sorted(s for (e, s) in self._runs if e == eid)

    def get_confidence_interval(self, eid: str) -> Optional[Dict[str, Any]]:
        bs = self._summaries.get(eid)
        if bs is None:
            return None
        return {"ci_level": bs.ci_level, "mean": bs.mean,
                "variance": bs.variance, "std": bs.std,
                "ci_low": bs.ci_low, "ci_high": bs.ci_high,
                "n_seeds": len(bs.seeds), "seeds": list(bs.seeds)}

    def get_outlier_reason(self, eid: str, seed: int) -> Optional[str]:
        bs = self._summaries.get(eid)
        if bs is None:
            return None
        for o in bs.outliers:
            if o.seed == seed:
                return o.reason
        return None

    def get_outliers(self, eid: str) -> List[Dict[str, Any]]:
        bs = self._summaries.get(eid)
        if bs is None:
            return []
        return [o.to_dict() for o in sorted(bs.outliers,
                                            key=lambda x: x.seed)]

    def query(self, eid: str) -> Dict[str, Any]:
        """一次性回答实验的结果、随机量消耗、种子、置信区间、偏离原因。"""
        exp = self.active_experiment(eid, allow_open=True)
        return {
            "experiment_id": eid,
            "source": exp.source,
            "seeds": self.get_seeds(eid),
            "result": self.get_result(eid),
            "stream_usage": self.get_stream_usage(eid),
            "confidence_interval": self.get_confidence_interval(eid),
            "outliers": self.get_outliers(eid),
            "conflicts": [c.to_dict()
                          for c in self.list_conflicts(eid)],
            "stream_layout": [l.to_dict() for l in exp.lay_out_stream()],
        }

    # ==================================================================
    # 8) 保存 / 载入
    # ==================================================================
    def to_payload(self) -> Dict[str, Any]:
        return {
            "experiments": [self._experiments[eid].to_dict()
                            for eid in sorted(self._experiments)],
            "variants": {
                eid: [{"source": src, "experiment": exp.to_dict()}
                      for src, exp in sorted(self._variants.get(eid, {}).items())]
                for eid in sorted(self._experiments)},
            "runs": [self._runs[k].to_dict()
                     for k in sorted(self._runs)],
            "result_claims": [self._claims[k]
                              for k in sorted(self._claims)],
            "batch_summaries": [self._summaries[eid].to_dict()
                                for eid in sorted(self._summaries)],
            "conflicts": [c.to_dict()
                          for c in sorted(self._conflicts,
                                          key=lambda x: (x.experiment_id,
                                                         x.seq))],
        }

    def save(self, path: str) -> None:
        save_bundle(path, self.to_payload())

    @classmethod
    def load(cls, path: str) -> "ExperimentSystem":
        """载入新系统。文件有任何问题都抛 IntegrityError。"""
        parsed = load_bundle(path)
        return cls._from_parsed(parsed)

    def load_into(self, path: str) -> None:
        """载入并替换当前系统状态；失败时当前状态保持不变。"""
        parsed = load_bundle(path)  # 全部校验通过后才执行下面的替换
        new = self._from_parsed(parsed)
        self.__dict__.update(new.__dict__)

    @classmethod
    def _from_parsed(cls, parsed: Dict[str, Any]) -> "ExperimentSystem":
        sys = cls()
        sys._experiments = dict(parsed["experiments"])
        sys._variants = {
            eid: {src: exp for src, exp in lst}
            for eid, lst in parsed["variants"].items()}
        sys._runs = {(r.experiment_id, r.seed): r for r in parsed["runs"]}
        sys._claims = {(c["experiment_id"], c["seed"], c["source"]): c
                       for c in parsed["claims"]}
        sys._summaries = {b.experiment_id: b for b in parsed["summaries"]}
        sys._conflicts = list(
            sorted(parsed["conflicts"], key=lambda x: (x.experiment_id,
                                                       x.seq)))
        for i, c in enumerate(sys._conflicts):
            c.seq = i
        # 恢复裁决后的活动配置
        sys._active_fp = {}
        for eid, exp in sys._experiments.items():
            sys._active_fp[eid] = fingerprint(exp.config_dict())
        for c in sys._conflicts:
            if c.kind == "config" and c.resolution:
                fp = c.resolution.split("fingerprint=", 1)[-1]
                sys._active_fp[c.experiment_id] = fp
        return sys
