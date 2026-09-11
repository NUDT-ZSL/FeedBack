"""流式带窗 DTW（动态时间规整）对齐内核。

只用 Python 标准库实现，面向两条持续追加的数值序列，支持：

* 三种逐点距离：``abs`` / ``sq`` / ``cos``；
* Sakoe-Chiba 带状窗口约束（``band``），窗口外单元格不可达；
* 真正的增量更新：每次 append 只新增一行或一列中的窗口内单元格，
  结果与从头全量重算完全一致；
* 可控内存上限（``max_cells``）与无上限精确模式；
* JSON 快照持久化（``save`` / ``load``），加载时强校验一致性。

DP 表约定（下标从 1 开始表示序列前缀长度）：

* 表维度 ``(n+1) x (m+1)``，第 0 行 / 第 0 列为边界，除 ``(0,0)=0`` 外均为无穷；
* 单元格 ``(i,j)`` 可填当且仅当 ``|i-j| <= band``；
* 递推 ``D(i,j) = cost(i,j) + min(D(i-1,j), D(i-1,j-1), D(i,j-1))``，
  平局时按 上 -> 左上 -> 左 的顺序选择前驱（确定性回溯）。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

__all__ = [
    "MAX_SERIES_LENGTH",
    "METRICS",
    "SNAPSHOT_FORMAT",
    "Series",
    "AppendResult",
    "AlignResult",
    "StateResult",
    "StreamAligner",
    "AlignmentError",
    "SeriesValidationError",
    "MetricError",
    "ZeroVectorError",
    "MemoryLimitError",
    "SnapshotError",
]

MAX_SERIES_LENGTH = 4096
METRICS = ("abs", "sq", "cos")
SNAPSHOT_FORMAT = "stream-aligner-v1"

_INF = math.inf


# ---------------------------------------------------------------------------
# 异常类型
# ---------------------------------------------------------------------------


class AlignmentError(ValueError):
    """本模块所有 ValueError 类错误的基类。"""


class SeriesValidationError(AlignmentError):
    """Series 非法（名字为空、值非有限数、长度超限等）。"""


class MetricError(AlignmentError):
    """距离度量名非法。"""


class ZeroVectorError(AlignmentError):
    """cos 度量下参与比较的前缀为零向量。"""


class MemoryLimitError(AlignmentError):
    """本次 append 将使 DP 单元格数超过 max_cells 上限，操作被拒绝。"""


class SnapshotError(AlignmentError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Series:
    """一条不可变的数值序列。

    :param name: 非空序列名。
    :param values: 有限浮点数列表，长度不超过 :data:`MAX_SERIES_LENGTH`。
    """

    name: str
    values: List[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name:
            raise SeriesValidationError("series name must be a non-empty string")
        if not isinstance(self.values, (list, tuple)):
            raise SeriesValidationError(
                f"series {self.name!r}: values must be a list, got {type(self.values).__name__}"
            )
        if len(self.values) > MAX_SERIES_LENGTH:
            raise SeriesValidationError(
                f"series {self.name!r}: length {len(self.values)} exceeds limit "
                f"{MAX_SERIES_LENGTH}"
            )
        cleaned: List[float] = []
        for idx, v in enumerate(self.values):
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise SeriesValidationError(
                    f"series {self.name!r}: value at index {idx} is not a real number "
                    f"(got {type(v).__name__})"
                )
            fv = float(v)
            if not math.isfinite(fv):
                raise SeriesValidationError(
                    f"series {self.name!r}: value at index {idx} must be finite, got {fv}"
                )
            cleaned.append(fv)
        # frozen dataclass 下用 object.__setattr__ 保存归一化后的副本
        object.__setattr__(self, "values", cleaned)


@dataclass(frozen=True)
class AppendResult:
    """单次 append 的结果。

    :param name: 被追加的序列名。
    :param new_length: 追加后该序列的长度。
    :param recomputed: 是否触发了整表重算（本实现始终为 ``False``，
        因为所有更新都是增量的；保留字段以明确语义）。
    :param distance: 追加后当前最佳对齐距离；端点不可达或数据不足时为 ``None``。
    """

    name: str
    new_length: int
    recomputed: bool
    distance: Optional[float]


@dataclass(frozen=True)
class AlignResult:
    """当前两条序列的最佳对齐结果。

    :param distance: 最佳路径距离；不可达时为 ``None``。
    :param path: 对齐路径，``(i, j)`` 二元组列表，从 ``(0, 0)`` 到
        ``(n-1, m-1)``；不可达时为空列表。
    :param warping_ratio: 路径长度 / ``max(n, m)``，衡量扭曲程度。
    :param band_violations: 路径上 ``|i-j|`` 超出 band 的步数，正常为 0。
    :param reason: 不可达原因说明；可达时为 ``None``。
    """

    distance: Optional[float]
    path: List[Tuple[int, int]]
    warping_ratio: float
    band_violations: int
    reason: Optional[str] = None

    @property
    def reachable(self) -> bool:
        """端点是否可达。"""
        return self.distance is not None

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 友好的字典（path 转为二元组列表的 JSON 形式）。"""
        return {
            "distance": self.distance,
            "path": [[i, j] for i, j in self.path],
            "warping_ratio": self.warping_ratio,
            "band_violations": self.band_violations,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class StateResult:
    """aligner 当前状态快照。

    :param length_a: 序列 A 当前长度。
    :param length_b: 序列 B 当前长度。
    :param filled_cells: DP 表中已填充（参与计算）的单元格数。
    :param window_utilization: 已填充单元格占无约束完整 DP 表 ``n*m`` 的比例，
        反映带状窗口实际裁剪掉了多少计算；无约束时为 1.0，无数据时为 0.0。
    :param last_distance: 最近一次对齐距离；未对齐过或不可达时为 ``None``。
    """

    length_a: int
    length_b: int
    filled_cells: int
    window_utilization: float
    last_distance: Optional[float]

    def to_dict(self) -> Dict[str, object]:
        """序列化为 JSON 友好的字典。"""
        return {
            "length_a": self.length_a,
            "length_b": self.length_b,
            "filled_cells": self.filled_cells,
            "window_utilization": self.window_utilization,
            "last_distance": self.last_distance,
        }


# ---------------------------------------------------------------------------
# 核心 aligner
# ---------------------------------------------------------------------------


class StreamAligner:
    """流式带窗 DTW 对齐器。

    :param name_a: 第一条序列名（非空）。
    :param name_b: 第二条序列名（非空）。
    :param metric: 距离度量，``"abs"`` / ``"sq"`` / ``"cos"`` 之一。
    :param band: Sakoe-Chiba 窗口半径，非负整数。``0`` 表示只允许对角线；
        当 ``band >= max(n, m)`` 时等价于无约束 DTW。
    :param max_cells: DP 表最大单元格数。正整数表示启用上限，某次 append
        会使已填充单元格数超过该值时该次 append 被整体拒绝（状态不变）；
        ``None`` 表示精确模式（无上限）。
    :raises MetricError: 度量名非法。
    :raises SeriesValidationError: 名字非法。
    :raises ValueError: band 或 max_cells 取值非法。
    """

    def __init__(
        self,
        name_a: str,
        name_b: str,
        metric: str = "abs",
        band: int = 4096,
        max_cells: Optional[int] = None,
    ) -> None:
        if not isinstance(name_a, str) or not name_a:
            raise SeriesValidationError("name_a must be a non-empty string")
        if not isinstance(name_b, str) or not name_b:
            raise SeriesValidationError("name_b must be a non-empty string")
        if not isinstance(metric, str) or metric not in METRICS:
            raise MetricError(
                f"invalid metric {metric!r}; expected one of {', '.join(METRICS)}"
            )
        if isinstance(band, bool) or not isinstance(band, int) or band < 0:
            raise ValueError(f"band must be a non-negative int, got {band!r}")
        if max_cells is not None:
            if isinstance(max_cells, bool) or not isinstance(max_cells, int):
                raise ValueError(f"max_cells must be an int or None, got {max_cells!r}")
            if max_cells <= 0:
                raise ValueError(f"max_cells must be positive or None, got {max_cells}")

        self._name_a = name_a
        self._name_b = name_b
        self._metric = metric
        self._band = band
        self._max_cells = max_cells

        self._a: List[float] = []
        self._b: List[float] = []

        # DP 表（含第 0 行 / 第 0 列边界）。
        self._dp: List[List[float]] = [[0.0]]
        self._bp: List[List[Optional[Tuple[int, int]]]] = [[None]]
        self._filled_cells = 0

        # cos 度量的增量统计量。
        self._norm_a: List[float] = [0.0]  # 前 i 个 A 值的平方和
        self._norm_b: List[float] = [0.0]
        self._dot: List[float] = [0.0]  # _dot[k] = sum(A[t]*B[t]), t < k

        self._cache: Optional[AlignResult] = None

    # ----- 构造辅助 -------------------------------------------------------

    @classmethod
    def from_series(
        cls,
        a: Series,
        b: Series,
        metric: str = "abs",
        band: int = 4096,
        max_cells: Optional[int] = None,
    ) -> "StreamAligner":
        """用两条已有 :class:`Series` 创建 aligner（内部按增量方式填充）。"""
        if not isinstance(a, Series) or not isinstance(b, Series):
            raise SeriesValidationError("from_series expects Series instances")
        aligner = cls(a.name, b.name, metric=metric, band=band, max_cells=max_cells)
        for v in a.values:
            aligner.append(a.name, v)
        for v in b.values:
            aligner.append(b.name, v)
        aligner._cache = None
        return aligner

    # ----- 基本属性 -------------------------------------------------------

    @property
    def name_a(self) -> str:
        """序列 A 的名字。"""
        return self._name_a

    @property
    def name_b(self) -> str:
        """序列 B 的名字。"""
        return self._name_b

    @property
    def metric(self) -> str:
        """距离度量名。"""
        return self._metric

    @property
    def band(self) -> int:
        """窗口半径。"""
        return self._band

    @property
    def max_cells(self) -> Optional[int]:
        """单元格上限，``None`` 表示无上限。"""
        return self._max_cells

    @property
    def values_a(self) -> List[float]:
        """序列 A 当前值的防御性副本。"""
        return list(self._a)

    @property
    def values_b(self) -> List[float]:
        """序列 B 当前值的防御性副本。"""
        return list(self._b)

    @property
    def filled_cells(self) -> int:
        """DP 表已填充单元格数。"""
        return self._filled_cells

    # ----- 窗口与容量计算 -------------------------------------------------

    def _added_cells_on_append_a(self) -> int:
        """预估向 A 追加一个值后新增的窗口内单元格数。"""
        i = len(self._a) + 1
        m = len(self._b)
        lo = max(1, i - self._band)
        hi = min(m, i + self._band)
        return max(0, hi - lo + 1)

    def _added_cells_on_append_b(self) -> int:
        """预估向 B 追加一个值后新增的窗口内单元格数。"""
        j = len(self._b) + 1
        n = len(self._a)
        lo = max(1, j - self._band)
        hi = min(n, j + self._band)
        return max(0, hi - lo + 1)

    # ----- 逐点代价 -------------------------------------------------------

    def _check_zero_prefixes(self, side: str, fvalue: float) -> None:
        """状态变更前的 cos 零向量预检（只针对本次将新增的窗内单元格）。

        语义：只有“参与比较的某个前缀向量范数为 0”才报错。因此：

        * 首值为 0、但对侧还是空序列时，新行/列与窗口不相交、没有任何
          单元格会被计算，**允许暂存**该 0（之后追加非零值可使该侧更长
          前缀的范数恢复为正）；
        * 一旦本次 append 新增的某个窗内单元格用到零范数前缀——可能是
          本侧新前缀（新值让该前缀平方和为 0），也可能是对侧某个历史
          前缀——就在改动任何状态前抛 :class:`ZeroVectorError`，保证
          预检失败时内核状态完全不变、调用方捕获后仍可追加别的值。

        :raises ZeroVectorError: 本次将填充的某个窗内单元格的前缀范数为 0。
        """
        n, m = len(self._a), len(self._b)
        if side == "a":
            i = n + 1
            norm_new = self._norm_a[n] + fvalue * fvalue
            lo = max(1, i - self._band)
            hi = min(m, i + self._band)
            for j in range(lo, hi + 1):
                if norm_new == 0.0:
                    raise ZeroVectorError(
                        "cosine cost undefined: series A prefix of length "
                        f"{i} is a zero vector at cell ({i},{j})"
                    )
                if self._norm_b[j] == 0.0:
                    raise ZeroVectorError(
                        "cosine cost undefined: series B prefix of length "
                        f"{j} is a zero vector at cell ({i},{j})"
                    )
        else:
            j = m + 1
            norm_new = self._norm_b[m] + fvalue * fvalue
            lo = max(1, j - self._band)
            hi = min(n, j + self._band)
            for i in range(lo, hi + 1):
                if norm_new == 0.0:
                    raise ZeroVectorError(
                        "cosine cost undefined: series B prefix of length "
                        f"{j} is a zero vector at cell ({i},{j})"
                    )
                if self._norm_a[i] == 0.0:
                    raise ZeroVectorError(
                        "cosine cost undefined: series A prefix of length "
                        f"{i} is a zero vector at cell ({i},{j})"
                    )

    def _cost(self, i: int, j: int) -> float:
        """序列前缀端点 A[i-1] 与 B[j-1] 之间的逐点距离。"""
        x = self._a[i - 1]
        y = self._b[j - 1]
        if self._metric == "abs":
            return abs(x - y)
        if self._metric == "sq":
            d = x - y
            return d * d
        # cos：1 - 余弦相似度，按前缀对齐长度求内积
        na = self._norm_a[i]
        nb = self._norm_b[j]
        if na == 0.0 or nb == 0.0:
            raise ZeroVectorError(
                f"cosine cost undefined: zero vector at cell ({i},{j}) "
                f"(norm_a={na}, norm_b={nb})"
            )
        dot = self._dot[min(i, j)]
        return 1.0 - dot / math.sqrt(na * nb)

    def _fill_cell(self, i: int, j: int) -> None:
        """填充单个窗口内单元格（含代价、最优前驱）。"""
        cost = self._cost(i, j)
        up = self._dp[i - 1][j]
        diag = self._dp[i - 1][j - 1]
        left = self._dp[i][j - 1]
        # 平局优先级：上 -> 左上 -> 左（与全量参考实现一致，保证路径确定性）。
        best = up
        prev: Optional[Tuple[int, int]] = (i - 1, j)
        if diag < best:
            best = diag
            prev = (i - 1, j - 1)
        if left < best:
            best = left
            prev = (i, j - 1)
        if not math.isfinite(best):
            # 三个前驱都不可达：本单元格也不可达，无前驱。
            self._dp[i][j] = _INF
            self._bp[i][j] = None
        else:
            self._dp[i][j] = cost + best
            self._bp[i][j] = prev
        self._filled_cells += 1

    # ----- 增量追加 -------------------------------------------------------

    def append(self, series_name: str, value: float) -> AppendResult:
        """向指定序列追加一个值并做增量 DP 更新。

        只计算新行（追加 A 时）或新列（追加 B 时）落在窗口内的单元格，
        不触碰任何历史单元格。

        :param series_name: 构造时给定的序列名之一。
        :param value: 有限浮点数。
        :raises SeriesValidationError: 序列名未知、值非有限、序列长度超过 4096。
        :raises ZeroVectorError: cos 度量下本次新增的某个窗内单元格用到零范数
            前缀（在任何状态变更前抛出，状态保持不变）。
        :raises MemoryLimitError: 本次追加会超过 ``max_cells``（状态保持不变）。
        """
        if series_name == self._name_a:
            side = "a"
        elif series_name == self._name_b:
            side = "b"
        else:
            raise SeriesValidationError(
                f"unknown series name {series_name!r}; expected "
                f"{self._name_a!r} or {self._name_b!r}"
            )
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SeriesValidationError(
                f"appended value must be a real number, got {type(value).__name__}"
            )
        fvalue = float(value)
        if not math.isfinite(fvalue):
            raise SeriesValidationError(f"appended value must be finite, got {fvalue}")

        n, m = len(self._a), len(self._b)
        if side == "a":
            if n >= MAX_SERIES_LENGTH:
                raise SeriesValidationError(
                    f"series {self._name_a!r}: length would exceed limit "
                    f"{MAX_SERIES_LENGTH}"
                )
            added = self._added_cells_on_append_a()
        else:
            if m >= MAX_SERIES_LENGTH:
                raise SeriesValidationError(
                    f"series {self._name_b!r}: length would exceed limit "
                    f"{MAX_SERIES_LENGTH}"
                )
            added = self._added_cells_on_append_b()

        if self._max_cells is not None and self._filled_cells + added > self._max_cells:
            raise MemoryLimitError(
                f"append rejected: DP table would grow to "
                f"{self._filled_cells + added} cells, exceeding max_cells="
                f"{self._max_cells} (current={self._filled_cells}, new={added})"
            )

        # cos 预检：新行/列窗口内若出现零向量前缀，直接拒绝且不改动任何状态，
        # 保证调用方捕获异常后仍可继续追加别的值。
        if self._metric == "cos":
            self._check_zero_prefixes(side, fvalue)

        if side == "a":
            self._append_a(fvalue)
            new_length = n + 1
        else:
            self._append_b(fvalue)
            new_length = m + 1

        self._cache = None
        distance = self.align().distance
        return AppendResult(
            name=series_name,
            new_length=new_length,
            recomputed=False,
            distance=distance,
        )

    def _append_a(self, value: float) -> None:
        """在 A 上追加：新增一行，只填该行窗口内的单元格。"""
        i = len(self._a) + 1
        m = len(self._b)
        self._a.append(value)
        self._norm_a.append(self._norm_a[-1] + value * value)
        self._extend_dot_prefix()

        self._dp.append([_INF] * (m + 1))
        self._bp.append([None] * (m + 1))

        lo = max(1, i - self._band)
        hi = min(m, i + self._band)
        for j in range(lo, hi + 1):
            self._fill_cell(i, j)

    def _append_b(self, value: float) -> None:
        """在 B 上追加：所有历史行扩展一列，只填该列窗口内的单元格。"""
        j = len(self._b) + 1
        n = len(self._a)
        self._b.append(value)
        self._norm_b.append(self._norm_b[-1] + value * value)
        self._extend_dot_prefix()

        for row in self._dp:
            row.append(_INF)
        for row in self._bp:
            row.append(None)

        lo = max(1, j - self._band)
        hi = min(n, j + self._band)
        for i in range(lo, hi + 1):
            self._fill_cell(i, j)

    def _extend_dot_prefix(self) -> None:
        """把对齐前缀内积表 ``_dot`` 扩展到 min(n, m)。"""
        k = min(len(self._a), len(self._b))
        while len(self._dot) < k + 1:
            t = len(self._dot) - 1
            self._dot.append(self._dot[-1] + self._a[t] * self._b[t])

    # ----- 对齐与回溯 -----------------------------------------------------

    def align(self) -> AlignResult:
        """返回当前两条序列的最佳对齐结果（带缓存）。

        端点不可达（典型情况：长度差超过 band）时返回
        ``distance=None`` 且带 ``reason`` 的 :class:`AlignResult`，不抛异常。
        """
        if self._cache is not None:
            return self._cache

        n, m = len(self._a), len(self._b)
        if n == 0 and m == 0:
            result = AlignResult(None, [], 0.0, 0, "both series are empty")
        elif n == 0 or m == 0:
            empty_name = self._name_a if n == 0 else self._name_b
            result = AlignResult(
                None,
                [],
                0.0,
                0,
                f"series {empty_name!r} is empty; DTW needs at least one point "
                "on each side",
            )
        elif abs(n - m) > self._band:
            result = AlignResult(
                None,
                [],
                0.0,
                0,
                f"endpoint unreachable: length difference {abs(n - m)} exceeds "
                f"band {self._band}",
            )
        elif not math.isfinite(self._dp[n][m]):
            result = AlignResult(
                None,
                [],
                0.0,
                0,
                "endpoint unreachable: no admissible path stays within the band",
            )
        else:
            result = self._traceback(n, m)
        self._cache = result
        return result

    def _traceback(self, n: int, m: int) -> AlignResult:
        """从 (n,m) 沿记录的前驱回溯到 (0,0)。"""
        path: List[Tuple[int, int]] = []
        cur: Optional[Tuple[int, int]] = (n, m)
        while cur is not None and cur != (0, 0):
            path.append(cur)
            i, j = cur
            cur = self._bp[i][j]
        if cur != (0, 0):
            return AlignResult(
                None,
                [],
                0.0,
                0,
                "endpoint unreachable: backtracking did not reach (0, 0)",
            )
        path.reverse()
        # DP 坐标 -> 值坐标（0-based）。path 不含边界 (0,0)：进入 (0,0) 的
        # 唯一合法前驱是 (1,1)，故首点自然映射为 (0,0)。
        value_path = [(i - 1, j - 1) for (i, j) in path]
        violations = sum(1 for (i, j) in path if abs(i - j) > self._band)
        return AlignResult(
            distance=self._dp[n][m],
            path=value_path,
            warping_ratio=len(value_path) / max(n, m),
            band_violations=violations,
            reason=None,
        )

    def get_state(self) -> StateResult:
        """返回长度、已填充单元格数、窗口利用率与上次对齐距离。"""
        n, m = len(self._a), len(self._b)
        utilization = (
            self._filled_cells / (n * m) if n * m > 0 else 0.0
        )
        last_distance = self._cache.distance if self._cache is not None else None
        return StateResult(
            length_a=n,
            length_b=m,
            filled_cells=self._filled_cells,
            window_utilization=utilization,
            last_distance=last_distance,
        )

    # ----- 持久化 ---------------------------------------------------------

    def to_snapshot(self) -> Dict[str, object]:
        """导出可 JSON 序列化的快照字典（含完整 DP 表窗口内状态）。"""
        n, m = len(self._a), len(self._b)
        cells: List[List[object]] = []
        for i in range(1, n + 1):
            lo = max(1, i - self._band)
            hi = min(m, i + self._band)
            for j in range(lo, hi + 1):
                value = self._dp[i][j]
                bp = self._bp[i][j]
                cells.append(
                    [
                        i,
                        j,
                        None if not math.isfinite(value) else value,
                        None if bp is None else [bp[0], bp[1]],
                    ]
                )
        last_distance = self._cache.distance if self._cache is not None else None
        return {
            "format": SNAPSHOT_FORMAT,
            "name_a": self._name_a,
            "name_b": self._name_b,
            "metric": self._metric,
            "band": self._band,
            "max_cells": self._max_cells,
            "values_a": list(self._a),
            "values_b": list(self._b),
            "last_distance": last_distance,
            "dp": {
                "rows": n + 1,
                "cols": m + 1,
                "cells": cells,
            },
        }

    def save(self, path: str) -> None:
        """把完整状态写入 JSON 文件（UTF-8、不带非有限浮点数）。"""
        payload = self.to_snapshot()
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, allow_nan=False, indent=2)

    @classmethod
    def load(cls, path: str) -> "StreamAligner":
        """从 JSON 快照重建 aligner 并做严格一致性校验。

        校验内容：格式标识、字段齐全、序列值有限、band 非负、度量合法、
        DP 维度与序列长度匹配、所有存储单元格在窗口内、窗口单元格无遗漏、
        每个单元格的值与前驱与按序列重算的结果逐格一致、缓存距离一致。

        :raises SnapshotError: 任何一项校验失败。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as exc:
            raise SnapshotError(f"cannot read snapshot {path!r}: {exc}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"snapshot {path!r} is not valid JSON: {exc}") from exc
        return cls.from_snapshot(data, source=path)

    @classmethod
    def from_snapshot(
        cls, data: object, source: str = "<snapshot>"
    ) -> "StreamAligner":
        """从快照字典重建并校验（:meth:`load` 的字典版本）。"""
        where = f"snapshot {source!r}"
        if not isinstance(data, dict):
            raise SnapshotError(f"{where}: top-level value must be an object")

        def require(key: str, expected: type) -> object:
            if key not in data:
                raise SnapshotError(f"{where}: missing field {key!r}")
            val = data[key]
            if not isinstance(val, expected) or (
                expected is int and isinstance(val, bool)
            ):
                raise SnapshotError(
                    f"{where}: field {key!r} must be {expected.__name__}, "
                    f"got {type(val).__name__}"
                )
            return val

        if data.get("format") != SNAPSHOT_FORMAT:
            raise SnapshotError(
                f"{where}: unexpected format {data.get('format')!r}, "
                f"expected {SNAPSHOT_FORMAT!r}"
            )
        name_a = require("name_a", str)
        name_b = require("name_b", str)
        metric = require("metric", str)
        band = require("band", int)
        values_a = require("values_a", list)
        values_b = require("values_b", list)
        if "max_cells" not in data:
            raise SnapshotError(f"{where}: missing field 'max_cells'")
        max_cells = data["max_cells"]
        if "dp" not in data or not isinstance(data["dp"], dict):
            raise SnapshotError(f"{where}: field 'dp' must be an object")

        if not name_a or not name_b:
            raise SnapshotError(f"{where}: series names must be non-empty strings")
        if metric not in METRICS:
            raise SnapshotError(f"{where}: invalid metric {metric!r}")
        if band < 0:
            raise SnapshotError(f"{where}: band must be non-negative, got {band}")
        if max_cells is not None:
            if isinstance(max_cells, bool) or not isinstance(max_cells, int):
                raise SnapshotError(
                    f"{where}: max_cells must be an int or null, "
                    f"got {type(max_cells).__name__}"
                )
            if max_cells <= 0:
                raise SnapshotError(f"{where}: max_cells must be positive, got {max_cells}")

        series_a = cls._validate_snapshot_values(values_a, name_a, where)
        series_b = cls._validate_snapshot_values(values_b, name_b, where)
        n, m = len(series_a), len(series_b)

        dp_obj = data["dp"]
        rows = dp_obj.get("rows")
        cols = dp_obj.get("cols")
        raw_cells = dp_obj.get("cells")
        if (
            not isinstance(rows, int)
            or isinstance(rows, bool)
            or not isinstance(cols, int)
            or isinstance(cols, bool)
        ):
            raise SnapshotError(f"{where}: dp.rows and dp.cols must be ints")
        if rows != n + 1 or cols != m + 1:
            raise SnapshotError(
                f"{where}: DP dimensions {rows}x{cols} do not match series lengths "
                f"{n + 1}x{m + 1}"
            )
        if not isinstance(raw_cells, list):
            raise SnapshotError(f"{where}: dp.cells must be a list")

        # 解析并校验单元格坐标 / 窗口约束 / 字段形状。
        stored: Dict[Tuple[int, int], Tuple[Optional[float], Optional[Tuple[int, int]]]] = {}
        for idx, cell in enumerate(raw_cells):
            if not isinstance(cell, list) or len(cell) != 4:
                raise SnapshotError(
                    f"{where}: cell #{idx} must be [i, j, value, backpointer]"
                )
            i, j, value, bp = cell
            if (
                not isinstance(i, int)
                or isinstance(i, bool)
                or not isinstance(j, int)
                or isinstance(j, bool)
                or not (1 <= i < rows and 1 <= j < cols)
            ):
                raise SnapshotError(f"{where}: cell #{idx} has invalid coordinates [{i},{j}]")
            if abs(i - j) > band:
                raise SnapshotError(
                    f"{where}: cell ({i},{j}) is stored but lies outside the band "
                    f"(|i-j|={abs(i - j)} > {band})"
                )
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, (int, float))
            ):
                raise SnapshotError(f"{where}: cell ({i},{j}) has invalid value {value!r}")
            if bp is not None:
                if not isinstance(bp, list) or len(bp) != 2:
                    raise SnapshotError(
                        f"{where}: cell ({i},{j}) backpointer must be [pi,pj] or null"
                    )
                pi, pj = bp
                if not (
                    isinstance(pi, int)
                    and not isinstance(pi, bool)
                    and isinstance(pj, int)
                    and not isinstance(pj, bool)
                ):
                    raise SnapshotError(
                        f"{where}: cell ({i},{j}) backpointer coordinates must be ints"
                    )
            if (i, j) in stored:
                raise SnapshotError(f"{where}: duplicate cell ({i},{j})")
            stored[(i, j)] = (
                None if value is None else float(value),
                None if bp is None else (bp[0], bp[1]),
            )

        expected_count = sum(
            max(0, min(m, i + band) - max(1, i - band) + 1)
            for i in range(1, n + 1)
        )
        if len(stored) != expected_count:
            raise SnapshotError(
                f"{where}: DP table has {len(stored)} stored cells but window requires "
                f"{expected_count} (cells missing or duplicated)"
            )

        # 用序列重算整张增量表，逐格比对，保证磁盘状态与内核定义一致。
        try:
            rebuilt = cls.from_series(
                Series(name_a, series_a),
                Series(name_b, series_b),
                metric=metric,
                band=band,
                max_cells=max_cells,
            )
        except MemoryLimitError as exc:
            raise SnapshotError(
                f"{where}: stored series do not fit in stored max_cells: {exc}"
            ) from exc
        except ZeroVectorError as exc:
            raise SnapshotError(f"{where}: stored series imply an undefined cos cost: {exc}") from exc

        for (i, j), (stored_value, stored_bp) in stored.items():
            actual_value = rebuilt._dp[i][j]
            actual_value = None if not math.isfinite(actual_value) else actual_value
            if stored_value != actual_value:
                raise SnapshotError(
                    f"{where}: DP value mismatch at ({i},{j}): stored {stored_value}, "
                    f"recomputed {actual_value}"
                )
            actual_bp = rebuilt._bp[i][j]
            if stored_bp != actual_bp:
                raise SnapshotError(
                    f"{where}: backpointer mismatch at ({i},{j}): stored {stored_bp}, "
                    f"recomputed {actual_bp}"
                )

        align_result = rebuilt.align()
        stored_last = data.get("last_distance")
        if stored_last is not None and (
            isinstance(stored_last, bool) or not isinstance(stored_last, (int, float))
        ):
            raise SnapshotError(f"{where}: last_distance must be a number or null")
        expected_last = align_result.distance
        if stored_last is None:
            stored_last_cmp: Optional[float] = None
        else:
            stored_last_cmp = float(stored_last)
        if stored_last_cmp != expected_last:
            raise SnapshotError(
                f"{where}: last_distance mismatch: stored {stored_last_cmp}, "
                f"recomputed {expected_last}"
            )
        rebuilt._cache = align_result
        return rebuilt

    @staticmethod
    def _validate_snapshot_values(
        raw: List[object], name: str, where: str
    ) -> List[float]:
        """校验快照中的值数组并返回浮点数列表。"""
        if not name:
            raise SnapshotError(f"{where}: empty series name")
        if len(raw) > MAX_SERIES_LENGTH:
            raise SnapshotError(
                f"{where}: series {name!r} length {len(raw)} exceeds {MAX_SERIES_LENGTH}"
            )
        out: List[float] = []
        for idx, v in enumerate(raw):
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise SnapshotError(
                    f"{where}: series {name!r} index {idx} must be a number, "
                    f"got {type(v).__name__}"
                )
            fv = float(v)
            if not math.isfinite(fv):
                raise SnapshotError(
                    f"{where}: series {name!r} index {idx} must be finite, got {fv}"
                )
            out.append(fv)
        return out
