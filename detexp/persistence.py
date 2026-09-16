"""单文件持久化。

文件格式（JSON 信封）::

    {
      "format": "detexp-bundle", "version": 1,
      "checksum": {"algorithm": "sha256", "value": "...",
                   "covers": ["experiments", "variants", "runs", ...]},
      "experiments": [...], "variants": {...}, "runs": [...],
      "result_claims": [...], "batch_summaries": [...], "conflicts": [...]
    }

载入流程严格按“解析 → 校验和 → 结构 → 语义/随机流守恒”顺序进行，
任何一步失败都抛 :class:`IntegrityError` 且不改变既有系统状态
（载入先构建临时对象，全部通过后才整体替换）。
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from typing import Any, Dict, List, Tuple

from .engine import fingerprint
from .errors import DetexpError, IntegrityError
from .models import (
    MODEL_VERSION,
    BatchSummary,
    ConflictRecord,
    Experiment,
    RunRecord,
)
from .rng import DeterministicStream

BUNDLE_FORMAT = "detexp-bundle"
COVERED_SECTIONS = ("experiments", "variants", "runs", "result_claims",
                    "batch_summaries", "conflicts")


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False)


def bundle_checksum(payload: Dict[str, Any]) -> str:
    h = hashlib.sha256()
    for section in COVERED_SECTIONS:
        h.update(section.encode("utf-8"))
        h.update(b"\0")
        h.update(_canonical(payload.get(section, [])).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def save_bundle(path: str, payload: Dict[str, Any]) -> None:
    """原子写入：先写临时文件再 os.replace，避免留下半截文件。"""
    body = {k: payload.get(k, [] if k != "variants" else {})
            for k in COVERED_SECTIONS}
    out = {"format": BUNDLE_FORMAT, "version": MODEL_VERSION,
           "checksum": {"algorithm": "sha256",
                        "value": bundle_checksum(body),
                        "covers": list(COVERED_SECTIONS)},
           **body}
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".detexp-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2, sort_keys=True,
                      allow_nan=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# 载入与校验
# ---------------------------------------------------------------------------

def _check_unique_ids(items: List[Any], id_attr: str, label: str,
                      ctx: str) -> None:
    ids = [getattr(x, id_attr) for x in items]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise IntegrityError(
            f"{ctx}: {label}标识不唯一，重复项 {dup}", path=None)


def load_bundle_bytes(raw: bytes, source_path: str = "<bytes>") \
        -> Dict[str, Any]:
    """解析 + 校验和 + 语义校验，返回可直接灌进系统的中间结构。

    返回: {"experiments": {id: Experiment}, "variants": {...},
           "runs": [RunRecord], "claims": [...],
           "summaries": [BatchSummary], "conflicts": [ConflictRecord]}
    """
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise IntegrityError(f"文件不是合法 UTF-8: {e}", source_path)
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        raise IntegrityError(
            f"JSON 解析失败（第 {e.lineno} 行第 {e.colno} 列）: {e.msg}",
            source_path)
    if not isinstance(doc, dict):
        raise IntegrityError("顶层结构必须是 JSON 对象", source_path)
    if doc.get("format") != BUNDLE_FORMAT:
        raise IntegrityError(
            f"format 字段应为 {BUNDLE_FORMAT!r}，实际为 {doc.get('format')!r}",
            source_path)
    if doc.get("version") != MODEL_VERSION:
        raise IntegrityError(
            f"version 不支持：文件 {doc.get('version')}，本系统 "
            f"{MODEL_VERSION}", source_path)

    cs = doc.get("checksum")
    if not isinstance(cs, dict) or "value" not in cs:
        raise IntegrityError("缺少 checksum 或其 value 字段", source_path)
    if cs.get("algorithm") != "sha256":
        raise IntegrityError(
            f"不支持的校验算法 {cs.get('algorithm')!r}", source_path)
    covers = cs.get("covers", [])
    if sorted(covers) != sorted(COVERED_SECTIONS):
        raise IntegrityError(
            f"checksum.covers 与当前版本不一致: {covers}", source_path)
    body = {k: doc.get(k, [] if k != "variants" else {})
            for k in COVERED_SECTIONS}
    actual = bundle_checksum(body)
    if not _safe_equal(actual, str(cs["value"])):
        raise IntegrityError(
            "校验和不匹配：文件可能被损坏或篡改 "
            f"（记录 {str(cs['value'])[:16]}…，实算 {actual[:16]}…）",
            source_path)

    return _parse_and_validate(body, source_path)


def load_bundle(path: str) -> Dict[str, Any]:
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        raise IntegrityError(f"无法读取文件: {e}", path)
    return load_bundle_bytes(raw, path)


def _safe_equal(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    out = 0
    for x, y in zip(a.lower(), b.lower()):
        out |= ord(x) ^ ord(y)
    return out == 0


def _parse_and_validate(body: Dict[str, Any], source_path: str
                        ) -> Dict[str, Any]:
    # ---- 1. 实验 -------------------------------------------------------
    raw_exps = body["experiments"]
    if not isinstance(raw_exps, list):
        raise IntegrityError("experiments: 期望数组", source_path)
    experiments: Dict[str, Experiment] = {}
    for i, d in enumerate(raw_exps):
        exp = Experiment.from_dict(d, f"experiments[{i}]")
        if exp.experiment_id in experiments:
            raise IntegrityError(
                f"experiments: 实验标识 {exp.experiment_id!r} 不唯一"
                f"（重复位置 [{i}]）", source_path)
        # 复用构建期校验（参数/引用/切片参数），不校验 fn 名称，
        # 因为自定义函数可能未注册；fn 存在性由系统层另行检查。
        try:
            exp.validate(fn_names=None)
        except DetexpError as e:
            raise IntegrityError(
                f"experiments[{i}]({exp.experiment_id}): {e}", source_path)
        experiments[exp.experiment_id] = exp

    # ---- 2. 配置变体 ---------------------------------------------------
    raw_var = body["variants"]
    if not isinstance(raw_var, dict):
        raise IntegrityError("variants: 期望对象", source_path)
    variants: Dict[str, List[Tuple[str, Experiment]]] = {}
    config_by_fp: Dict[str, Experiment] = {}
    for eid, exp in experiments.items():
        config_by_fp[fingerprint(exp.config_dict())] = exp
    for eid, lst in raw_var.items():
        if eid not in experiments:
            raise IntegrityError(
                f"variants: 变体指向未知实验 {eid!r}", source_path)
        if not isinstance(lst, list):
            raise IntegrityError(f"variants[{eid}]: 期望数组", source_path)
        parsed = []
        for j, item in enumerate(lst):
            ctx = f"variants[{eid}][{j}]"
            if not isinstance(item, dict) or "source" not in item \
                    or "experiment" not in item:
                raise IntegrityError(
                    f"{ctx}: 需要 source 与 experiment 字段", source_path)
            ve = Experiment.from_dict(item["experiment"], f"{ctx}.experiment")
            if ve.experiment_id != eid:
                raise IntegrityError(
                    f"{ctx}: 变体实验标识 {ve.experiment_id!r} 与键 {eid!r}"
                    f"不一致", source_path)
            try:
                ve.validate(fn_names=None)
            except DetexpError as e:
                raise IntegrityError(f"{ctx}: {e}", source_path)
            parsed.append((str(item["source"]), ve))
            config_by_fp[fingerprint(ve.config_dict())] = ve
        if len({s for s, _ in parsed}) != len(parsed):
            raise IntegrityError(
                f"variants[{eid}]: 来源名称重复", source_path)
        variants[eid] = parsed

    # ---- 3. 运行记录 + 随机流守恒 -------------------------------------
    raw_runs = body["runs"]
    if not isinstance(raw_runs, list):
        raise IntegrityError("runs: 期望数组", source_path)
    runs: List[RunRecord] = []
    run_keys = set()
    for i, d in enumerate(raw_runs):
        rec = RunRecord.from_dict(d, f"runs[{i}]")
        key = (rec.experiment_id, rec.seed)
        if key in run_keys:
            raise IntegrityError(
                f"runs[{i}]: 实验 {rec.experiment_id!r} 种子 {rec.seed} "
                f"存在多条本地运行记录", source_path)
        run_keys.add(key)
        if rec.experiment_id not in experiments:
            raise IntegrityError(
                f"runs[{i}]: 运行记录指向未知实验 "
                f"{rec.experiment_id!r}", source_path)
        cfg_fp = rec.config_fingerprint or fingerprint(
            experiments[rec.experiment_id].config_dict())
        exp = config_by_fp.get(cfg_fp)
        if exp is None or exp.experiment_id != rec.experiment_id:
            raise IntegrityError(
                f"runs[{i}]: 运行记录对应的实验配置版本不存在"
                f"（config_fingerprint={cfg_fp[:12]}…）", source_path)
        _validate_run_conservation(rec, exp, f"runs[{i}]", source_path)
        runs.append(rec)

    # ---- 4. 外部结果声明 ----------------------------------------------
    raw_claims = body["result_claims"]
    if not isinstance(raw_claims, list):
        raise IntegrityError("result_claims: 期望数组", source_path)
    claims = []
    claim_keys = set()
    for i, d in enumerate(raw_claims):
        ctx = f"result_claims[{i}]"
        claim = _parse_claim(d, ctx, source_path)
        if claim["experiment_id"] not in experiments:
            raise IntegrityError(
                f"{ctx}: 指向未知实验 {claim['experiment_id']!r}",
                source_path)
        k = (claim["experiment_id"], claim["seed"], claim["source"])
        if k in claim_keys:
            raise IntegrityError(f"{ctx}: (实验,种子,来源) 重复", source_path)
        claim_keys.add(k)
        claims.append(claim)

    # ---- 5. 批量汇总（重算比对） --------------------------------------
    raw_bs = body["batch_summaries"]
    if not isinstance(raw_bs, list):
        raise IntegrityError("batch_summaries: 期望数组", source_path)
    summaries: List[BatchSummary] = []
    for i, d in enumerate(raw_bs):
        bs = BatchSummary.from_dict(d, f"batch_summaries[{i}]")
        if bs.experiment_id not in experiments:
            raise IntegrityError(
                f"batch_summaries[{i}]: 指向未知实验 "
                f"{bs.experiment_id!r}", source_path)
        _validate_summary(bs, f"batch_summaries[{i}]", source_path)
        summaries.append(bs)

    # ---- 6. 冲突记录 ---------------------------------------------------
    raw_cf = body["conflicts"]
    if not isinstance(raw_cf, list):
        raise IntegrityError("conflicts: 期望数组", source_path)
    conflicts = []
    cids = set()
    for i, d in enumerate(raw_cf):
        c = ConflictRecord.from_dict(d, f"conflicts[{i}]")
        if c.conflict_id in cids:
            raise IntegrityError(
                f"conflicts[{i}]: 冲突标识 {c.conflict_id!r} 不唯一",
                source_path)
        cids.add(c.conflict_id)
        if c.experiment_id not in experiments:
            raise IntegrityError(
                f"conflicts[{i}]: 指向未知实验 {c.experiment_id!r}",
                source_path)
        if not c.source_a or not c.source_b or c.source_a == c.source_b:
            raise IntegrityError(
                f"conflicts[{i}]: source_a/source_b 必须不同且非空",
                source_path)
        conflicts.append(c)

    return {"experiments": experiments, "variants": variants, "runs": runs,
            "claims": claims, "summaries": summaries,
            "conflicts": conflicts}


def _parse_claim(d: Any, ctx: str, source_path: str) -> Dict[str, Any]:
    if not isinstance(d, dict):
        raise IntegrityError(f"{ctx}: 期望对象", source_path)
    required = ("experiment_id", "seed", "source", "status", "estimate")
    for k in required:
        if k not in d:
            raise IntegrityError(f"{ctx}: 缺少字段 {k!r}", source_path)
    if not isinstance(d["experiment_id"], str) or not isinstance(
            d["source"], str) or not d["source"]:
        raise IntegrityError(
            f"{ctx}: experiment_id/source 必须为非空字符串", source_path)
    seed = d["seed"]
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise IntegrityError(f"{ctx}.seed: 期望非负 int", source_path)
    status = d["status"]
    if status not in ("ok", "failed"):
        raise IntegrityError(
            f"{ctx}.status: 非法值 {status!r}", source_path)
    est = d["estimate"]
    if est is not None and not (
            isinstance(est, (int, float)) and not isinstance(est, bool)):
        raise IntegrityError(
            f"{ctx}.estimate: 期望数值或 null", source_path)
    return {"experiment_id": d["experiment_id"], "seed": seed,
            "source": d["source"], "status": status,
            "estimate": (float(est) if isinstance(est, (int, float))
                         and not isinstance(est, bool) else None),
            "detail": d.get("detail")}


def _validate_run_conservation(rec: RunRecord, exp: Experiment,
                               ctx: str, source_path: str) -> None:
    """随机流守恒：布局一致、消耗不越界、样本值可按流重算、指纹一致。"""
    layout = exp.lay_out_stream()
    laid_by_step: Dict[str, List[Any]] = {s.step_id: []
                                          for s in exp.steps}
    for ls in layout:
        laid_by_step[ls.step_id].append(ls)

    # 步骤顺序与标识必须与配置一致
    cfg_ids = [s.step_id for s in exp.steps]
    rec_ids = [sr.step_id for sr in rec.step_records]
    if rec_ids != cfg_ids:
        raise IntegrityError(
            f"{ctx}: 步骤顺序/标识不合法，配置 {cfg_ids}，记录 {rec_ids}",
            source_path)

    stream = DeterministicStream(rec.seed, exp.experiment_id)
    for sr in rec.step_records:
        laid_list = laid_by_step[sr.step_id]
        if len(sr.slices) != len(laid_list):
            raise IntegrityError(
                f"{ctx}.{sr.step_id}: 切片数 {len(sr.slices)} 与配置 "
                f"{len(laid_list)} 不一致", source_path)
        laid_sorted = sorted(laid_list, key=lambda x: x.slice_index)
        sr_sorted = sorted(sr.slices, key=lambda x: x.slice_index)
        for laid, slrec in zip(laid_sorted, sr_sorted):
            if (slrec.kind, slrec.offset, slrec.count) != (
                    laid.kind, laid.offset, laid.count):
                raise IntegrityError(
                    f"{ctx}.{sr.step_id}.slices[{laid.slice_index}]: "
                    f"布局 (kind,offset,count) 应为 "
                    f"({laid.kind},{laid.offset},{laid.count})，记录为 "
                    f"({slrec.kind},{slrec.offset},{slrec.count})",
                    source_path)
            if not 0 <= slrec.consumed <= slrec.count:
                raise IntegrityError(
                    f"{ctx}.{sr.step_id}: 消耗 {slrec.consumed} 越界 "
                    f"[0,{slrec.count}]", source_path)
            for pair in slrec.sample_draws:
                if (not isinstance(pair, list) or len(pair) != 2
                        or not isinstance(pair[0], int)):
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}.sample_draws: 期望 [index,value]"
                        f" 对", source_path)
                idx = pair[0]
                if not laid.offset <= idx < laid.offset + laid.count:
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}: 抽样下标 {idx} 不在其切片 "
                        f"[{laid.offset},{laid.offset + laid.count}) 内",
                        source_path)
                want = stream.draw_at(idx, laid.kind, laid.draw_params)
                got = pair[1]
                if not _draws_equal(want, got):
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}: 下标 {idx} 的随机量与按 "
                        f"(seed={rec.seed}, experiment={exp.experiment_id!r})"
                        f" 重算结果不符（随机流不守恒）：记录 {got!r}，"
                        f"重算 {want!r}", source_path)
        for ai, att in enumerate(sr.attempts):
            for key, used in att.consumed.items():
                kind, _, off_str = key.partition("@")
                try:
                    off = int(off_str)
                except ValueError:
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}.attempts[{ai}]: 切片键 {key!r}"
                        f" 非法", source_path)
                match = [l for l in laid_list if l.kind == kind
                         and l.offset == off]
                if not match:
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}.attempts[{ai}]: 消耗记录引用了"
                        f"不属于该步骤的切片 {key!r}", source_path)
                if not 0 <= used <= match[0].count:
                    raise IntegrityError(
                        f"{ctx}.{sr.step_id}.attempts[{ai}]: 切片 {key} "
                        f"消耗 {used} 越界", source_path)

    # 偏移量必须从 0 连续铺满
    offsets = sorted((l.offset, l.count) for l in layout)
    cursor = 0
    for off, cnt in offsets:
        if off != cursor:
            raise IntegrityError(
                f"{ctx}: 随机流布局在 offset={off} 处不连续（期望 "
                f"{cursor}）", source_path)
        cursor = off + cnt

    # 指纹与状态一致性
    if sr_mismatch := [sr.step_id for sr in rec.step_records
                       if sr.status not in ("ok", "failed")]:
        raise IntegrityError(f"{ctx}: 非法步骤状态 {sr_mismatch}",
                             source_path)
    if rec.status == "ok":
        if any(sr.status != "ok" for sr in rec.step_records):
            raise IntegrityError(
                f"{ctx}: 运行状态为 ok 但存在失败步骤", source_path)
    fp = fingerprint({"seed": rec.seed, "results": [
        {"step_id": sr.step_id, "status": sr.status, "result": sr.result}
        for sr in rec.step_records]})
    if rec.result_fingerprint is not None and fp != rec.result_fingerprint:
        raise IntegrityError(
            f"{ctx}: result_fingerprint 不匹配（记录 "
            f"{rec.result_fingerprint[:12]}…，实算 {fp[:12]}…）",
            source_path)


def _draws_equal(want: Any, got: Any) -> bool:
    if isinstance(want, float):
        return isinstance(got, (int, float)) and not isinstance(
            got, bool) and _bit_equal(want, float(got))
    return want == got


def _bit_equal(a: float, b: float) -> bool:
    import struct
    return struct.pack(">d", a) == struct.pack(">d", b)


def _validate_summary(bs: BatchSummary, ctx: str, source_path: str) -> None:
    """用记录的估计量重算统计量，逐项比对。"""
    from .analysis import analyze_estimates
    if list(bs.estimates.keys()) != [str(s) for s in bs.seeds] \
            or sorted(bs.seeds) != bs.seeds:
        raise IntegrityError(
            f"{ctx}: seeds 必须升序且与 estimates 键一致", source_path)
    values = {s: bs.estimates[str(s)] for s in bs.seeds}
    recomputed = analyze_estimates(bs.experiment_id, bs.seeds, values,
                                   ci_level=bs.ci_level)
    for name, a, b in (
            ("mean", recomputed.mean, bs.mean),
            ("variance", recomputed.variance, bs.variance),
            ("std", recomputed.std, bs.std),
            ("ci_low", recomputed.ci_low, bs.ci_low),
            ("ci_high", recomputed.ci_high, bs.ci_high)):
        if not _close(a, b):
            raise IntegrityError(
                f"{ctx}: {name} 与原始数据重算结果不符（{b!r} vs {a!r}）",
                source_path)
    if [o.seed for o in recomputed.outliers] != [
            o.seed for o in bs.outliers]:
        raise IntegrityError(
            f"{ctx}: 离群种子列表与原始数据重算结果不一致", source_path)


def _close(a: float, b: float, tol: float = 1e-12) -> bool:
    if math.isinf(a) or math.isinf(b):
        return a == b
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))
