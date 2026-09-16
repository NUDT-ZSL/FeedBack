"""容差报告与跨轨冲突检测。"""

from __future__ import annotations

from fractions import Fraction
from typing import Dict, List, Sequence, Tuple

from .model import (
    AlignmentReport,
    Conflict,
    ConflictParams,
    Entry,
    Segment,
    ToleranceReport,
    ToleranceViolation,
)
from .timecode import format_millis


# --------------------------------------------------------------------------- #
# 容差
# --------------------------------------------------------------------------- #
def build_tolerance_report(
    ref_entries: Sequence[Entry],
    segments: Sequence[Segment],
    anchors: Sequence[Anchor],
    tolerance_ms: int,
) -> ToleranceReport:
    """逐锚点计算残差（基准中点 - 校正值），按基准条目时间合并超限区间。

    锚点的基准索引未必连续（中间有条目没匹配上），因此合并条件是
    “对应基准条目时间区间重叠或相接”，而非索引相邻。
    输出顺序：按基准起点升序（稳定）。
    """
    bad: List[Tuple[int, int, int, Tuple[int, int]]] = []
    if not segments:
        # 没有可用校正模型（锚点不足）：无法计算残差，返回空超限列表，
        # 调用方应通过 report.status == 'insufficient_anchors' 获知。
        return ToleranceReport(tolerance_ms=tolerance_ms, violations=())
    for a in sorted(anchors, key=lambda x: (x.ref_mid, x.cand_mid)):
        seg = _segment_for_cand(segments, a.cand_mid)
        pred = seg.correct(a.cand_mid)
        residual = _round_fraction(a.ref_mid - pred)
        if abs(residual) > tolerance_ms:
            ref_e = ref_entries[a.ref_index]
            bad.append((ref_e.start, ref_e.end, residual, (a.ref_index, a.cand_index)))

    bad.sort(key=lambda b: (b[0], b[1]))
    violations: List[ToleranceViolation] = []
    for start, end, residual, point in bad:
        if violations and start <= violations[-1].ref_end:
            # 并入上一个区间（frozen dataclass 不可变，重建）。
            prev = violations[-1]
            violations[-1] = ToleranceViolation(
                ref_start=prev.ref_start,
                ref_end=max(prev.ref_end, end),
                max_residual=max(prev.max_residual, abs(residual)),
                anchor_points=tuple(sorted(prev.anchor_points + (point,))),
            )
        else:
            violations.append(
                ToleranceViolation(
                    ref_start=start,
                    ref_end=end,
                    max_residual=abs(residual),
                    anchor_points=(point,),
                )
            )
    return ToleranceReport(tolerance_ms=tolerance_ms, violations=tuple(violations))


def _segment_for_cand(segments: Sequence[Segment], cand_ms: int) -> Segment:
    for s in segments:
        if s.contains(cand_ms):
            return s
    return segments[-1]


def _round_fraction(value: Fraction) -> int:
    q, r = divmod(abs(value).numerator, value.denominator)
    if r * 2 >= value.denominator:
        q += 1
    return q if value >= 0 else -q


# --------------------------------------------------------------------------- #
# 冲突
# --------------------------------------------------------------------------- #
def _ref_coverage(seg: Segment) -> Tuple[int, int]:
    los = [a.ref_mid for a in seg.anchors]
    return min(los), max(los)


def detect_conflicts(
    reports: Dict[str, AlignmentReport],
    config_rate_eps: Fraction,
    config_shift_eps_ms: int,
) -> List[Conflict]:
    """在每两条轨的每对“基准覆盖区间相交”的段之间检查参数矛盾。

    判据（在共同基准区间上满足其一即矛盾，不静默择一，全部可逐步推导）：

    1. 速率比之差 ``|ratio_a - ratio_b| > conflict_rate_eps``
       —— 两轨对同一内容的来源帧率给出了互不相容的说法；
    2. 平移错位（对称定义）：设中点 m，各自逆映射
       ``c_a = (m-shift_a)/ratio_a``、``c_b = (m-shift_b)/ratio_b``，
       再把对方的候选时刻代入自己的校正：
       ``d = (|f_b(c_a)-m| + |f_a(c_b)-m|)/2
          = (ratio_a+ratio_b)/2 · |c_a-c_b|``
       超过 ``conflict_shift_eps_ms`` 即矛盾。
       速率相同时 d 就等于两轨截距之差（基准毫秒）；速率不同时它度量的是
       “若两轨共用同一来源时间码，在 m 处会偏离基准多远”，不会被斜率掩盖。

    不会静默择一：每条矛盾都原样保留。稳定排序：基准区间起点、终点、双方 id。
    """
    conflicts: List[Conflict] = []
    ids = sorted(reports)
    for x in range(len(ids)):
        for y in range(x + 1, len(ids)):
            id_a, id_b = ids[x], ids[y]
            ra, rb = reports[id_a], reports[id_b]
            for sa in ra.segments:
                cov_a = _ref_coverage(sa)
                for sb in rb.segments:
                    cov_b = _ref_coverage(sb)
                    lo = max(cov_a[0], cov_b[0])
                    hi = min(cov_a[1], cov_b[1])
                    if lo > hi:
                        continue
                    rate_delta = abs(sa.ratio - sb.ratio)
                    mid = Fraction(lo + hi, 2)
                    pos_a = (mid - sa.shift) / sa.ratio
                    pos_b = (mid - sb.shift) / sb.ratio
                    # 对称错位：互相代入对方逆映射出的候选时刻。
                    cross_a = abs(sb.ratio * pos_a + sb.shift - mid)
                    cross_b = abs(sa.ratio * pos_b + sa.shift - mid)
                    pos_delta = (cross_a + cross_b) / 2
                    rate_bad = rate_delta > config_rate_eps
                    shift_bad = pos_delta > config_shift_eps_ms
                    if not (rate_bad or shift_bad):
                        continue
                    reasons = []
                    if rate_bad:
                        reasons.append(
                            f"速率比差 {float(rate_delta):.4f} 超过阈值 {float(config_rate_eps):.4f}"
                        )
                    if shift_bad:
                        reasons.append(
                            f"区间中点处校正错位 {_round_fraction(pos_delta)}ms "
                            f"超过阈值 {config_shift_eps_ms}ms"
                        )
                    conflicts.append(
                        Conflict(
                            interval_ref_lo=lo,
                            interval_ref_hi=hi,
                            track_a=ConflictParams(
                                track_id=id_a,
                                segment_index=sa.index,
                                ratio=sa.ratio,
                                shift=sa.shift,
                                anchor_ref_range=cov_a,
                            ),
                            track_b=ConflictParams(
                                track_id=id_b,
                                segment_index=sb.index,
                                ratio=sb.ratio,
                                shift=sb.shift,
                                anchor_ref_range=cov_b,
                            ),
                            rate_delta=rate_delta,
                            shift_delta_ms=pos_delta,
                            reason=(
                                f"基准区间 {format_millis(lo)}~{format_millis(hi)}："
                                + "；".join(reasons)
                            ),
                        )
                    )
    conflicts.sort(key=lambda c: (c.interval_ref_lo, c.interval_ref_hi, c.key()))
    return conflicts
