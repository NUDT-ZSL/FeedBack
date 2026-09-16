"""执行引擎。

核心性质：每个步骤在全局随机流上的切片在运行前就已确定
（offset/count），:class:`~detexp.rng.RandomWindow` 硬性限制可读范围，
因此：

* 顺序、逆序、线程并行三种调度下，每个步骤看到的随机数完全相同；
* 失败重试重新从同一 offset 开一个新窗口，后续步骤的随机量原样保留；
* 任何步骤都不可能越界读到别的步骤的随机量。
"""

from __future__ import annotations

import hashlib
import json
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Sequence

from .errors import StreamExhaustedError
from .models import (
    Experiment,
    LaidSlice,
    RunRecord,
    StepRecord,
    SliceRecord,
    AttemptRecord,
)
from .rng import DeterministicStream, RandomWindow, normalize_seed
from .steps import StepFail, StepContext, get_step_fn

SAMPLE_DRAWS_KEPT = 3
SCHEDULING_MODES = ("sequential", "parallel", "reverse")


def canonical_json(obj: Any) -> str:
    """稳定 JSON 序列化：键排序、无空白、非 ASCII 不转义。"""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False)


def fingerprint(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def _extract_estimate(last_result: Any) -> Any:
    if isinstance(last_result, dict) and "estimate" in last_result:
        return last_result["estimate"]
    if isinstance(last_result, bool):
        return None
    if isinstance(last_result, (int, float)):
        return last_result
    return None


class Executor:
    """无状态执行器：所有状态都在返回的 :class:`RunRecord` 中。"""

    def __init__(self, max_workers: Optional[int] = None):
        self.max_workers = max_workers

    # ------------------------------------------------------------------
    def run(self, experiment: Experiment, seed: Any = None,
            scheduling: str = "sequential") -> RunRecord:
        if scheduling not in SCHEDULING_MODES:
            raise ValueError(
                f"未知调度方式 {scheduling!r}，允许 {SCHEDULING_MODES}")
        if seed is None:
            seed = experiment.policy_seed()
        seed_int = normalize_seed(seed)
        if seed_int is None:
            raise ValueError(
                f"实验 {experiment.experiment_id!r} 既未传入 seed，"
                f"种子策略也不是 fixed")

        layout = experiment.lay_out_stream()
        slices_by_step: Dict[str, List[LaidSlice]] = {
            s.step_id: [] for s in experiment.steps}
        for laid in layout:
            slices_by_step[laid.step_id].append(laid)

        stream = DeterministicStream(seed_int, experiment.experiment_id)
        ordered_steps = list(experiment.steps)
        schedule_order = ordered_steps
        if scheduling == "reverse":
            schedule_order = list(reversed(ordered_steps))

        def run_step(step) -> StepRecord:
            return self._run_step_with_retry(
                experiment, step, slices_by_step[step.step_id], stream,
                seed_int)

        if scheduling == "parallel" and len(schedule_order) > 1:
            with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
                indexed = list(pool.map(run_step, schedule_order))
            records_by_id = {r.step_id: r for r in indexed}
            records = [records_by_id[s.step_id] for s in ordered_steps]
        else:
            records = [None] * len(ordered_steps)  # type: ignore[list-item]
            index_by_id = {s.step_id: i
                           for i, s in enumerate(ordered_steps)}
            for step in schedule_order:
                rec = run_step(step)
                records[index_by_id[step.step_id]] = rec  # type: ignore

        for i, rec in enumerate(records):
            rec.order = i

        all_ok = all(r.status == "ok" for r in records)
        last_ok_result: Any = None
        estimate_step: Optional[str] = None
        for rec in records:
            if rec.status == "ok":
                last_ok_result = rec.result
                estimate_step = rec.step_id
        estimate = _extract_estimate(last_ok_result) if all_ok else None

        ordered_results = [
            {"step_id": r.step_id, "status": r.status, "result": r.result}
            for r in records]
        fp = fingerprint({"seed": seed_int, "results": ordered_results})

        # attempts 记录每一次尝试（成功步骤的最后一条 error=None）。
        attempts_total = sum(len(r.attempts) for r in records)
        retries_total = attempts_total - len(records)
        failed = next((r for r in records if r.status == "failed"), None)
        return RunRecord(
            experiment_id=experiment.experiment_id, seed=seed_int,
            status="ok" if all_ok else "failed", step_records=records,
            estimate=estimate, estimate_step=estimate_step,
            attempts_total=attempts_total, retries_total=max(retries_total, 0),
            scheduling=scheduling, result_fingerprint=fp,
            config_fingerprint=fingerprint(experiment.config_dict()),
            error=(f"步骤 {failed.step_id!r} 在 {len(failed.attempts)} 次"
                   f"尝试后仍失败" if failed else None))

    # ------------------------------------------------------------------
    def _run_step_with_retry(self, experiment: Experiment, step,
                             laid_slices: List[LaidSlice],
                             stream: DeterministicStream,
                             seed_int: int) -> StepRecord:
        retries = (step.retries if step.retries is not None
                   else experiment.default_retries)
        max_attempts = retries + 1
        resolved_params = experiment.resolve_step_params(step)
        fn = get_step_fn(step.fn)

        attempts: List[AttemptRecord] = []
        last_error = ""
        last_error_type = ""
        for attempt_no in range(max_attempts):
            # 关键：每次尝试都用同一批 (offset, count) 重新开窗，
            # 之前失败尝试读过的随机量作废重来，绝不向前推进。
            windows = [
                RandomWindow(stream, ls.offset, ls.count, ls.kind,
                             ls.draw_params, step.step_id, ls.slice_index)
                for ls in laid_slices]
            ctx = StepContext(windows, seed_int, attempt_no)
            try:
                result = fn(ctx, resolved_params)
                json.dumps(result, allow_nan=False)  # 结果必须可序列化
            except StepFail as e:
                last_error, last_error_type = str(e), type(e).__name__
                attempts.append(self._attempt_record(attempt_no, windows,
                                                     last_error,
                                                     last_error_type))
                if not e.retryable or attempt_no + 1 >= max_attempts:
                    break
                continue
            except StreamExhaustedError as e:
                # 越界偷取随机量：配置错误，重试无意义
                last_error, last_error_type = str(e), type(e).__name__
                attempts.append(self._attempt_record(attempt_no, windows,
                                                     last_error,
                                                     last_error_type))
                break
            except OverflowError as e:
                # 数值溢出：按配置重试，复用原随机流
                last_error, last_error_type = f"数值溢出: {e}", "OverflowError"
                attempts.append(self._attempt_record(attempt_no, windows,
                                                     last_error,
                                                     last_error_type))
                if attempt_no + 1 >= max_attempts:
                    break
                continue
            except Exception as e:  # noqa: BLE001 - 记录后统一处理
                last_error = f"{type(e).__name__}: {e}"
                last_error_type = type(e).__name__
                attempts.append(self._attempt_record(
                    attempt_no, windows,
                    last_error + "\n" + traceback.format_exc(),
                    last_error_type))
                break
            attempts.append(AttemptRecord(
                attempt=attempt_no,
                consumed={f"{w.kind}@{w.offset}": w.pos for w in windows},
                error=None, error_type=None))
            return StepRecord(
                step_id=step.step_id, fn=step.fn, status="ok",
                result=result, attempts=attempts,
                slices=[self._slice_record(ls, w)
                        for ls, w in zip(laid_slices, windows)])

        return StepRecord(step_id=step.step_id, fn=step.fn,
                          status="failed", result=None, attempts=attempts,
                          slices=[self._empty_slice_record(ls)
                                  for ls in laid_slices])

    @staticmethod
    def _attempt_record(attempt_no: int,
                        windows: List[RandomWindow],
                        error: str,
                        error_type: str) -> AttemptRecord:
        return AttemptRecord(
            attempt=attempt_no,
            consumed={f"{w.kind}@{w.offset}": w.pos for w in windows},
            error=error, error_type=error_type)

    @staticmethod
    def _slice_record(laid: LaidSlice, w: RandomWindow) -> SliceRecord:
        samples = [[idx, val] for idx, val in w.draws[:SAMPLE_DRAWS_KEPT]]
        return SliceRecord(kind=laid.kind, offset=laid.offset,
                           count=laid.count, consumed=w.pos,
                           slice_index=laid.slice_index,
                           sample_draws=samples)

    @staticmethod
    def _empty_slice_record(laid: LaidSlice) -> SliceRecord:
        return SliceRecord(kind=laid.kind, offset=laid.offset,
                           count=laid.count, consumed=0,
                           slice_index=laid.slice_index, sample_draws=[])

    # ------------------------------------------------------------------
    def reproducibility_check(self, experiment: Experiment,
                              seed: Any = None,
                              schedules: Sequence[str] = ("sequential",
                                                           "parallel",
                                                           "reverse")
                              ) -> Dict[str, Any]:
        """同一实验同一种子用多种调度各跑一遍，逐字节比较。"""
        records = {m: self.run(experiment, seed, scheduling=m)
                   for m in schedules}
        fps = {m: r.result_fingerprint for m, r in records.items()}
        estimates = {m: r.estimate for m, r in records.items()}
        identical = len(set(fps.values())) == 1
        return {"identical": identical, "fingerprints": fps,
                "estimates": estimates,
                "record": records[schedules[0]]}
