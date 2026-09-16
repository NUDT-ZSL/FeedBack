"""人类可读的对齐报告（中文纯文本）。

这是“可复核校正依据”的阅读视图；机器可读的完整数据在 JSON 导出文件里。
"""

from __future__ import annotations

from fractions import Fraction
from typing import List

from .model import AlignmentReport, Conflict, SegmentQuery
from .system import SubtitleSystem
from .timecode import format_millis


def _frac_ms(value: Fraction) -> str:
    """Fraction 毫秒 → 可读字符串，整毫秒不带小数。"""
    if value.denominator == 1:
        return f"{int(value)}ms"
    return f"{float(value):.3f}ms"


def _unitless(value: Fraction) -> str:
    if value.denominator == 1:
        return f"{int(value)}"
    return f"{float(value):.3f}"


def render_track(report: AlignmentReport) -> str:
    lines: List[str] = []
    lines.append(f"轨 {report.track_id!r}  状态={report.status}")
    if report.note:
        lines.append(f"  说明：{report.note}")
    b = report.bias
    lines.append(
        "  偏差分项："
        f"整体平移 shift={_frac_ms(b.shift_ms)}（置信度 {b.shift_confidence:.2f}）；"
        f"速率比 ratio={float(b.rate_ratio):.6f}（置信度 {b.rate_confidence:.2f}）；"
        f"局部缺失 {len(b.missing_intervals)} 处"
    )
    lines.append(f"    平移依据：{b.shift_basis}")
    lines.append(f"    速率依据：{b.rate_basis}")
    for m in b.missing_intervals:
        lines.append(
            "  缺失区间："
            f"{format_millis(m.ref_lo)} ~ {format_millis(m.ref_hi)} "
            f"（{m.duration_ms}ms，置信度 {m.confidence:.2f}）"
        )
        lines.append(f"    左锚点 {m.left_anchor}，右锚点 {m.right_anchor}")
        lines.append(f"    依据：{m.reason}")
    for s in report.segments:
        dom_lo = "-∞" if s.domain_lo is None else format_millis(s.domain_lo)
        dom_hi = "+∞" if s.domain_hi is None else format_millis(s.domain_hi)
        lines.append(
            f"  段 {s.index}：候选域 [{dom_lo}, {dom_hi})  "
            f"ref = {float(s.ratio):.7f}·cand + {_frac_ms(s.shift)}  "
            f"锚点 {len(s.anchors)} 个，最大残差 {s.residual_max_abs}ms"
        )
        for a in s.anchors:
            lines.append(
                f"      [{a.kind:5s}] 基准#{a.ref_index}@{format_millis(a.ref_mid)} "
                f"↔ 候选#{a.cand_index}@{format_millis(a.cand_mid)} "
                f"score={a.score:.3f} | {a.evidence}"
            )
    tol = report.tolerance
    if tol.within_tolerance:
        lines.append(f"  容差 {tol.tolerance_ms}ms：全部锚点在容差内")
    else:
        lines.append(f"  容差 {tol.tolerance_ms}ms：{len(tol.violations)} 个超限区间")
        for v in tol.violations:
            lines.append(
                f"      超限 {format_millis(v.ref_start)} ~ {format_millis(v.ref_end)} "
                f"最大残差 {v.max_residual}ms，锚点 {list(v.anchor_points)}"
            )
    return "\n".join(lines)


def render_conflict(c: Conflict) -> str:
    return (
        "冲突："
        f"{format_millis(c.interval_ref_lo)} ~ {format_millis(c.interval_ref_hi)}\n"
        f"  来源 A {c.track_a.track_id!r} 段{c.track_a.segment_index}："
        f"ratio={float(c.track_a.ratio):.7f} shift={_frac_ms(c.track_a.shift)}\n"
        f"  来源 B {c.track_b.track_id!r} 段{c.track_b.segment_index}："
        f"ratio={float(c.track_b.ratio):.7f} shift={_frac_ms(c.track_b.shift)}\n"
        f"  速率差={float(c.rate_delta):.5f}，中点错位={_frac_ms(c.shift_delta_ms)}\n"
        f"  原因：{c.reason}"
    )


def render_query(q: SegmentQuery) -> str:
    return (
        f"查询 轨 {q.track_id!r} @候选 {format_millis(q.cand_ms)}\n"
        f"  校正后基准时刻：{format_millis(round(float(q.corrected_ms)))}"
        f"（精确值 {_frac_ms(q.corrected_ms)}），使用段 {q.segment_index}\n"
        f"  参数：ratio={float(q.ratio):.7f}，shift={_frac_ms(q.shift)}\n"
        f"  外推：{'是' if q.extrapolated else '否'}；"
        f"缺失分界点：{'是' if q.in_missing_gap else '否'}；"
        f"段均方误差 {_unitless(q.residual_mse)}ms²\n"
        f"  参与拟合锚点（{len(q.anchors)} 个）："
        + ", ".join(f"#{a.ref_index}/#{a.cand_index}" for a in q.anchors)
    )


def render_system(sysobj: SubtitleSystem) -> str:
    parts = [
        "=" * 72,
        f"基准时间轴（来源 {sysobj.reference.source!r}，"
        f"{len(sysobj.reference.entries)} 条）",
    ]
    for tid in sysobj.track_ids():
        parts.append("-" * 72)
        parts.append(render_track(sysobj.report(tid)))
    conflicts = sysobj.conflicts()
    if conflicts:
        parts.append("-" * 72)
        parts.append(f"冲突记录 {len(conflicts)} 条（双方参数均保留，未静默择一）：")
        for c in conflicts:
            parts.append(render_conflict(c))
    parts.append("=" * 72)
    return "\n".join(parts)
