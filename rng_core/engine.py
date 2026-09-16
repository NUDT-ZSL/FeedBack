"""确定性执行引擎。

关键性质
========
1. 随机流只由 (实验id, 种子, 步骤序号, 抽签id, 类型) 决定，与线程调度无关，
   所以同一步骤在顺序执行与并行执行下拿到的随机数逐位相同。
2. 每个步骤只能接触引擎按声明预算切好的数组；处理器拿不到流对象本身，
   无法多抽、越界抽或影响后续步骤。
3. 重试时把该步骤的流整体倒回起点重播（并逐元素核对重播值与首次一致），
   不引入任何新随机量，后续步骤的流键完全不涉及重试次数。
4. 步骤依赖只能指向更早步骤（模型层保证），引擎按拓扑分层调度；
   运行记录一律按声明顺序落库，因此输出顺序稳定、可比较。
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .handlers import HandlerRegistry, StepContext, StepFailure
from .models import (
    ExperimentSpec, DrawSpec, StepSpec, ValidationError,
    resolve_value, validate_param_value,
)
from .rng import RandomStream, DeterministicRandomError, normalize_type


# --------------------------------------------------------------------------- #
# 运行记录
# --------------------------------------------------------------------------- #

@dataclass
class AttemptRecord:
    attempt: int
    status: str                 # success | failed
    category: Optional[str] = None
    message: Optional[str] = None


@dataclass
class StepRecord:
    index: int
    sid: str
    handler: str
    status: str                 # success | failed | skipped
    attempts: List[AttemptRecord] = field(default_factory=list)
    declared_draws: Dict[str, int] = field(default_factory=dict)
    consumed_draws: Dict[str, int] = field(default_factory=dict)
    blocks_read: Dict[str, int] = field(default_factory=dict)
    stream_keys: List[str] = field(default_factory=list)
    replayed_attempts: int = 0
    output: Optional[Dict[str, Any]] = None
    error_category: Optional[str] = None
    error_message: Optional[str] = None


@dataclass
class RunResult:
    experiment_id: str
    seed: int
    status: str                 # success | failed
    params: Dict[str, Any]
    steps: List[StepRecord]
    fingerprint: str = ""

    @property
    def outputs(self) -> Dict[str, Dict[str, Any]]:
        return {s.sid: s.output for s in self.steps if s.output is not None}

    def output_of(self, sid: str) -> Dict[str, Any]:
        for s in self.steps:
            if s.sid == sid:
                if s.output is None:
                    raise KeyError(f"步骤 {sid!r} 没有成功输出")
                return s.output
        raise KeyError(f"步骤 {sid!r} 不存在")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "seed": self.seed,
            "status": self.status,
            "params": self.params,
            "fingerprint": self.fingerprint,
            "steps": [
                {
                    "index": s.index, "id": s.sid, "handler": s.handler,
                    "status": s.status,
                    "attempts": [vars(a) for a in s.attempts],
                    "declared_draws": s.declared_draws,
                    "consumed_draws": s.consumed_draws,
                    "blocks_read": s.blocks_read,
                    "stream_keys": s.stream_keys,
                    "replayed_attempts": s.replayed_attempts,
                    "output": s.output,
                    "error_category": s.error_category,
                    "error_message": s.error_message,
                }
                for s in self.steps
            ],
        }


def canonical_json(obj: Any) -> str:
    """稳定序列化：键排序、紧凑分隔、禁止 NaN/Infinity（非有限值必须显式报错）。"""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False)


def _check_finite(obj: Any, path: str) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, float):
        if not math.isfinite(obj):
            raise StepFailure(f"输出含非有限值 {obj}（数值溢出）", "overflow",
                              {"path": path})
    elif isinstance(obj, dict):
        for k in sorted(obj):
            _check_finite(obj[k], f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _check_finite(v, f"{path}[{i}]")


# --------------------------------------------------------------------------- #
# 引擎
# --------------------------------------------------------------------------- #

class ExecutionError(Exception):
    """运行期无法继续的错误（参数缺失、处理器不存在等声明期之后的问题）。"""


class Engine:
    def __init__(self, registry: HandlerRegistry):
        self.registry = registry

    # ---- 公共 API ------------------------------------------------------- #

    def run(self, spec: ExperimentSpec, seed: int,
            param_values: Optional[Dict[str, Any]] = None, *,
            parallel: bool = False, max_workers: Optional[int] = None) -> RunResult:
        """以指定种子执行一次实验。parallel=True 时按依赖分层线程调度。

        两种调度方式产生的 :class:`RunResult` 完全一致（含指纹）。
        """
        resolved_params = self._resolve_experiment_params(spec, param_values or {})
        levels, deps = self._topo_levels(spec)

        records: Dict[int, StepRecord] = {
            i: StepRecord(index=i, sid=s.sid, handler=s.handler, status="skipped")
            for i, s in enumerate(spec.steps)
        }
        any_failure = False

        for level in levels:
            # 只有（传递）依赖的步骤全部成功，该步骤才可执行；否则保持 skipped。
            runnable = [
                i for i in level
                if all(records[d].status == "success" for d in deps[i])
            ]
            for i in level:
                if i not in runnable:
                    any_failure = True
            if not runnable:
                continue

            if parallel and len(runnable) > 1:
                with concurrent.futures.ThreadPoolExecutor(
                        max_workers=max_workers or len(runnable)) as pool:
                    futures = {
                        pool.submit(self._execute_step, spec, i, resolved_params,
                                    seed, self._visible_outputs(i, deps, records)): i
                        for i in runnable
                    }
                    level_results = [(futures[f], f.result())
                                     for f in concurrent.futures.as_completed(futures)]
                level_results.sort(key=lambda x: x[0])
            else:
                level_results = [
                    (i, self._execute_step(
                        spec, i, resolved_params, seed,
                        self._visible_outputs(i, deps, records)))
                    for i in runnable
                ]

            for i, rec in level_results:
                records[i] = rec
                if rec.status != "success":
                    any_failure = True

        ordered = [records[i] for i in range(len(spec.steps))]
        status = "failed" if any_failure else "success"
        fingerprint = self._fingerprint(spec, seed, resolved_params, ordered)
        return RunResult(
            experiment_id=spec.eid, seed=seed, status=status,
            params=resolved_params, steps=ordered, fingerprint=fingerprint,
        )

    # ---- 参数 ----------------------------------------------------------- #

    @staticmethod
    def _resolve_experiment_params(spec: ExperimentSpec,
                                   supplied: Dict[str, Any]) -> Dict[str, Any]:
        resolved: Dict[str, Any] = {}
        for ps in spec.params:
            path = ["params", ps.name]
            if ps.name in supplied:
                value = supplied[ps.name]
            elif ps.default is not None:
                value = ps.default
            elif not ps.required:
                continue
            else:
                raise ExecutionError(
                    f"实验 {spec.eid!r} 缺少必填参数 {ps.name!r}")
            try:
                resolved[ps.name] = validate_param_value(ps, value, path)
            except ValidationError as exc:
                raise ExecutionError(str(exc)) from None
        unknown = set(supplied) - {p.name for p in spec.params}
        if unknown:
            raise ExecutionError(
                f"实验 {spec.eid!r} 收到未声明参数：{sorted(unknown)}")
        return resolved

    # ---- 依赖分层 -------------------------------------------------------- #

    @staticmethod
    def _topo_levels(spec: ExperimentSpec):
        """返回 (拓扑分层, 每个步骤的传递依赖集合)。

        同层步骤互不依赖，可以并行；传递依赖集合决定失败时谁应被跳过。
        """
        deps: Dict[int, set] = {i: set() for i in range(len(spec.steps))}
        idx = {s.sid: i for i, s in enumerate(spec.steps)}
        for i, s in enumerate(spec.steps):
            for d in s.depends_on:
                deps[i].add(idx[d])

            def collect(token: Any) -> None:
                if isinstance(token, str) and token.startswith("$steps."):
                    target = token[1:].split(".")[1]
                    deps[i].add(idx[target])

            for v in s.params.values():
                _walk_refs(v, collect)
            for d in s.draws:
                collect(d.count)
                for v in d.draw_params.values():
                    _walk_refs(v, collect)

        # 展开为传递闭包（依赖方失败时，间接依赖者同样跳过）。
        closure: Dict[int, set] = {}

        def closure_of(i: int) -> set:
            if i in closure:
                return closure[i]
            acc = set(deps[i])
            for d in deps[i]:
                acc |= closure_of(d)
            closure[i] = acc
            return acc

        for i in range(len(spec.steps)):
            closure_of(i)

        remaining = dict(closure)
        levels: List[List[int]] = []
        while remaining:
            ready = sorted(i for i, d in remaining.items()
                           if not (d & set(remaining)))
            if not ready:
                raise ExecutionError("步骤依赖存在环")  # 模型层已排除
            levels.append(ready)
            for i in ready:
                remaining.pop(i)
        return levels, closure

    @staticmethod
    def _visible_outputs(i: int, deps: Dict[int, set],
                         records: Dict[int, StepRecord]) -> Dict[str, Dict[str, Any]]:
        """某步骤可见的更早步骤输出：其（传递）依赖中成功者。"""
        out: Dict[str, Dict[str, Any]] = {}
        for d in sorted(deps[i]):
            rec = records[d]
            if rec.status == "success" and rec.output is not None:
                out[rec.sid] = rec.output
        return out

    # ---- 单步执行（含重试重播）------------------------------------------ #

    def _execute_step(self, spec: ExperimentSpec, step_index: int,
                      resolved_params: Dict[str, Any], seed: int,
                      prior_outputs: Dict[str, Dict[str, Any]]) -> StepRecord:
        s = spec.steps[step_index]
        record = StepRecord(index=step_index, sid=s.sid, handler=s.handler,
                            status="failed")

        # 1) 首次准备：解析引用参数并切出该步骤独占的随机流。
        try:
            if not self.registry.contains(s.handler):
                raise ExecutionError(
                    f"实验 {spec.eid!r} 步骤 {s.sid!r} 使用了未注册处理器 "
                    f"{s.handler!r}")
            step_params = _resolve_tree(
                s.params, resolved_params, seed, prior_outputs,
                ["steps", f"[{step_index}]", "params"])
            draw_arrays, draw_meta = self._prepare_draws(
                spec, s, step_index, step_params, resolved_params,
                seed, prior_outputs)
        except StepFailure as exc:
            record.attempts.append(AttemptRecord(1, "failed", exc.category, str(exc)))
            record.error_category, record.error_message = exc.category, str(exc)
            return record
        except (ValidationError, ExecutionError) as exc:
            record.attempts.append(AttemptRecord(
                1, "failed", "invalid_param", str(exc)))
            record.error_category, record.error_message = "invalid_param", str(exc)
            return record

        for k, (rtype, count, blocks) in enumerate(draw_meta):
            record.declared_draws[rtype] = record.declared_draws.get(rtype, 0) + count
            record.blocks_read[rtype] = record.blocks_read.get(rtype, 0) + blocks
            record.stream_keys.append(
                f"exp={spec.eid}|seed={seed}|step={step_index}"
                f"|draw={s.draws[k].draw_id}|type={rtype}")
        first_arrays = {k: list(v) for k, v in draw_arrays.items()}

        handler = self.registry.get(s.handler)

        # 2) 按策略执行 + 重试（随机流倒回重播）。
        for attempt in range(1, s.retry.max_attempts + 1):
            if attempt > 1:
                # 重试：流倒回，重新切分并逐元素核对与首次完全相同。
                replay_arrays, replay_meta = self._prepare_draws(
                    spec, s, step_index, step_params, resolved_params,
                    seed, prior_outputs)
                for draw_id in first_arrays:
                    if replay_arrays[draw_id] != first_arrays[draw_id]:
                        raise ExecutionError(
                            f"步骤 {s.sid!r} 第 {attempt} 次重试的随机流与首次不一致，"
                            "确定性被破坏")
                record.replayed_attempts += 1
                draw_arrays = replay_arrays

            ctx = StepContext(
                experiment_id=spec.eid, seed=seed, step_index=step_index,
                step_id=s.sid, attempt=attempt, params=step_params,
                draws=draw_arrays, outputs=dict(prior_outputs),
            )
            try:
                output = handler(ctx)
                if not isinstance(output, dict):
                    raise StepFailure("处理器输出必须是 dict", "value_error")
                _check_finite(output, f"steps[{step_index}].output")
            except StepFailure as exc:
                record.attempts.append(
                    AttemptRecord(attempt, "failed", exc.category, str(exc)))
                if exc.category in s.retry.retry_on \
                        and attempt < s.retry.max_attempts:
                    continue
                record.status = "failed"
                record.error_category = exc.category
                record.error_message = str(exc)
                break

            record.attempts.append(AttemptRecord(attempt, "success"))
            record.status = "success"
            record.output = output
            break

        # 3) 消耗守恒：成功时声明量必须等于流实际交付量。
        if record.status == "success":
            consumed: Dict[str, int] = {}
            for rtype, count, _blocks in draw_meta:
                consumed[rtype] = consumed.get(rtype, 0) + count
            record.consumed_draws = consumed
            if consumed != record.declared_draws:
                raise ExecutionError(
                    f"步骤 {s.sid!r} 随机量不守恒：声明 {record.declared_draws}，"
                    f"实际交付 {consumed}")
        return record

    def _prepare_draws(
        self, spec: ExperimentSpec, s: StepSpec, step_index: int,
        step_params: Dict[str, Any], resolved_params: Dict[str, Any],
        seed: int, prior_outputs: Dict[str, Dict[str, Any]],
    ) -> Tuple[Dict[str, List[float]], List[Tuple[str, int, int]]]:
        arrays: Dict[str, List[float]] = {}
        meta: List[Tuple[str, int, int]] = []
        path_base = ["steps", f"[{step_index}]", "draws"]
        for j, d in enumerate(s.draws):
            dpath = path_base + [f"[{j}]"]
            try:
                count = resolve_value(d.count, resolved_params, seed,
                                      prior_outputs, dpath + ["count"])
                if isinstance(count, bool) or not isinstance(count, int) or count < 1:
                    raise StepFailure(
                        f"抽签数量解析后必须是 >=1 的整数，得到 {count!r}",
                        "invalid_param")
                dparams = _resolve_tree(
                    d.draw_params, resolved_params, seed, prior_outputs,
                    dpath + ["params"])
                _validate_draw_params(d.rtype, dparams, dpath)
                stream = RandomStream(spec.eid, seed, step_index, d.draw_id)
                values = stream.draw(d.rtype, count, dparams)
            except StepFailure:
                raise
            except ValidationError as exc:
                raise StepFailure(str(exc), "invalid_param") from None
            except DeterministicRandomError as exc:
                raise StepFailure(str(exc), "value_error") from None
            except (TypeError, ValueError, ZeroDivisionError) as exc:
                raise StepFailure(f"随机流切分失败：{exc}", "invalid_param") from None
            if d.draw_id in arrays:
                raise StepFailure(f"抽签id {d.draw_id!r} 重复", "invalid_param")
            arrays[d.draw_id] = values
            rtype = normalize_type(d.rtype)
            blocks = sum(stream.blocks_read().values())
            declared = stream.consumed().get(rtype, 0)
            if declared != count:
                raise ExecutionError(
                    f"步骤 {s.sid!r} 抽签 {d.draw_id!r} 消耗 {declared} "
                    f"与声明 {count} 不符")
            meta.append((rtype, count, blocks))
        return arrays, meta

    # ---- 指纹 ----------------------------------------------------------- #

    @staticmethod
    def _fingerprint(spec: ExperimentSpec, seed: int,
                     params: Dict[str, Any], steps: List[StepRecord]) -> str:
        body = {
            "eid": spec.eid,
            "seed": seed,
            "params": params,
            "steps": [
                {
                    "sid": s.sid,
                    "handler": s.handler,
                    "declared": s.declared_draws,
                    "consumed": s.consumed_draws,
                    "blocks": s.blocks_read,
                    "output": s.output,
                    "attempts": [(a.attempt, a.status, a.category) for a in s.attempts],
                }
                for s in steps
            ],
        }
        return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# 辅助
# --------------------------------------------------------------------------- #

def _validate_draw_params(rtype: str, p: Dict[str, Any],
                          path: List[str]) -> None:
    """运行期分布参数校验（引用解析后的值可能越界）。"""
    try:
        if rtype == "uniform":
            low, high = float(p.get("low", 0.0)), float(p.get("high", 1.0))
            if high < low:
                raise StepFailure(
                    f"uniform 上界 {high} 小于下界 {low}", "invalid_param")
        elif rtype == "integer":
            low, high = int(p["low"]), int(p["high"])
            if high < low:
                raise StepFailure(
                    f"integer 上界 {high} 小于下界 {low}", "invalid_param")
        elif rtype == "bernoulli":
            pv = float(p.get("p", 0.5))
            if not 0.0 <= pv <= 1.0:
                raise StepFailure(
                    f"bernoulli 概率 p={pv} 超出 [0,1]", "invalid_param")
        elif rtype == "gaussian":
            sigma = float(p.get("sigma", 1.0))
            if sigma < 0:
                raise StepFailure(
                    f"gaussian 标准差 sigma={sigma} 为负", "invalid_param")
    except StepFailure:
        raise
    except (TypeError, ValueError, KeyError) as exc:
        raise StepFailure(f"分布参数非法：{exc}", "invalid_param") from None


def _walk_refs(token: Any, sink) -> None:
    """递归收集字符串叶子中的引用（参数支持嵌套 dict/list）。"""
    if isinstance(token, str):
        if token.startswith("$"):
            sink(token)
    elif isinstance(token, dict):
        for v in token.values():
            _walk_refs(v, sink)
    elif isinstance(token, (list, tuple)):
        for v in token:
            _walk_refs(v, sink)


def _resolve_tree(token: Any, resolved_params: Dict[str, Any], seed: int,
                  outputs: Dict[str, Dict[str, Any]], path: List[str]) -> Any:
    if isinstance(token, str) and token.startswith("$"):
        return resolve_value(token, resolved_params, seed, outputs, path)
    if isinstance(token, dict):
        return {k: _resolve_tree(v, resolved_params, seed, outputs, path + [k])
                for k, v in token.items()}
    if isinstance(token, list):
        return [_resolve_tree(v, resolved_params, seed, outputs, path + [f"[{i}]"])
                for i, v in enumerate(token)]
    return token
