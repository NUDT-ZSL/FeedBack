"""稳健线性拟合与切口（中段缺失）检测。

记号约定：一条候选字幕的时刻 ``c`` 校正到基准轴 ``r`` 满足

    r = ratio * c + shift

* ``ratio`` 是速率比（候选走 1ms 对应基准走 ratio ms；帧率漂移时 ratio ≠ 1）；
* ``shift`` 是整体平移（毫秒）。

数学要点：

* 所有运算用 :class:`fractions.Fraction`，斜率/截距精确可复现；
* 切口检测对每个相邻锚点分界取两侧局部窗口（各最多 3 点）各自 OLS，
  用“基准轴错位量 / 窗口内残差”信噪比确认中段缺失，支持多个缺口；
  不依赖全局拟合（任何跨越其他缺口的全局直线都会被污染）；
* 切口两侧各自拟合，残差归零 → 缺失不会被当成“内容压缩”；
* 同一点集无论按什么顺序喂入，输出完全一致（只依赖点集与索引排序）；
* 单段两个点时退化为两点式（OLS 的精确解）。

:func:`theil_sen` 作为稳健估计工具保留，可供人工复核时对照。
"""

from __future__ import annotations

from fractions import Fraction
from typing import TYPE_CHECKING, List, Optional, Sequence, Tuple

from .errors import AlignmentError
from .model import Anchor, MissingInterval, Segment

if TYPE_CHECKING:  # 仅类型提示，避免循环导入。
    from .model import Entry


class FittedPoints:
    """一次拟合的结果：参数 + 拟合质量诊断（基准毫秒）。"""

    __slots__ = ("ratio", "shift", "residual_max_abs", "residual_mse")

    def __init__(self, ratio: Fraction, shift: Fraction, points: Sequence[Tuple[int, int]]):
        self.ratio = ratio
        self.shift = shift
        sse = 0
        max_abs = 0
        for x, y in points:
            res = Fraction(y) - (ratio * x + shift)  # 基准 - 预测
            max_abs = max(max_abs, abs(_round_fraction(res)))
            sse += res * res
        self.residual_max_abs = max_abs
        n = max(len(points), 1)
        # 精确均方误差（ms²）；需要 RMS 时展示层再开方，避免 Fraction 里出现浮点。
        self.residual_mse = Fraction(sse, n)


# --------------------------------------------------------------------------- #
# 基础拟合
# --------------------------------------------------------------------------- #
def ols_fit(points: Sequence[Tuple[int, int]]) -> Tuple[Fraction, Fraction]:
    """对 (cand_ms, ref_ms) 点集做精确 OLS：返回 (ratio, shift)。

    斜率用中心化形式 ``Σ(x-x̄)(y-ȳ)/Σ(x-x̄)²``；
    若所有 x 相同（锚点间隔退化），速率不可辨识，抛 :class:`AlignmentError`。
    两个点时即两点式，三个点以上为最小二乘。
    """
    n = len(points)
    if n < 2:
        raise AlignmentError("至少需要 2 个锚点才能拟合速率与偏移")
    sx = sum(x for x, _ in points)
    sy = sum(y for _, y in points)
    xbar = Fraction(sx, n)
    ybar = Fraction(sy, n)
    sxx = sum((Fraction(x) - xbar) ** 2 for x, _ in points)
    if sxx == 0:
        raise AlignmentError("锚点候选时刻全部相同，无法辨识速率（x 无展布）")
    sxy = sum((Fraction(x) - xbar) * (Fraction(y) - ybar) for x, y in points)
    ratio = sxy / sxx
    shift = ybar - ratio * xbar
    return ratio, shift


def theil_sen(points: Sequence[Tuple[int, int]]) -> Tuple[Fraction, Fraction]:
    """Theil–Sen 稳健估计：斜率取所有点对斜率的中位数，截距取 y - slope·x 的中位数。

    点对按 (i,j) 排序后取中位数，完全确定、与输入顺序无关。
    """
    n = len(points)
    if n < 2:
        raise AlignmentError("至少需要 2 个锚点才能做稳健估计")
    slopes: List[Fraction] = []
    for i in range(n):
        xi, yi = points[i]
        for j in range(i + 1, n):
            xj, yj = points[j]
            dx = xj - xi
            if dx != 0:
                slopes.append(Fraction(yj - yi, dx))
    if not slopes:
        raise AlignmentError("锚点候选时刻全部相同，无法辨识速率")
    slopes.sort()
    slope = _median(slopes)
    intercepts = sorted(Fraction(y) - slope * x for x, y in points)
    return slope, _median(intercepts)


def _median(values: Sequence[Fraction]) -> Fraction:
    n = len(values)
    mid = n // 2
    if n % 2:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2


def _round_fraction(value: Fraction) -> int:
    """最近整数，0.5 向远离零（与 timecode 保持同一舍入约定）。"""
    q, r = divmod(abs(value).numerator, value.denominator)
    if r * 2 >= value.denominator:
        q += 1
    return q if value >= 0 else -q


# --------------------------------------------------------------------------- #
# 切口检测（中段缺失）
# --------------------------------------------------------------------------- #
def detect_cuts(
    anchors: Sequence[Anchor],
    residual_factor: float,
    min_gap_ms: int,
) -> List[int]:
    """在锚点序列（已按 cand_mid 升序）中找出切口边界。

    返回切口个数个分界索引 ``b``：切口位于 ``anchors[b-1]`` 与 ``anchors[b]``
    之间。

    判据（**局部窗口**，不依赖全局拟合——存在多个缺口时，任何跨越其他
    缺口的全局/半全局直线都会被污染，递归也无法在顶层找到干净分界）：

    对每个候选分界，取紧邻两侧各最多 ``WINDOW=3`` 个锚点，各自 OLS：

    * ``noise`` = 两窗口内点相对各自直线的最大绝对残差；
    * ``gap`` = 两条局部直线在分界候选时刻于**基准轴**上的错位量；

    真切口：窗口内的点各自共线（noise≈0），gap 等于缺失时长；
    紧邻真切口的假分界：其某个窗口必然横跨真缺口 → noise≈缺失量，被拒；
    纯速率漂移：任意位置的两条局部直线都与全局直线重合，gap≈0，不切。

    确认条件：``gap ≥ min_gap_ms`` 且 ``gap/noise ≥ residual_factor``。
    已确认切口两侧一个窗口宽度内不再接受其他切口。结果只依赖锚点点集
    与确定性扫描顺序，与到达顺序无关。
    """
    # 不依赖输入顺序：内部一律按 (cand_mid, ref_index) 排序。
    ordered = sorted(anchors, key=lambda a: (a.cand_mid, a.ref_index))
    n = len(ordered)
    if n < 4:
        return []  # 至少两侧各 2 点才有意义

    window = min(3, n - 2)
    candidates: List[Tuple[Fraction, int, Fraction, Fraction]] = []  # (snr, b, gap, noise)
    for b in range(2, n - 1):  # 两侧至少各 2 点
        li = range(max(0, b - window), b)
        ri = range(b, min(n, b + window))
        left_pts = [(ordered[k].cand_mid, ordered[k].ref_mid) for k in li]
        right_pts = [(ordered[k].cand_mid, ordered[k].ref_mid) for k in ri]
        try:
            rl, il = ols_fit(left_pts)
            rr, ir = ols_fit(right_pts)
        except AlignmentError:
            continue
        noise_l = max(abs(Fraction(y) - (rl * x + il)) for x, y in left_pts)
        noise_r = max(abs(Fraction(y) - (rr * x + ir)) for x, y in right_pts)
        noise = max(noise_l, noise_r, Fraction(1))
        x_cut = Fraction(ordered[b - 1].cand_mid + ordered[b].cand_mid, 2)
        gap = abs((rr * x_cut + ir) - (rl * x_cut + il))
        if gap < min_gap_ms:
            continue
        snr = gap / noise
        if snr >= residual_factor:
            candidates.append((snr, b, gap, noise))

    # SNR 高者优先；确认一个切口后，其两侧一个窗口宽度内的候选全部抑制
    # （它们的窗口横跨该切口，本就不可信）。
    candidates.sort(key=lambda c: (-c[0], c[1]))
    cuts: List[int] = []
    for _, b, _gap, _noise in candidates:
        if all(abs(b - c) >= window for c in cuts):
            cuts.append(b)
    cuts.sort()
    return cuts


# --------------------------------------------------------------------------- #
# 分段建模
# --------------------------------------------------------------------------- #
def build_segments(
    anchors: Sequence[Anchor],
    cuts: Sequence[int],
    min_anchors: int,
    ref_entries: Optional[Sequence["Entry"]] = None,
) -> Tuple[List[Segment], List[MissingInterval]]:
    """按切口把锚点分组，每段独立 OLS，生成 Segment 与缺失区间。

    段域（候选时刻）：

    * 分界取相邻两侧锚点候选中点；
    * 首段下界 -∞、末段上界 +∞，保证任意时刻都可查询；
    * 左段右闭/右段左开的约定统一为半开 ``[lo, hi)``。

    缺失区间（基准轴）优先取“两侧锚点之间缺失的基准条目”的时间并集
    （即基准第 la.ref_index+1 … ra.ref_index-1 条），这就是被整段删掉的
    内容本身，可直接逐条复核；若缺口落在条目间隙（中间没有条目），
    回退为两侧直线在分界点的几何预测区间。

    若某组点数 < ``min_anchors``，回退为与相邻段同参数（并入相邻段）。
    """
    n = len(anchors)
    ordered = sorted(anchors, key=lambda a: (a.cand_mid, a.ref_index))
    bounds = [0] + list(cuts) + [n]
    groups: List[List[Anchor]] = []
    for k in range(len(bounds) - 1):
        grp = ordered[bounds[k] : bounds[k + 1]]
        if grp:
            groups.append(grp)

    # 拟合每组；点数不足的组先标记，稍后并入邻组。
    fitted: List[Optional[Tuple[Fraction, Fraction]]] = []
    for grp in groups:
        if len(grp) < min_anchors:
            fitted.append(None)
        else:
            fitted.append(ols_fit([(a.cand_mid, a.ref_mid) for a in grp]))

    # 把 None 组并入最近的可拟合组（确定性：优先并入左侧）。
    for g in range(len(groups)):
        if fitted[g] is not None:
            continue
        if g > 0 and fitted[g - 1] is not None:
            groups[g - 1].extend(groups[g])
            groups[g] = []
        elif g + 1 < len(groups) and fitted[g + 1] is not None:
            groups[g + 1] = groups[g] + groups[g + 1]
            groups[g] = []
    groups = [g for g in groups if g]
    for g in groups:
        g.sort(key=lambda a: (a.cand_mid, a.ref_index))

    segments: List[Segment] = []
    missing: List[MissingInterval] = []
    for si, grp in enumerate(groups):
        ratio, shift = ols_fit([(a.cand_mid, a.ref_mid) for a in grp])
        # 段域
        domain_lo: Optional[int] = None
        domain_hi: Optional[int] = None
        if si > 0:
            prev_last = groups[si - 1][-1]
            cur_first = grp[0]
            domain_lo = (prev_last.cand_mid + cur_first.cand_mid + 1) // 2
        if si + 1 < len(groups):
            cur_last = grp[-1]
            nxt_first = groups[si + 1][0]
            domain_hi = (cur_last.cand_mid + nxt_first.cand_mid + 1) // 2
        fp = FittedPoints(ratio, shift, [(a.cand_mid, a.ref_mid) for a in grp])
        segments.append(
            Segment(
                index=si,
                ratio=ratio,
                shift=shift,
                anchors=tuple(grp),
                domain_lo=domain_lo,
                domain_hi=domain_hi,
                residual_max_abs=fp.residual_max_abs,
                residual_mse=fp.residual_mse,
            )
        )

    # 缺失区间（基准轴）：每两个相邻段之间一个。
    for si in range(len(segments) - 1):
        left = segments[si]
        right = segments[si + 1]
        la = left.anchors[-1]
        ra = right.anchors[0]

        # 几何预测区间：两侧直线在分界候选时刻映射到基准轴的位置。
        x_cut_l = Fraction(la.cand_mid + ra.cand_mid, 2)
        ref_left_side = _round_fraction(left.ratio * x_cut_l + left.shift)
        ref_right_side = _round_fraction(right.ratio * x_cut_l + right.shift)
        geom_lo = min(ref_left_side, ref_right_side)
        geom_hi = max(ref_left_side, ref_right_side)

        # 首选：两锚点之间缺失的基准条目（ref 索引 la+1 … ra-1）的时间并集。
        missing_idxs = list(range(la.ref_index + 1, ra.ref_index))
        if ref_entries is not None and missing_idxs:
            lo_ref = min(ref_entries[i].start for i in missing_idxs)
            hi_ref = max(ref_entries[i].end for i in missing_idxs)
            reason_detail = (
                f"基准第 {la.ref_index + 1}~{ra.ref_index - 1} 条"
                f"（共 {len(missing_idxs)} 条）在候选轨无对应锚点，"
                f"条目时间跨度 {hi_ref - lo_ref}ms；两侧分别 OLS 拟合残差均接近零，"
                "判定为整段缺失而非速率压缩；几何错位区间 "
                f"{geom_hi - geom_lo}ms"
            )
        else:
            lo_ref, hi_ref = geom_lo, geom_hi
            reason_detail = (
                "两锚点之间没有可归属的基准条目，取两侧直线在分界点的"
                f"几何预测区间，错位 {hi_ref - lo_ref}ms；两侧分别 OLS 拟合"
                "残差均接近零，判定为整段缺失而非速率压缩"
            )

        # 置信度：两侧拟合自身残差越小、缺失越显著，置信越高。
        span = max(hi_ref - lo_ref, 1)
        noise = max(left.residual_max_abs, right.residual_max_abs, 1)
        conf = float(min(Fraction(1), Fraction(span) / (span + 4 * noise)))
        missing.append(
            MissingInterval(
                ref_lo=lo_ref,
                ref_hi=hi_ref,
                left_anchor=la.as_tuple(),
                right_anchor=ra.as_tuple(),
                duration_ms=hi_ref - lo_ref,
                confidence=round(conf, 6),
                reason=(
                    f"锚点 ({la.ref_index},{la.cand_index}) 与 "
                    f"({ra.ref_index},{ra.cand_index}) 之间存在整段缺失：" + reason_detail
                ),
            )
        )
    return segments, missing


# --------------------------------------------------------------------------- #
# 偏差汇总（需求 2 的三类分项）
# --------------------------------------------------------------------------- #
def aggregate_bias(
    segments: Sequence[Segment],
    missing: Sequence[MissingInterval],
    anchors: Sequence[Anchor],
) -> Tuple[Fraction, Fraction, float, float, str, str]:
    """汇总 shift / rate 及置信依据。

    多段（有缺失）时，速率取各段按锚点数加权平均，shift 取首段截距并注明分段。
    """
    total_anchors = sum(len(s.anchors) for s in segments)
    # 加权速率
    rate = Fraction(0)
    for s in segments:
        rate += s.ratio * len(s.anchors)
    rate /= total_anchors
    # 平移：用首段在候选 0 点的截距作为“整体平移”的代表值。
    shift = segments[0].shift

    # 置信度：锚点越多、残差越小、x 展布越大，置信越高。
    pts = [(a.cand_mid, a.ref_mid) for a in anchors]
    xspan = max(x for x, _ in pts) - min(x for x, _ in pts)
    max_res = max((s.residual_max_abs for s in segments), default=0)
    # 速率置信：展布 vs 噪声。展布 30min、残差 <=250ms → 接近 1。
    if xspan > 0:
        rate_conf = float(min(1.0, Fraction(xspan) / (xspan + 20 * max(max_res, 1))))
    else:
        rate_conf = 0.0
    # 平移置信：锚点数与残差水平。
    shift_conf = float(min(1.0, Fraction(total_anchors) / (total_anchors + 2)))
    shift_conf = round(0.5 * shift_conf + 0.5 * min(1.0, 1000 / (max_res + 1000)), 6)
    rate_conf = round(rate_conf, 6)

    exact_n = sum(1 for a in anchors if a.kind == "exact")
    rate_basis = (
        f"{total_anchors} 个锚点（{exact_n} 精确），候选时刻展布 {xspan}ms，"
        f"各段最大残差 {max_res}ms，分段独立 OLS（切口按两侧直线基准轴错位检测）"
        + (f"，{len(segments)} 段按锚点数加权" if len(segments) > 1 else "")
    )
    shift_basis = (
        f"取首段截距（候选 0ms 对应的基准毫秒），基于 {len(segments[0].anchors)} 个锚点"
        + ("；存在缺失分段，其余段截距见各段参数" if len(segments) > 1 else "")
    )
    return shift, rate, shift_conf, rate_conf, shift_basis, rate_basis
