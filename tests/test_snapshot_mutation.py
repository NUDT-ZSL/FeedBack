"""快照载入器的结构变异测试（永久回归）。

用一个独立的、按快照文档严格建模的预言机，和递归随机变异产生的
损坏快照做对照：载入器对每一份快照的「接受 / 拒绝」判定必须与预言
机一致，且任何损坏都只能抛 ``SerializationError``，绝不能泄漏原始
``TypeError``/``KeyError`` 之类的异常（历史上曾出现过 field 被改成
不可哈希列表时抛 TypeError 的缺陷）。
"""

import copy
import json
import math
import random
import unittest

from table_kernel import TableKernel, export_snapshot, load_snapshot
from table_kernel.errors import SerializationError

TYPES = ("int", "float", "str", "bool")
OPS = {"eq", "ne", "lt", "le", "gt", "ge", "in", "not_in", "contains"}
ORDERED = {"lt", "le", "gt", "ge"}
KNOWN_STATS = {
    "full_rebuilds", "visible_rebuilds", "rows_inserted", "rows_removed",
    "window_moves", "window_resizes", "window_refreshes", "window_clamps",
}
REQUIRED_TOP = {"version", "schema", "rows", "sort", "filters", "window"}
OPTIONAL_TOP = {"stats", "seed"}


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _scalar_ok(t, v):
    if t == "int":
        return _is_int(v)
    if t == "float":
        return (isinstance(v, (int, float)) and not isinstance(v, bool)
                and (not isinstance(v, float) or math.isfinite(v)))
    if t == "str":
        return isinstance(v, str)
    if t == "bool":
        return isinstance(v, bool)
    return False


def strict_accepts(s):
    """严格预言机：文档形态完全自洽才接受。"""
    if not isinstance(s, dict):
        return False
    if REQUIRED_TOP - set(s):
        return False
    if set(s) - REQUIRED_TOP - OPTIONAL_TOP:
        return False
    if not _is_int(s.get("version")) or s["version"] != 1:
        return False
    seed = s.get("seed", 0)
    if not _is_int(seed) or seed < 0:
        return False
    stats = s.get("stats", {})
    if not isinstance(stats, dict):
        return False
    for key, val in stats.items():
        if key not in KNOWN_STATS or not _is_int(val) or val < 0:
            return False

    schema = {}
    if not isinstance(s["schema"], list) or not s["schema"]:
        return False
    for f in s["schema"]:
        if not isinstance(f, dict) or set(f) != {"name", "type"}:
            return False
        n, t = f["name"], f["type"]
        if not (isinstance(n, str) and n and isinstance(t, str)
                and t in TYPES) or n in schema:
            return False
        schema[n] = t

    ids = set()
    if not isinstance(s["rows"], list):
        return False
    for r in s["rows"]:
        if not isinstance(r, dict) or set(r) != {"id", "fields"}:
            return False
        rid, flds = r["id"], r["fields"]
        if not (isinstance(rid, str) and rid and rid not in ids):
            return False
        ids.add(rid)
        if not isinstance(flds, dict) or set(flds) != set(schema):
            return False
        for n, t in schema.items():
            if not _scalar_ok(t, flds[n]):
                return False

    seen = set()
    if not isinstance(s["sort"], list):
        return False
    for sp in s["sort"]:
        if not isinstance(sp, dict) or set(sp) != {"field", "asc"}:
            return False
        f, asc = sp["field"], sp["asc"]
        if not (isinstance(asc, bool) and isinstance(f, str)
                and f in schema and f not in seen):
            return False
        seen.add(f)

    if not isinstance(s["filters"], list):
        return False
    for flt in s["filters"]:
        if not isinstance(flt, dict) or set(flt) != {"field", "op", "value"}:
            return False
        f, op, v = flt["field"], flt["op"], flt["value"]
        if not (isinstance(f, str) and f in schema
                and isinstance(op, str) and op in OPS):
            return False
        t = schema[f]
        if op in ORDERED and t == "bool":
            return False
        if op == "contains":
            if t != "str" or not isinstance(v, str):
                return False
        elif op in ("in", "not_in"):
            if not isinstance(v, list) or any(
                    not _scalar_ok(t, x) for x in v):
                return False
        elif not _scalar_ok(t, v):
            return False

    w = s["window"]
    if w is not None:
        if not isinstance(w, dict) or set(w) != {"start", "size"}:
            return False
        if not _is_int(w["start"]) or w["start"] < 0:
            return False
        if not _is_int(w["size"]) or w["size"] <= 0:
            return False
        # 有可见行时区间不得越界；无可见行时窗口挂起，允许保留
        visible = _count_visible(s, schema)
        if visible > 0 and w["start"] + w["size"] > visible:
            return False
    return True


def _row_passes(flt, fields):
    f, op, v = flt["field"], flt["op"], flt["value"]
    x = fields[f]
    if op == "eq":
        return x == v
    if op == "ne":
        return x != v
    if op == "lt":
        return x < v
    if op == "le":
        return x <= v
    if op == "gt":
        return x > v
    if op == "ge":
        return x >= v
    if op == "in":
        return x in v
    if op == "not_in":
        return x not in v
    if op == "contains":
        return v in x
    return False


def _count_visible(s, schema):
    return sum(
        1 for r in s["rows"]
        if all(_row_passes(flt, r["fields"]) for flt in s["filters"]))


def _garbage(rng):
    """每次返回全新对象，避免可变垃圾被递归污染后自包含。"""
    kind = rng.randrange(12)
    if kind == 0:
        return None
    if kind == 1:
        return rng.random() < 0.5
    if kind == 2:
        return rng.randrange(-9, 9)
    if kind == 3:
        return rng.random() * 3 - 1.5
    if kind == 4:
        return rng.choice(["", "x", "str"])
    if kind in (5, 6):
        return [_garbage(rng) for _ in range(rng.randrange(3))]
    if kind in (7, 8):
        return {f"k{i}": _garbage(rng)
                for i in range(rng.randrange(3))}
    if kind == 9:
        return float("nan")
    if kind == 10:
        return float("inf")
    return -float("inf")


def _mutate(node, rng):
    if isinstance(node, dict):
        if not node:
            node["hacked"] = _garbage(rng)
            return
        choice = rng.random()
        if choice < 0.4:
            key = rng.choice(list(node.keys()))
            node[key] = _garbage(rng)
        elif choice < 0.55:
            del node[rng.choice(list(node.keys()))]
        elif choice < 0.7:
            node[f"hacked{rng.randrange(1000)}"] = _garbage(rng)
        else:
            _mutate(rng.choice(list(node.values())), rng)
    elif isinstance(node, list):
        if not node:
            node.append(_garbage(rng))
        elif rng.random() < 0.4:
            node[rng.randrange(len(node))] = _garbage(rng)
        elif rng.random() < 0.5:
            node.pop(rng.randrange(len(node)))
        else:
            _mutate(node[rng.randrange(len(node))], rng)


def _base_snapshot():
    k = TableKernel(
        {"age": "int", "name": "str", "score": "float", "ok": "bool"},
        [{"id": f"r{i}",
          "fields": {"age": i % 5, "name": f"n{i % 3}",
                     "score": i * 0.5, "ok": i % 2 == 0}}
         for i in range(20)],
        sort=[("age", False), ("name", True)],
        filters=[{"field": "age", "op": "in", "value": [1, 2]},
                 ("name", "contains", "n")],
        window_size=6, seed=3)
    k.move_to(2)
    return export_snapshot(k)


class SnapshotMutationFuzzTest(unittest.TestCase):
    def test_pristine_snapshot_accepted(self):
        snap = _base_snapshot()
        self.assertTrue(strict_accepts(copy.deepcopy(snap)))
        k = load_snapshot(copy.deepcopy(snap))
        # 恢复的窗口 (2,6) 与全量排序筛选后取同区间逐行一致
        self.assertEqual(k.visible_ids(), k.reference_visible(2, 6))
        self.assertEqual(k.window, (2, 6))

    def test_random_structural_mutations_match_oracle(self):
        rng = random.Random(20260915)
        base = _base_snapshot()
        self.assertTrue(strict_accepts(copy.deepcopy(base)))
        trials = 4000
        for _ in range(trials):
            mutant = copy.deepcopy(base)
            for _ in range(rng.randint(1, 3)):
                _mutate(mutant, rng)
            oracle_ok = strict_accepts(mutant)
            try:
                k = load_snapshot(mutant)
                loader_ok = True
            except SerializationError:
                loader_ok = False
            # 关键不变量：接受/拒绝判定一致，且不允许任何其他异常逃逸
            if loader_ok != oracle_ok:
                try:
                    shown = json.dumps(mutant, ensure_ascii=False,
                                       default=str)[:500]
                except ValueError:
                    shown = repr(mutant)[:500]
                self.fail(
                    "判定分歧: loader=%s oracle=%s 快照=%s"
                    % (loader_ok, oracle_ok, shown))
            if loader_ok and mutant["window"] is not None \
                    and k.visible_count > 0:
                # 被接受的非空窗口快照，其窗口区间必须确实可取
                st, sz = mutant["window"]["start"], mutant["window"]["size"]
                self.assertEqual(
                    k.visible_ids(),
                    k.window_at(st, sz))


if __name__ == "__main__":
    unittest.main()
