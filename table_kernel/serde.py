"""快照导出 / 载入。

快照为纯 JSON 文档（只用标准库 ``json``），包含行集合、模式、排序
筛选规则、窗口状态与增量统计。载入策略是**先全量校验、再整体构造**：
所有错误先收集齐全，任意一处不合法都抛 :class:`SerializationError`，
调用方原有的内核状态一字不改。

快照格式（version 1）::

    {
      "version": 1,
      "schema": [{"name": "age", "type": "int"}, ...],
      "rows": [{"id": "r1", "fields": {"age": 1, ...}}, ...],
      "sort": [{"field": "age", "asc": false}, ...],
      "filters": [{"field": "age", "op": "ge", "value": 2}, ...],
        # filters.value 支持标量或列表；
      "window": {"start": 0, "size": 10} | null,
      "stats": {"full_rebuilds": 3, ...},
      "seed": 0
    }
"""

from __future__ import annotations

import json
import math
from typing import Any, TYPE_CHECKING

from .errors import (
    BatchValidationError,
    SerializationError,
    ValidationError,
)
from .kernel import TableKernel
from .schema import FieldSpec, Schema

if TYPE_CHECKING:
    from pathlib import Path

SNAPSHOT_VERSION = 1
KNOWN_STATS = (
    "full_rebuilds", "visible_rebuilds", "rows_inserted", "rows_removed",
    "window_moves", "window_resizes", "window_refreshes", "window_clamps",
)


# ----------------------------------------------------------------------
# 导出
# ----------------------------------------------------------------------

def export_snapshot(kernel: TableKernel) -> dict[str, Any]:
    """导出为可 JSON 序列化的纯数据快照。"""
    rows = [
        {"id": rid, "fields": dict(kernel.rows[rid].values)}
        for rid in sorted(kernel.rows)
    ]
    return {
        "version": SNAPSHOT_VERSION,
        "schema": [{"name": f.name, "type": f.type}
                   for f in kernel.schema.fields],
        "rows": rows,
        "sort": [s.to_dict() for s in kernel.sort_specs],
        "filters": [f.to_dict() for f in kernel.filters],
        "window": ({"start": kernel.window[0], "size": kernel.window[1]}
                   if kernel.window is not None else None),
        "stats": kernel.stats(),
        "seed": kernel._seed,
    }


def save_snapshot(kernel: TableKernel, path: "str | Path") -> None:
    """导出快照并原子写入文件（先写临时文件再替换）。"""
    snap = export_snapshot(kernel)
    path = str(path)
    tmp = f"{path}.tmp"
    text = json.dumps(snap, ensure_ascii=False, indent=2)
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    import os
    os.replace(tmp, path)


# ----------------------------------------------------------------------
# 载入
# ----------------------------------------------------------------------

def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def load_snapshot(data: Any) -> TableKernel:
    """从快照数据（dict 或 JSON 字符串）载入内核。

    任何字段缺失、类型错误、标识重复、规则非法、窗口越界都会抛
    :class:`SerializationError`；该函数只构造并返回新内核，不会修改
    调用方的既有对象，因此失败对既有状态零影响。
    """
    # ---- 0. 顶层结构 ----
    if isinstance(data, (str, bytes, bytearray)):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as e:
            raise SerializationError(
                f"快照载入失败，状态未改变：快照不是合法 JSON: "
                f"第 {e.lineno} 行第 {e.colno} 列: {e.msg}") from e
    if not isinstance(data, dict):
        raise SerializationError("快照载入失败，状态未改变：顶层必须是 JSON 对象")

    errors: list[str] = []

    def fail(msg: str, path: str | None = None) -> None:
        where = f"（位置 {path}）" if path else ""
        errors.append(f"{msg}{where}")

    missing = [k for k in ("version", "schema", "rows", "sort",
                           "filters", "window") if k not in data]
    if missing:
        raise SerializationError(
            "快照载入失败，状态未改变：缺少必需字段: "
            + ", ".join(repr(m) for m in missing))

    version = data["version"]
    if not _is_int(version) or version != SNAPSHOT_VERSION:
        fail(f"不支持的快照版本 {version!r}，当前支持 {SNAPSHOT_VERSION}",
             "version")

    # ---- 1. schema ----
    schema = _parse_schema(data["schema"], fail)

    # ---- 2. rows ----
    rows, ids = _parse_rows(data["rows"], schema, fail)

    # ---- 3. sort / filters ----
    sort_dicts = _parse_sort(data["sort"], fail)
    filter_dicts = _parse_filters(data["filters"], fail)

    # ---- 4. window ----
    window = _parse_window(data["window"], fail)

    # ---- 5. stats / seed ----
    stats = _parse_stats(data.get("stats", {}), fail)
    seed = _parse_seed(data.get("seed", 0), fail)

    if errors:
        raise SerializationError(
            f"快照载入失败，共 {len(errors)} 处错误，状态未改变: "
            + " | ".join(errors))

    # 结构层面全部合法；构造内核做语义校验（类型、重复、规则绑定、
    # 排序键自洽），这些校验抛 BatchValidationError/ValidationError。
    assert sort_dicts is not None and filter_dicts is not None
    try:
        kernel = TableKernel(
            schema, rows,
            sort=sort_dicts,
            filters=filter_dicts,
            seed=seed,
        )
    except (BatchValidationError, ValidationError) as e:
        # 理论上前面已覆盖大部分，这里兜底保证错误信息清晰
        raise SerializationError(f"快照载入失败，状态未改变: {e}") from e

    # 窗口合法性必须与载入后的可见行数核对（越界/零尺寸）。允许「挂起
    # 窗口」：窗口不超过声明尺寸上限、但当前暂时没有可见行时保留窗口，
    # 数据恢复后自动挂接。
    if window is not None:
        start, size = window
        count = kernel.visible_count
        if count > 0 and start + size > count:
            raise SerializationError(
                f"快照载入失败，窗口越界：[{start}, {start + size}) "
                f"超出可见行数 {count}，状态未改变")
        # count == 0 时恢复为挂起窗口，数据到达后自动挂接
        kernel._restore_window(start, size)

    if stats:
        kernel._restore_stats(stats)
    return kernel


def load_snapshot_file(path: "str | Path") -> TableKernel:
    """从文件读取并载入快照；读取/解析失败不影响任何已有内核。"""
    try:
        with open(str(path), "r", encoding="utf-8") as fh:
            text = fh.read()
    except OSError as e:
        raise SerializationError(f"无法读取快照文件 {path!r}: {e}") from e
    return load_snapshot(text)


# ----------------------------------------------------------------------
# 各部分解析（只做结构/类型检查，错误全部收集进 errors）
# ----------------------------------------------------------------------

def _as_list(v: Any, name: str, fail) -> list | None:
    if v is None:
        fail(f"{name!r} 不能为 null", name)
        return None
    if not isinstance(v, list):
        fail(f"{name!r} 必须是数组", name)
        return None
    return v


def _parse_sort(v: Any, fail) -> list[dict] | None:
    if not isinstance(v, list):
        fail("'sort' 必须是数组", "sort")
        return None
    out: list[dict] = []
    for i, item in enumerate(v):
        p = f"sort[{i}]"
        if not isinstance(item, dict):
            fail("排序规则必须是对象", p)
            continue
        if "field" not in item or "asc" not in item:
            fail("排序规则缺少 'field' 或 'asc'", p)
            continue
        field, asc = item["field"], item["asc"]
        if not isinstance(field, str) or not field:
            fail("排序字段必须是非空字符串", f"{p}.field")
        if not isinstance(asc, bool):
            fail("asc 必须是布尔值", f"{p}.asc")
        out.append({"field": field, "asc": asc})
    return out


def _parse_filters(v: Any, fail) -> list[dict] | None:
    from .kernel import OPERATORS
    if not isinstance(v, list):
        fail("'filters' 必须是数组", "filters")
        return None
    out: list[dict] = []
    for i, item in enumerate(v):
        p = f"filters[{i}]"
        if not isinstance(item, dict):
            fail("筛选条件必须是对象", p)
            continue
        if not all(k in item for k in ("field", "op", "value")):
            fail("筛选条件缺少 'field'、'op' 或 'value'", p)
            continue
        field, op, value = item["field"], item["op"], item["value"]
        if not isinstance(field, str) or not field:
            fail("筛选字段必须是非空字符串", f"{p}.field")
        if not isinstance(op, str) or op not in OPERATORS:
            fail(f"操作符非法: {op!r}", f"{p}.op")
        # value 类型与字段的匹配在 kernel 构造时统一校验，这里只检查
        # 多值操作是否给了数组
        if op in ("in", "not_in") and not isinstance(value, list):
            fail(f"{op!r} 的值必须是数组", f"{p}.value")
        out.append({"field": field, "op": op, "value": value})
    return out


def _parse_schema(v: Any, fail) -> Schema | None:
    if not isinstance(v, list) or not v:
        fail("schema 必须是非空数组", "schema")
        return None
    specs: list[FieldSpec] = []
    names: set[str] = set()
    for i, item in enumerate(v):
        p = f"schema[{i}]"
        if not isinstance(item, dict):
            fail("字段描述必须是对象", p)
            continue
        if "name" not in item or "type" not in item:
            fail("字段描述缺少 'name' 或 'type'", p)
            continue
        name, type_ = item["name"], item["type"]
        if not isinstance(name, str) or not name:
            fail("字段名必须是非空字符串", f"{p}.name")
            continue
        if name in names:
            fail(f"字段名重复: {name!r}", f"{p}.name")
            continue
        if type_ not in ("int", "float", "str", "bool"):
            fail(f"字段类型非法: {type_!r}", f"{p}.type")
            continue
        names.add(name)
        specs.append(FieldSpec(name, type_))
    return Schema(specs) if specs else None


def _parse_rows(v: Any, schema: Schema | None,
                fail) -> tuple[list[dict] | None, set[str]]:
    ids: set[str] = set()
    if not isinstance(v, list):
        fail("rows 必须是数组", "rows")
        return None, ids
    rows_out: list[dict] = []
    for i, item in enumerate(v):
        p = f"rows[{i}]"
        if not isinstance(item, dict):
            fail("行必须是对象", p)
            continue
        if "id" not in item:
            fail("缺少 'id'", p)
            continue
        row_id = item["id"]
        if not isinstance(row_id, str) or not row_id:
            fail("行标识必须是非空字符串", f"{p}.id")
            continue
        if row_id in ids:
            fail(f"行标识重复: {row_id!r}", f"{p}.id")
            continue
        ids.add(row_id)
        if "fields" not in item:
            fail("缺少 'fields'", p)
            continue
        if not isinstance(item["fields"], dict):
            fail("fields 必须是对象", f"{p}.fields")
            continue
        if schema is not None:
            # 逐字段类型检查，给出精确位置
            fields = item["fields"]
            for fspec in schema.fields:
                if fspec.name not in fields:
                    fail(f"缺少字段 {fspec.name!r}", f"{p}.fields")
                else:
                    val = fields[fspec.name]
                    if not _value_matches(fspec.type, val):
                        fail(
                            f"字段 {fspec.name!r} 需要 {fspec.type} 类型，"
                            f"实际为 {type(val).__name__}（值: {val!r}）",
                            f"{p}.fields.{fspec.name}")
            extra = sorted(set(fields) - {f.name for f in schema.fields})
            if extra:
                fail(f"多余字段: {extra[0]!r}", f"{p}.fields.{extra[0]}")
        rows_out.append(item)
    return rows_out, ids


def _value_matches(t: str, v: Any) -> bool:
    if t == "int":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "float":
        return (isinstance(v, (int, float)) and not isinstance(v, bool)
                and (not isinstance(v, float) or math.isfinite(v)))
    if t == "str":
        return isinstance(v, str)
    if t == "bool":
        return isinstance(v, bool)
    return False


def _parse_window(v: Any, fail) -> tuple[int, int] | None:
    if v is None:
        return None
    if not isinstance(v, dict):
        fail("window 必须是对象或 null", "window")
        return None
    if "start" not in v or "size" not in v:
        fail("window 缺少 'start' 或 'size'", "window")
        return None
    start, size = v["start"], v["size"]
    if not _is_int(start) or start < 0:
        fail(f"window.start 必须是非负整数，得到 {start!r}",
             "window.start")
    if not _is_int(size) or size <= 0:
        fail(f"window.size 必须是正整数，得到 {size!r}", "window.size")
    if _is_int(start) and _is_int(size) and start >= 0 and size > 0:
        return start, size
    return None


def _parse_stats(v: Any, fail) -> dict[str, int]:
    out: dict[str, int] = {}
    if not isinstance(v, dict):
        fail("stats 必须是对象", "stats")
        return out
    for key, val in v.items():
        if key not in KNOWN_STATS:
            fail(f"未知统计项 {key!r}", f"stats.{key}")
            continue
        if not _is_int(val) or val < 0:
            fail(f"统计项 {key!r} 必须是非负整数，得到 {val!r}",
                 f"stats.{key}")
            continue
        out[key] = val
    return out


def _parse_seed(v: Any, fail) -> int:
    if not _is_int(v) or v < 0:
        fail(f"seed 必须是非负整数，得到 {v!r}", "seed")
        return 0
    return v
