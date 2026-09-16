"""JSON 持久化（需求 7）。

文件包含全部输入（基准、各轨条目、容差配置）与全部对齐产物（锚点、
分段校正参数、缺失区间、容差报告、冲突记录）。

载入策略保证“失败后状态不变”：

1. JSON 解析失败 / 字段缺失 / 标识不唯一 / 时刻非法 → 收集问题后抛
   :class:`PersistenceError`，不返回任何半成品对象；
2. 输入通过校验后先构建一个**临时** SubtitleSystem，重新跑一遍确定性
   对齐流水线，把重算结果与文件中存储的锚点/参数/冲突逐项比对；
3. 任何不一致（文件被手工改坏、参数不自洽）都报错并丢弃临时对象，
   调用方原有系统不受影响。

Fraction 统一存为 ``"p/q"`` 文本（整数存 ``"p"``），无浮点损失。
"""

from __future__ import annotations

import json
import os
import tempfile
from fractions import Fraction
from typing import Any, Dict, List, Optional, Tuple

from .errors import PersistenceError, ValidationError
from .model import (
    AlignConfig,
    AlignmentReport,
    Anchor,
    Conflict,
    Entry,
    Reference,
    SubtitleTrack,
)
from .system import SubtitleSystem

FORMAT = "subalign"
VERSION = 1


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def frac_to_str(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"


def parse_frac(text: Any, problems: List[str], path: str) -> Optional[Fraction]:
    if isinstance(text, int) and not isinstance(text, bool):
        return Fraction(int(text))
    if isinstance(text, str):
        m = text.strip()
        if "/" in m:
            n, _, d = m.partition("/")
            try:
                nn, dd = int(n), int(d)
            except ValueError:
                problems.append(f"{path}：分数分子分母必须是整数：{text!r}")
                return None
            if dd == 0:
                problems.append(f"{path}：分数分母为零：{text!r}")
                return None
            return Fraction(nn, dd)
        try:
            # Fraction 接受整数与十进制字符串且精确（无浮点损失）。
            return Fraction(m)
        except ValueError:
            problems.append(f"{path}：无法解析的数值：{text!r}")
            return None
    problems.append(f"{path}：数值必须是整数字符串或 p/q 形式，实际为 {type(text).__name__}")
    return None


def _r6(x: float) -> float:
    return round(float(x), 6)


# --------------------------------------------------------------------------- #
# 编码
# --------------------------------------------------------------------------- #
def _encode_entry(e: Entry) -> Dict[str, Any]:
    return {"start": int(e.start), "end": int(e.end), "text": e.text}


def _encode_anchor(a: Anchor) -> Dict[str, Any]:
    return {
        "ref_index": a.ref_index,
        "cand_index": a.cand_index,
        "ref_mid": a.ref_mid,
        "cand_mid": a.cand_mid,
        "score": _r6(a.score),
        "kind": a.kind,
        "evidence": a.evidence,
    }


def _encode_results(sysobj: SubtitleSystem) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for tid in sysobj.track_ids():
        rep: AlignmentReport = sysobj.report(tid)
        seg_list = []
        for s in rep.segments:
            seg_list.append(
                {
                    "index": s.index,
                    "ratio": frac_to_str(s.ratio),
                    "shift": frac_to_str(s.shift),
                    "domain_lo": s.domain_lo,
                    "domain_hi": s.domain_hi,
                    "residual_max_abs": s.residual_max_abs,
                    "residual_mse": frac_to_str(s.residual_mse),
                    "anchors": [[a.ref_index, a.cand_index] for a in s.anchors],
                }
            )
        bias = rep.bias
        out[tid] = {
            "status": rep.status,
            "note": rep.note,
            "anchors": [_encode_anchor(a) for a in rep.anchors],
            "segments": seg_list,
            "bias": {
                "shift_ms": frac_to_str(bias.shift_ms),
                "rate_ratio": frac_to_str(bias.rate_ratio),
                "shift_confidence": _r6(bias.shift_confidence),
                "rate_confidence": _r6(bias.rate_confidence),
                "shift_basis": bias.shift_basis,
                "rate_basis": bias.rate_basis,
                "missing_intervals": [
                    {
                        "ref_lo": m.ref_lo,
                        "ref_hi": m.ref_hi,
                        "left_anchor": list(m.left_anchor),
                        "right_anchor": list(m.right_anchor),
                        "duration_ms": m.duration_ms,
                        "confidence": _r6(m.confidence),
                        "reason": m.reason,
                    }
                    for m in bias.missing_intervals
                ],
            },
            "tolerance": {
                "tolerance_ms": rep.tolerance.tolerance_ms,
                "violations": [
                    {
                        "ref_start": v.ref_start,
                        "ref_end": v.ref_end,
                        "max_residual": v.max_residual,
                        "anchor_points": [list(p) for p in v.anchor_points],
                    }
                    for v in rep.tolerance.violations
                ],
            },
        }
    return out


def _encode_conflicts(sysobj: SubtitleSystem) -> List[Dict[str, Any]]:
    out = []
    c: Conflict
    for c in sysobj.conflicts():
        out.append(
            {
                "interval_ref_lo": c.interval_ref_lo,
                "interval_ref_hi": c.interval_ref_hi,
                "track_a": _encode_conflict_params(c.track_a),
                "track_b": _encode_conflict_params(c.track_b),
                "rate_delta": frac_to_str(c.rate_delta),
                "shift_delta_ms": frac_to_str(c.shift_delta_ms),
                "reason": c.reason,
            }
        )
    return out


def _encode_conflict_params(p) -> Dict[str, Any]:
    return {
        "track_id": p.track_id,
        "segment_index": p.segment_index,
        "ratio": frac_to_str(p.ratio),
        "shift": frac_to_str(p.shift),
        "anchor_ref_range": list(p.anchor_ref_range),
    }


def to_dict(sysobj: SubtitleSystem) -> Dict[str, Any]:
    """导出为可 JSON 序列化的普通字典（会先确保全部轨已对齐）。"""
    if not sysobj.reports():
        sysobj.align()
    cfg = sysobj.config
    return {
        "format": FORMAT,
        "version": VERSION,
        "reference": {
            "source": sysobj.reference.source,
            "entries": [_encode_entry(e) for e in sysobj.reference.entries],
        },
        "tracks": [
            {
                "id": t.track_id,
                "source": t.source,
                "entries": [_encode_entry(e) for e in t.entries],
            }
            for t in (sysobj.get_track(i) for i in sysobj.track_ids())
        ],
        "config": {
            "similarity_threshold": cfg.similarity_threshold,
            "min_anchors": cfg.min_anchors,
            "cut_residual_factor": cfg.cut_residual_factor,
            "min_cut_gap_ms": cfg.min_cut_gap_ms,
            "tolerance_ms": cfg.tolerance_ms,
            "conflict_rate_eps": frac_to_str(cfg.conflict_rate_eps),
            "conflict_shift_eps_ms": cfg.conflict_shift_eps_ms,
            "fuzzy_anchor_cap": cfg.fuzzy_anchor_cap,
        },
        "results": _encode_results(sysobj),
        "conflicts": _encode_conflicts(sysobj),
    }


def to_json(sysobj: SubtitleSystem, path: Optional[str] = None) -> Optional[str]:
    """写入文件（同目录临时文件 + 原子替换）；``path=None`` 时返回 JSON 字符串。"""
    payload = json.dumps(
        to_dict(sysobj), ensure_ascii=False, indent=2, sort_keys=False
    )
    if path is None:
        return payload
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".subalign-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(payload)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return None


# --------------------------------------------------------------------------- #
# 解码
# --------------------------------------------------------------------------- #
def _require(
    obj: Any, key: str, problems: List[str], path: str, expected: Tuple[type, ...]
) -> Any:
    if not isinstance(obj, dict) or key not in obj:
        problems.append(f"{path}：缺少字段 {key!r}")
        return None
    val = obj[key]
    if not isinstance(val, expected) or isinstance(val, bool) and bool not in expected:
        names = "/".join(t.__name__ for t in expected)
        problems.append(
            f"{path}.{key}：类型错误，期望 {names}，实际 {type(val).__name__}"
        )
        return None
    return val


def _decode_entries(raw: Any, problems: List[str], path: str) -> Optional[List[Entry]]:
    if not isinstance(raw, list):
        problems.append(f"{path}：entries 必须是列表")
        return None
    entries: List[Entry] = []
    for i, item in enumerate(raw):
        p = f"{path}.entries[{i}]"
        if not isinstance(item, dict):
            problems.append(f"{p}：必须是对象")
            continue
        start = _require(item, "start", problems, p, (int, float))
        end = _require(item, "end", problems, p, (int, float))
        text = _require(item, "text", problems, p, (str,))
        if start is None or end is None or text is None:
            continue
        if not isinstance(start, int) or isinstance(start, bool):
            problems.append(f"{p}.start：必须是整数毫秒")
            continue
        if not isinstance(end, int) or isinstance(end, bool):
            problems.append(f"{p}.end：必须是整数毫秒")
            continue
        entries.append(Entry(start=int(start), end=int(end), text=text))
    return entries


def from_dict(data: Any) -> SubtitleSystem:
    """从普通字典构建系统，全量校验并重算比对；失败抛 :class:`PersistenceError`。"""
    problems: List[str] = []
    if not isinstance(data, dict):
        raise PersistenceError("文件根节点必须是 JSON 对象")
    if data.get("format") != FORMAT:
        problems.append(f"format 必须为 {FORMAT!r}，实际为 {data.get('format')!r}")
    if data.get("version") != VERSION:
        problems.append(f"version 必须为 {VERSION}，实际为 {data.get('version')!r}")

    # ---- 基准 ----
    ref_raw = data.get("reference")
    reference: Optional[Reference] = None
    if not isinstance(ref_raw, dict):
        problems.append("reference：缺少或不是对象")
    else:
        source = _require(ref_raw, "source", problems, "reference", (str,))
        entries = _decode_entries(ref_raw.get("entries"), problems, "reference")
        if source is not None and entries is not None:
            try:
                reference = Reference(entries=entries, source=source)
            except ValidationError as ex:
                problems.append(str(ex))

    # ---- 轨（唯一性在此显式检查） ----
    tracks: List[SubtitleTrack] = []
    track_ids: set = set()
    tracks_raw = data.get("tracks")
    if not isinstance(tracks_raw, list):
        problems.append("tracks：缺少或不是列表")
    else:
        for ti, traw in enumerate(tracks_raw):
            p = f"tracks[{ti}]"
            if not isinstance(traw, dict):
                problems.append(f"{p}：必须是对象")
                continue
            tid = _require(traw, "id", problems, p, (str,))
            source = _require(traw, "source", problems, p, (str,))
            entries = _decode_entries(traw.get("entries"), problems, p)
            if tid is None or source is None or entries is None:
                continue
            if tid in track_ids:
                problems.append(f"{p}：轨标识重复 {tid!r}")
                continue
            track_ids.add(tid)
            try:
                tracks.append(SubtitleTrack(track_id=tid, source=source, entries=entries))
            except ValidationError as ex:
                problems.append(str(ex))

    # ---- 配置 ----
    config: Optional[AlignConfig] = None
    cfg_raw = data.get("config")
    if cfg_raw is None:
        config = AlignConfig()
    elif not isinstance(cfg_raw, dict):
        problems.append("config：不是对象")
    else:
        kwargs: Dict[str, Any] = {}
        p = "config"
        for key in (
            "similarity_threshold",
            "min_anchors",
            "cut_residual_factor",
            "min_cut_gap_ms",
            "tolerance_ms",
            "conflict_shift_eps_ms",
            "fuzzy_anchor_cap",
        ):
            if key in cfg_raw:
                val = cfg_raw[key]
                if isinstance(val, bool) or not isinstance(val, (int, float)):
                    problems.append(f"{p}.{key}：必须是数字")
                else:
                    kwargs[key] = val
        if "conflict_rate_eps" in cfg_raw:
            fr = parse_frac(cfg_raw["conflict_rate_eps"], problems, f"{p}.conflict_rate_eps")
            if fr is not None:
                kwargs["conflict_rate_eps"] = fr
        try:
            if not problems:
                config = AlignConfig(**kwargs)
        except ValidationError as ex:
            problems.append(str(ex))

    # ---- results 结构完整性（字段缺失在此报出） ----
    results_raw = data.get("results")
    if results_raw is None:
        problems.append("results：缺少 results 字段")
    elif not isinstance(results_raw, dict):
        problems.append("results：必须是对象")
    else:
        for tid in track_ids:
            if tid not in results_raw:
                problems.append(f"results：缺少轨 {tid!r} 的对齐结果")
                continue
            _check_result_shape(results_raw[tid], f"results.{tid}", problems)
        for extra in set(results_raw) - track_ids:
            problems.append(f"results：包含未知轨 {extra!r}")
    conflicts_raw = data.get("conflicts")
    if conflicts_raw is None:
        problems.append("conflicts：缺少字段")
    elif not isinstance(conflicts_raw, list):
        problems.append("conflicts：必须是列表")

    if problems or reference is None:
        raise PersistenceError("文件校验失败，未载入任何内容", sorted(set(problems)))

    # ---- 构建临时系统并重算（原子性：只有全部成功才返回） ----
    assert config is not None
    tmp = SubtitleSystem(reference, tracks, config)
    tmp.align()

    expected_results = _encode_results(tmp)
    _compare_results(results_raw, tmp, problems)
    _compare_conflicts(conflicts_raw, tmp.conflicts(), problems)

    if problems:
        raise PersistenceError(
            "存储结果与重算结果不一致（文件可能已损坏或参数不自洽），未载入",
            sorted(set(problems)),
        )
    return tmp


def _check_result_shape(raw: Any, path: str, problems: List[str]) -> None:
    if not isinstance(raw, dict):
        problems.append(f"{path}：必须是对象")
        return
    for key in ("status", "anchors", "segments", "bias", "tolerance"):
        if key not in raw:
            problems.append(f"{path}：缺少字段 {key!r}")
    if "anchors" in raw and not isinstance(raw["anchors"], list):
        problems.append(f"{path}.anchors：必须是列表")
    elif isinstance(raw.get("anchors"), list):
        for i, a in enumerate(raw["anchors"]):
            if not isinstance(a, dict):
                problems.append(f"{path}.anchors[{i}]：必须是对象")
                continue
            for key in ("ref_index", "cand_index", "ref_mid", "cand_mid", "score", "kind"):
                if key not in a:
                    problems.append(f"{path}.anchors[{i}]：缺少字段 {key!r}")
    if "segments" in raw and not isinstance(raw["segments"], list):
        problems.append(f"{path}.segments：必须是列表")
    elif isinstance(raw.get("segments"), list):
        for i, s in enumerate(raw["segments"]):
            sp = f"{path}.segments[{i}]"
            if not isinstance(s, dict):
                problems.append(f"{sp}：必须是对象")
                continue
            for key in ("index", "ratio", "shift", "domain_lo", "domain_hi", "anchors"):
                if key not in s:
                    problems.append(f"{sp}：缺少字段 {key!r}")
            if "ratio" in s:
                parse_frac(s["ratio"], problems, f"{sp}.ratio")
            if "shift" in s:
                parse_frac(s["shift"], problems, f"{sp}.shift")
    bias = raw.get("bias")
    if isinstance(bias, dict):
        for key in ("shift_ms", "rate_ratio", "missing_intervals"):
            if key not in bias:
                problems.append(f"{path}.bias：缺少字段 {key!r}")
        if "shift_ms" in bias:
            parse_frac(bias["shift_ms"], problems, f"{path}.bias.shift_ms")
        if "rate_ratio" in bias:
            parse_frac(bias["rate_ratio"], problems, f"{path}.bias.rate_ratio")
        mi = bias.get("missing_intervals")
        if mi is not None and not isinstance(mi, list):
            problems.append(f"{path}.bias.missing_intervals：必须是列表")
        elif isinstance(mi, list):
            for j, m in enumerate(mi):
                mp = f"{path}.bias.missing_intervals[{j}]"
                if not isinstance(m, dict):
                    problems.append(f"{mp}：必须是对象")
                    continue
                for key in ("ref_lo", "ref_hi", "duration_ms", "confidence",
                            "left_anchor", "right_anchor"):
                    if key not in m:
                        problems.append(f"{mp}：缺少字段 {key!r}")
    tol = raw.get("tolerance")
    if isinstance(tol, dict) and "tolerance_ms" not in tol:
        problems.append(f"{path}.tolerance：缺少字段 tolerance_ms")


def _norm_anchor(raw: Dict[str, Any]) -> Tuple[int, int, int, int, str, float]:
    return (
        int(raw["ref_index"]),
        int(raw["cand_index"]),
        int(raw["ref_mid"]),
        int(raw["cand_mid"]),
        str(raw["kind"]),
        _r6(raw["score"]),
    )


def _compare_results(raw: Dict[str, Any], rebuilt: SubtitleSystem, problems: List[str]) -> None:
    """逐轨把存储结果与临时系统的重算结果精确比对。"""
    for tid in rebuilt.track_ids():
        exp = rebuilt.report(tid)
        got = raw.get(tid)
        if not isinstance(got, dict):
            problems.append(f"results.{tid}：缺少或不是对象")
            continue
        if got.get("status") != exp.status:
            problems.append(
                f"results.{tid}.status：存储 {got.get('status')!r}，重算 {exp.status!r}"
            )
        ga = [_norm_anchor(a) for a in got.get("anchors", []) if isinstance(a, dict)]
        ea = [_norm_anchor(_encode_anchor(a)) for a in exp.anchors]
        if ga != ea:
            problems.append(f"results.{tid}.anchors：与重算锚点不一致")
        gs = got.get("segments", [])
        if len(gs) != len(exp.segments):
            problems.append(
                f"results.{tid}.segments：段数存储 {len(gs)}，重算 {len(exp.segments)}"
            )
            continue
        for i, (g, es) in enumerate(zip(gs, exp.segments)):
            sp = f"results.{tid}.segments[{i}]"
            if not isinstance(g, dict):
                problems.append(f"{sp}：必须是对象")
                continue
            if _frac_of(g.get("ratio")) != es.ratio:
                problems.append(f"{sp}.ratio：与重算不一致")
            if _frac_of(g.get("shift")) != es.shift:
                problems.append(f"{sp}.shift：与重算不一致")
            if g.get("domain_lo") != es.domain_lo or g.get("domain_hi") != es.domain_hi:
                problems.append(f"{sp}：段域与重算不一致")
            ganc = sorted(tuple(p) for p in g.get("anchors", []))
            eanc = sorted((a.ref_index, a.cand_index) for a in es.anchors)
            if ganc != eanc:
                problems.append(f"{sp}.anchors：与重算不一致")
            if _frac_of(g.get("residual_mse")) != es.residual_mse:
                problems.append(f"{sp}.residual_mse：与重算不一致")
        # 偏差分项
        gb = got.get("bias", {})
        if _frac_of(gb.get("shift_ms")) != exp.bias.shift_ms:
            problems.append(f"results.{tid}.bias.shift_ms：与重算不一致")
        if _frac_of(gb.get("rate_ratio")) != exp.bias.rate_ratio:
            problems.append(f"results.{tid}.bias.rate_ratio：与重算不一致")
        gm = [
            (
                int(m["ref_lo"]),
                int(m["ref_hi"]),
                int(m.get("duration_ms", -1)),
                tuple(m.get("left_anchor", [])),
                tuple(m.get("right_anchor", [])),
                round(float(m.get("confidence", -1.0)), 6),
            )
            for m in gb.get("missing_intervals", [])
        ]
        em = [
            (
                m.ref_lo,
                m.ref_hi,
                m.duration_ms,
                m.left_anchor,
                m.right_anchor,
                round(m.confidence, 6),
            )
            for m in exp.bias.missing_intervals
        ]
        if sorted(gm) != sorted(em):
            problems.append(f"results.{tid}.bias.missing_intervals：与重算不一致")
        # 容差
        gv = [
            (int(v["ref_start"]), int(v["ref_end"]), int(v["max_residual"]))
            for v in got.get("tolerance", {}).get("violations", [])
        ]
        ev = [
            (v.ref_start, v.ref_end, v.max_residual)
            for v in exp.tolerance.violations
        ]
        if sorted(gv) != sorted(ev):
            problems.append(f"results.{tid}.tolerance.violations：与重算不一致")
        if got.get("tolerance", {}).get("tolerance_ms") != exp.tolerance.tolerance_ms:
            problems.append(f"results.{tid}.tolerance.tolerance_ms：与重算不一致")


def _frac_of(text: Any) -> Optional[Fraction]:
    """比对用的宽松解析（结构问题已在 shape 阶段收集）。"""
    if text is None:
        return None
    try:
        if isinstance(text, int):
            return Fraction(text)
        s = str(text).strip()
        if "/" not in s:
            return Fraction(s)
        n, _, d = s.partition("/")
        return Fraction(int(n), int(d))
    except (ValueError, ZeroDivisionError):
        return None


def _compare_conflicts(
    raw: List[Any], expected: List[Conflict], problems: List[str]
) -> None:
    def key_of(c: Dict[str, Any]) -> Tuple:
        return (
            int(c["interval_ref_lo"]),
            int(c["interval_ref_hi"]),
            str(c["track_a"]["track_id"]),
            str(c["track_b"]["track_id"]),
        )

    def exp_key(c: Conflict) -> Tuple:
        return (c.interval_ref_lo, c.interval_ref_hi, c.track_a.track_id, c.track_b.track_id)

    try:
        got = sorted((c for c in raw if isinstance(c, dict)), key=key_of)
    except (KeyError, TypeError):
        problems.append("conflicts：存在结构不完整的记录")
        return
    exp = sorted(expected, key=exp_key)
    if len(got) != len(exp):
        problems.append(f"conflicts：记录数存储 {len(got)}，重算 {len(exp)}")
        return
    for g, e in zip(got, exp):
        k = exp_key(e)
        if key_of(g) != k:
            problems.append("conflicts：区间或双方来源与重算不一致")
            continue
        if _frac_of(g.get("rate_delta")) != e.rate_delta:
            problems.append(f"conflicts {k}：rate_delta 与重算不一致")
        if _frac_of(g.get("shift_delta_ms")) != e.shift_delta_ms:
            problems.append(f"conflicts {k}：shift_delta_ms 与重算不一致")
        sides = (("track_a", e.track_a), ("track_b", e.track_b))
        for side_name, side in sides:
            if _frac_of(g[side_name].get("ratio")) != side.ratio:
                problems.append(f"conflicts {k}.{side_name}.ratio：与重算不一致")
            if _frac_of(g[side_name].get("shift")) != side.shift:
                problems.append(f"conflicts {k}.{side_name}.shift：与重算不一致")


def from_json_text(text: str) -> SubtitleSystem:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as ex:
        raise PersistenceError(f"JSON 解析失败：{ex}") from ex
    return from_dict(data)


def from_json(path: str) -> SubtitleSystem:
    """从文件载入；任何失败都抛 :class:`PersistenceError`，不产生半成品。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as ex:
        raise PersistenceError(f"无法读取文件 {path!r}：{ex}") from ex
    return from_json_text(text)
