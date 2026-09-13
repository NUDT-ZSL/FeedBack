"""内存时序索引（纯 Python 标准库实现）。

结构概览
--------

索引状态由三部分组成，全部是**纯持久化（persistent）数据结构**：

* ``_series_root``：一棵以 series 名为键的持久化 Treap，值为
  ``(该 series 的数据树根, 点数)``；
* 每个 series 的数据树是一棵以 ``(ts, point_id)`` 为键的持久化 Treap，
  值为 :class:`Point`；
* ``_points_root``：一棵以 ``point_id`` 为键的持久化 Treap，值为
  :class:`Point`，负责全局唯一性与 :meth:`get_point`。

“持久化”指每次修改都沿根到目标的路径复制节点（path copying），
不触碰的子树与旧版本共享。因此：

* 插入 / 删除只分配 O(log n) 个新节点，旧版本仍然完整可读；
* **snapshot 只保存三个根引用，O(1) 时间、O(1) 增量内存**，
  与总点数无关，连打任意次快照都不会复制数据；
* rollback 只是把三个根引用换回去，O(1)，且因为节点永不就地修改，
  任何快照都不会被后续变更（包括回滚后另起分支的变更）破坏，
  快照之间完全隔离、可以任意来回回滚。

复杂度（n 为桶内点数，s 为 series 数，k 为命中点数）：

* 插入：O(log s + log n)；
* 范围查询：O(log n + k)；
* 范围删除：数据树两次 split + 一次 merge 为 O(log n + k)，
  全局 point_id 索引按删除规模自适应——零星删除逐点擦除
  O(k log n)，大批删除（如清空整桶）线性重建 O(m)，避免
  删除半个索引时的平方级退化；
* snapshot / rollback：O(1)。

Treap 的平衡是*期望*意义上的（随机优先级，模块加载时以固定种子初始化，
行为可复现）。本模块不保证线程安全。
"""

from __future__ import annotations

import json
import math
import os
import random
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple

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
# 持久化 Treap（Persistent Treap）
#
# 所有修改原语都不改变传入的节点，而是返回新根；未涉及的子树原样共享。
# 键可以是任意可比较类型（本模块中是 str 或 (int, str) 元组）。
# ---------------------------------------------------------------------------

# 固定种子，保证测试与多次运行之间行为可复现
_rng = random.Random(0x5EED1234)


class _Node:
    __slots__ = ("key", "value", "priority", "left", "right")

    def __init__(
        self,
        key: Any,
        value: Any,
        priority: int,
        left: "Optional[_Node]" = None,
        right: "Optional[_Node]" = None,
    ) -> None:
        self.key = key
        self.value = value
        self.priority = priority
        self.left = left
        self.right = right


# “保持该字段不变”的哨兵：不能用 None，因为 None 本身是合法的孩子值
_KEEP = object()


def _clone_with(
    node: _Node,
    *,
    left: Any = _KEEP,
    right: Any = _KEEP,
    value: Any = _KEEP,
) -> _Node:
    """复制一个节点，可替换左/右孩子或值；未指定的字段保持共享。"""
    return _Node(
        node.key,
        node.value if value is _KEEP else value,
        node.priority,
        node.left if left is _KEEP else left,
        node.right if right is _KEEP else right,
    )


def _merge(a: Optional[_Node], b: Optional[_Node]) -> Optional[_Node]:
    """持久化合并：要求 a 中所有键 < b 中所有键。返回新树，入参树不变。"""
    if a is None:
        return b
    if b is None:
        return a
    if a.priority > b.priority:
        return _clone_with(a, right=_merge(a.right, b))
    return _clone_with(b, left=_merge(a, b.left))


def _split(
    root: Optional[_Node], key: Any
) -> Tuple[Optional[_Node], Optional[_Node]]:
    """持久化切分：返回 (键 < key 的新树, 键 >= key 的新树)。"""
    if root is None:
        return None, None
    if root.key < key:
        left, right = _split(root.right, key)
        return _clone_with(root, right=left), right
    left, right = _split(root.left, key)
    return left, _clone_with(root, left=right)


def _upsert(
    root: Optional[_Node],
    key: Any,
    value: Any,
    priority: int,
) -> Optional[_Node]:
    """持久化插入/更新。

    键不存在时用 ``priority`` 新建节点；键已存在时*保留原优先级*
    （树形状不变），只沿路径复制并替换值。
    """
    if root is None:
        return _Node(key, value, priority)
    if key == root.key:
        return _clone_with(root, value=value)
    if key < root.key:
        new_left = _upsert(root.left, key, value, priority)
        # 更新已有键时路径上优先级全部不变、堆性质自然成立；
        # 新插入则按优先级决定是否旋转
        if new_left.priority > root.priority:
            return _rotate_right(_clone_with(root, left=new_left))
        return _clone_with(root, left=new_left)
    new_right = _upsert(root.right, key, value, priority)
    if new_right.priority > root.priority:
        return _rotate_left(_clone_with(root, right=new_right))
    return _clone_with(root, right=new_right)


def _rotate_right(y: _Node) -> _Node:
    """对*已复制*的节点做右旋，返回新的子树根。"""
    x = y.left
    assert x is not None
    # x 是新复制的节点，直接改它的指针即可（不会影响任何旧版本）
    x.right = _clone_with(y, left=x.right)
    return x


def _rotate_left(x: _Node) -> _Node:
    """对*已复制*的节点做左旋，返回新的子树根。"""
    y = x.right
    assert y is not None
    y.left = _clone_with(x, right=y.left)
    return y


def _erase(
    root: Optional[_Node], key: Any
) -> Tuple[Optional[_Node], Any]:
    """持久化按键删除，返回 (新根, 被删值)；键不存在时被删值为 None。"""
    if root is None:
        return None, None
    if key == root.key:
        return _merge(root.left, root.right), root.value
    if key < root.key:
        new_left, removed = _erase(root.left, key)
        if removed is None:
            return root, None  # 键不存在：直接返回原根，零分配
        return _clone_with(root, left=new_left), removed
    new_right, removed = _erase(root.right, key)
    if removed is None:
        return root, None
    return _clone_with(root, right=new_right), removed


def _find(root: Optional[_Node], key: Any) -> Any:
    """按键查找，返回值；不存在返回 None。"""
    while root is not None:
        if key == root.key:
            return root.value
        root = root.left if key < root.key else root.right
    return None


def _cartesian_build(items: List[Tuple[Any, Any]]) -> Optional[_Node]:
    """按键有序的 ``(key, value)`` 列表线性构建一棵随机 Treap。

    随机赋优先级后用单调栈做笛卡尔树构树，O(n) 时间、O(n) 个全新
    节点（这些节点尚未发布，可以直接挂指针）。供大批删除后重建
    全局 point_id 索引使用。
    """
    if not items:
        return None
    stack: List[_Node] = []
    for key, value in items:
        node = _Node(key, value, _rng.getrandbits(64))
        last: Optional[_Node] = None
        while stack and stack[-1].priority < node.priority:
            last = stack.pop()
        node.left = last
        if stack:
            stack[-1].right = node
        stack.append(node)
    return stack[0]


def _bulk_erase(
    root: Optional[_Node], keys: List[Any], total_size: int
) -> Optional[_Node]:
    """持久化批量删键，自适应两条策略。

    * 少量删除：逐点 :func:`_erase`，约 O(k log m) 次路径复制，
      不触碰无关子树；
    * 大批删除：中序遍历整棵树跳过被删键，再用
      :func:`_cartesian_build` 线性重建，约 O(m) 次操作与
      O(m-k) 个新节点。

    ``total_size`` 是删前树的节点数（调用方已知，避免为估规模
    而遍历整棵树）。因此删零星点仍是对数级，删整棵子树时耗时
    与规模近线性。
    """
    if not keys or root is None:
        return root
    k = len(keys)
    depth = max(1, total_size.bit_length())
    erase_cost = 2 * k * depth          # 逐点路径复制的估计节点数
    rebuild_cost = total_size + max(0, total_size - k)  # 遍历 + 新节点
    if erase_cost <= rebuild_cost:
        new_root = root
        for key in keys:
            new_root, _ = _erase(new_root, key)
        return new_root

    deleted = set(keys)
    survivors: List[Tuple[Any, Any]] = []
    cur = root
    stack: List[_Node] = []
    while cur is not None or stack:
        while cur is not None:
            stack.append(cur)
            cur = cur.left
        cur = stack.pop()
        if cur.key not in deleted:
            survivors.append((cur.key, cur.value))
        cur = cur.right
    return _cartesian_build(survivors)


def _collect_inorder(root: Optional[_Node], out: List[Any]) -> None:
    if root is None:
        return
    _collect_inorder(root.left, out)
    out.append(root.value)
    _collect_inorder(root.right, out)


def _range_scan(root: Optional[_Node], start: int, end: int) -> List[Point]:
    """返回数据树中 ts ∈ [start, end) 的点，按 (ts, point_id) 升序。

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
        result.append(cur.value)
        nxt = cur.right
        while nxt is not None:
            stack.append(nxt)
            nxt = nxt.left
    return result


# ---------------------------------------------------------------------------
# 状态根 / 快照
#
# 索引任意时刻的完整状态就是 (series 树根, point_id 树根, 总点数)。
# 快照只保存这个三元组；所有树节点不可变，快照与工作区、快照与快照
# 之间靠结构共享天然隔离。
# ---------------------------------------------------------------------------

StateRoots = Tuple[Optional[_Node], Optional[_Node], int]


# ---------------------------------------------------------------------------
# 索引主体
# ---------------------------------------------------------------------------


class TimeSeriesIndex:
    """内存时序索引：持久化 Treap + 结构共享快照。"""

    FORMAT_NAME = "timeseries-index"
    SCHEMA_VERSION = 1

    def __init__(self) -> None:
        self._series_root: Optional[_Node] = None  # series -> (data_root, count)
        self._points_root: Optional[_Node] = None  # point_id -> Point
        self._total: int = 0
        self._snapshots: Dict[str, StateRoots] = {}

    # -- 内部写入原语 -----------------------------------------------------

    def _insert_point(self, p: Point) -> None:
        """把一个*已校验且确认不冲突*的点写入当前状态。"""
        entry = _find(self._series_root, p.series)
        data_root, count = entry if entry is not None else (None, 0)
        data_root = _upsert(
            data_root, (p.ts, p.point_id), p, _rng.getrandbits(64)
        )
        self._series_root = _upsert(
            self._series_root, p.series, (data_root, count + 1),
            _rng.getrandbits(64),
        )
        self._points_root = _upsert(
            self._points_root, p.point_id, p, _rng.getrandbits(64)
        )
        self._total += 1

    # -- 基础属性 ---------------------------------------------------------

    def __len__(self) -> int:
        return self._total

    @property
    def total_points(self) -> int:
        """当前总点数。"""
        return self._total

    # -- 写入 -------------------------------------------------------------

    def insert(self, point: Any) -> None:
        """插入一个点（:class:`Point` 或等价映射）。

        :raises DuplicatePointError: point_id 已存在。
        :raises InvalidPointError: 字段非法。
        """
        p = _coerce_point(point)
        if _find(self._points_root, p.point_id) is not None:
            raise DuplicatePointError(f"point_id 重复: {p.point_id}")
        self._insert_point(p)

    def insert_many(self, points: Any) -> None:
        """批量插入，**原子**：要么全部成功，要么索引保持调用前状态。

        先做完整校验（字段、批内 point_id 重复、与已有数据冲突），
        全部通过后才开始写入，因此校验阶段失败绝不会产生半插入状态；
        落盘阶段只操作已验证的数据，不会再失败。

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
            if _find(self._points_root, p.point_id) is not None:
                raise DuplicatePointError(f"point_id 已存在: {p.point_id}")
            seen.add(p.point_id)
            prepared.append(p)

        # 校验全部通过，以下写入不会再失败
        for p in prepared:
            self._insert_point(p)

    # -- 查询 -------------------------------------------------------------

    def get_point(self, point_id: str) -> Optional[Point]:
        """按 point_id 取点详情，不存在返回 ``None``。"""
        return _find(self._points_root, point_id)

    def list_series(self) -> List[str]:
        """返回所有 series 名，按字典序升序。"""
        names: List[str] = []
        cur = self._series_root
        stack: List[_Node] = []
        while cur is not None or stack:
            while cur is not None:
                stack.append(cur)
                cur = cur.left
            cur = stack.pop()
            names.append(cur.key)
            cur = cur.right
        return names

    def series_count(self, series: str) -> int:
        """返回某 series 的点数，不存在时为 0。"""
        entry = _find(self._series_root, series)
        return entry[1] if entry is not None else 0

    def range_query(self, series: str, start: int, end: int) -> List[Point]:
        """查询 ``[start, end)`` 内的点，按 ``(ts, point_id)`` 升序。

        :raises InvalidRangeError: start / end 不是整数或 start > end。
        """
        start = _validate_bound(start, "start")
        end = _validate_bound(end, "end")
        if start > end:
            raise InvalidRangeError(f"start({start}) 不能大于 end({end})")
        entry = _find(self._series_root, series)
        if entry is None:
            return []
        return _range_scan(entry[0], start, end)

    def range_delete(self, series: str, start: int, end: int) -> int:
        """删除 ``[start, end)`` 内的点，返回被删点数。

        series 不存在或区间为空时返回 0，不报错；``start > end``
        一律抛 :class:`InvalidRangeError`，**不会**删除任何数据。
        数据树通过两次 split + 一次 merge 完成切分，期望 O(log n + k)。

        :raises InvalidRangeError: start / end 不是整数或 start > end。
        """
        start = _validate_bound(start, "start")
        end = _validate_bound(end, "end")
        if start > end:
            raise InvalidRangeError(f"start({start}) 不能大于 end({end})")
        entry = _find(self._series_root, series)
        if entry is None:
            return 0
        data_root, count = entry

        left, rest = _split(data_root, (start, ""))
        middle, right = _split(rest, (end, ""))

        deleted: List[Point] = []
        _collect_inorder(middle, deleted)
        if not deleted:
            return 0  # 空区间：两个 split 的结果与原树等价，直接不写入

        new_data = _merge(left, right)
        if new_data is None:
            # 桶清空：从 series 表中移除该键
            self._series_root, _ = _erase(self._series_root, series)
        else:
            self._series_root = _upsert(
                self._series_root, series, (new_data, count - len(deleted)),
                _rng.getrandbits(64),
            )
        self._points_root = _bulk_erase(
            self._points_root,
            [p.point_id for p in deleted],
            self._total,
        )
        self._total -= len(deleted)
        return len(deleted)

    # -- 快照与回滚 -------------------------------------------------------
    #
    # 隔离规则（也见 README）：
    #   * 快照是不可变的状态根；任何修改只产生新节点，绝不改写旧节点；
    #   * rollback 仅仅切换当前根引用，不触碰任何快照；
    #   * 回滚之后相当于从历史点开出一条新分支，新插入/删除只在新分支
    #     上分配节点；其它快照（无论更早还是更晚）的根仍然指向它们
    #     自己的世界，再回滚过去状态精确无误，不会串入分支上的变更。
    # ---------------------------------------------------------------------

    def snapshot(self, name: str) -> str:
        """对当前状态打快照，名称必须是非空且未占用的字符串。

        操作本身是 O(1)：只保存三个根引用，实际数据靠持久化节点
        结构共享，不随总点数复制。
        """
        if not isinstance(name, str) or not name:
            raise SnapshotError("快照名称必须是非空字符串")
        if name in self._snapshots:
            raise SnapshotExistsError(f"快照已存在: {name}")
        self._snapshots[name] = (
            self._series_root,
            self._points_root,
            self._total,
        )
        return name

    def rollback(self, name: str) -> str:
        """回滚到指定快照（O(1)）。

        快照之后插入的点全部丢弃、删除的点全部恢复（交错删插同样
        精确恢复）；其它快照（更早或更晚的）都保持原样、仍可继续
        来回回滚。

        :raises SnapshotNotFoundError: 快照名称不存在。
        """
        roots = self._snapshots.get(name)
        if roots is None:
            raise SnapshotNotFoundError(f"快照不存在: {name}")
        self._series_root, self._points_root, self._total = roots
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
        series_points: Dict[str, int] = {}

        def walk(node: Optional[_Node]) -> None:
            if node is None:
                return
            walk(node.left)
            series_points[node.key] = node.value[1]
            walk(node.right)

        walk(self._series_root)
        return {
            "series_count": len(series_points),
            "total_points": self._total,
            "series_points": series_points,
            "snapshots": sorted(self._snapshots),
        }

    # -- 序列化 -----------------------------------------------------------

    def _state_to_series_map(
        self, series_root: Optional[_Node]
    ) -> Dict[str, List[Dict[str, Any]]]:
        result: Dict[str, List[Dict[str, Any]]] = {}
        cur = series_root
        stack: List[_Node] = []
        while cur is not None or stack:
            while cur is not None:
                stack.append(cur)
                cur = cur.left
            cur = stack.pop()
            data_root = cur.value[0]
            points: List[Point] = []
            _collect_inorder(data_root, points)
            result[cur.key] = [p.to_dict() for p in points]
            cur = cur.right
        return result

    def to_dict(self) -> Dict[str, Any]:
        """导出为可 JSON 序列化的完整结构（含全部快照）。"""
        snapshots = [
            {"name": name, "series": self._state_to_series_map(roots[0])}
            for name, roots in sorted(self._snapshots.items())
        ]
        return {
            "format": self.FORMAT_NAME,
            "schema_version": self.SCHEMA_VERSION,
            "series": self._state_to_series_map(self._series_root),
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

        校验顺序与内容：文件可读；JSON 可解析且不含 NaN/Infinity
        常量；顶层为对象且 ``format`` / ``schema_version`` / ``series``
        / ``snapshots`` 四个必填字段齐全（错误信息指出具体缺哪个）；
        schema_version 受支持；每个点字段合法（ts 整数、value 有限等）；
        point_id 在 live 内、每个快照内分别全局唯一；点的 series
        字段与其所在桶一致（即快照引用的 series 都存在）；快照名
        非空且不重复。任何失败抛带中文说明的 :class:`IndexFormatError`。
        """
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
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
        for key in ("format", "schema_version", "series", "snapshots"):
            if key not in data:
                raise IndexFormatError(f"缺少顶层字段: {key}")
        if data["format"] != cls.FORMAT_NAME:
            raise IndexFormatError(
                f"format 字段应为 {cls.FORMAT_NAME!r}，实际为 {data['format']!r}"
            )
        version = data["schema_version"]
        if not isinstance(version, int) or isinstance(version, bool):
            raise IndexFormatError(
                f"schema_version 必须是整数，实际为 {version!r}"
            )
        if version != cls.SCHEMA_VERSION:
            raise IndexFormatError(
                f"schema_version={version} 不受支持，"
                f"当前支持版本: {cls.SCHEMA_VERSION}"
            )

        live_by_series, _live_points, _ = _load_series_map(
            data["series"], "当前数据"
        )

        raw_snaps = data["snapshots"]
        if not isinstance(raw_snaps, list):
            raise IndexFormatError("snapshots 必须是数组")
        loaded_snapshots: List[Tuple[str, Dict[str, List[Point]]]] = []
        snapshot_names: set[str] = set()
        for i, raw in enumerate(raw_snaps):
            where = f"snapshots[{i}]"
            if not isinstance(raw, dict):
                raise IndexFormatError(f"{where} 必须是对象")
            if "name" not in raw or "series" not in raw:
                missing = [
                    k for k in ("name", "series") if k not in raw
                ]
                raise IndexFormatError(
                    f"{where} 缺少字段: {', '.join(missing)}"
                )
            name = raw["name"]
            if not isinstance(name, str) or not name:
                raise IndexFormatError(f"{where} 的 name 必须是非空字符串")
            if name in snapshot_names:
                raise IndexFormatError(f"快照名称重复: {name}")
            snapshot_names.add(name)
            by_series, _points, _counts = _load_series_map(raw["series"], where)
            loaded_snapshots.append((name, by_series))

        index = cls()
        # 文件已完成全量校验，live 与各快照都是相互独立的世界，
        # 直接按有序键线性构树（笛卡尔树），不走逐条插入的路径复制
        index._series_root, index._points_root, index._total = (
            _build_state_roots(live_by_series)
        )
        for name, by_series in loaded_snapshots:
            index._snapshots[name] = _build_state_roots(by_series)
        return index


def _build_state_roots(
    by_series: Dict[str, List[Point]]
) -> StateRoots:
    """把 ``{series: [Point, ...]}`` 线性构造成状态根（load 用）。

    每个桶内的点按 ``(ts, point_id)`` 排序后用笛卡尔建树 O(n) 构树，
    全局 point_id 索引同理；比逐条插入（每次 O(log n) 路径复制）快
    一个数量级以上。
    """
    series_entries: List[Tuple[str, Tuple[Any, int]]] = []
    point_items: List[Tuple[str, Point]] = []
    total = 0
    for series in sorted(by_series):
        ordered = sorted(by_series[series], key=lambda p: (p.ts, p.point_id))
        data_root = _cartesian_build(
            [((p.ts, p.point_id), p) for p in ordered]
        )
        count = len(ordered)
        series_entries.append((series, (data_root, count)))
        point_items.extend((p.point_id, p) for p in ordered)
        total += count
    point_items.sort(key=lambda item: item[0])
    series_root = _cartesian_build(series_entries)
    points_root = _cartesian_build(point_items)
    return series_root, points_root, total


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
