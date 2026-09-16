"""稳健线性拟合与切口（中段缺失）检测。

记号约定：一条候选字幕的时刻 ``c`` 校正到基准轴 ``r`` 满足

    r = ratio * c + shift

* ``ratio`` 是速率比（候选走 1ms 对应基准走 ratio ms；帧率漂移时 ratio ≠ 1）；
* ``shift`` 是整体平移（毫秒）。

数学要点：

* 所有运算用 :class:`fractions.Fraction`，斜率/截距精确可复现；
* 切口检测是全局分段回归 DP：枚举分段数 k，前缀和 O(1) 求任意连续段
  OLS 残差平方和，DP 求分 k 段的全局最小 SSE，取第一个每个分界都通过
  “基准轴错位量 ≥ 阈值 + 错位/段内残差信噪比”方案。支持两处及以上
  互不相邻且相距很近的缺失（局部窗口判据会被另一处缺失污染，全局 DP
  不会）；
* 切口两侧各自拟合，残差归零 → 缺失不会被当成“内容压缩”；
* 同一点集无论按什么顺序喂入，输出完全一致（只依赖点集与索引排序）；
* 单段两个点时退化为两点式（OLS 的精确解）。

:func:`theil_sen` 作为稳健估计工具保留，可供人工复核时对照。
"""

from __future__ import annotations

from fractions import Fraction
from typing import TYPE_CHECKING, Dict, List, Optional, Sequence, Tuple

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
# 切口检测（中段缺失）——全局分段回归 DP
# --------------------------------------------------------------------------- #
MAX_SEGMENTS = 16  # 单轨最多识别的分段数（即至多 15 处互不相邻缺失）


def _segment_sse(
    p: dict, l: int, r: int
) -> Optional[Fraction]:
    """连续点段 [l, r) 的 OLS 残差平方和（前缀和 O(1)）；不可拟合返回 None。"""
    m = r - l
    if m < 2:
        return None
    sx = p["sx"][r] - p["sx"][l]
    sy = p["sy"][r] - p["sy"][l]
    sxx = p["sxx"][r] - p["sxx"][l]
    syy = p["syy"][r] - p["syy"][l]
    sxy = p["sxy"][r] - p["sxy"][l]
    sxx_dev = sxx - sx * sx / m
    if sxx_dev <= 0:
        return None
    sxy_dev = sxy - sx * sy / m
    syy_dev = syy - sy * sy / m
    sse = syy_dev - sxy_dev * sxy_dev / sxx_dev
    return Fraction(0) if sse < 0 else sse


def _segment_line(
    p: dict, l: int, r: int
) -> Optional[Tuple[Fraction, Fraction]]:
    """连续点段 [l, r) 的 (slope, intercept)；不可拟合返回 None。"""
    m = r - l
    if m < 2:
        return None
    sx = p["sx"][r] - p["sx"][l]
    sy = p["sy"][r] - p["sy"][l]
    sxx = p["sxx"][r] - p["sxx"][l]
    sxy = p["sxy"][r] - p["sxy"][l]
    xbar = Fraction(sx, m)
    ybar = Fraction(sy, m)
    sxx_dev = sxx - sx * sx / m
    if sxx_dev <= 0:
        return None
    slope = (sxy - sx * sy / m) / sxx_dev
    return slope, ybar - slope * xbar


def detect_cuts(
    anchors: Sequence[Anchor],
    residual_factor: float,
    min_gap_ms: int,
    min_anchors: int = 2,
) -> List[int]:
    """在锚点序列（已按 cand_mid 升序）中找出全部互不相邻的切口边界。

    返回切口个数个分界索引 ``b``：切口位于 ``anchors[b-1]`` 与 ``anchors[b]``
    之间。

    判据是**候选预筛 + 全局分段回归**：

    1. 预筛（O(n)，精确）：对每个候选分界 b，用紧邻两侧各 ``w`` 个
       （``w = max(2, min_anchors)``）锚点各拟合一条直线，若两直线在
       分界候选时刻的基准轴错位量 ≥ ``min_gap_ms`` 则 b 进入候选集。
       真实切口两侧紧邻锚点必落在各自分段直线上，真切口因此一定被预筛
       命中；而纯平移/纯速率漂移时任意位置两侧窗口共线、错位量为 0，
       候选集为空立即返回。局部窗口在“两处缺失相距很近、中间锚点组
       只有 w 个点”时也不漏：窗口只取到分段边界为止，不横跨其他缺口。
    2. 精确分段 DP：只允许在候选位置切分，枚举分段数 k，用前缀和 O(1)
       求任意连续段 OLS 残差平方和，DP 求分 k 段的全局最小 SSE 与分界，
       取第一个通过逐分界校验（错位量 ≥ 阈值、错位/段内残差信噪比
       ≥ ``residual_factor``）的方案。假候选即使局部错位大，在全局最优
       分段里也无法让各段残差归零，clean 校验将其排除。因此支持任意
       多处互不相邻的缺失，且不会把噪声/漂移误切。

    结果只依赖锚点点集与确定的扫描/平手裁决，与锚点到达顺序无关。

    前提：相邻两个切口之间至少要有 ``w = max(2, min_anchors)`` 个锚点
    （这是“一段独立直线”可辨识的最低条件）。两段缺失中间只剩 0~1 个
    锚点时，中间段速率在数学上不可辨识，此时结果不保证——这是数据
    不足而非算法缺陷；正常的多段缺失（中段锚点数与两侧同量级）可
    可靠识别。
    """
    ordered = sorted(anchors, key=lambda a: (a.cand_mid, a.ref_index))
    n = len(ordered)
    w = max(2, min_anchors)
    if n < 2 * w:
        return []

    xs = [Fraction(a.cand_mid) for a in ordered]
    ys = [Fraction(a.ref_mid) for a in ordered]
    p = {"xs": xs, "ys": ys,
         "sx": _prefix(xs), "sy": _prefix(ys),
         "sxx": _prefix_sq(xs), "syy": _prefix_sq(ys),
         "sxy": _prefix_cross(xs, ys)}

    # 精确共线快捷路径：切任何分界的错位量都是 0。
    if _segment_sse(p, 0, n) == 0:
        return []

    # ---- 第 1 步：候选边界预筛 ----
    candidates: List[int] = []
    for b in range(w, n - w + 1):
        left = _segment_line(p, b - w, b)
        right = _segment_line(p, b, b + w)
        if left is None or right is None:
            continue
        x_cut = (xs[b - 1] + xs[b]) / 2
        gap = abs((right[0] * x_cut + right[1]) - (left[0] * x_cut + left[1]))
        if gap >= min_gap_ms:
            candidates.append(b)
    if not candidates:
        return []

    # ---- 第 2 步：只在候选位置上做精确分段 DP ----
    positions = [0] + candidates + [n]
    mpos = len(positions)
    last_i = mpos - 1
    # 段代价表：只有段内锚点数 ≥ w 才可用。
    sse_tab: Dict[Tuple[int, int], Fraction] = {}
    for ai in range(mpos):
        for bi in range(ai + 1, mpos):
            lo, hi = positions[ai], positions[bi]
            if hi - lo >= w:
                sse = _segment_sse(p, lo, hi)
                if sse is not None:
                    sse_tab[(ai, bi)] = sse

    kmax = min(len(candidates) + 1, n // w, MAX_SEGMENTS)

    # dp[k][end_i] = 把锚点 [0, positions[end_i]) 分成 k 段（每段 ≥ w 点、
    # 内部分界只能落在候选位置）的最小 SSE 与分界列表。
    dp_prev: List[Optional[Tuple[Fraction, List[int]]]] = [None] * mpos
    for end_i in range(1, mpos):
        if (0, end_i) in sse_tab:
            dp_prev[end_i] = (sse_tab[(0, end_i)], [])
    prev_sse: Optional[Fraction] = (
        dp_prev[last_i][0] if dp_prev[last_i] is not None else None
    )

    last_solution: Optional[List[int]] = None
    for k in range(2, kmax + 1):
        cur: List[Optional[Tuple[Fraction, List[int]]]] = [None] * mpos
        for end_i in range(k - 1, mpos):
            best: Optional[Tuple[Fraction, List[int]]] = None
            # mid_i 必须是候选内部分界（下标 1..last_i-1）。
            for mid_i in range(1, end_i):
                prev = dp_prev[mid_i]
                if prev is None or (mid_i, end_i) not in sse_tab:
                    continue
                total = prev[0] + sse_tab[(mid_i, end_i)]
                bounds = prev[1] + [positions[mid_i]]
                if best is None or total < best[0] or (
                    total == best[0] and bounds < best[1]
                ):
                    best = (total, bounds)
            cur[end_i] = best
        final = cur[last_i]
        if final is not None:
            last_solution = final[1]
            if _solution_clean(p, final[1], residual_factor, min_gap_ms):
                return sorted(final[1])
            # SSE 不再下降或已归零 → 更高 k 只会过拟合，提前结束。
            if prev_sse is not None and (final[0] >= prev_sse or final[0] == 0):
                break
            prev_sse = final[0]
        dp_prev = cur

    # 缺口数超过分段上限：尽力而为，只保留局部门槛达标的分界。
    if last_solution is not None:
        return _partial_clean_bounds(p, last_solution, residual_factor, min_gap_ms)
    return []


def _segment_noise(p: dict, lo: int, hi: int,
                   line: Tuple[Fraction, Fraction]) -> Fraction:
    slope, intercept = line
    max_res = Fraction(0)
    for i in range(lo, hi):
        res = abs(p["ys"][i] - (slope * p["xs"][i] + intercept))
        if res > max_res:
            max_res = res
    return max_res


def _solution_clean(
    p: dict,
    bounds: Sequence[int],
    residual_factor: float,
    min_gap_ms: int,
) -> bool:
    """分段方案中每个分界是否都满足错位量与局部信噪比要求（全部满足才 True）。"""
    n = len(p["xs"])
    edges = [0] + list(bounds) + [n]
    lines = []
    noises = []
    for k in range(len(edges) - 1):
        line = _segment_line(p, edges[k], edges[k + 1])
        if line is None:
            return False
        lines.append(line)
        noises.append(_segment_noise(p, edges[k], edges[k + 1], line))
    factor = Fraction(residual_factor)
    for k, b in enumerate(bounds):
        sl_l, sh_l = lines[k]
        sl_r, sh_r = lines[k + 1]
        x_cut = (p["xs"][b - 1] + p["xs"][b]) / 2
        gap = abs((sl_r * x_cut + sh_r) - (sl_l * x_cut + sh_l))
        if gap < min_gap_ms:
            return False
        noise = max(noises[k], noises[k + 1], Fraction(1))
        if gap < factor * noise:
            return False
    return True


def _partial_clean_bounds(
    p: dict,
    bounds: Sequence[int],
    residual_factor: float,
    min_gap_ms: int,
) -> List[int]:
    """上限回退：方案中哪些分界局部门槛达标，就保留哪些。"""
    n = len(p["xs"])
    edges = [0] + list(bounds) + [n]
    lines = []
    noises = []
    for k in range(len(edges) - 1):
        line = _segment_line(p, edges[k], edges[k + 1])
        if line is None:
            return []
        lines.append(line)
        noises.append(_segment_noise(p, edges[k], edges[k + 1], line))
    factor = Fraction(residual_factor)
    kept: List[int] = []
    for k, b in enumerate(bounds):
        sl_l, sh_l = lines[k]
        sl_r, sh_r = lines[k + 1]
        x_cut = (p["xs"][b - 1] + p["xs"][b]) / 2
        gap = abs((sl_r * x_cut + sh_r) - (sl_l * x_cut + sh_l))
        noise = max(noises[k], noises[k + 1], Fraction(1))
        if gap >= min_gap_ms and gap >= factor * noise:
            kept.append(b)
    return sorted(kept)


def _prefix(seq: Sequence[Fraction]) -> List[Fraction]:
    acc = [Fraction(0)]
    for v in seq:
        acc.append(acc[-1] + v)
    return acc


def _prefix_sq(seq: Sequence[Fraction]) -> List[Fraction]:
    acc = [Fraction(0)]
    for v in seq:
        acc.append(acc[-1] + v * v)
    return acc


def _prefix_cross(xs: Sequence[Fraction], ys: Sequence[Fraction]) -> List[Fraction]:
    acc = [Fraction(0)]
    for x, y in zip(xs, ys):
        acc.append(acc[-1] + x * y)
    return acc


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
