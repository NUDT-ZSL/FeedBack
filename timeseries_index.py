"""内存时序索引（纯 Python 标准库实现）。

结构概览
--------

* 每个数据点是一个 :class:`Point`（frozen dataclass）。
* 索引按 ``series`` 分桶，桶内是一棵以 ``(ts, point_id)`` 为键的 **Treap**
  （树堆，随机化平衡二叉搜索树）。插入 / 单点删除期望 O(log n)，
  范围查询 O(log n + k)，范围删除通过两次 split + 一次 merge 完成，
  期望 O(log n + k)，k 为命中点数。
* ``point_id -> Point`` 的全局字典保证 point_id 全局唯一，并支撑
  :meth:`TimeSeriesIndex.get_point` O(1) 查询。
* 快照会深拷贝每棵 Treap（Point 对象不可变，浅共享即可），
  回滚时用快照的副本重建当前状态，因此回滚不会破坏任何已有快照，
  快照之间可以来回嵌套回滚。

注意 Treap 的平衡保证是*期望*意义上的（随机优先级），随机源在模块加载时
以固定种子初始化，行为可复现。本模块不保证线程安全。
"""

from __future__ import annotations

import json
import math
import os
import random
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# 异常类型
# ---------------------------------------------------------------------------


class TimeseriesError(Exception):
    """本模块所有自定义异常的基类。"""


class InvalidPointError(TimeseriesError, ValueError):
    """数据点字段非法（缺失、类型错误、非有限值等）。"""


class DuplicatePointError(TimeseriesError, ValueError):
    """插入时 point_id 已存在（含同一批次内部重复）。"""


class InvalidRangeError(TimeseriesError, ValueError):
    """范围参数非法（start > end 或类型不是整数）。"""


class SnapshotError(TimeseriesError):
    """快照相关错误的基类。"""


class SnapshotNotFoundError(SnapshotError, KeyError):
    """回滚 / 删除一个不存在的快照。"""

    def __str__(self) -> str:  # KeyError.__str__ 会多加一层引号
        return self.args[0] if self.args else ""


class SnapshotExistsError(SnapshotError, ValueError):
    """创建快照时名称已被占用。"""


class IndexFormatError(TimeseriesError, ValueError):
    """save 文件损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 数据点
# ---------------------------------------------------------------------------

_POINT_FIELDS = ("point_id", "series", "ts", "value")


@dataclass(frozen=True)
class Point:
    """一个时序数据点，构造时即校验，创建后不可变。

    :param point_id: 非空字符串，全局唯一。
    :param series: 非空字符串，序列名。
    :param ts: 整数逻辑时间（bool 不被接受，尽管它是 int 的子类）。
    :param value: 有限数值，统一规整为 ``float`` 存储。
    """

    point_id: str
    series: str
    ts: int
    value: float

    def __post_init__(self) -> None:
        if not isinstance(self.point_id, str) or not self.point_id:
            raise InvalidPointError("point_id 必须是非空字符串")
        if not isinstance(self.series, str) or not self.series:
            raise InvalidPointError("series 必须是非空字符串")
        if isinstance(self.ts, bool) or not isinstance(self.ts, int):
            raise InvalidPointError(f"ts 必须是整数，收到 {type(self.ts).__name__}")
        value = self.value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise InvalidPointError(
                f"value 必须是数值，收到 {type(value).__name__}"
            )
        value = float(value)
        if not math.isfinite(value):
            raise InvalidPointError("value 必须是有限数（不能是 NaN/Infinity）")
        # frozen dataclass 中规整字段需要绕过冻结机制
        object.__setattr__(self, "value", value)

    @staticmethod
    def from_dict(raw: Any) -> "Point":
        """从映射构造 :class:`Point`，字段缺失 / 多余 / 类型错都抛
        :class:`InvalidPointError`。"""
        if not isinstance(raw, Mapping):
            raise InvalidPointError(
                f"数据点必须是 JSON 对象，收到 {type(raw).__name__}"
            )
        missing = [f for f in _POINT_FIELDS if f not in raw]
        if missing:
            raise InvalidPointError(f"数据点缺少字段: {', '.join(missing)}")
        extra = [k for k in raw if k not in _POINT_FIELDS]
        if extra:
            raise InvalidPointError(f"数据点存在未知字段: {', '.join(sorted(extra))}")
        return Point(
            point_id=raw["point_id"],
            series=raw["series"],
            ts=raw["ts"],
            value=raw["value"],
        )

    def to_dict(self) -> Dict[str, Any]:
        """转成可 JSON 序列化的字典。"""
        return {
            "point_id": self.point_id,
            "series": self.series,
            "ts": self.ts,
            "value": self.value,
        }


def _coerce_point(point: Any) -> Point:
    """接受 :class:`Point` 或映射，统一返回校验过的 :class:`Point`。"""
    if isinstance(point, Point):
        return point
    if isinstance(point, Mapping):
        return Point.from_dict(point)
    raise InvalidPointError(
        f"insert 参数必须是 Point 或 JSON 对象，收到 {type(point).__name__}"
    )


def _validate_bound(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidRangeError(
            f"{name} 必须是整数，收到 {type(value).__name__}"
        )
    return value


# ---------------------------------------------------------------------------
# Treap（树堆）
#
# 节点键为 (ts, point_id)，天然全序且与查询要求的排序一致。
# split / merge 是 Treap 的核心原语，均只沿期望 O(log n) 的路径工作。
# 这些函数会*就地*修改节点指针，因此只能作用于索引当前私有树；
# 快照持有自己深拷贝出来的树，互不影响。
# ---------------------------------------------------------------------------

# 固定种子，保证测试与多次运行之间行为可复现
_rng = random.Random(0x5EED1234)


class _Node:
    __slots__ = ("key", "point", "priority", "left", "right")

    def __init__(self, point: Point, priority: int) -> None:
        self.key: Tuple[int, str] = (point.ts, point.point_id)
        self.point: Point = point
        self.priority: int = priority
        self.left: Optional[_Node] = None
        self.right: Optional[_Node] = None


def _merge(a: Optional[_Node], b: Optional[_Node]) -> Optional[_Node]:
    """合并两棵树，要求 a 中所有键 < b 中所有键。"""
    if a is None:
        return b
    if b is None:
        return a
    if a.priority > b.priority:
        a.right = _merge(a.right, b)
        return a
    b.left = _merge(a, b.left)
    return b


def _split(root: Optional[_Node], key: Tuple[int, str]) -> Tuple[
    Optional[_Node], Optional[_Node]
]:
    """按键切分：返回 (键 < key 的树, 键 >= key 的树)。"""
    if root is None:
        return None, None
    if root.key < key:
        left, right = _split(root.right, key)
        root.right = left
        return root, right
    left, right = _split(root.left, key)
    root.left = right
    return left, root


def _rotate_right(y: _Node) -> _Node:
    x = y.left
    assert x is not None
    y.left = x.right
    x.right = y
    return x


def _rotate_left(x: _Node) -> _Node:
    y = x.right
    assert y is not None
    x.right = y.left
    y.left = x
    return y


def _insert(root: Optional[_Node], node: _Node) -> _Node:
    """按 BST 规则插入并用优先级旋转维持堆性质；键重复抛错。"""
    if root is None:
        return node
    if node.key == root.key:  # 理论上不可达：point_id 全局唯一
        raise DuplicatePointError(
            f"point_id 重复: {node.point.point_id}"
        )
    if node.key < root.key:
        root.left = _insert(root.left, node)
        assert root.left is not None
        if root.left.priority > root.priority:
            root = _rotate_right(root)
    else:
        root.right = _insert(root.right, node)
        assert root.right is not None
        if root.right.priority > root.priority:
            root = _rotate_left(root)
    return root


def _erase(root: Optional[_Node], key: Tuple[int, str]) -> Tuple[
    Optional[_Node], Optional[Point]
]:
    """按键删除单个节点，返回 (新根, 被删点)；键不存在时被删点为 None。"""
    if root is None:
        return None, None
    if key == root.key:
        removed = root.point
        return _merge(root.left, root.right), removed
    if key < root.key:
        root.left, removed = _erase(root.left, key)
    else:
        root.right, removed = _erase(root.right, key)
    return root, removed


def _clone(root: Optional[_Node]) -> Optional[_Node]:
    """深拷贝一棵树。Point 不可变，直接共享；优先级保留以维持相同形状。"""
    if root is None:
        return None
    node = _Node(root.point, root.priority)
    node.left = _clone(root.left)
    node.right = _clone(root.right)
    return node


def _collect_inorder(root: Optional[_Node], out: List[Point]) -> None:
    if root is None:
        return
    _collect_inorder(root.left, out)
    out.append(root.point)
    _collect_inorder(root.right, out)


def _range_scan(root: Optional[_Node], start: int, end: int) -> List[Point]:
    """返回 ts ∈ [start, end) 的点，按 (ts, point_id) 升序。

    point_id 都是非空字符串，所以用 ``(start, "")`` / ``(end, "")``
    作为开闭边界：ts == start 的键一定大于下界，ts == end 的键一定
    大于等于上界，恰好得到左闭右开区间。
    """
    lo = (start, "")
    hi = (end, "")
    stack: List[_Node] = []
    cur = root
    # 下降到第一个键 >= lo 的节点，沿途保留后继路径
    while cur is not None:
        if cur.key >= lo:
            stack.append(cur)
            cur = cur.left
        else:
            cur = cur.right

    result: List[Point] = []
    while stack:
        cur = stack.pop()
        if cur.key >= hi:
            break  # 中序有序，之后的点全部 >= end
        result.append(cur.point)
        nxt = cur.right
        while nxt is not None:
            stack.append(nxt)
            nxt = nxt.left
    return result


def _build_tree(points: Sequence[Point]) -> Optional[_Node]:
    """把一批点插入成一棵新 Treap，供 load 重建使用。"""
    root: Optional[_Node] = None
    for point in points:
        root = _insert(root, _Node(point, _rng.getrandbits(64)))
    return root


# ---------------------------------------------------------------------------
# 快照容器
# ---------------------------------------------------------------------------


@dataclass
class _Snapshot:
    """一次快照记录的完整状态。"""

    series: Dict[str, Optional[_Node]]  # series -> 快照专属 Treap 根
    points: Dict[str, Point]            # point_id -> Point（Point 可共享）
    counts: Dict[str, int]              # series -> 点数


# ---------------------------------------------------------------------------
# 索引主体
# ---------------------------------------------------------------------------


class TimeSeriesIndex:
    """内存时序索引：按 series 分桶 + 桶内 Treap + 全局 point_id 表。"""

    FORMAT_NAME = "timeseries-index"
    FORMAT_VERSION = 1

    def __init__(self) -> None:
        self._series: Dict[str, Optional[_Node]] = {}
        self._points: Dict[str, Point] = {}
        self._counts: Dict[str, int] = {}
        self._snapshots: Dict[str, _Snapshot] = {}

    # -- 基础属性 ---------------------------------------------------------

    def __len__(self) -> int:
        return len(self._points)

    @property
    def total_points(self) -> int:
        """当前总点数。"""
        return len(self._points)

    # -- 写入 -------------------------------------------------------------

    def insert(self, point: Any) -> None:
        """插入一个点（:class:`Point` 或等价映射）。

        :raises DuplicatePointError: point_id 已存在。
        :raises InvalidPointError: 字段非法。
        """
        p = _coerce_point(point)
        if p.point_id in self._points:
            raise DuplicatePointError(f"point_id 重复: {p.point_id}")
        self._points[p.point_id] = p
        node = _Node(p, _rng.getrandbits(64))
        self._series[p.series] = _insert(self._series.get(p.series), node)
        self._counts[p.series] = self._counts.get(p.series, 0) + 1

    def insert_many(self, points: Any) -> None:
        """批量插入，**原子**：要么全部成功，要么索引保持调用前状态。

        先做完整校验（字段、批内 point_id 重复、与已有数据冲突），
        全部通过后才开始写入，因此校验阶段失败绝不会产生半插入状态。

        :raises DuplicatePointError: 批内或与已有数据 point_id 冲突。
        :raises InvalidPointError: 任一点字段非法。
        """
        # 拒绝字符串/字节/映射：它们虽然可迭代，但显然不是点的序列
        if isinstance(points, (str, bytes, Mapping)) or not hasattr(
            points, "__iter__"
        ):
            raise InvalidPointError("insert_many 参数必须是数据点列表/可迭代对象")
        prepared: List[Point] = []
        seen: set[str] = set()
        for raw in points:
            p = _coerce_point(raw)
            if p.point_id in seen:
                raise DuplicatePointError(
                    f"批量插入中 point_id 重复: {p.point_id}"
                )
            if p.point_id in self._points:
                raise DuplicatePointError(f"point_id 已存在: {p.point_id}")
            seen.add(p.point_id)
            prepared.append(p)

        # 校验全部通过，以下写入不会再失败
        for p in prepared:
            self._points[p.point_id] = p
            node = _Node(p, _rng.getrandbits(64))
            self._series[p.series] = _insert(self._series.get(p.series), node)
            self._counts[p.series] = self._counts.get(p.series, 0) + 1

    # -- 查询 -------------------------------------------------------------

    def get_point(self, point_id: str) -> Optional[Point]:
        """按 point_id 取点详情，不存在返回 ``None``。"""
        return self._points.get(point_id)

    def list_series(self) -> List[str]:
        """返回所有 series 名，按字典序升序。"""
        return sorted(self._series)

    def series_count(self, series: str) -> int:
        """返回某 series 的点数，不存在时为 0。"""
        return self._counts.get(series, 0)

    def range_query(self, series: str, start: int, end: int) -> List[Point]:
        """查询 ``[start, end)`` 内的点，按 ``(ts, point_id)`` 升序。

        :raises InvalidRangeError: start / end 不是整数或 start > end。
        """
        start = _validate_bound(start, "start")
        end = _validate_bound(end, "end")
        if start > end:
            raise InvalidRangeError(f"start({start}) 不能大于 end({end})")
        root = self._series.get(series)
        if root is None:
            return []
        return _range_scan(root, start, end)

    def range_delete(self, series: str, start: int, end: int) -> int:
        """删除 ``[start, end)`` 内的点，返回被删点数。

        series 不存在或区间为空时返回 0，不报错。实现为两次
        split 取出中间段 + 一次 merge 缝合，期望 O(log n + k)。

        :raises InvalidRangeError: start / end 不是整数或 start > end。
        """
        start = _validate_bound(start, "start")
        end = _validate_bound(end, "end")
        if start > end:
            raise InvalidRangeError(f"start({start}) 不能大于 end({end})")
        root = self._series.get(series)
        if root is None:
            return 0

        left, rest = _split(root, (start, ""))
        middle, right = _split(rest, (end, ""))

        deleted: List[Point] = []
        _collect_inorder(middle, deleted)
        for p in deleted:
            del self._points[p.point_id]

        new_root = _merge(left, right)
        if new_root is None:
            # 桶清空后移除 series，保证 list_series 只包含有点的序列
            self._series.pop(series, None)
            self._counts.pop(series, None)
        else:
            self._series[series] = new_root
            self._counts[series] = self._counts.get(series, 0) - len(deleted)
        return len(deleted)

    # -- 快照与回滚 -------------------------------------------------------

    def snapshot(self, name: str) -> str:
        """对当前全部桶状态打快照，名称必须是非空且未占用的字符串。

        快照保存深拷贝，之后对索引的任何修改都不会影响它。
        """
        if not isinstance(name, str) or not name:
            raise SnapshotError("快照名称必须是非空字符串")
        if name in self._snapshots:
            raise SnapshotExistsError(f"快照已存在: {name}")
        self._snapshots[name] = _Snapshot(
            series={s: _clone(root) for s, root in self._series.items()},
            points=dict(self._points),
            counts=dict(self._counts),
        )
        return name

    def rollback(self, name: str) -> str:
        """回滚到指定快照。

        快照之后插入的点全部丢弃、删除的点全部恢复；其它快照
        （更早或更晚的）都保持原样、仍可继续回滚。

        :raises SnapshotNotFoundError: 快照名称不存在。
        """
        snap = self._snapshots.get(name)
        if snap is None:
            raise SnapshotNotFoundError(f"快照不存在: {name}")
        # 用快照的*副本*替换当前状态，后续修改不会写坏快照本身
        self._series = {s: _clone(root) for s, root in snap.series.items()}
        self._points = dict(snap.points)
        self._counts = dict(snap.counts)
        return name

    def delete_snapshot(self, name: str) -> None:
        """删除一个快照；不存在时抛 :class:`SnapshotNotFoundError`。"""
        if name not in self._snapshots:
            raise SnapshotNotFoundError(f"快照不存在: {name}")
        del self._snapshots[name]

    def list_snapshots(self) -> List[str]:
        """返回所有快照名称，按字典序升序。"""
        return sorted(self._snapshots)

    # -- 状态概览 ---------------------------------------------------------

    def get_state(self) -> Dict[str, Any]:
        """返回索引状态概览。

        内容：series 数量、总点数、每个 series 的点数（按名排序）、
        快照名称列表。
        """
        return {
            "series_count": len(self._series),
            "total_points": len(self._points),
            "series_points": {
                s: self._counts[s] for s in sorted(self._series)
            },
            "snapshots": sorted(self._snapshots),
        }

    # -- 序列化 -----------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """导出为可 JSON 序列化的完整结构（含全部快照）。"""
        live: Dict[str, List[Dict[str, Any]]] = {}
        for s in sorted(self._series):
            pts: List[Point] = []
            _collect_inorder(self._series[s], pts)
            live[s] = [p.to_dict() for p in pts]

        snapshots = []
        for name in sorted(self._snapshots):
            snap = self._snapshots[name]
            snap_series: Dict[str, List[Dict[str, Any]]] = {}
            for s in sorted(snap.series):
                pts = []
                _collect_inorder(snap.series[s], pts)
                snap_series[s] = [p.to_dict() for p in pts]
            snapshots.append({"name": name, "series": snap_series})

        return {
            "format": self.FORMAT_NAME,
            "version": self.FORMAT_VERSION,
            "series": live,
            "snapshots": snapshots,
        }

    def save(self, path: str) -> None:
        """把索引（含快照）写成 JSON 文件。

        先写同目录临时文件再原子替换，避免写到一半留下残缺文件。
        """
        payload = json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
        directory = os.path.dirname(os.path.abspath(path))
        fd, tmp_path = tempfile.mkstemp(prefix=".tsidx-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp_path, path)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    @classmethod
    def load(cls, path: str) -> "TimeSeriesIndex":
        """从 :meth:`save` 写出的文件重建索引并做一致性校验。

        校验内容：JSON 可解析且不含 NaN/Infinity 常量；顶层字段齐全；
        每个点字段合法；point_id 全局唯一；点所在桶与其 series 字段
        一致（即快照引用的 series 都存在）；快照名称非空且不重复。

        :raises IndexFormatError: 文件损坏或任何一致性校验失败。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as exc:
            raise IndexFormatError(f"无法读取文件 {path!r}: {exc}") from exc

        def _reject_constant(value: str) -> None:
            raise IndexFormatError(f"文件包含非法 JSON 常量: {value}")

        try:
            data = json.loads(text, parse_constant=_reject_constant)
        except IndexFormatError:
            raise
        except json.JSONDecodeError as exc:
            raise IndexFormatError(f"JSON 解析失败: {exc}") from exc

        if not isinstance(data, dict):
            raise IndexFormatError("顶层结构必须是 JSON 对象")
        for key in ("format", "version", "series", "snapshots"):
            if key not in data:
                raise IndexFormatError(f"缺少顶层字段: {key}")
        if data["format"] != cls.FORMAT_NAME:
            raise IndexFormatError(
                f"format 字段应为 {cls.FORMAT_NAME!r}，实际为 {data['format']!r}"
            )
        if data["version"] != cls.FORMAT_VERSION:
            raise IndexFormatError(
                f"version 字段应为 {cls.FORMAT_VERSION}，实际为 {data['version']!r}"
            )

        live_by_series, live_points, live_counts = _load_series_map(
            data["series"], "当前数据"
        )

        raw_snaps = data["snapshots"]
        if not isinstance(raw_snaps, list):
            raise IndexFormatError("snapshots 必须是数组")
        loaded_snapshots: List[Tuple[str, Dict[str, List[Point]], Dict[str, Point], Dict[str, int]]] = []
        snapshot_names: set[str] = set()
        for i, raw in enumerate(raw_snaps):
            where = f"snapshots[{i}]"
            if not isinstance(raw, dict):
                raise IndexFormatError(f"{where} 必须是对象")
            if "name" not in raw or "series" not in raw:
                raise IndexFormatError(f"{where} 缺少 name 或 series 字段")
            name = raw["name"]
            if not isinstance(name, str) or not name:
                raise IndexFormatError(f"{where} 的 name 必须是非空字符串")
            if name in snapshot_names:
                raise IndexFormatError(f"快照名称重复: {name}")
            snapshot_names.add(name)
            by_series, points, counts = _load_series_map(raw["series"], where)
            loaded_snapshots.append((name, by_series, points, counts))

        index = cls()
        index.insert_many(list(live_points.values()))
        for name, by_series, points, counts in loaded_snapshots:
            roots = {s: _build_tree(plist) for s, plist in by_series.items()}
            index._snapshots[name] = _Snapshot(roots, points, counts)
        return index


def _load_series_map(
    obj: Any, context: str
) -> Tuple[Dict[str, List[Point]], Dict[str, Point], Dict[str, int]]:
    """校验并加载 ``{series: [point, ...]}`` 结构。

    每个点的 ``series`` 必须与其所在桶一致（保证引用的 series 存在），
    point_id 在整张映射内全局唯一。
    """
    if not isinstance(obj, dict):
        raise IndexFormatError(f"{context}: series 必须是 JSON 对象")
    by_series: Dict[str, List[Point]] = {}
    all_points: Dict[str, Point] = {}
    counts: Dict[str, int] = {}
    for bucket, raw_list in obj.items():
        if not isinstance(bucket, str) or not bucket:
            raise IndexFormatError(f"{context}: series 名必须是非空字符串")
        if not isinstance(raw_list, list):
            raise IndexFormatError(
                f"{context}: series {bucket!r} 的值必须是数组"
            )
        pts: List[Point] = []
        for i, raw in enumerate(raw_list):
            try:
                p = Point.from_dict(raw)
            except InvalidPointError as exc:
                raise IndexFormatError(
                    f"{context} / series {bucket!r} 第 {i} 个点非法: {exc}"
                ) from exc
            if p.series != bucket:
                raise IndexFormatError(
                    f"{context} / series {bucket!r} 中的点 {p.point_id!r} "
                    f"其 series 字段为 {p.series!r}，引用的 series 不存在或不匹配"
                )
            if p.point_id in all_points:
                raise IndexFormatError(
                    f"{context}: point_id 全局唯一性被破坏，重复 ID: {p.point_id}"
                )
            all_points[p.point_id] = p
            pts.append(p)
        if pts:
            by_series[bucket] = pts
            counts[bucket] = len(pts)
    return by_series, all_points, counts
