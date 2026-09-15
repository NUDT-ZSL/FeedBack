"""表格视窗内核。

设计要点
========

* **双 Treap 结构**：``_full_treap`` 保存全部行按当前排序规则形成的
  稳定全序；``_visible_treap`` 保存通过筛选的行。两棵树都以
  「排序键元组」为键，元组最后一个分量恒为行标识，因此键全局唯一，
  排序键相同时严格按行标识字典序打破平局（稳定排序）。
* **窗口移动零重排**：可见树始终是完整的筛选结果，窗口只是其上的
  排名区间 ``[start, start+size)``。移动/缩放窗口只做一次 O(log n +
  窗口行数) 的区间截取，不触碰任何行的顺序。
* **规则/数据增量更新**：增删行走 treap 单点插入/删除（O(log n)）；
  排序变更整体重建两棵树；筛选变更只重建可见树（全量树不变）。
  窗口内此前已可见的行来自同一棵中序树，相对顺序天然保持。
* **严格校验 + 原子失败**：所有会失败的操作先完成全部校验，再提交
  修改；失败时窗口与可见序列保持原样。
"""

from __future__ import annotations

import threading
from typing import Any, Optional

from .errors import (
    BatchValidationError,
    DuplicateRowError,
    KernelError,
    RuleError,
    UnknownRowError,
    ValidationError,
    WindowError,
)
from .schema import FieldSpec, Schema
from .treap import Treap

# ----------------------------------------------------------------------
# 排序键中的降序包装：反转比较方向，避免对字符串取负
# ----------------------------------------------------------------------


class _Rev:
    __slots__ = ("v",)

    def __init__(self, value: Any):
        self.v = value

    def __lt__(self, other: "_Rev") -> bool:
        # 降序：大值在前
        return self.v > other.v

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Rev) and self.v == other.v

    def __repr__(self) -> str:
        return f"_Rev({self.v!r})"


# ----------------------------------------------------------------------
# 规则描述
# ----------------------------------------------------------------------

OPERATORS = frozenset({
    "eq", "ne", "lt", "le", "gt", "ge",
    "in", "not_in", "contains",
})
_ORDERED_OPS = frozenset({"lt", "le", "gt", "ge"})
_STR_OPS = frozenset({"contains"})


class SortSpec:
    """单列排序规则：字段名 + 是否升序。"""

    __slots__ = ("field", "asc")

    def __init__(self, field: str, asc: bool = True):
        if not isinstance(field, str) or not field:
            raise RuleError("排序字段名必须是非空字符串")
        # 显式拒绝把 0/1 当布尔
        if not isinstance(asc, bool):
            raise RuleError(f"排序方向必须是布尔值，字段 {field!r} 得到 {asc!r}")
        self.field = field
        self.asc = asc

    def to_dict(self) -> dict[str, Any]:
        return {"field": self.field, "asc": self.asc}

    @classmethod
    def from_any(cls, obj: Any, index: int) -> "SortSpec":
        if isinstance(obj, SortSpec):
            return obj
        if isinstance(obj, dict):
            if "field" not in obj:
                raise ValidationError("排序规则缺少 'field'", index=index,
                                      path="field")
            if "asc" not in obj:
                raise ValidationError("排序规则缺少 'asc'", index=index,
                                      path="asc")
            try:
                return cls(obj["field"], obj["asc"])
            except RuleError as e:
                raise ValidationError(str(e), index=index) from e
        if isinstance(obj, (tuple, list)) and len(obj) == 2:
            try:
                return cls(obj[0], obj[1])
            except RuleError as e:
                raise ValidationError(str(e), index=index) from e
        raise ValidationError(
            "排序规则必须是 {'field':..., 'asc':...} 或 (field, asc)",
            index=index,
        )


class Filter:
    """单条筛选条件，字段名 + 操作符 + 比较值（多值操作为列表）。"""

    __slots__ = ("field", "op", "value")

    def __init__(self, field: str, op: str, value: Any):
        if not isinstance(field, str) or not field:
            raise RuleError("筛选字段名必须是非空字符串")
        if op not in OPERATORS:
            raise RuleError(
                f"不支持的操作符 {op!r}，可选: {', '.join(sorted(OPERATORS))}"
            )
        self.field = field
        self.op = op
        self.value = value

    def to_dict(self) -> dict[str, Any]:
        return {"field": self.field, "op": self.op, "value": self.value}

    @classmethod
    def from_any(cls, obj: Any, index: int) -> "Filter":
        if isinstance(obj, Filter):
            return obj
        if isinstance(obj, dict):
            for key in ("field", "op", "value"):
                if key not in obj:
                    raise ValidationError(f"筛选条件缺少 {key!r}",
                                          index=index, path=key)
            try:
                return cls(obj["field"], obj["op"], obj["value"])
            except RuleError as e:
                raise ValidationError(str(e), index=index) from e
        if isinstance(obj, (tuple, list)) and len(obj) == 3:
            try:
                return cls(obj[0], obj[1], obj[2])
            except RuleError as e:
                raise ValidationError(str(e), index=index) from e
        raise ValidationError(
            "筛选条件必须是 {'field':..., 'op':..., 'value':...} "
            "或 (field, op, value)",
            index=index,
        )


# ----------------------------------------------------------------------
# 行
# ----------------------------------------------------------------------


class Row:
    __slots__ = ("id", "values", "sort_key", "visible")

    def __init__(self, row_id: str, values: dict[str, Any]):
        self.id = row_id
        self.values = values
        self.sort_key: tuple[Any, ...] = ()
        self.visible = True


# ----------------------------------------------------------------------
# 内核
# ----------------------------------------------------------------------


class TableKernel:
    """表格视窗内核。

    Parameters
    ----------
    schema:
        字段模式，:class:`~table_kernel.schema.Schema` 或字段名到类型的
        映射，例如 ``{"age": "int", "name": "str"}``。
    rows:
        初始行，每项形如 ``{"id": "r1", "fields": {"age": 10, ...}}``。
    sort:
        排序规则列表，越靠前优先级越高；空列表表示仅按行标识排序。
    filters:
        筛选条件列表，条件之间为逻辑与；空列表表示全部可见。
    window_size:
        给定则在构造成功后把窗口初始化为
        ``[0, min(window_size, 可见行数))``；不给定则窗口未设置，
        需先调用 :meth:`set_window`。
    seed:
        Treap 随机优先级种子，传入固定值可让重建结果完全确定。
    """

    def __init__(
        self,
        schema: Schema | dict[str, str],
        rows: Optional[list[dict[str, Any]]] = None,
        sort: Optional[list[Any]] = None,
        filters: Optional[list[Any]] = None,
        *,
        window_size: Optional[int] = None,
        seed: int = 0,
    ):
        if not isinstance(schema, Schema):
            schema = Schema(schema)
        self.schema = schema
        self._seed = seed

        # 规则：先解析成对象（内部不合法会在此失败），稍后再绑定 schema
        sort_objs = [SortSpec.from_any(s, i)
                     for i, s in enumerate(sort or [])]
        filter_objs = [Filter.from_any(f, i)
                       for i, f in enumerate(filters or [])]

        # 行存储：标识 -> Row
        self.rows: dict[str, Row] = {}

        # 解析并校验全部初始行（整批原子）
        parsed = self._validate_rows(rows or [])
        for row_id, values in parsed:
            if row_id in self.rows:  # _validate_rows 已保证批内不重复
                raise DuplicateRowError(row_id)
            self.rows[row_id] = Row(row_id, values)

        # 规则绑定 schema（字段存在性、值类型在此校验）
        self._sort_specs: list[SortSpec] = []
        self._filters: list[Filter] = []
        self._bind_rules(sort_objs, filter_objs)

        # 窗口状态：(start, size) 或 None
        self._window: Optional[tuple[int, int]] = None
        # 当前窗口对应的可见行标识序列（缓存的物化结果）
        self._visible_view: list[str] = []

        # 增量统计
        self._stats = {
            "full_rebuilds": 0,        # 全量排序树（重）建次数
            "visible_rebuilds": 0,     # 可见树（重）建次数
            "rows_inserted": 0,        # add_rows 累计插入行数
            "rows_removed": 0,         # remove_rows 累计删除行数
            "window_moves": 0,         # 窗口平移成功次数
            "window_resizes": 0,       # 窗口改尺寸成功次数
            "window_refreshes": 0,     # 窗口序列物化刷新次数
            "window_clamps": 0,        # 数据/筛选变化后窗口自动收窄次数
        }
        self._lock = threading.RLock()

        # 初次构建
        self._build_trees()
        if window_size is not None:
            if isinstance(window_size, bool) or not isinstance(window_size, int):
                raise WindowError(
                    "window_size 必须是正整数，实际为 "
                    f"{type(window_size).__name__}")
            if window_size <= 0:
                raise WindowError(
                    f"window_size 必须为正整数，得到 {window_size}")
            count = len(self._visible_treap)
            size = min(window_size, count) if count > 0 else window_size
            # 可见行为 0 时窗口挂起（(0, size) 保留），数据到达后由
            # _reconcile_window 自动挂接
            self._window = (0, size)
            if count > 0:
                self._materialize()

    # ------------------------------------------------------------------
    # 校验
    # ------------------------------------------------------------------

    def _validate_rows(self, rows: list[dict[str, Any]]
                       ) -> list[tuple[str, dict[str, Any]]]:
        """整批校验行输入，收集全部错误后一次性抛出（原子拒绝）。"""
        if not isinstance(rows, list):
            raise ValidationError(
                f"行集合必须是列表，实际为 {type(rows).__name__}"
            )
        errors: list[ValidationError] = []
        parsed: list[tuple[str, dict[str, Any]]] = []
        seen: set[str] = set()
        for i, item in enumerate(rows):
            if not isinstance(item, dict):
                errors.append(ValidationError(
                    "行必须是 {'id':..., 'fields':...} 形式的映射", index=i))
                parsed.append(("", {}))
                continue
            if "id" not in item:
                errors.append(ValidationError("缺少行标识 'id'", index=i,
                                              path="id"))
                row_id = ""
            else:
                row_id = item["id"]
                if not isinstance(row_id, str) or not row_id:
                    errors.append(ValidationError(
                        "行标识必须是非空字符串", index=i, path="id"))
                    row_id = str(row_id) if row_id is not None else ""
            if "fields" not in item:
                errors.append(ValidationError("缺少行数据 'fields'", index=i,
                                              path="fields"))
                fields: dict[str, Any] = {}
            elif not isinstance(item["fields"], dict):
                errors.append(ValidationError(
                    f"'fields' 必须是映射，实际为 "
                    f"{type(item['fields']).__name__}",
                    index=i, path="fields"))
                fields = {}
            else:
                fields = item["fields"]
                try:
                    self.schema.validate_row(fields, index=i)
                except ValidationError as e:
                    errors.append(e)
            if row_id:
                if row_id in seen:
                    errors.append(ValidationError(
                        f"批内行标识重复: {row_id!r}", index=i, path="id"))
                elif row_id in self.rows:
                    errors.append(ValidationError(
                        f"行标识与已有行重复: {row_id!r}", index=i,
                        path="id"))
                seen.add(row_id)
            parsed.append((row_id, fields))
        if errors:
            raise BatchValidationError("行数据校验失败，整批拒绝", errors)
        return parsed

    def _bind_rules(self, sort_objs: list[SortSpec],
                    filter_objs: list[Filter]) -> None:
        """把规则绑定到当前 schema，全部合法后才整体生效。"""
        sort_fields: set[str] = set()
        bound_sort: list[SortSpec] = []
        for i, spec in enumerate(sort_objs):
            if not self.schema.has(spec.field):
                raise ValidationError(
                    f"排序字段不存在: {spec.field!r}", index=i, path="field")
            if spec.field in sort_fields:
                raise ValidationError(
                    f"排序字段重复: {spec.field!r}", index=i, path="field")
            sort_fields.add(spec.field)
            bound_sort.append(spec)

        bound_filters: list[Filter] = []
        for i, f in enumerate(filter_objs):
            fspec = self.schema.field(f.field)  # 不存在会抛 ValidationError
            self._validate_filter_value(fspec, f, i)
            bound_filters.append(f)
        self._sort_specs = bound_sort
        self._filters = bound_filters

    def _validate_filter_value(self, fspec: FieldSpec, f: Filter,
                               index: int) -> None:
        t = fspec.type
        if f.op in _ORDERED_OPS and t == "bool":
            raise ValidationError(
                f"布尔字段 {fspec.name!r} 不支持次序操作 {f.op!r}，"
                "只支持 eq/ne/in/not_in",
                index=index, path="op")
        if f.op == "contains" and t != "str":
            raise ValidationError(
                f"'contains' 只能用于字符串字段，{fspec.name!r} 是 {t}",
                index=index, path="op")
        if f.op in ("in", "not_in"):
            if not isinstance(f.value, list):
                raise ValidationError(
                    f"{f.op!r} 的值必须是列表", index=index, path="value")
            for j, v in enumerate(f.value):
                self._check_scalar_type(fspec, v, index,
                                        f"value[{j}]")
        else:
            self._check_scalar_type(fspec, f.value, index, "value")

    @staticmethod
    def _check_scalar_type(fspec: FieldSpec, value: Any, index: int,
                           path: str) -> None:
        t = fspec.type
        ok = False
        if t == "int":
            ok = isinstance(value, int) and not isinstance(value, bool)
        elif t == "float":
            # 比较值允许写整数字面量
            ok = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif t == "str":
            ok = isinstance(value, str)
        elif t == "bool":
            ok = isinstance(value, bool)
        if not ok:
            raise ValidationError(
                f"字段 {fspec.name!r} 的比较值需要 {t} 类型，实际得到 "
                f"{type(value).__name__}（值: {value!r}）",
                index=index, path=path)

    # ------------------------------------------------------------------
    # 排序键与筛选求值
    # ------------------------------------------------------------------

    def _make_sort_key(self, values: dict[str, Any],
                       row_id: str) -> tuple[Any, ...]:
        parts: list[Any] = []
        for spec in self._sort_specs:
            v = values[spec.field]
            parts.append(v if spec.asc else _Rev(v))
        # 末位恒定为行标识：平局按字典序，且保证键全局唯一
        parts.append(row_id)
        return tuple(parts)

    def _eval_filter(self, f: Filter, values: dict[str, Any]) -> bool:
        v = values[f.field]
        op = f.op
        target = f.value
        if op == "eq":
            return v == target
        if op == "ne":
            return v != target
        if op == "lt":
            return v < target
        if op == "le":
            return v <= target
        if op == "gt":
            return v > target
        if op == "ge":
            return v >= target
        if op == "in":
            return v in target
        if op == "not_in":
            return v not in target
        if op == "contains":
            return target in v
        raise RuleError(f"内部错误：未实现的操作符 {op!r}")

    def _row_passes(self, values: dict[str, Any]) -> bool:
        for f in self._filters:
            if not self._eval_filter(f, values):
                return False
        return True

    # ------------------------------------------------------------------
    # 树构建（规则变更时）
    # ------------------------------------------------------------------

    def _new_treap(self) -> Treap:
        return Treap(lambda a, b: a < b, seed=self._seed)

    def _build_trees(self) -> None:
        """按当前规则全量构建两棵树（仅构造与排序变更时调用）。"""
        for row in self.rows.values():
            row.sort_key = self._make_sort_key(row.values, row.id)
            row.visible = self._row_passes(row.values)

        full_pairs: list[tuple[tuple, Row]] = [
            (row.sort_key, row) for row in self.rows.values()
        ]
        full_pairs.sort(key=lambda p: p[0])
        self._full_treap = self._new_treap()
        self._full_treap.build_sorted(full_pairs)
        self._stats["full_rebuilds"] += 1

        visible_pairs = [p for p in full_pairs if p[1].visible]
        self._visible_treap = self._new_treap()
        self._visible_treap.build_sorted(visible_pairs)
        self._stats["visible_rebuilds"] += 1

        self._reconcile_window()

    def _rebuild_visible_tree(self) -> None:
        """筛选变化后重建可见树；全量树与排序键保持不变。"""
        pairs: list[tuple[tuple, Row]] = []
        for payload in self._full_treap.iter_payloads():
            row: Row = payload
            vis = self._row_passes(row.values)
            row.visible = vis
            if vis:
                pairs.append((row.sort_key, row))
        self._visible_treap = self._new_treap()
        self._visible_treap.build_sorted(pairs)
        self._stats["visible_rebuilds"] += 1
        self._reconcile_window()

    # ------------------------------------------------------------------
    # 窗口
    # ------------------------------------------------------------------

    def _validate_window(self, start: int, size: int,
                         count: int) -> None:
        if isinstance(start, bool) or not isinstance(start, int):
            raise WindowError(
                f"窗口起点必须是整数，实际为 {type(start).__name__}")
        if isinstance(size, bool) or not isinstance(size, int):
            raise WindowError(
                f"窗口尺寸必须是整数，实际为 {type(size).__name__}")
        if size <= 0:
            raise WindowError(f"窗口尺寸必须为正整数，得到 {size}")
        if start < 0:
            raise WindowError(f"窗口起点不能为负，得到 {start}")
        if start + size > count:
            raise WindowError(
                f"窗口越界：区间 [{start}, {start + size}) 超出可见行数 "
                f"{count}")

    def _reconcile_window(self) -> None:
        """数据/规则变化后把窗口收回合法范围；合法窗口绝不跳起点。

        可见行临时为 0 时不销毁窗口，而是保留为「挂起窗口」、可见序列
        置空；待数据/筛选恢复后自动重新挂接，避免窗口状态非预期丢失。
        """
        if self._window is None:
            self._visible_view = []
            return
        start, size = self._window
        count = len(self._visible_treap)
        if count == 0:
            self._visible_view = []
            self._stats["window_clamps"] += 1
            return
        new_start, new_size = start, size
        if start + size > count:
            if size >= count:
                # 数据/筛选结果整体比窗口还小：起点归 0，尺寸收到 count
                new_start, new_size = 0, count
            else:
                # 仅尾部越界：尺寸不变，整体回退贴住右边界
                new_start = count - size
            self._stats["window_clamps"] += 1
        self._window = (new_start, new_size)
        self._materialize()

    def _materialize(self) -> None:
        """从可见树截取当前窗口，唯一会改写可见序列的地方。"""
        if self._window is None:
            self._visible_view = []
            return
        start, size = self._window
        rows = self._visible_treap.slice_payloads(start, start + size)
        self._visible_view = [r.id for r in rows]
        self._stats["window_refreshes"] += 1

    def set_window(self, start: int, size: int) -> list[str]:
        """显式设置窗口区间 ``[start, start+size)``。

        非法（越界、尺寸非正）时抛 :class:`WindowError`，当前窗口与
        可见序列保持不变。成功后返回新的可见行标识列表。
        """
        with self._lock:
            count = len(self._visible_treap)
            self._validate_window(start, size, count)
            old = self._window
            self._window = (start, size)
            if old is not None and old[1] != size:
                self._stats["window_resizes"] += 1
            if old is not None and old[0] != start:
                self._stats["window_moves"] += 1
            if old is None:
                # 首次设置窗口同时计一次移动与一次刷新
                self._stats["window_moves"] += 1
            self._materialize()
            return list(self._visible_view)

    def move_to(self, start: int) -> list[str]:
        """保持尺寸平移窗口起点；窗口尚未设置时拒绝。"""
        with self._lock:
            if self._window is None:
                raise WindowError("窗口尚未设置，请先调用 set_window")
            _, size = self._window
            count = len(self._visible_treap)
            self._validate_window(start, size, count)
            if start != self._window[0]:
                self._stats["window_moves"] += 1
            self._window = (start, size)
            self._materialize()
            return list(self._visible_view)

    def scroll(self, delta: int) -> list[str]:
        """相对平移 ``delta`` 行（可为负）；越界则拒绝且状态不变。"""
        with self._lock:
            if isinstance(delta, bool) or not isinstance(delta, int):
                raise WindowError(
                    f"滚动量必须是整数，实际为 {type(delta).__name__}")
            if self._window is None:
                raise WindowError("窗口尚未设置，请先调用 set_window")
            start, size = self._window
            return self.move_to(start + delta)

    def resize(self, size: int) -> list[str]:
        """保持起点改变窗口尺寸（向右扩张/收缩）；非法则状态不变。"""
        with self._lock:
            if isinstance(size, bool) or not isinstance(size, int):
                raise WindowError(
                    f"窗口尺寸必须是整数，实际为 {type(size).__name__}")
            if self._window is None:
                raise WindowError("窗口尚未设置，请先调用 set_window")
            start, _ = self._window
            count = len(self._visible_treap)
            self._validate_window(start, size, count)
            if size != self._window[1]:
                self._stats["window_resizes"] += 1
            self._window = (start, size)
            self._materialize()
            return list(self._visible_view)

    # ------------------------------------------------------------------
    # 数据增删（增量）
    # ------------------------------------------------------------------

    def add_rows(self, rows: list[dict[str, Any]]) -> None:
        """增量插入一批行。

        整批严格原子：先收集全部行的校验错误一次性抛出（任何一行
        非法或标识重复都整批拒绝）；即使在校验通过后的提交阶段发生
        意外，也会回滚已写入的行、统计与窗口，使内核回到导入前。
        """
        with self._lock:
            parsed = self._validate_rows(rows)
            new_rows: list[Row] = []
            for row_id, values in parsed:
                row = Row(row_id, values)
                row.sort_key = self._make_sort_key(values, row_id)
                row.visible = self._row_passes(values)
                new_rows.append(row)
            if not new_rows:
                # 空批次是完全 no-op：不动物化计数与窗口
                return

            saved_window = self._window
            saved_stats = dict(self._stats)
            committed: list[Row] = []
            failed: Row | None = None
            try:
                for row in new_rows:
                    failed = row
                    self._full_treap.insert(row.sort_key, row)
                    if row.visible:
                        self._visible_treap.insert(row.sort_key, row)
                    self.rows[row.id] = row
                    self._stats["rows_inserted"] += 1
                    committed.append(row)
                    failed = None
                self._reconcile_window()
            except BaseException:
                # 先撤销失败行可能已部分写入的树节点（按 contains 幂等，
                # 处理插入内部异常时节点半入树的情况；映射尚未登记）
                if failed is not None:
                    if self._visible_treap.contains(failed.sort_key):
                        self._visible_treap.remove(failed.sort_key)
                    if self._full_treap.contains(failed.sort_key):
                        self._full_treap.remove(failed.sort_key)
                    self.rows.pop(failed.id, None)
                # 再逆序回滚已完整提交的行
                for row in reversed(committed):
                    if row.visible:
                        self._visible_treap.remove(row.sort_key)
                    self._full_treap.remove(row.sort_key)
                    self.rows.pop(row.id, None)
                # 先按原窗口重新物化，再把统计整体还原（含撤销物化计数）
                self._window = saved_window
                self._materialize()
                self._stats.clear()
                self._stats.update(saved_stats)
                raise

    def remove_rows(self, ids: "list[str] | tuple[str, ...]") -> None:
        """增量删除一批行；存在未知标识时整批拒绝，状态不变。

        接受列表或元组；字符串等非序列、非字符串标识、批内重复、
        未知标识都会被整批拒绝。
        """
        with self._lock:
            if not isinstance(ids, (list, tuple)):
                raise ValidationError(
                    "标识集合必须是列表或元组，实际为 "
                    f"{type(ids).__name__}")
            errors: list[ValidationError] = []
            seen: set[str] = set()
            for i, row_id in enumerate(ids):
                if not isinstance(row_id, str):
                    errors.append(ValidationError(
                        "行标识必须是字符串", index=i, path="id"))
                    continue
                if row_id in seen:
                    errors.append(ValidationError(
                        f"删除列表内标识重复: {row_id!r}", index=i,
                        path="id"))
                elif row_id not in self.rows:
                    errors.append(ValidationError(
                        f"行标识不存在: {row_id!r}", index=i, path="id"))
                seen.add(row_id)
            if errors:
                raise BatchValidationError("删除操作校验失败，整批拒绝",
                                           errors)
            if not ids:
                # 空批次是完全 no-op
                return
            saved_window = self._window
            saved_stats = dict(self._stats)
            deleted: list[Row] = []
            failed: Row | None = None
            try:
                for row_id in ids:
                    failed = self.rows.pop(row_id)
                    self._full_treap.remove(failed.sort_key)
                    if failed.visible:
                        self._visible_treap.remove(failed.sort_key)
                    self._stats["rows_removed"] += 1
                    deleted.append(failed)
                    failed = None
                self._reconcile_window()
            except BaseException:
                # 先恢复失败行：树在异常时可能已部分改动，按 contains
                # 幂等补回，避免重复插入或遗漏
                if failed is not None:
                    if not self._full_treap.contains(failed.sort_key):
                        self._full_treap.insert(failed.sort_key, failed)
                    if failed.visible and not self._visible_treap.contains(
                            failed.sort_key):
                        self._visible_treap.insert(
                            failed.sort_key, failed)
                    self.rows[failed.id] = failed
                # 再按相反顺序恢复已完整删除的行
                for row in reversed(deleted):
                    self._full_treap.insert(row.sort_key, row)
                    if row.visible:
                        self._visible_treap.insert(row.sort_key, row)
                    self.rows[row.id] = row
                # 先按原窗口重新物化，再整体还原统计
                self._window = saved_window
                self._materialize()
                self._stats.clear()
                self._stats.update(saved_stats)
                raise

    # ------------------------------------------------------------------
    # 规则变更（增量的特例：整体重排/重筛，窗口与已可见行不乱序）
    # ------------------------------------------------------------------

    def set_sort(self, sort: list[Any]) -> None:
        """更换排序规则。

        规则非法时状态不变。排序变更会全量重排，但窗口起点/尺寸保持
        不变，窗口内行按新全序从可见树截取——与「全量排序筛选后取同
        一区间」逐行一致。
        """
        with self._lock:
            objs = [SortSpec.from_any(s, i) for i, s in enumerate(sort)]
            # _bind_rules 先在临时结构上校验，全部合法才提交规则状态
            self._bind_rules(objs, self._filters)
            self._build_trees()

    def set_filters(self, filters: list[Any]) -> None:
        """更换筛选条件（条件间为逻辑与）；非法时状态不变。"""
        with self._lock:
            objs = [Filter.from_any(f, i) for i, f in enumerate(filters)]
            self._bind_rules(self._sort_specs, objs)
            self._rebuild_visible_tree()

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def _require_row(self, row_id: str) -> Row:
        if not isinstance(row_id, str):
            raise ValidationError("行标识必须是字符串")
        row = self.rows.get(row_id)
        if row is None:
            raise UnknownRowError(row_id)
        return row

    def visible_ids(self) -> list[str]:
        """当前窗口内的可见行标识（稳定顺序），窗口未设置时抛 WindowError。"""
        with self._lock:
            if self._window is None:
                raise WindowError("窗口尚未设置，请先调用 set_window")
            return list(self._visible_view)

    def window_at(self, start: int, size: int) -> list[str]:
        """查询任意窗口 ``[start, start+size)`` 的可见行而不改变当前状态。

        越界或尺寸非正时抛 :class:`WindowError`。
        """
        with self._lock:
            count = len(self._visible_treap)
            self._validate_window(start, size, count)
            return [r.id for r in
                    self._visible_treap.slice_payloads(start, start + size)]

    def visible_rows(self) -> list[dict[str, Any]]:
        """当前窗口内可见行的快照（id + fields），按稳定顺序。"""
        with self._lock:
            if self._window is None:
                raise WindowError("窗口尚未设置，请先调用 set_window")
            return [self._snapshot(self.rows[rid]) for rid in self._visible_view]

    def position_of(self, row_id: str) -> int:
        """行在当前排序+筛选下的 0 基可见位置。

        行被筛选掉时抛 :class:`RowFilteredError`；标识不存在时抛
        :class:`UnknownRowError`。
        """
        with self._lock:
            row = self._require_row(row_id)
            if not row.visible:
                raise RowFilteredError(row_id)
            return self._visible_treap.rank_of(row.sort_key)

    def full_position_of(self, row_id: str) -> int:
        """行在当前排序规则下、忽略筛选时的 0 基位置。"""
        with self._lock:
            row = self._require_row(row_id)
            return self._full_treap.rank_of(row.sort_key)

    def is_visible(self, row_id: str) -> bool:
        """该行是否通过当前筛选。"""
        with self._lock:
            return self._require_row(row_id).visible

    def in_window(self, row_id: str) -> bool:
        """该行是否落在当前窗口内；被筛选掉或窗口未设置返回 False。"""
        with self._lock:
            row = self._require_row(row_id)
            if self._window is None or not row.visible:
                return False
            pos = self._visible_treap.rank_of(row.sort_key)
            start, size = self._window
            return start <= pos < start + size

    def get_row(self, row_id: str) -> dict[str, Any]:
        """取单行快照。"""
        with self._lock:
            return self._snapshot(self._require_row(row_id))

    @staticmethod
    def _snapshot(row: Row) -> dict[str, Any]:
        return {"id": row.id, "fields": dict(row.values)}

    # ------------------------------------------------------------------
    # 状态与统计
    # ------------------------------------------------------------------

    @property
    def window(self) -> Optional[tuple[int, int]]:
        return self._window

    @property
    def row_count(self) -> int:
        return len(self.rows)

    @property
    def visible_count(self) -> int:
        return len(self._visible_treap)

    @property
    def sort_specs(self) -> list[SortSpec]:
        return list(self._sort_specs)

    @property
    def filters(self) -> list[Filter]:
        return list(self._filters)

    def stats(self) -> dict[str, int]:
        """返回增量统计（计数）的副本。"""
        with self._lock:
            return dict(self._stats)

    # 仅供 serde 重建时恢复计数
    def _restore_stats(self, stats: dict[str, int]) -> None:
        for key, value in stats.items():
            if key in self._stats and isinstance(value, int) \
                    and not isinstance(value, bool):
                self._stats[key] = value

    # 仅供 serde 重建时恢复窗口（允许挂起窗口：可见行为 0 时保留）
    def _restore_window(self, start: int, size: int) -> None:
        self._window = (start, size)
        self._reconcile_window()

    # ------------------------------------------------------------------
    # 验收辅助：全量参考结果
    # ------------------------------------------------------------------

    def reference_visible(self, start: int, size: int) -> list[str]:
        """用最朴素的全量排序+筛选计算区间结果，供测试逐行比对。"""
        rows = list(self.rows.values())
        rows.sort(key=lambda r: r.sort_key)
        ids = [r.id for r in rows if r.visible]
        return ids[start:start + size]


class RowFilteredError(KernelError):
    """查询的行存在但被当前筛选条件过滤。"""

    def __init__(self, row_id: str):
        self.row_id = row_id
        super().__init__(
            f"行 {row_id!r} 存在但未通过当前筛选，没有可见位置")
