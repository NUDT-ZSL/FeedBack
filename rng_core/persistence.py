"""单文件持久化与严格载入校验。

文件为一个 UTF-8 JSON 文档，包含：实验配置（各方版本）、运行记录、批量汇总、
冲突记录与运行参数。写入采用临时文件 + 原子替换，任何时刻不会出现半写文件。

载入时依次做**全部**校验，任一不过即抛 :class:`StoreCorruptError`（带 JSON 路径
定位），且目标 Registry 保持载入前状态不变（先构建到全新实例，最后整体替换）：

1. JSON 可解析、顶层结构与格式版本；整体 content_hash 一致（防截断/篡改）；
2. 实验：标识唯一，``parse_experiment`` 重放全部声明期校验（步骤顺序、引用、
   参数非法都带定位），每个配置的摘要与存储摘要一致；
3. 运行：步骤序号连续且与配置一一对应；状态/尝试序列自洽；
   重新计算引擎指纹必须与记录指纹逐字符一致（输出被改即报）；
   每步声明随机量 = 实际消耗随机量，流键完整且互不冲突（随机流守恒）；
4. 汇总：各行取值与运行记录交叉一致，均值/方差/置信区间按行值重算一致；
5. 冲突：ID 重算一致、来源真实存在、来源与内容快照一一对应。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import replace
from typing import Any, Dict, List, Optional, Tuple

from . import models as M
from .batch import BatchReport, EstimatorSummary, SeedRow
from .engine import (
    AttemptRecord, RunResult, StepRecord, canonical_json,
)
from .handlers import HandlerRegistry, build_default_registry
from .models import parse_experiment, spec_to_wire
from .registry import ConflictRecord, Registry, _hash_id

FORMAT_VERSION = 1
_CONTENT_KEYS = ("format_version", "experiments", "results", "reports",
                 "conflicts", "param_values")


class StoreCorruptError(ValueError):
    """文件损坏/字段缺失/校验失败。消息中带定位路径。"""


# --------------------------------------------------------------------------- #
# 类型与结构小工具
# --------------------------------------------------------------------------- #

def _err(msg: str, path: str) -> StoreCorruptError:
    return StoreCorruptError(f"{path}: {msg}" if path else msg)


def _T(obj: Any, key: str, typ: type, path: str, *,
       required: bool = True, default: Any = None) -> Any:
    if key not in obj:
        if required:
            raise _err(f"缺少必填字段 {key!r}", path)
        return default
    v = obj[key]
    if not isinstance(v, typ) or (typ is int and isinstance(v, bool)):
        want = typ.__name__
        raise _err(f"字段 {key!r} 应为 {want}，实际为 {type(v).__name__}", path)
    return v


def _as_dict(v: Any, path: str) -> Dict[str, Any]:
    if not isinstance(v, dict):
        raise _err(f"应为对象，实际为 {type(v).__name__}", path)
    return v


def _as_list(v: Any, path: str) -> List[Any]:
    if not isinstance(v, list):
        raise _err(f"应为数组，实际为 {type(v).__name__}", path)
    return v


def _finite_number(v: Any, path: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise _err(f"应为数值，实际为 {type(v).__name__}", path)
    f = float(v)
    if f != f or f in (float("inf"), float("-inf")):
        raise _err("数值为 NaN/Infinity", path)
    return f


# --------------------------------------------------------------------------- #
# 写入
# --------------------------------------------------------------------------- #

def save(registry: Registry, path: str) -> str:
    """把登记处完整状态原子写入单个 JSON 文件，返回路径。"""
    experiments: List[Dict[str, Any]] = []
    for eid in sorted(registry._experiments):
        for source in sorted(registry._experiments[eid]):
            spec = registry._experiments[eid][source]
            wire = spec_to_wire(spec)
            digest = hashlib.sha256(
                canonical_json(wire).encode("utf-8")).hexdigest()[:16]
            experiments.append({"source": source, "spec_digest": digest,
                                "spec": wire})

    results: List[Dict[str, Any]] = []
    for (eid, seed) in sorted(registry._results, key=lambda k: (k[0], k[1])):
        for source in sorted(registry._results[(eid, seed)]):
            run = registry._results[(eid, seed)][source]
            results.append({"source": source, "result": run.to_dict()})

    reports: List[Dict[str, Any]] = []
    for key in sorted(registry._reports, key=lambda k: (k[0], k[1])):
        for source in sorted(registry._reports[key]):
            reports.append({"source": source,
                            "report": registry._reports[key][source].to_dict()})

    conflicts = [c.to_dict() for c in registry.conflicts()]

    body = {
        "format_version": FORMAT_VERSION,
        "experiments": experiments,
        "results": results,
        "reports": reports,
        "conflicts": conflicts,
        "param_values": {
            eid: registry._param_values.get(eid, {})
            for eid in registry._param_values
        },
    }
    body["content_hash"] = hashlib.sha256(
        canonical_json({k: body[k] for k in _CONTENT_KEYS}).encode("utf-8")
    ).hexdigest()

    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".rngstore-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(body, f, ensure_ascii=False, indent=2, sort_keys=True,
                      allow_nan=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


# --------------------------------------------------------------------------- #
# 载入
# --------------------------------------------------------------------------- #

def load(path: str, handlers: Optional[HandlerRegistry] = None) -> Registry:
    """从文件载入并返回全新 Registry；失败不影响任何既有实例。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()
    except FileNotFoundError:
        raise
    except OSError as exc:
        raise StoreCorruptError(f"无法读取文件 {path}: {exc}") from None

    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise StoreCorruptError(
            f"JSON 解析失败（行 {exc.lineno} 列 {exc.colno}）：{exc.msg}") from None

    if not isinstance(doc, dict):
        raise _err("顶层必须是 JSON 对象", "$")

    version = _T(doc, "format_version", int, "$.format_version")
    if version != FORMAT_VERSION:
        raise _err(f"不支持的格式版本 {version}，本程序支持 {FORMAT_VERSION}",
                   "$.format_version")
    for key in ("experiments", "results", "reports", "conflicts"):
        if key not in doc:
            raise _err(f"缺少必填顶层字段 {key!r}", "$")
        if not isinstance(doc[key], list):
            raise _err(f"顶层字段 {key!r} 必须是数组", f"$.{key}")
    stored_hash = doc.get("content_hash")
    if not isinstance(stored_hash, str):
        raise _err("缺少 content_hash 或类型错误", "$.content_hash")
    expect_hash = hashlib.sha256(
        canonical_json({k: doc.get(k, []) for k in _CONTENT_KEYS}).encode("utf-8")
    ).hexdigest()
    if stored_hash != expect_hash:
        raise _err("content_hash 不一致：文件被截断、篡改或手工修改过",
                   "$.content_hash")

    staging = Registry(handlers or build_default_registry())
    specs: Dict[str, Dict[str, M.ExperimentSpec]] = {}

    _load_experiments(doc["experiments"], staging, specs)
    result_index = _load_results(doc["results"], staging, specs)
    _load_reports(doc["reports"], staging, specs, result_index)
    _load_conflicts(doc["conflicts"], staging, specs)
    _load_param_values(doc.get("param_values", {}), staging, specs)

    # 全部通过后，staging 即为最终实例（调用方自己的 Registry 未被触碰）。
    return staging


# ---- 各段校验 -------------------------------------------------------------- #

def _load_experiments(raw_list: List[Any], staging: Registry,
                      specs: Dict[str, Dict[str, M.ExperimentSpec]]) -> None:
    seen_pairs: set = set()
    for i, item in enumerate(raw_list):
        p = f"$.experiments[{i}]"
        item = _as_dict(item, p)
        source = _T(item, "source", str, f"{p}.source")
        wire = _as_dict(item.get("spec"), f"{p}.spec")
        digest = _T(item, "spec_digest", str, f"{p}.spec_digest")
        actual = hashlib.sha256(
            canonical_json(wire).encode("utf-8")).hexdigest()[:16]
        if digest != actual:
            raise _err(f"spec_digest 不一致（记录 {digest}，实际 {actual}）",
                       f"{p}.spec_digest")
        try:
            spec = parse_experiment(wire)
        except M.ValidationError as exc:
            raise _err(str(exc), p) from None
        if (spec.eid, source) in seen_pairs:
            raise _err(
                f"实验标识 {spec.eid!r} 与来源 {source!r} 的组合重复"
                "（同一实验内标识必须唯一）", f"{p}.spec.id")
        seen_pairs.add((spec.eid, source))
        spec = replace(spec, source=source)
        staging.register_experiment(spec, wire=wire)
        specs.setdefault(spec.eid, {})[source] = spec


def _attempt_from_dict(d: Any, path: str) -> AttemptRecord:
    d = _as_dict(d, path)
    attempt = _T(d, "attempt", int, f"{path}.attempt")
    if attempt < 1:
        raise _err(f"attempt 必须 >= 1，得到 {attempt}", f"{path}.attempt")
    status = _T(d, "status", str, f"{path}.status")
    if status not in ("success", "failed"):
        raise _err(f"attempt 状态非法 {status!r}", f"{path}.status")
    category = d.get("category")
    if category is not None and not isinstance(category, str):
        raise _err("category 应为字符串或 null", f"{path}.category")
    message = d.get("message")
    if message is not None and not isinstance(message, str):
        raise _err("message 应为字符串或 null", f"{path}.message")
    return AttemptRecord(attempt=attempt, status=status,
                         category=category, message=message)


def _result_from_dict(d: Dict[str, Any], path: str) -> RunResult:
    eid = _T(d, "experiment_id", str, f"{path}.experiment_id")
    seed = _T(d, "seed", int, f"{path}.seed")
    status = _T(d, "status", str, f"{path}.status")
    if status not in ("success", "failed"):
        raise _err(f"运行状态非法 {status!r}", f"{path}.status")
    params = _T(d, "params", dict, f"{path}.params")
    fingerprint = _T(d, "fingerprint", str, f"{path}.fingerprint")
    raw_steps = _T(d, "steps", list, f"{path}.steps")

    records: List[StepRecord] = []
    seen_idx: set = set()
    for j, sd in enumerate(raw_steps):
        sp = f"{path}.steps[{j}]"
        sd = _as_dict(sd, sp)
        index = _T(sd, "index", int, f"{sp}.index")
        if index in seen_idx or index < 0:
            raise _err(f"步骤序号 {index} 重复或非法", f"{sp}.index")
        seen_idx.add(index)
        sid = _T(sd, "id", str, f"{sp}.id")
        handler = _T(sd, "handler", str, f"{sp}.handler")
        sstatus = _T(sd, "status", str, f"{sp}.status")
        if sstatus not in ("success", "failed", "skipped"):
            raise _err(f"步骤状态非法 {sstatus!r}", f"{sp}.status")
        attempts = [
            _attempt_from_dict(a, f"{sp}.attempts[{k}]")
            for k, a in enumerate(_T(sd, "attempts", list, f"{sp}.attempts"))
        ]
        nums = [a.attempt for a in attempts]
        if nums != list(range(1, len(attempts) + 1)):
            raise _err(f"尝试序号必须从 1 连续递增，得到 {nums}",
                       f"{sp}.attempts")
        if sstatus == "success":
            if not attempts or attempts[-1].status != "success":
                raise _err("成功步骤的最后一次尝试必须是 success", sp)
            out = sd.get("output")
            if not isinstance(out, dict):
                raise _err("成功步骤必须有对象类型 output", f"{sp}.output")
        elif sstatus == "failed":
            if not attempts or attempts[-1].status != "failed":
                raise _err("失败步骤的最后一次尝试必须是 failed", sp)
        else:  # skipped：前序失败后未执行，允许没有尝试、没有输出
            if attempts:
                raise _err("跳过的步骤不应有尝试记录", f"{sp}.attempts")
        declared = _counts(sd.get("declared_draws"), f"{sp}.declared_draws")
        consumed = _counts(sd.get("consumed_draws"), f"{sp}.consumed_draws")
        blocks = _counts(sd.get("blocks_read"), f"{sp}.blocks_read")
        keys = _T(sd, "stream_keys", list, f"{sp}.stream_keys")
        for k, key in enumerate(keys):
            if not isinstance(key, str):
                raise _err("流键必须是字符串", f"{sp}.stream_keys[{k}]")
        replayed = _T(sd, "replayed_attempts", int,
                      f"{sp}.replayed_attempts")
        if replayed < 0:
            raise _err("replayed_attempts 不能为负", f"{sp}.replayed_attempts")
        rec = StepRecord(
            index=index, sid=sid, handler=handler, status=sstatus,
            attempts=attempts, declared_draws=declared,
            consumed_draws=consumed, blocks_read=blocks,
            stream_keys=list(keys), replayed_attempts=replayed,
            output=sd.get("output"),
            error_category=(sd.get("error_category") if sstatus != "success"
                            else None),
            error_message=(sd.get("error_message") if sstatus != "success"
                           else None),
        )
        records.append(rec)

    if seen_idx != set(range(len(raw_steps))):
        raise _err(f"步骤序号必须是 0..{len(raw_steps) - 1} 的连续集合",
                   f"{path}.steps")
    records.sort(key=lambda r: r.index)
    return RunResult(experiment_id=eid, seed=seed, status=status,
                     params=dict(params), steps=records, fingerprint=fingerprint)


def _counts(v: Any, path: str) -> Dict[str, int]:
    v = _as_dict(v if v is not None else {}, path)
    out: Dict[str, int] = {}
    for k, n in v.items():
        if not isinstance(k, str) or isinstance(n, bool) or not isinstance(n, int):
            raise _err("随机量计数必须是 类型->整数 的映射", path)
        if n < 0:
            raise _err(f"类型 {k!r} 计数为负 {n}", path)
        out[k] = n
    return out


def _load_results(raw_list: List[Any], staging: Registry,
                  specs: Dict[str, Dict[str, M.ExperimentSpec]]) \
        -> Dict[Tuple[str, int], Dict[str, RunResult]]:
    index: Dict[Tuple[str, int], Dict[str, RunResult]] = {}
    seen_sources: Dict[Tuple[str, int], set] = {}
    for i, item in enumerate(raw_list):
        p = f"$.results[{i}]"
        item = _as_dict(item, p)
        source = _T(item, "source", str, f"{p}.source")
        run = _result_from_dict(_as_dict(item.get("result"), f"{p}.result"),
                                f"{p}.result")
        key = (run.experiment_id, run.seed)
        if key[0] not in specs:
            raise _err(f"结果引用了不存在的实验 {key[0]!r}",
                       f"{p}.result.experiment_id")
        if source in seen_sources.setdefault(key, set()):
            raise _err(f"实验 {key[0]} 种子 {key[1]} 的来源 {source!r} 重复",
                       p)
        seen_sources[key].add(source)

        # 与配置逐步骤核对 + 随机流守恒 + 指纹复算。
        # 配置可能有多来源版本：结果必须与其中至少一个版本的步骤序列一致。
        candidates = [s for s in specs[key[0]].values()]
        matching = [s for s in candidates
                    if len(s.steps) == len(run.steps)
                    and all(ss.sid == rec.sid and ss.handler == rec.handler
                            for ss, rec in zip(s.steps, run.steps))]
        if not matching:
            raise _err(
                f"步骤数 {len(run.steps)} 或步骤序列与该实验的任何配置版本"
                "都不一致（步骤顺序不合法）", f"{p}.result.steps")
        spec = matching[0]
        declared_keys: set = set()
        for rec, ss in zip(run.steps, spec.steps):
            sp = f"{p}.result.steps[{rec.index}]"
            if rec.status == "success":
                if rec.declared_draws != rec.consumed_draws:
                    raise _err(
                        f"随机流不守恒：声明 {rec.declared_draws}，"
                        f"消耗 {rec.consumed_draws}", sp)
                # 重试只能重播：流键数量必须仍恰好等于抽签数量。
                if len(rec.stream_keys) != len(ss.draws):
                    raise _err(
                        f"流键数 {len(rec.stream_keys)} 与抽签声明数 "
                        f"{len(ss.draws)} 不符（重试不得消耗新随机量）", sp)
            # 流键逐条核对：类型集合与声明一致，且键唯一、归属本运行。
            expected_types = sorted(d.rtype for d in ss.draws)
            got_types = sorted(k.split("type=")[-1] for k in rec.stream_keys)
            if rec.status == "success" and expected_types != got_types:
                raise _err(
                    f"流键类型集合 {got_types} 与声明 {expected_types} 不一致",
                    f"{sp}.stream_keys")
            for skey in rec.stream_keys:
                prefix = (f"exp={run.experiment_id}|seed={run.seed}"
                          f"|step={rec.index}|draw=")
                if not skey.startswith(prefix):
                    raise _err(f"流键不属于本运行：{skey}", f"{sp}.stream_keys")
                if skey in declared_keys:
                    raise _err(f"流键重复，切分不唯一：{skey}",
                               f"{sp}.stream_keys")
                declared_keys.add(skey)

        expect_status = "failed" if any(
            r.status in ("failed", "skipped") for r in run.steps) else "success"
        if expect_status != run.status:
            raise _err(
                f"运行总体状态 {run.status!r} 与步骤状态自洽结果 "
                f"{expect_status!r} 不一致", f"{p}.result.status")

        recomputed = staging.engine._fingerprint(
            spec, run.seed, run.params, run.steps)
        if recomputed != run.fingerprint:
            raise _err(
                f"运行指纹不一致（记录 {run.fingerprint[:12]}…，"
                f"重算 {recomputed[:12]}…）：结果或步骤记录被修改过",
                f"{p}.result.fingerprint")

        staging.store_result(run, source)
        index.setdefault(key, {})[source] = run
    return index


def _load_reports(raw_list: List[Any], staging: Registry,
                  specs: Dict[str, Dict[str, M.ExperimentSpec]],
                  result_index: Dict[Tuple[str, int], Dict[str, RunResult]]) \
        -> None:
    seen: set = set()
    for i, item in enumerate(raw_list):
        p = f"$.reports[{i}]"
        item = _as_dict(item, p)
        source = _T(item, "source", str, f"{p}.source")
        rep = _as_dict(item.get("report"), f"{p}.report")
        eid = _T(rep, "experiment_id", str, f"{p}.report.experiment_id")
        if eid not in specs:
            raise _err(f"汇总引用了不存在的实验 {eid!r}",
                       f"{p}.report.experiment_id")
        seeds = _T(rep, "seeds", list, f"{p}.report.seeds")
        for s in seeds:
            if not isinstance(s, int) or isinstance(s, bool):
                raise _err("seeds 必须是整数数组", f"{p}.report.seeds")
        raw_summaries = _T(rep, "summaries", list, f"{p}.report.summaries")
        summaries: List[EstimatorSummary] = []
        names: List[str] = []
        for j, sd in enumerate(raw_summaries):
            sp = f"{p}.report.summaries[j={j}]"
            sd = _as_dict(sd, sp)
            name = _T(sd, "estimator", str, f"{sp}.estimator")
            names.append(name)
            step_id = _T(sd, "step_id", str, f"{sp}.step_id")
            field_name = _T(sd, "field", str, f"{sp}.field")
            n = _T(sd, "n", int, f"{sp}.n")
            level = _finite_number(sd.get("confidence_level"),
                                   f"{sp}.confidence_level")
            raw_rows = _T(sd, "rows", list, f"{sp}.rows")
            rows: List[SeedRow] = []
            values: List[float] = []
            for k, rd in enumerate(raw_rows):
                rp = f"{sp}.rows[{k}]"
                rd = _as_dict(rd, rp)
                seed = _T(rd, "seed", int, f"{rp}.seed")
                status = _T(rd, "status", str, f"{rp}.status")
                value = rd.get("value")
                if value is not None:
                    value = _finite_number(value, f"{rp}.value")
                    values.append(value)
                    # 与运行记录交叉核对：汇总取值必须等于该种子该字段
                    bucket = result_index.get((eid, seed))
                    matched = False
                    if bucket:
                        for run in bucket.values():
                            try:
                                cell = run.output_of(step_id)[field_name]
                            except (KeyError, TypeError):
                                cell = None
                            if isinstance(cell, (int, float)) and \
                                    not isinstance(cell, bool) and \
                                    abs(float(cell) - value) <= 1e-12 * max(
                                        1.0, abs(float(cell))):
                                matched = True
                                break
                    if not matched:
                        raise _err(
                            f"种子 {seed} 的取值 {value} 在运行记录 "
                            f"{step_id}.{field_name} 中找不到一致来源", rp)
                rows.append(SeedRow(
                    seed=seed, status=status, value=value,
                    robust_z=rd.get("robust_z"),
                    classic_z=rd.get("classic_z"),
                    is_outlier=bool(rd.get("is_outlier", False)),
                    reason=str(rd.get("reason", "")),
                    fingerprint=str(rd.get("fingerprint", "")),
                ))
            rows.sort(key=lambda r: r.seed)
            if len(values) != n:
                raise _err(f"n={n} 与有效取值行数 {len(values)} 不一致",
                           f"{sp}.n")
            median = _optional_number(sd.get("median"), f"{sp}.median")
            mad = _optional_number(sd.get("mad"), f"{sp}.mad")
            std_error = _optional_number(sd.get("std_error"),
                                         f"{sp}.std_error")
            mean_got = _optional_number(sd.get("mean"), f"{sp}.mean")
            var_got = _optional_number(sd.get("variance"), f"{sp}.variance")
            ci = sd.get("ci")
            ci_got = [None, None]
            if ci is not None:
                ci = _as_list(ci, f"{sp}.ci")
                if len(ci) != 2:
                    raise _err("ci 必须是 [low, high]", f"{sp}.ci")
                ci_got = [_optional_number(ci[0], f"{sp}.ci[0]"),
                          _optional_number(ci[1], f"{sp}.ci[1]")]
            summary = EstimatorSummary(
                estimator=name, n=n, step_id=step_id, field=field_name,
                confidence_level=level, rows=rows,
                mean=mean_got, variance=var_got, std_error=std_error,
                ci_low=ci_got[0], ci_high=ci_got[1],
                median=median, mad=mad,
                note=str(sd.get("note", "")))
            if values:
                _recompute_stats(summary, values, sp)
            summaries.append(summary)

        key = (eid, tuple(names))
        if key in seen or (source in staging._reports.setdefault(key, {})):
            raise _err(f"汇总 {eid}/{names} 来源 {source!r} 重复", p)
        seen.add(key)
        report = BatchReport(
            experiment_id=eid, seeds=list(seeds),
            parallel_seeds=bool(rep.get("parallel_seeds", False)),
            summaries=summaries)
        staging._reports.setdefault(key, {})[source] = report


def _optional_number(v: Any, path: str) -> Optional[float]:
    if v is None:
        return None
    return _finite_number(v, path)


def _recompute_stats(summary: EstimatorSummary, values: List[float],
                     path: str) -> None:
    """用各行取值重算全部统计量，与存储值逐字段比对（捕获统计字段损坏）。

    通过后把重算值回填到 summary，确保内存中的汇总与记录口径完全一致。
    """
    import math
    from .batch import _percentile, t_quantile

    n = len(values)
    mean = sum(values) / n
    var = sum((x - mean) ** 2 for x in values) / (n - 1) if n > 1 else 0.0
    median = _percentile(sorted(values), 50)
    mad = _percentile(sorted(abs(x - median) for x in values), 50)
    se = math.sqrt(var) / math.sqrt(n) if n > 1 else 0.0

    def check(fld: str, got, want, rel: float = 1e-9) -> None:
        if got is None:
            raise _err(f"缺少统计字段 {fld}", f"{path}.{fld}")
        if math.isinf(got) or abs(float(got) - want) > rel * max(1.0, abs(want)):
            raise _err(f"{fld}={got} 与按行重算值 {want} 不一致",
                       f"{path}.{fld}")

    check("mean", summary.mean, mean)
    check("variance", summary.variance, var)
    check("median", summary.median, median)
    check("mad", summary.mad, mad)
    check("std_error", summary.std_error, se)
    if n >= 2:
        tcrit = t_quantile(0.5 + summary.confidence_level / 2.0, n - 1)
        check("ci_low", summary.ci_low, mean - tcrit * se)
        check("ci_high", summary.ci_high, mean + tcrit * se)

    summary.mean, summary.variance = mean, var
    summary.median, summary.mad, summary.std_error = median, mad, se
    if n >= 2:
        summary.ci_low, summary.ci_high = mean - tcrit * se, mean + tcrit * se


def _load_conflicts(raw_list: List[Any], staging: Registry,
                    specs: Dict[str, Dict[str, M.ExperimentSpec]]) -> None:
    seen_ids: set = set()
    rebuilt: List[ConflictRecord] = []
    for i, item in enumerate(raw_list):
        p = f"$.conflicts[{i}]"
        item = _as_dict(item, p)
        cid = _T(item, "conflict_id", str, f"{p}.conflict_id")
        kind = _T(item, "kind", str, f"{p}.kind")
        eid = _T(item, "experiment_id", str, f"{p}.experiment_id")
        sources = _T(item, "sources", list, f"{p}.sources")
        contents = _as_dict(item.get("contents"), f"{p}.contents")
        message = _T(item, "message", str, f"{p}.message")
        if cid in seen_ids:
            raise _err(f"冲突记录 id {cid!r} 重复", f"{p}.conflict_id")
        seen_ids.add(cid)
        if not sources or any(not isinstance(s, str) for s in sources):
            raise _err("sources 必须是非空字符串数组", f"{p}.sources")
        if sorted(sources) != sorted(contents):
            raise _err("sources 与 contents 的键集合必须一致",
                       f"{p}.contents")
        seed = item.get("seed")
        if seed is not None and (not isinstance(seed, int)
                                 or isinstance(seed, bool)):
            raise _err("seed 必须是整数或 null", f"{p}.seed")

        if kind == "config":
            want_id = _hash_id("config", eid)
            if eid not in specs:
                raise _err(f"冲突引用了不存在的实验 {eid!r}", p)
            for s in sources:
                if s not in specs[eid]:
                    raise _err(f"冲突来源 {s!r} 在实验配置中不存在", p)
        elif kind == "result":
            if seed is None:
                raise _err("result 冲突必须带 seed", p)
            want_id = _hash_id("result", eid, str(seed))
            bucket = staging._results.get((eid, seed))
            if bucket is None:
                raise _err(f"冲突引用了不存在的结果 {eid}/{seed}", p)
            for s in sources:
                if s not in bucket:
                    raise _err(f"冲突来源 {s!r} 在结果中不存在", p)
        elif kind == "report":
            subject = str(item.get("subject", ""))
            names = tuple(subject.split(",")) if subject else ()
            want_id = _hash_id("report", eid, names)
            found = staging._reports.get((eid, names))
            if found is None:
                raise _err(f"冲突引用了不存在的汇总 {eid}/{names}", p)
            for s in sources:
                if s not in found:
                    raise _err(f"冲突来源 {s!r} 在汇总中不存在", p)
        else:
            raise _err(f"冲突类型 {kind!r} 非法", f"{p}.kind")
        if cid != want_id:
            raise _err(f"冲突 id 重算为 {want_id}，与记录 {cid} 不符",
                       f"{p}.conflict_id")
        rebuilt.append(ConflictRecord(
            conflict_id=cid, kind=kind, experiment_id=eid,
            sources=list(sources), message=message,
            contents=dict(contents), seed=seed,
            subject=str(item.get("subject", ""))))

    # 交叉校验：文件中的冲突记录必须与"数据里真实存在的矛盾"一一对应。
    # 多报（没矛盾却有记录）或漏报（有矛盾却无记录）都视为损坏，杜绝静默择一。
    expect_config = set(staging._config_conflict)
    expect_result = set(staging._result_conflict)
    expect_report = {
        key for key, bucket in staging._reports.items()
        if len({canonical_json(r.to_dict()) for r in bucket.values()}) > 1
    }
    got_config = {c.experiment_id for c in rebuilt if c.kind == "config"}
    got_result = {(c.experiment_id, c.seed) for c in rebuilt if c.kind == "result"}
    got_report = {
        (c.experiment_id,
         tuple(c.subject.split(",")) if c.subject else ())
        for c in rebuilt if c.kind == "report"
    }
    if got_config != expect_config:
        raise _err(
            f"配置矛盾集合不一致：记录 {sorted(got_config)}，"
            f"实际 {sorted(expect_config)}（冲突记录漏报或多报）",
            "$.conflicts")
    if got_result != expect_result:
        raise _err(
            f"结果矛盾集合不一致：记录 {sorted(map(str, got_result))}，"
            f"实际 {sorted(map(str, expect_result))}（冲突记录漏报或多报）",
            "$.conflicts")
    if got_report != expect_report:
        raise _err(
            f"汇总矛盾集合不一致：记录 {sorted(map(str, got_report))}，"
            f"实际 {sorted(map(str, expect_report))}（冲突记录漏报或多报）",
            "$.conflicts")

    # 用文件中的权威冲突记录替换注册阶段自动生成的临时记录。
    staging._config_conflict.clear()
    staging._result_conflict.clear()
    staging._report_conflict.clear()
    for rec in rebuilt:
        if rec.kind == "config":
            staging._config_conflict[rec.experiment_id] = rec
        elif rec.kind == "result":
            staging._result_conflict[(rec.experiment_id, rec.seed)] = rec
        else:
            names = tuple(rec.subject.split(",")) if rec.subject else ()
            staging._report_conflict[(rec.experiment_id, names)] = rec


def _load_param_values(raw: Any, staging: Registry,
                       specs: Dict[str, Dict[str, M.ExperimentSpec]]) -> None:
    if not isinstance(raw, dict):
        raise _err("param_values 必须是对象", "$.param_values")
    for eid, values in raw.items():
        if eid not in specs:
            raise _err(f"参数取值引用了不存在的实验 {eid!r}",
                       f"$.param_values.{eid}")
        if not isinstance(values, dict):
            raise _err("参数取值必须是对象", f"$.param_values.{eid}")
        staging._param_values[eid] = dict(values)
