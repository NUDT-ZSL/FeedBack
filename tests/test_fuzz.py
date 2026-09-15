"""差分随机压力测试。

维护一个朴素的全量参考模型（Python 排序 + 列表切片），随机执行
增删行 / 改排序 / 改筛选 / 窗口移动缩放，每一步都要求：

1. 内核窗口可见序列 == 参考模型同区间切片（逐行一致）；
2. 每个存在行的 position / is_visible / in_window 与参考一致；
3. 两棵 Treap 的内部不变量成立；
4. 非法窗口操作必须被拒绝且窗口/可见序列不变。
"""

import random
import unittest

from table_kernel.errors import BatchValidationError, ValidationError, WindowError
from table_kernel.kernel import TableKernel
from table_kernel.serde import export_snapshot, load_snapshot

SCHEMA = {"a": "int", "b": "str", "c": "float", "d": "bool"}

FIELDS = ["a", "b", "c", "d"]
SORT_CHOICES = [
    [],
    [("a", True)],
    [("a", False)],
    [("b", True)],
    [("a", True), ("b", False)],
    [("c", False)],
    [("d", True), ("a", True)],
]
FILTER_CHOICES = [
    [],
    [("a", "ge", 3)],
    [("a", "lt", 6)],
    [("a", "le", 6)],
    [("a", "gt", 2)],
    [("a", "ne", 3)],
    [("a", "in", [1, 4, 7])],
    [("a", "not_in", [0, 2, 9])],
    [("b", "contains", "x")],
    [("d", "eq", True)],
    [("d", "ne", False)],
    [("a", "ge", 2), ("a", "le", 8)],
]


class ReferenceModel:
    """与内核窗口收回策略完全一致的朴素参考实现。"""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.sort: list = []
        self.filters: list = []
        self.window = None  # (start, size)，count==0 时挂起保留

    def _passes(self, fields):
        for f, op, v in self.filters:
            x = fields[f]
            if op == "eq" and x != v:
                return False
            if op == "ne" and x == v:
                return False
            if op == "lt" and not x < v:
                return False
            if op == "le" and not x <= v:
                return False
            if op == "gt" and not x > v:
                return False
            if op == "ge" and not x >= v:
                return False
            if op == "in" and x not in v:
                return False
            if op == "not_in" and x in v:
                return False
            if op == "contains" and v not in x:
                return False
        return True

    def _ordered(self):
        items = list(self.rows.items())
        items.sort(key=lambda kv: self._key(kv[1], kv[0]))
        return [(rid, f) for rid, f in items if self._passes(f)]

    def _key(self, fields, rid):
        key = []
        for f, asc in self.sort:
            v = fields[f]
            if f == "d":
                v = bool(v)
            key.append(v if asc else _RevRef(v))
        key.append(rid)
        return tuple(key)

    def _reconcile(self):
        if self.window is None:
            return
        start, size = self.window
        count = len(self._ordered())
        if count == 0:
            return  # 挂起
        if start + size > count:
            if size >= count:
                self.window = (0, count)
            else:
                self.window = (count - size, size)

    def visible(self):
        if self.window is None:
            return None
        ordered = self._ordered()
        if not ordered:
            return []
        start, size = self.window
        return [rid for rid, _ in ordered[start:start + size]]

    def position(self, rid):
        for i, (x, _) in enumerate(self._ordered()):
            if x == rid:
                return i
        return None


class _RevRef:
    __slots__ = ("v",)

    def __init__(self, v):
        self.v = v

    def __lt__(self, o):
        return self.v > o.v


def random_fields(rng, idx):
    return {
        "a": rng.randrange(10),
        "b": rng.choice(["x", "y", "z", "xx", "q"]) + str(idx % 5),
        "c": rng.randrange(100) / 4,
        "d": rng.random() < 0.5,
    }


class DifferentialFuzzTest(unittest.TestCase):
    def _assert_consistent(self, k, ref):
        ordered = ref._ordered()
        self.assertEqual(k.visible_count, len(ordered))
        self.assertEqual(k.row_count, len(ref.rows))
        # 全量可见顺序一致
        full_ids = [p.id for p in k._visible_treap.iter_payloads()]
        self.assertEqual(full_ids, [rid for rid, _ in ordered])
        # Treap 不变量
        k._full_treap.verify()
        k._visible_treap.verify()
        # 窗口逐行一致
        ref._reconcile()
        self.assertEqual(k.window, ref.window)
        if ref.window is not None:
            self.assertEqual(k.visible_ids(), ref.visible())
            start, size = ref.window
            if ordered:
                # position / in_window
                win_ids = set(k.visible_ids())
                for rid in list(ref.rows)[:30]:
                    pos = ref.position(rid)
                    if pos is None:
                        self.assertFalse(k.is_visible(rid))
                    else:
                        self.assertEqual(k.position_of(rid), pos)
                        self.assertEqual(k.in_window(rid), rid in win_ids)
            # window_at 任意合法窗口
            if ordered:
                s = min(2, len(ordered))
                self.assertEqual(k.window_at(0, s),
                                 [rid for rid, _ in ordered[:s]])

    def test_random_operations(self):
        for seed in (20260915, 1, 999, 31337):
            with self.subTest(seed=seed):
                self._run_fuzz(seed)

    def _run_fuzz(self, seed):
        rng = random.Random(seed)
        k = TableKernel(SCHEMA, [], sort=[], filters=[], seed=7)
        ref = ReferenceModel()
        next_id = 0

        for step in range(900):
            op = rng.random()
            if op < 0.35 and next_id < 400:
                # 批量加 1~4 行，偶尔构造非法行或重复标识（整批必失败）
                batch = []
                planned = []
                bad = False
                for _ in range(rng.randrange(1, 4)):
                    rid = f"id-{next_id:04d}"
                    next_id += 1
                    fields = random_fields(rng, next_id)
                    item = {"id": rid, "fields": fields}
                    roll = rng.random()
                    if roll < 0.07:
                        item["fields"] = {**fields, "a": "bad"}
                        bad = True
                    elif roll < 0.12:
                        pool = list(ref.rows) + [b["id"] for b in batch]
                        if pool:  # 与已有行或同批前行撞标识
                            item["id"] = rng.choice(pool)
                            bad = True
                    batch.append(item)
                    if not bad:
                        planned.append((item["id"], item["fields"]))
                if bad:
                    with self.assertRaises((ValidationError,
                                            BatchValidationError)):
                        k.add_rows(batch)
                    # 参考模型保持原样，整批不生效
                else:
                    k.add_rows(batch)
                    for rid, f in planned:
                        ref.rows[rid] = f
                    ref._reconcile()
            elif op < 0.55 and ref.rows:
                # 批量删除
                ids = rng.sample(list(ref.rows),
                                  min(len(ref.rows), rng.randrange(1, 4)))
                if rng.random() < 0.07:
                    ids = ids + ["ghost"]
                    try:
                        k.remove_rows(ids)
                        self.fail("删除未知行应失败")
                    except BatchValidationError:
                        pass
                else:
                    k.remove_rows(ids)
                    for rid in ids:
                        ref.rows.pop(rid, None)
                    ref._reconcile()
            elif op < 0.7:
                spec = rng.choice(SORT_CHOICES)
                k.set_sort([s for s in spec])
                ref.sort = spec
                ref._reconcile()
            elif op < 0.82:
                spec = rng.choice(FILTER_CHOICES)
                k.set_filters([dict(field=f, op=o, value=v)
                               for f, o, v in spec])
                ref.filters = spec
                ref._reconcile()
            else:
                # 窗口操作
                count = k.visible_count
                action = rng.choice(["set", "move", "resize", "scroll"])
                if count == 0:
                    continue
                cur = k.window
                size = rng.randrange(1, min(count, 25) + 1)
                start = rng.randrange(0, max(1, count - size + 1))
                if cur is None or action == "set":
                    k.set_window(start, size)
                    ref.window = (start, size)
                elif action == "move":
                    _, sz = cur
                    if sz <= count:
                        st = rng.randrange(0, count - sz + 1)
                        k.move_to(st)
                        ref.window = (st, sz)
                elif action == "resize":
                    st, _ = cur
                    if st + size <= count:
                        k.resize(size)
                        ref.window = (st, size)
                else:
                    st, sz = cur
                    delta = rng.randrange(-5, 6)
                    if 0 <= st + delta and st + delta + sz <= count:
                        k.scroll(delta)
                        ref.window = (st + delta, sz)

            # 随机发起一些非法窗口操作，断言原子性
            if k.window is not None and rng.random() < 0.12:
                bad_start, bad_size = k.window
                total = k.visible_count
                bad = rng.choice([
                    (0, 0), (-1, 5), (total, 1),
                    (bad_start, total + 1),
                    (max(0, total - bad_size + 1), bad_size),
                ])
                before = k.visible_ids() if total else []
                wbefore = k.window
                try:
                    if rng.random() < 0.5:
                        k.set_window(*bad)
                    else:
                        st, _sz = bad
                        k.move_to(st)  # 保持当前 size
                except WindowError:
                    self.assertEqual(k.window, wbefore)
                    self.assertEqual(
                        k.visible_ids() if k.visible_count else [],
                        before if k.visible_count else [])
                # 无论拒绝还是恰好合法，参考窗口都以内核实际窗口为准
                ref.window = k.window

            self._assert_consistent(k, ref)

    def test_snapshot_roundtrip_mid_fuzz(self):
        """在随机状态下导出/载入，载入结果必须与原内核逐行一致。"""
        rng = random.Random(4242)
        rows = [{"id": f"id-{i:04d}", "fields": random_fields(rng, i)}
                for i in range(120)]
        k = TableKernel(SCHEMA, rows,
                        sort=[("a", True), ("b", False)],
                        filters=[{"field": "a", "op": "le", "value": 8}],
                        window_size=15, seed=1)
        k.set_window(20, 15)
        snap = export_snapshot(k)
        k2 = load_snapshot(snap)
        self.assertEqual(k2.visible_ids(), k.visible_ids())
        self.assertEqual(k2.window, k.window)
        for i in range(0, k.visible_count, 7):
            rid = k._visible_treap.kth_payload(i).id
            self.assertEqual(k2.position_of(rid), i)
        # 载入后的内核继续做增量操作仍然正确
        k2.add_rows([{"id": "id-new",
                      "fields": {"a": 0, "b": "z0", "c": 1.0,
                                 "d": False}}])
        self.assertTrue(k2.is_visible("id-new"))


if __name__ == "__main__":
    unittest.main()
