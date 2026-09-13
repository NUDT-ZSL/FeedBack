"""diffcore 的 unittest 验收测试。

运行方式：
    python -m unittest discover -s tests -v
"""

import random
import time
import unittest

from diffcore import (
    align,
    map_line,
    fold,
    relocate,
    to_dict,
    from_dict,
)


def assert_alignment_valid(testcase, result, old_lines, new_lines):
    """校验对齐结果的基本性质：单调、全覆盖、匹配行内容一致。"""
    old_seen = []
    new_seen = []
    for pair in result:
        o, n = pair
        testcase.assertFalse(o is None and n is None,
                             "存在两侧都为 None 的记录")
        if o is not None:
            old_seen.append(o)
        if n is not None:
            new_seen.append(n)
        if o is not None and n is not None:
            testcase.assertEqual(old_lines[o], new_lines[n],
                                 "匹配上的两行内容不一致")
    testcase.assertEqual(old_seen, list(range(len(old_lines))),
                         "old 侧未按顺序覆盖所有行")
    testcase.assertEqual(new_seen, list(range(len(new_lines))),
                         "new 侧未按顺序覆盖所有行")


def dp_lcs_len(a, b):
    """朴素 DP 求 LCS 长度，用于交叉验证。"""
    prev = [0] * (len(b) + 1)
    for x in a:
        cur = [0]
        for j, y in enumerate(b):
            if x == y:
                cur.append(prev[j] + 1)
            else:
                cur.append(max(prev[j + 1], cur[-1]))
        prev = cur
    return prev[-1]


class AlignBasicTest(unittest.TestCase):
    def test_both_empty(self):
        self.assertEqual(align([], []), [])

    def test_one_side_empty(self):
        self.assertEqual(align(["a", "b"], []), [(0, None), (1, None)])
        self.assertEqual(align([], ["a", "b"]), [(None, 0), (None, 1)])

    def test_identical(self):
        lines = ["x", "y", "z"]
        self.assertEqual(align(lines, list(lines)), [(0, 0), (1, 1), (2, 2)])

    def test_pure_insertion(self):
        result = align(["a", "d"], ["a", "b", "c", "d"])
        self.assertEqual(result, [(0, 0), (None, 1), (None, 2), (1, 3)])

    def test_pure_deletion(self):
        result = align(["a", "b", "c", "d"], ["a", "d"])
        self.assertEqual(result, [(0, 0), (1, None), (2, None), (3, 1)])

    def test_replacement_block(self):
        old = ["head", "o1", "o2", "o3", "tail"]
        new = ["head", "n1", "n2", "tail"]
        result = align(old, new)
        self.assertEqual(result, [
            (0, 0),
            (1, None), (2, None), (3, None),
            (None, 1), (None, 2),
            (4, 3),
        ])

    def test_no_common_lines(self):
        old = ["a", "b", "c"]
        new = ["x", "y"]
        result = align(old, new)
        self.assertEqual(result,
                         [(0, None), (1, None), (2, None), (None, 0), (None, 1)])

    def test_duplicate_lines_deterministic(self):
        # 大量重复行：结果必须确定，且多次调用完全一致
        old = ["same"] * 5 + ["mid"] + ["same"] * 7
        new = ["same"] * 3 + ["other"] + ["same"] * 4
        first = align(old, new)
        second = align(old, new)
        self.assertEqual(first, second)
        assert_alignment_valid(self, first, old, new)
        # 重复行的匹配数应等于 LCS 长度
        matched = sum(1 for o, n in first if o is not None and n is not None)
        self.assertEqual(matched, dp_lcs_len(old, new))

    def test_invalid_input_types(self):
        with self.assertRaises(TypeError):
            align("abc", ["a"])          # 字符串不是行列表
        with self.assertRaises(TypeError):
            align(["a", 1], ["a"])       # 元素必须是字符串
        with self.assertRaises(TypeError):
            align(["a"], None)


class MapLineTest(unittest.TestCase):
    def setUp(self):
        self.old = ["a", "b", "c", "d"]
        self.new = ["a", "x", "c", "d", "e"]
        # 对齐: a-a, b删, x增, c-c, d-d, e增
        self.result = align(self.old, self.new)

    def test_old_to_new(self):
        self.assertEqual(map_line(self.result, "old", 0), 0)
        self.assertIsNone(map_line(self.result, "old", 1))   # b 被删
        self.assertEqual(map_line(self.result, "old", 2), 2)
        self.assertEqual(map_line(self.result, "old", 3), 3)

    def test_new_to_old(self):
        self.assertEqual(map_line(self.result, "new", 0), 0)
        self.assertIsNone(map_line(self.result, "new", 1))   # x 是新增
        self.assertEqual(map_line(self.result, "new", 4), None)

    def test_invalid_side(self):
        with self.assertRaises(ValueError) as ctx:
            map_line(self.result, "both", 1)
        msg = str(ctx.exception)
        self.assertIn("'both'", msg)
        self.assertIn("1", msg)

    def test_index_out_of_range(self):
        with self.assertRaises(ValueError) as ctx:
            map_line(self.result, "old", 99)
        msg = str(ctx.exception)
        self.assertIn("'old'", msg)
        self.assertIn("99", msg)
        with self.assertRaises(ValueError):
            map_line(self.result, "new", -1)
        with self.assertRaises(ValueError):
            map_line(self.result, "old", 1.5)


class FoldTest(unittest.TestCase):
    def setUp(self):
        self.old = ["l%d" % i for i in range(10)]
        # 删除第 3、4 行，其余保留
        self.new = [l for i, l in enumerate(self.old) if i not in (3, 4)]
        self.result = align(self.old, self.new)

    def test_merge_overlapping_then_map(self):
        # 重叠区间 [1,3]、[2,5] 合并为 [1,5]；old 1..5 去掉 3、4 后
        # 对应 new 的 1..3（new 中 1,2,3 对应 old 1,2,5）
        self.assertEqual(fold(self.result, [(1, 3), (2, 5)]), [(1, 3)])

    def test_disjoint_ranges_stay_separate(self):
        self.assertEqual(fold(self.result, [(0, 1), (6, 7)]), [(0, 1), (4, 5)])

    def test_fully_deleted_range_dropped(self):
        self.assertEqual(fold(self.result, [(3, 4)]), [])

    def test_range_partly_deleted(self):
        self.assertEqual(fold(self.result, [(2, 5)]), [(2, 3)])

    def test_empty_ranges(self):
        self.assertEqual(fold(self.result, []), [])

    def test_new_side_ranges(self):
        # new 侧区间 [1, 2] 对应 old 的 [1, 2]
        self.assertEqual(fold(self.result, [(1, 2)], side="new"), [(1, 2)])

    def test_invalid_ranges(self):
        with self.assertRaises(ValueError):
            fold(self.result, [(5, 2)])       # 起点大于终点
        with self.assertRaises(ValueError):
            fold(self.result, [(-1, 2)])      # 负行号
        with self.assertRaises(ValueError):
            fold(self.result, [(1,)])         # 形状错误
        with self.assertRaises(ValueError):
            fold(self.result, [(0, 1)], side="middle")


class RelocateTest(unittest.TestCase):
    def setUp(self):
        self.old = ["a", "b", "c", "d", "e"]
        # b、c 被删，f 新增在末尾
        self.new = ["a", "d", "e", "f"]
        self.result = align(self.old, self.new)

    def test_moved_and_unchanged(self):
        anns = [
            {"side": "old", "line": 0, "id": "keep"},
            {"side": "old", "line": 3, "id": "shift"},
        ]
        out = relocate(anns, self.result)
        self.assertEqual(out[0]["mapped_line"], 0)
        self.assertEqual(out[0]["status"], "unchanged")
        self.assertEqual(out[1]["mapped_line"], 1)
        self.assertEqual(out[1]["status"], "moved")

    def test_deleted_prefers_previous_line(self):
        anns = [{"side": "old", "line": 2, "id": "gone"}]  # c 被删
        out = relocate(anns, self.result)
        self.assertEqual(out[0]["status"], "deleted")
        # 前一行 b 也被删，落到再前一行 a（new 侧 0）
        self.assertEqual(out[0]["mapped_line"], 0)

    def test_deleted_falls_back_to_next_line(self):
        old = ["x", "y", "z"]
        new = ["z"]                       # 前两行都被删
        result = align(old, new)
        out = relocate([{"side": "old", "line": 0, "id": "head"}], result)
        self.assertEqual(out[0]["status"], "deleted")
        self.assertEqual(out[0]["mapped_line"], 0)  # 挂到后一行 z

    def test_deleted_with_no_survivor(self):
        result = align(["only"], [])
        out = relocate([{"side": "old", "line": 0, "id": "doom"}], result)
        self.assertEqual(out[0]["status"], "deleted")
        self.assertIsNone(out[0]["mapped_line"])

    def test_new_side_annotation(self):
        anns = [{"side": "new", "line": 3, "id": "added"}]  # f 是新增行
        out = relocate(anns, self.result)
        self.assertEqual(out[0]["status"], "deleted")   # 相对 old 侧无对应行
        self.assertEqual(out[0]["mapped_line"], 4)      # 挂到前一行 e

    def test_input_not_mutated_and_fields_kept(self):
        anns = [{"side": "old", "line": 0, "id": "k"}]
        out = relocate(anns, self.result)
        self.assertNotIn("status", anns[0])     # 原对象不被修改
        self.assertEqual(out[0]["id"], "k")     # 原字段保留

    def test_invalid_annotation(self):
        with self.assertRaises(ValueError):
            relocate([{"side": "old", "line": 99, "id": "x"}], self.result)
        with self.assertRaises(ValueError):
            relocate([{"side": "up", "line": 0, "id": "x"}], self.result)
        with self.assertRaises(ValueError):
            relocate([{"side": "old", "id": "x"}], self.result)


class SerializationTest(unittest.TestCase):
    def test_round_trip(self):
        old = ["a", "b", "c", "b", "d"]
        new = ["b", "c", "b", "e"]
        result = align(old, new)
        data = to_dict(result)
        self.assertEqual(from_dict(data), result)
        # 模拟 JSON 往返（list 结构不变、元组变列表也要接受）
        import json
        self.assertEqual(from_dict(json.loads(json.dumps(data))), result)

    def test_to_dict_stable(self):
        result = align(["x", "y"], ["y", "x"])
        self.assertEqual(to_dict(result), to_dict(list(result)))

    def test_from_dict_rejects_bad_structure(self):
        bad_cases = [
            "not a dict",                                  # 整体不是字典
            {"pairs": "nope"},                             # pairs 不是列表
            {"pairs": [[0, 0], [0, 1]]},                   # old 行号重复
            {"pairs": [[0, 0], [2, 1], [1, 2]]},           # old 非单调
            {"pairs": [[0, 1], [1, 1]]},                   # new 行号重复
            {"pairs": [[0, 0], [1, 0]]},                   # new 非单调
            {"pairs": [[None, None]]},                     # 两侧都为 None
            {"pairs": [[0, 0, 0]]},                        # 记录形状错误
            {"pairs": [[-1, 0]]},                          # 负行号
            {"pairs": [["0", 0]]},                         # 行号类型错误
        ]
        for data in bad_cases:
            with self.assertRaises(ValueError, msg="未拒绝: %r" % (data,)):
                from_dict(data)

    def test_from_dict_error_names_record(self):
        try:
            from_dict({"pairs": [[0, 0], [5, 1], [2, 2]]})
        except ValueError as exc:
            self.assertIn("2", str(exc))          # 指出是第 2 条记录
            self.assertIn("[2, 2]", str(exc))     # 带上坏记录内容
        else:
            self.fail("应当抛出 ValueError")


class PerformanceTest(unittest.TestCase):
    def test_20k_lines_5pct_diff_under_2s(self):
        n = 20000
        old = ["def fn_%d(): pass" % i for i in range(n)]
        new = list(old)
        # 5% 的行被替换（分散分布）
        for i in range(0, n, 20):
            new[i] = "def changed_%d(): return %d" % (i, i)
        start = time.perf_counter()
        result = align(old, new)
        elapsed = time.perf_counter() - start
        assert_alignment_valid(self, result, old, new)
        self.assertLess(elapsed, 2.0,
                        "对齐耗时 %.3fs，超过 2s 上限" % elapsed)

    def test_20k_lines_contiguous_block_replaced_under_2s(self):
        # 差异集中成一整段（1000 行被整体替换）是 O(ND) 的最坏形态之一
        n = 20000
        old = ["def fn_%d(): pass" % i for i in range(n)]
        new = old[:9500] + ["brand_new_%d" % i for i in range(1000)] + old[10500:]
        start = time.perf_counter()
        result = align(old, new)
        elapsed = time.perf_counter() - start
        assert_alignment_valid(self, result, old, new)
        self.assertLess(elapsed, 2.0,
                        "对齐耗时 %.3fs，超过 2s 上限" % elapsed)


class FuzzTest(unittest.TestCase):
    """固定种子的随机用例：与朴素 DP 交叉验证 LCS 长度与结果合法性。"""

    def test_random_small_inputs(self):
        rng = random.Random(20260913)
        alphabet = ["a", "b", "c", "d"]       # 小字母表，制造大量重复行
        for _ in range(300):
            old = [rng.choice(alphabet) for _ in range(rng.randrange(0, 25))]
            new = [rng.choice(alphabet) for _ in range(rng.randrange(0, 25))]
            result = align(old, new)
            assert_alignment_valid(self, result, old, new)
            matched = sum(1 for o, n in result
                          if o is not None and n is not None)
            self.assertEqual(matched, dp_lcs_len(old, new),
                             "匹配数不等于 LCS 长度: %r vs %r" % (old, new))
            # 序列化往返一致
            self.assertEqual(from_dict(to_dict(result)), result)
            # 同一输入重复调用结果一致
            self.assertEqual(align(old, new), result)


if __name__ == "__main__":
    unittest.main()
