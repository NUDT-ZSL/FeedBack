"""JSON 快照持久化。

快照包含：逻辑时钟、改版、分群、观测、构成阈值，以及由它们确定性重算的
**归因结果**（各改版报告、各体验项来源链）。

载入时依次校验：

1. JSON 可解析、顶层结构与必填字段；
2. 标识唯一（改版 id、分群 id、观测键）、时刻合法（int、不晚于时钟）；
3. 归属自洽（观测引用的分群存在且当时有活动成员、纪元严格递增等）；
4. 贡献守恒：重算每个可计算的改版报告与每条来源链，复查
   ``结构 + 真实 == 总变化``、``段贡献之和 == 首末总变化``，并与快照中
   存储的归因结果逐项比对；
5. 快照中存储的归因数字本身也独立做一次守恒检查（防止只改结果段）。

任何一步失败都抛 :class:`ValidationError`（带位置）；由于先在全新引擎上
重建、成功后才返回，**失败不影响调用方已有的引擎状态**。保存采用
“临时文件 + 原子替换”，写到一半不会破坏旧快照。
"""

import json
import math
import os
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from .clock import LogicalClock
from .engine import (
    DEFAULT_COMPOSITION_THRESHOLD,
    NATURAL_LABEL,
    AttributionEngine,
)
from .errors import ValidationError, require

FORMAT_VERSION = 1
_TOL = 1e-7


# ---------------------------------------------------------------------------
# 归因结果序列化
# ---------------------------------------------------------------------------


def _segment_attr_dict(a) -> Dict[str, Any]:
    return {
        "segment_id": a.segment_id,
        "total": a.total,
        "structural": a.structural,
        "real": a.real,
        "mix": a.mix,
        "composition_migration": a.composition_migration,
        "overlap": a.overlap,
        "attributed_to_composition": a.attributed_to_composition,
        "before_value": a.before_value,
        "after_value": a.after_value,
        "before_weight": a.before_weight,
        "after_weight": a.after_weight,
        "before_count": a.before_count,
        "after_count": a.after_count,
    }


def _report_dict(report) -> Dict[str, Any]:
    return {
        "revision_id": report.revision.id,
        "items": [
            {
                "item": it.item,
                "before_time": it.before_time,
                "after_time": it.after_time,
                "total": it.total,
                "structural": it.structural,
                "real": it.real,
                "canceled_by_structure": it.canceled_by_structure,
                "segment_shares": [[s, v] for s, v in it.segment_shares],
                "composition_segments": list(it.composition_segments),
                "excluded_segments": list(it.excluded_segments),
                "segments": [_segment_attr_dict(a)
                             for a in it.segment_attributions],
            }
            for it in report.items
        ],
    }


def _chain_dict(chain) -> Dict[str, Any]:
    return {
        "item": chain.item,
        "start_time": chain.start_time,
        "end_time": chain.end_time,
        "start_value": chain.start_value,
        "end_value": chain.end_value,
        "total_change": chain.total_change,
        "panel_segments": list(chain.panel_segments),
        "excluded_segments": list(chain.excluded_segments),
        "segments": [
            {
                "revision_id": s.revision_id,
                "window_start": s.window_start,
                "window_end": s.window_end,
                "contribution": s.contribution,
                "structural": s.structural,
                "real": s.real,
                "canceled_by_structure": s.canceled_by_structure,
            }
            for s in chain.segments
        ],
    }


def _compute_results(engine: AttributionEngine) -> Dict[str, Any]:
    """计算全部当前可计算的归因结果（数据不足的项跳过）。"""
    reports: List[Dict[str, Any]] = []
    for rev in engine.revisions:
        try:
            reports.append(_report_dict(engine.attribute_revision(rev.id)))
        except ValidationError:
            continue  # 观测不足的合法中间态

    affected = sorted({item for rev in engine.revisions for item in rev.items})
    chains: List[Dict[str, Any]] = []
    for item in affected:
        try:
            chains.append(_chain_dict(engine.item_chain(item)))
        except ValidationError:
            continue
    return {"reports": reports, "chains": chains}


# ---------------------------------------------------------------------------
# 导出 / 保存
# ---------------------------------------------------------------------------


def to_dict(engine: AttributionEngine) -> Dict[str, Any]:
    return {
        "format_version": FORMAT_VERSION,
        "clock": {"now": engine.clock.now},
        "composition_threshold": engine.composition_threshold,
        "revisions": [
            {"id": r.id, "time": r.time, "items": list(r.items)}
            for r in engine.revisions
        ],
        "segments": [
            {"id": s.id,
             "epochs": [{"time": e.time, "users": list(e.users)}
                        for e in s.epochs]}
            for s in engine.segments
        ],
        "observations": [
            {"segment_id": sid, "time": t, "item": item, "value": value}
            for sid, t, item, value in engine.raw_observations()
        ],
        "attribution": _compute_results(engine),
    }


def save(engine: AttributionEngine, path: str) -> None:
    """原子写入快照到 ``path``。"""
    data = json.dumps(to_dict(engine), ensure_ascii=False, indent=2,
                      sort_keys=True, allow_nan=False)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".attr-snapshot-", suffix=".tmp",
                               dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# 载入
# ---------------------------------------------------------------------------


def _field(obj: Dict[str, Any], key: str, path: str, typ: type) -> Any:
    require(isinstance(obj, dict), "该节点应为对象", path)
    require(key in obj, f"缺少必填字段 {key!r}", f"{path}.{key}")
    val = obj[key]
    if typ is int:
        require(isinstance(val, int) and not isinstance(val, bool),
                f"字段 {key!r} 必须是整数", f"{path}.{key}")
    elif typ is float:
        require(isinstance(val, (int, float))
                and not isinstance(val, bool),
                f"字段 {key!r} 必须是数值", f"{path}.{key}")
    elif typ is str:
        require(isinstance(val, str) and val.strip(),
                f"字段 {key!r} 必须是非空字符串", f"{path}.{key}")
    elif typ is list:
        require(isinstance(val, list), f"字段 {key!r} 必须是数组",
                f"{path}.{key}")
    elif typ is dict:
        require(isinstance(val, dict), f"字段 {key!r} 必须是对象",
                f"{path}.{key}")
    return val


def _num(obj: Dict[str, Any], key: str, path: str) -> float:
    require(key in obj, f"缺少必填字段 {key!r}", f"{path}.{key}")
    val = obj[key]
    require(isinstance(val, (int, float)) and not isinstance(val, bool),
            f"字段 {key!r} 必须是数值", f"{path}.{key}")
    val = float(val)
    require(val == val and val not in (float("inf"), float("-inf")),
            f"字段 {key!r} 不允许 NaN/Inf", f"{path}.{key}")
    return val


def _close(a: float, b: float) -> bool:
    return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=_TOL)


def _rebuild(data: Any) -> AttributionEngine:
    """在全新引擎上重建并全量校验；失败抛 ValidationError。"""
    require(isinstance(data, dict), "快照顶层必须是 JSON 对象", "")

    version = _field(data, "format_version", "", int)
    require(version == FORMAT_VERSION,
            f"不支持的快照格式版本 {version}（支持 {FORMAT_VERSION}）",
            "format_version")

    clock_obj = _field(data, "clock", "", dict)
    now = _field(clock_obj, "now", "clock", int)
    require(now >= 0, "逻辑时钟时刻不能为负", "clock.now")

    threshold = data.get("composition_threshold",
                         DEFAULT_COMPOSITION_THRESHOLD)
    require(isinstance(threshold, (int, float))
            and not isinstance(threshold, bool)
            and 0.0 <= float(threshold) <= 1.0,
            "composition_threshold 必须是 [0, 1] 内的数值",
            "composition_threshold")

    engine = AttributionEngine(
        clock=LogicalClock(now), composition_threshold=float(threshold))

    # --- 改版 ---
    rev_rows = _field(data, "revisions", "", list)
    for i, row in enumerate(rev_rows):
        p = f"revisions[{i}]"
        require(isinstance(row, dict), "改版记录必须是对象", p)
        rid = _field(row, "id", p, str)
        rtime = _field(row, "time", p, int)
        items = _field(row, "items", p, list)
        engine.register_revision(rid, rtime, items)

    # --- 分群（归属裁决由全量纪元确定性推导，与文件登记顺序无关） ---
    seg_rows = _field(data, "segments", "", list)
    for i, row in enumerate(seg_rows):
        p = f"segments[{i}]"
        require(isinstance(row, dict), "分群记录必须是对象", p)
        sid = _field(row, "id", p, str)
        epoch_rows = _field(row, "epochs", p, list)
        require(epoch_rows, "分群至少需要一个构成纪元", f"{p}.epochs")
        epochs = []
        for j, er in enumerate(epoch_rows):
            ep = f"{p}.epochs[{j}]"
            require(isinstance(er, dict), "纪元记录必须是对象", ep)
            etime = _field(er, "time", ep, int)
            users = _field(er, "users", ep, list)
            epochs.append((etime, users))
        first_time, first_users = epochs[0]
        engine.register_segment(sid, first_time, first_users)
        for etime, users in epochs[1:]:
            engine.replace_composition(sid, etime, users)

    # --- 观测：显式查重（同键不同值 = 损坏） ---
    obs_rows = _field(data, "observations", "", list)
    seen: Dict[tuple, float] = {}
    for i, row in enumerate(obs_rows):
        p = f"observations[{i}]"
        require(isinstance(row, dict), "观测记录必须是对象", p)
        sid = _field(row, "segment_id", p, str)
        t = _field(row, "time", p, int)
        item = _field(row, "item", p, str)
        value = _num(row, "value", p)
        key = (sid, t, item.strip())
        if key in seen:
            require(_close(seen[key], value),
                    f"同一观测键 (segment={sid!r}, time={t}, "
                    f"item={item!r}) 存在冲突值：{seen[key]} != {value}", p)
            continue  # 完全重复：幂等接受
        seen[key] = value
        try:
            engine.observe(sid, t, item, value)
        except ValidationError as e:
            raise e.at(f"{p}.{e.path}" if e.path else p)

    # --- 归因结果：守恒自查 + 与重算结果比对 ---
    stored = data.get("attribution")
    if stored is not None:
        require(isinstance(stored, dict),
                "attribution 必须是对象", "attribution")
        _check_stored_conservation(stored)
        _compare_with_recomputed(engine, stored)

    return engine


def _check_stored_conservation(attribution: Dict[str, Any]) -> None:
    """对快照里存的归因数字独立做守恒检查（不依赖重算）。"""
    reports = _field(attribution, "reports", "attribution", list)
    for i, rep in enumerate(reports):
        rp = f"attribution.reports[{i}]"
        require(isinstance(rep, dict), "报告必须是对象", rp)
        for j, it in enumerate(_field(rep, "items", rp, list)):
            ip = f"{rp}.items[{j}]"
            total = _num(it, "total", ip)
            structural = _num(it, "structural", ip)
            real = _num(it, "real", ip)
            require(abs(structural + real - total) < _TOL,
                    f"存储的归因结果不守恒：结构({structural}) + 真实("
                    f"{real}) != 总变化({total})", ip)
            for k, a in enumerate(_field(it, "segments", ip, list)):
                ap = f"{ip}.segments[{k}]"
                atot = _num(a, "total", ap)
                require(abs(_num(a, "structural", ap)
                            + _num(a, "real", ap) - atot) < _TOL,
                        "存储的分群归因结构+真实 != 总变化", ap)
                require(abs(_num(a, "mix", ap)
                            + _num(a, "composition_migration", ap)
                            + _num(a, "real", ap) - atot) < _TOL,
                        "存储的分群分解成分之和 != 总变化", ap)

    chains = _field(attribution, "chains", "attribution", list)
    for i, ch in enumerate(chains):
        cp = f"attribution.chains[{i}]"
        require(isinstance(ch, dict), "来源链必须是对象", cp)
        total_change = _num(ch, "total_change", cp)
        segs = _field(ch, "segments", cp, list)
        seg_sum = 0.0
        for k, s in enumerate(segs):
            sp = f"{cp}.segments[{k}]"
            contrib = _num(s, "contribution", sp)
            require(abs(_num(s, "structural", sp) + _num(s, "real", sp)
                        - contrib) < _TOL,
                    "存储的来源链段结构+真实 != 段贡献", sp)
            seg_sum += contrib
        require(abs(seg_sum - total_change) < _TOL,
                f"存储的来源链段贡献之和 ({seg_sum}) != 首末总变化 "
                f"({total_change})，守恒被破坏", cp)


def _assert_close_dict(path: str, stored: Dict[str, Any],
                       recomputed: Dict[str, Any],
                       numeric_fields: Tuple[str, ...]) -> None:
    for key in numeric_fields:
        require(key in stored, f"归因结果缺少字段 {key!r}", f"{path}.{key}")
        sv, rv = float(stored[key]), float(recomputed[key])
        require(_close(sv, rv),
                f"归因结果与重算不一致：{key} 存储值 {sv} != 重算值 {rv}",
                f"{path}.{key}")


def _compare_with_recomputed(engine: AttributionEngine,
                             stored: Dict[str, Any]) -> None:
    """用当前数据重算，与快照中的归因结果逐项比对。"""
    fresh = _compute_results(engine)

    stored_reports = {r["revision_id"]: r for r in stored["reports"]}
    fresh_reports = {r["revision_id"]: r for r in fresh["reports"]}
    require(stored_reports.keys() == fresh_reports.keys(),
            f"可计算改版集合不一致：存储 {sorted(stored_reports)} "
            f"!= 重算 {sorted(fresh_reports)}", "attribution.reports")

    for rid, srep in stored_reports.items():
        frep = fresh_reports[rid]
        s_items = {it["item"]: it for it in srep["items"]}
        f_items = {it["item"]: it for it in frep["items"]}
        require(s_items.keys() == f_items.keys(),
                f"改版 {rid} 的体验项集合不一致", "attribution.reports")
        for item, sit in s_items.items():
            fit = f_items[item]
            ip = f"attribution.reports[{rid}].items[{item}]"
            _assert_close_dict(ip, sit, fit,
                               ("before_time", "after_time", "total",
                                "structural", "real",
                                "canceled_by_structure"))
            require(sit["composition_segments"]
                    == fit["composition_segments"],
                    "构成归因分群列表与重算不一致", ip)
            s_seg = {a["segment_id"]: a for a in sit["segments"]}
            f_seg = {a["segment_id"]: a for a in fit["segments"]}
            require(s_seg.keys() == f_seg.keys(),
                    "分群归因集合与重算不一致", ip)
            for sid, sa in s_seg.items():
                _assert_close_dict(f"{ip}.segments[{sid}]", sa, f_seg[sid],
                                   ("total", "structural", "real", "mix",
                                    "composition_migration", "overlap",
                                    "before_value", "after_value",
                                    "before_weight", "after_weight",
                                    "before_count", "after_count"))

    stored_chains = {c["item"]: c for c in stored["chains"]}
    fresh_chains = {c["item"]: c for c in fresh["chains"]}
    require(stored_chains.keys() == fresh_chains.keys(),
            "可计算来源链集合与重算不一致", "attribution.chains")
    for item, sc in stored_chains.items():
        fc = fresh_chains[item]
        cp = f"attribution.chains[{item}]"
        _assert_close_dict(cp, sc, fc,
                           ("start_time", "end_time", "start_value",
                            "end_value", "total_change"))
        require(len(sc["segments"]) == len(fc["segments"]),
                "来源链段数与重算不一致", cp)
        for k, (ss, fs) in enumerate(zip(sc["segments"], fc["segments"])):
            sp = f"{cp}.segments[{k}]"
            require(ss["revision_id"] == fs["revision_id"]
                    and ss["window_start"] == fs["window_start"]
                    and ss["window_end"] == fs["window_end"],
                    "来源链段归属或窗口与重算不一致", sp)
            _assert_close_dict(sp, ss, fs,
                               ("contribution", "structural", "real",
                                "canceled_by_structure"))


def load_dict(data: Any) -> AttributionEngine:
    """从内存快照字典重建引擎（失败抛 ValidationError）。"""
    return _rebuild(data)


def load(path: str) -> AttributionEngine:
    """从 JSON 文件载入引擎。

    文件损坏 / 字段缺失 / 守恒被破坏时抛 :class:`ValidationError`；
    本函数始终返回全新引擎，调用方原有的引擎状态不会被改动。
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        raise ValidationError(f"快照文件不存在：{path}", path)
    except OSError as e:
        raise ValidationError(f"快照文件无法读取：{e}", path)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValidationError(
            f"快照不是合法 JSON：第 {e.lineno} 行第 {e.colno} 列："
            f"{e.msg}", path)
    return _rebuild(data)
