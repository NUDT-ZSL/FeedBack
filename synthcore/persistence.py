"""状态导出 / 载入(JSON,仅标准库)。

导出内容:物品(含库存)、配方、以及派生的最优方案与冲突记录(供检视;
载入时派生数据会被忽略并重新推导,保证以物品+配方为唯一事实来源)。

载入校验(全部通过才落库,任何失败都不影响现有状态):
- 结构完整:顶层为对象且含 items / recipes 列表;
- 标识唯一且为非空字符串;
- 数量为正整数、库存为非负整数(布尔值不算);
- 配方引用的物品必须存在,同一列表内物品不重复;
- strict_cycles=True 时不允许存在未消解的配方环。
"""
from __future__ import annotations

import json
from typing import List, Union

from .engine import Engine
from .errors import CycleError, ValidationError

FORMAT_VERSION = 1


def export_state(engine: Engine) -> dict:
    """导出完整状态为可 JSON 序列化的字典。"""
    best = {}
    for iid in sorted(engine.items):
        src = engine.source(iid)
        entry = {"source": src}
        cost = engine.unit_cost(iid)
        if cost is not None:
            entry["cost"] = str(cost)
        if src == "recipe":
            entry["recipe"] = engine.best_recipe(iid)
        best[iid] = entry
    return {
        "version": FORMAT_VERSION,
        "items": [
            {"id": it.id, "stock": it.stock}
            for it in sorted(engine.items.values(), key=lambda x: x.id)
        ],
        "recipes": [
            {
                "id": r.id,
                "inputs": [{"item": i, "qty": q} for i, q in r.inputs],
                "outputs": [{"item": i, "qty": q} for i, q in r.outputs],
            }
            for r in sorted(engine.recipes.values(), key=lambda x: x.id)
        ],
        "derived": {
            "best": best,
            "conflicts": engine.conflicts,
        },
    }


def dumps(engine: Engine, **json_kwargs) -> str:
    """导出为 JSON 字符串。"""
    kwargs = {"ensure_ascii": False, "indent": 2, "sort_keys": True}
    kwargs.update(json_kwargs)
    return json.dumps(export_state(engine), **kwargs)


def load(data: Union[str, bytes, dict], strict_cycles: bool = False) -> Engine:
    """从 JSON 字符串/字节/字典构建新引擎;校验失败抛 ValidationError。"""
    engine = Engine()
    replace_state(engine, data, strict_cycles=strict_cycles)
    return engine


def replace_state(engine: Engine, data: Union[str, bytes, dict],
                  strict_cycles: bool = False) -> None:
    """将导出数据载入现有引擎;先完整校验并构建新状态,全部通过后一次性
    替换,任何失败都不会改变 engine 的当前状态。"""
    fresh = _build(data, strict_cycles=strict_cycles)
    engine.items = fresh.items
    engine.recipes = fresh.recipes
    engine._producers = fresh._producers
    engine._consumers = fresh._consumers
    engine._cost = fresh._cost
    engine._best = fresh._best
    engine._usable = fresh._usable
    engine._unsettled = fresh._unsettled
    engine._scc = fresh._scc
    engine.conflicts = fresh.conflicts
    engine.last_affected = fresh.last_affected


def _build(data: Union[str, bytes, dict], strict_cycles: bool) -> Engine:
    errors: List[str] = []

    if isinstance(data, (str, bytes)):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"JSON 解析失败: {exc}") from exc

    if not isinstance(data, dict):
        raise ValidationError(f"顶层结构应为对象, 实际为 {type(data).__name__}")

    version = data.get("version", FORMAT_VERSION)
    if version != FORMAT_VERSION:
        raise ValidationError(
            f"不支持的格式版本 {version!r}, 期望 {FORMAT_VERSION}"
        )

    raw_items = data.get("items")
    raw_recipes = data.get("recipes")
    if not isinstance(raw_items, list):
        errors.append("缺失或非法字段 'items'(应为列表)")
        raw_items = []
    if not isinstance(raw_recipes, list):
        errors.append("缺失或非法字段 'recipes'(应为列表)")
        raw_recipes = []
    if errors:
        raise ValidationError("; ".join(errors))

    # ---- 物品:标识唯一、库存非负整数 ----
    items = {}
    for idx, entry in enumerate(raw_items):
        where = f"items[{idx}]"
        if not isinstance(entry, dict):
            errors.append(f"{where}: 应为对象, 实际为 {entry!r}")
            continue
        iid = entry.get("id")
        if not isinstance(iid, str) or not iid:
            errors.append(f"{where}.id: 标识必须为非空字符串, 实际为 {iid!r}")
            continue
        if iid in items:
            errors.append(f"{where}.id: 物品标识 {iid!r} 重复")
            continue
        stock = entry.get("stock", 0)
        if isinstance(stock, bool) or not isinstance(stock, int) or stock < 0:
            errors.append(f"{where}.stock: 库存必须为非负整数, 实际为 {stock!r}")
            continue
        items[iid] = stock

    # ---- 配方:标识唯一、数量为正整数、引用存在、同表不重复 ----
    recipes = []
    seen_rids = set()
    for idx, entry in enumerate(raw_recipes):
        where = f"recipes[{idx}]"
        if not isinstance(entry, dict):
            errors.append(f"{where}: 应为对象, 实际为 {entry!r}")
            continue
        rid = entry.get("id")
        if not isinstance(rid, str) or not rid:
            errors.append(f"{where}.id: 标识必须为非空字符串, 实际为 {rid!r}")
            continue
        if rid in seen_rids:
            errors.append(f"{where}.id: 配方标识 {rid!r} 重复")
            continue
        seen_rids.add(rid)
        ok = True
        parsed = {}
        for kind in ("inputs", "outputs"):
            pairs = entry.get(kind)
            if not isinstance(pairs, list) or not pairs:
                errors.append(f"{where}.{kind}: 应为非空列表")
                ok = False
                continue
            seen_items = set()
            norm = []
            for j, p in enumerate(pairs):
                pw = f"{where}.{kind}[{j}]"
                if not isinstance(p, dict):
                    errors.append(f"{pw}: 应为对象, 实际为 {p!r}")
                    ok = False
                    continue
                iid, qty = p.get("item"), p.get("qty")
                if not isinstance(iid, str) or not iid:
                    errors.append(f"{pw}.item: 标识必须为非空字符串, 实际为 {iid!r}")
                    ok = False
                    continue
                if iid not in items:
                    errors.append(f"{pw}.item: 引用了不存在的物品 {iid!r}")
                    ok = False
                if iid in seen_items:
                    errors.append(f"{pw}.item: 物品 {iid!r} 在同一列表中重复出现")
                    ok = False
                seen_items.add(iid)
                if isinstance(qty, bool) or not isinstance(qty, int) or qty <= 0:
                    errors.append(f"{pw}.qty: 数量必须为正整数, 实际为 {qty!r}")
                    ok = False
                    continue
                norm.append((iid, qty))
            parsed[kind] = norm
        if ok:
            recipes.append((rid, parsed["inputs"], parsed["outputs"]))

    if errors:
        raise ValidationError("; ".join(errors))

    # ---- 构建(此时数据必然合法,add_* 不会再抛错) ----
    engine = Engine()
    for iid, stock in items.items():
        engine.add_item(iid, stock)
    for rid, ins, outs in recipes:
        engine.add_recipe(rid, ins, outs)

    if strict_cycles and engine.conflicts:
        desc = [
            "环 " + " -> ".join(c["items"] + c["items"][:1])
            + " (配方: " + ", ".join(c["recipes"]) + ")"
            for c in engine.conflicts
        ]
        raise CycleError("存在未消解的配方环: " + "; ".join(desc))

    return engine
