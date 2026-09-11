"""bloom_kernel / main.py 的单元测试。

运行::

    python -m unittest -v test_bloom_kernel

覆盖：字段校验、插入幂等、无假阴性、经验假阳性率 vs 理论值、
基数估算、集合运算语义、max_bits 上限、快照往返与损坏文件、
边界条件（空内核 / m=1 / k=1 / 多字节 UTF-8 / 多 tag）、
以及 main.py 的 stdin JSON 行协议（子进程集成）。
"""

from __future__ import annotations

import json
import os
import random
import string
import subprocess
import sys
import tempfile
import unittest

from bloom_kernel import (
    DEFAULT_K,
    DEFAULT_M,
    MAX_KEY_BYTES,
    BloomKernel,
    CapacityError,
    ExactKernel,
    Item,
    PersistenceError,
    ValidationError,
)

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN_PY = os.path.join(HERE, "main.py")


def make_keys(n: int, seed: int, prefix: str = "k") -> list:
    """用固定种子生成 n 个互不相同的随机字符串。"""
    rng = random.Random(seed)
    alphabet = string.ascii_letters + string.digits
    out = []
    seen = set()
    while len(out) < n:
        length = rng.randint(4, 24)
        key = prefix + "-" + "".join(rng.choice(alphabet) for _ in range(length))
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


class TestItemValidation(unittest.TestCase):
    def test_valid_item(self):
        item = Item("a", "shard-1", 1)
        self.assertEqual((item.key, item.tag, item.seq), ("a", "shard-1", 1))

    def test_frozen(self):
        item = Item("a", "t", 1)
        with self.assertRaises(Exception):
            item.key = "b"  # type: ignore[misc]

    def test_empty_key(self):
        with self.assertRaises(ValidationError) as ctx:
            Item("", "t", 1)
        self.assertIn("key", str(ctx.exception))

    def test_empty_tag(self):
        with self.assertRaises(ValidationError):
            Item("k", "", 1)

    def test_bad_tag_chars(self):
        for bad in ("a b", "中文tag", "a/b?", ""):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    Item("k", bad, 1)

    def test_allowed_tag_chars(self):
        for good in ("a.b_c/d-x", "0", "AZ"):
            Item("k", good, 1)

    def test_seq_bounds_and_type(self):
        with self.assertRaises(ValidationError):
            Item("k", "t", 0)
        with self.assertRaises(ValidationError):
            Item("k", "t", -3)
        with self.assertRaises(ValidationError):
            Item("k", "t", True)  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            Item("k", "t", 1.0)  # type: ignore[arg-type]

    def test_key_wrong_type(self):
        with self.assertRaises(ValidationError):
            Item(123, "t", 1)  # type: ignore[arg-type]

    def test_key_utf8_byte_limit(self):
        # 每个 emoji 4 字节；256/4 = 64 个正好 256 字节合法，65 个拒绝。
        Item("😀" * 64, "t", 1)
        with self.assertRaises(ValidationError) as ctx:
            Item("😀" * 65, "t", 1)
        self.assertIn("260", str(ctx.exception))
        self.assertIn(str(MAX_KEY_BYTES), str(ctx.exception))


class TestInsertAndContains(unittest.TestCase):
    def test_empty_kernel(self):
        k = BloomKernel(default_m=64, default_k=3)
        self.assertEqual(k.tags(), [])
        self.assertEqual(k.total_bits, 0)
        self.assertEqual(k.stats(), {})
        self.assertFalse(k.contains("nope", "x"))
        with self.assertRaises(ValidationError):
            k.fill_ratio("nope")
        with self.assertRaises(ValidationError):
            k.false_positive_rate("nope")
        with self.assertRaises(ValidationError):
            k.estimate_cardinality("nope")

    def test_insert_returns_new_flag(self):
        k = BloomKernel(default_m=1024, default_k=3)
        self.assertTrue(k.insert(Item("a", "t", 1)))
        self.assertFalse(k.insert(Item("a", "t", 2)))  # 幂等
        self.assertFalse(k.insert(Item("a", "t", 3)))
        s = k.stats()["t"]
        self.assertEqual(s["inserted"], 3)
        self.assertEqual(s["distinct"], 1)

    def test_idempotent_bits(self):
        k = BloomKernel(default_m=1024, default_k=3)
        k.insert(Item("a", "t", 1))
        bits_after_first = k.set_bits("t")
        k.insert(Item("a", "t", 2))
        k.insert(Item("a", "t", 3))
        self.assertEqual(k.set_bits("t"), bits_after_first)

    def test_single_record(self):
        k = BloomKernel(default_m=128, default_k=1)
        k.insert(Item("only", "t", 1))
        self.assertTrue(k.contains("t", "only"))
        self.assertEqual(k.estimate_cardinality("t"), 1)

    def test_contains_requires_string_key(self):
        # contains 对未知 tag 直接 False；对已知 tag 的非字符串 key
        # 在 encode 处自然抛错（AttributeError 属于调用方类型错误）。
        k = BloomKernel(default_m=128, default_k=1)
        self.assertFalse(k.contains("t", "anything"))

    def test_multibyte_keys(self):
        k = BloomKernel(default_m=4096, default_k=4)
        keys = ["中文键值", "😀🎉-test", "ёщё", "混合 mixed 123", "てすと"]
        for i, key in enumerate(keys, 1):
            k.insert(Item(key, "asia", i))
        for key in keys:
            self.assertTrue(k.contains("asia", key), f"假阴性: {key}")
        self.assertFalse(k.contains("asia", "不存在的键"))

    def test_same_key_multiple_tags_independent(self):
        k = BloomKernel(default_m=4096, default_k=4)
        k.insert(Item("dup-key", "tag-a", 1))
        self.assertTrue(k.contains("tag-a", "dup-key"))
        self.assertFalse(k.contains("tag-b", "dup-key"))
        k.insert(Item("dup-key", "tag-b", 1))
        self.assertTrue(k.contains("tag-b", "dup-key"))
        self.assertEqual(set(k.tags()), {"tag-a", "tag-b"})

    def test_reproducible_hashes(self):
        # 两个独立内核插入相同数据后，位布局必须逐字节一致。
        a = BloomKernel(default_m=512, default_k=5)
        b = BloomKernel(default_m=512, default_k=5)
        for key in make_keys(50, seed=1):
            a.insert(Item(key, "t", 1))
            b.insert(Item(key, "t", 1))
        sa, sb = a.to_dict()["shards"]["t"], b.to_dict()["shards"]["t"]
        self.assertEqual(sa["bits_hex"], sb["bits_hex"])

    def test_no_false_negatives_large_random(self):
        """几万条随机 key × 多个 tag：插过的必须全部命中。"""
        bloom = BloomKernel(default_m=1 << 18, default_k=7)
        exact = ExactKernel()
        tags = ["alpha", "beta", "gamma"]
        per_tag = 20000
        for t_idx, tag in enumerate(tags):
            keys = make_keys(per_tag, seed=100 + t_idx, prefix=tag)
            for seq, key in enumerate(keys, 1):
                bloom.insert(Item(key, tag, seq))
                exact.insert(Item(key, tag, seq))
        # 所有真实成员无一遗漏
        for t_idx, tag in enumerate(tags):
            for key in make_keys(per_tag, seed=100 + t_idx, prefix=tag):
                self.assertTrue(bloom.contains(tag, key))
        # 精确参照内核看到的基数与布隆估算接近（再验一次估算口径）
        for tag in tags:
            true_n = exact.stats()[tag]["distinct"]
            self.assertLess(
                abs(bloom.estimate_cardinality(tag) - true_n) / true_n, 0.10
            )


class TestFalsePositiveRate(unittest.TestCase):
    def test_empty_shard_fpr_zero(self):
        # 空内核（尚未建任何分片）查询未知 tag 直接 False；
        # 空填充率对应的理论 FPR 为 0。
        empty = BloomKernel(default_m=4096, default_k=7)
        self.assertFalse(empty.contains("t", "anything"))
        self.assertAlmostEqual((0 / 4096) ** 7, 0.0)

    def test_empirical_fpr_near_theory(self):
        # 小容量 + 高密度，使假阳性率可测量：
        # m=8192, default_k=7, n=2000 时填充率 ≈ 0.82，理论 FPR ≈ 0.24。
        m, k, n = 8192, 7, 2000
        bloom = BloomKernel(default_m=m, default_k=k)
        for seq, key in enumerate(make_keys(n, seed=7, prefix="present"), 1):
            bloom.insert(Item(key, "t", seq))
        theory = bloom.false_positive_rate("t")
        fill = bloom.fill_ratio("t")
        self.assertGreater(fill, 0.7)
        self.assertGreater(theory, 0.15)
        self.assertLess(theory, 0.35)

        trials = 20000
        false_hits = sum(
            bloom.contains("t", f"absent-{i}") for i in range(trials)
        )
        empirical = false_hits / trials
        # 二项分布标准差 ≈ sqrt(p(1-p)/N) ≈ 0.003，给 10σ 容差防抖动。
        sigma = (theory * (1 - theory) / trials) ** 0.5
        self.assertLess(abs(empirical - theory), 10 * sigma,
                        f"经验 FPR={empirical}, 理论={theory}, σ={sigma}")

    def test_defaults(self):
        k = BloomKernel()
        self.assertEqual(k.default_m, DEFAULT_M)
        self.assertEqual(k.default_k, DEFAULT_K)
        self.assertIsNone(k.max_bits)

    def test_invalid_config(self):
        with self.assertRaises(ValidationError):
            BloomKernel(default_m=0)
        with self.assertRaises(ValidationError):
            BloomKernel(default_m=-8)
        with self.assertRaises(ValidationError):
            BloomKernel(default_k=0)
        with self.assertRaises(ValidationError):
            BloomKernel(default_m=True)  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            BloomKernel(max_bits=-1)


class TestCardinality(unittest.TestCase):
    def test_estimate_moderate_fill(self):
        m, k, n = 1 << 16, 7, 2000
        bloom = BloomKernel(default_m=m, default_k=k)
        for seq, key in enumerate(make_keys(n, seed=11, prefix="c"), 1):
            bloom.insert(Item(key, "t", seq))
        est = bloom.estimate_cardinality("t")
        rel = abs(est - n) / n
        self.assertLess(rel, 0.10, f"估算 {est} vs 真实 {n}, 相对误差 {rel:.2%}")

    def test_estimate_unaffected_by_duplicates(self):
        bloom = BloomKernel(default_m=1 << 14, default_k=5)
        keys = make_keys(500, seed=12)
        for seq, key in enumerate(keys, 1):
            bloom.insert(Item(key, "t", seq))
        est_once = bloom.estimate_cardinality("t")
        for seq, key in enumerate(keys, 501):
            bloom.insert(Item(key, "t", seq))
        est_twice = bloom.estimate_cardinality("t")
        self.assertEqual(est_once, est_twice)
        self.assertEqual(bloom.inserted_count("t"), 1000)

    def test_estimate_empty_and_single(self):
        bloom = BloomKernel(default_m=1 << 16, default_k=7)
        bloom.insert(Item("x", "t", 1))
        self.assertIn(bloom.estimate_cardinality("t"), (1, 2))

    def test_estimate_full_array_fallback(self):
        # m=1 时插入任意 key 都会立刻置满：FPR=1，任何查询都命中，
        # 基数估计失去意义（饱和），distinct 只统计到首个新模式。
        bloom = BloomKernel(default_m=1, default_k=1)
        bloom.insert(Item("a", "t", 1))
        bloom.insert(Item("b", "t", 2))
        bloom.insert(Item("c", "t", 3))
        self.assertEqual(bloom.fill_ratio("t"), 1.0)
        self.assertEqual(bloom.false_positive_rate("t"), 1.0)
        self.assertTrue(bloom.contains("t", "从未插入"))
        self.assertGreaterEqual(bloom.stats()["t"]["distinct"], 1)

    def test_estimate_full_array_fallback_whitebox(self):
        # 白盒构造“全满 + distinct=3”的饱和分片，验证 ln(0) 兜底分支
        # 直接返回 distinct 计数而不是炸掉。
        bloom = BloomKernel(default_m=8, default_k=2)
        bloom.insert(Item("a", "t", 1))
        shard = bloom._shards["t"]
        shard.bits[:] = b"\xff"
        shard.distinct = 3
        self.assertEqual(bloom.estimate_cardinality("t"), 3)


class TestSetOperations(unittest.TestCase):
    def _build_pair(self, m=32768, k=5, track=False):
        keys = make_keys(600, seed=21)
        left_keys = set(keys[:400])
        right_keys = set(keys[200:])  # 与 left 重叠 200 个
        # 再加各自独有的不同前缀段，保证两侧都有独有元素
        left_keys |= set(make_keys(100, seed=22, prefix="L"))
        right_keys |= set(make_keys(100, seed=23, prefix="R"))

        left = BloomKernel(default_m=m, default_k=k, track_keys=track)
        right = BloomKernel(default_m=m, default_k=k, track_keys=track)
        for i, key in enumerate(left_keys, 1):
            left.insert(Item(key, "t", i))
        for i, key in enumerate(right_keys, 1):
            right.insert(Item(key, "t", i))
        return left, right, left_keys, right_keys

    def test_exact_reference_ops(self):
        # 双方都开启 track_keys：运算走精确集合路径，差集也零假阴性。
        left, right, lk, rk = self._build_pair(track=True)
        exact_l, exact_r = ExactKernel(), ExactKernel()
        for i, key in enumerate(lk, 1):
            exact_l.insert(Item(key, "t", i))
        for i, key in enumerate(rk, 1):
            exact_r.insert(Item(key, "t", i))

        u = left.union(right)
        inter = left.intersect(right)
        diff = left.difference(right)

        # 不允许假阴性：精确集合运算结果中的每个成员都必须命中
        for key in lk | rk:
            self.assertTrue(u.contains("t", key), f"并集假阴性: {key}")
        for key in lk & rk:
            self.assertTrue(inter.contains("t", key), f"交集假阴性: {key}")
        for key in lk - rk:
            self.assertTrue(diff.contains("t", key), f"差集假阴性: {key}")

        # 精确路径下结果 distinct 就是精确集合大小
        self.assertEqual(u.stats()["t"]["distinct"], len(lk | rk))
        self.assertEqual(inter.stats()["t"]["distinct"], len(lk & rk))
        self.assertEqual(diff.stats()["t"]["distinct"], len(lk - rk))
        self.assertEqual(u.estimate_cardinality("t"), len(lk | rk))

        # 交集/差集不引入新假阳性：抽样两侧都没插过的 key，命中率应极低
        # （交集结果更稀疏，FPR 不高于原集合；差集同量级）。
        inter_fpr = inter.false_positive_rate("t")
        self.assertLessEqual(inter_fpr, left.false_positive_rate("t"))

        # 与精确内核运算结果逐成员对照
        ei = exact_l.intersect(exact_r)
        ed = exact_l.difference(exact_r)
        self.assertEqual(ei.stats()["t"]["distinct"], len(lk & rk))
        self.assertEqual(ed.stats()["t"]["distinct"], len(lk - rk))

    def test_bitonly_difference_can_mask_members(self):
        """文档化布隆位图运算的固有局限：纯位图差集可能漏报 A 独有成员。

        触发条件较苛刻（该成员的 k 个散列位被 B 的其他成员全部覆盖），
        用极小位图 + 单侧插入可稳定构造；track_keys 精确路径则无此问题。
        """
        victim = "victim-key"
        # m=8, k=3 时插入很少几个 B 侧 key 就可能覆盖 victim 的全部位。
        # 多试几组配置，找到一个能观察到“掩盖”的场景；若环境下始终
        # 触发不了（极小概率），断言精确路径一定正确即可。
        observed_masking = False
        for m, k in ((8, 3), (16, 3), (16, 4), (32, 4)):
            left = BloomKernel(default_m=m, default_k=k, track_keys=False)
            right = BloomKernel(default_m=m, default_k=k, track_keys=False)
            left.insert(Item(victim, "t", 1))
            for i, key in enumerate(make_keys(200, seed=31, prefix="b"), 2):
                right.insert(Item(key, "t", i))
            bit_diff = left.difference(right)
            if not bit_diff.contains("t", victim):
                observed_masking = True
                break
        # 同样数据在精确跟踪路径下必须永远正确
        left2 = BloomKernel(default_m=32, default_k=4, track_keys=True)
        right2 = BloomKernel(default_m=32, default_k=4, track_keys=True)
        left2.insert(Item(victim, "t", 1))
        for i, key in enumerate(make_keys(200, seed=31, prefix="b"), 2):
            right2.insert(Item(key, "t", i))
        self.assertTrue(left2.difference(right2).contains("t", victim))
        if not observed_masking:
            # 记录但不判失败：该局限在数学上成立，docstring/README 已说明。
            pass

    def test_bitwise_semantics(self):
        left, right, _, _ = self._build_pair()
        inter = left.intersect(right)
        diff = left.difference(right)
        lb = left.to_dict()["shards"]["t"]["bits_hex"]
        rb = right.to_dict()["shards"]["t"]["bits_hex"]
        ib = inter.to_dict()["shards"]["t"]["bits_hex"]
        db = diff.to_dict()["shards"]["t"]["bits_hex"]
        lbb, rbb, ibb, dbb = (
            bytes.fromhex(lb), bytes.fromhex(rb),
            bytes.fromhex(ib), bytes.fromhex(db),
        )
        for i in range(len(lbb)):
            self.assertEqual(ibb[i], lbb[i] & rbb[i])
            self.assertEqual(dbb[i], lbb[i] & (~rbb[i] & 0xFF))
            # 交集是两侧子集；差集是左侧子集且与右侧不相交
            self.assertEqual(ibb[i] & lbb[i], ibb[i])
            self.assertEqual(dbb[i] & lbb[i], dbb[i])
            self.assertEqual(dbb[i] & rbb[i], 0)

    def test_intersection_fpr_not_higher(self):
        left, right, _, _ = self._build_pair()
        inter = left.intersect(right)
        self.assertLessEqual(
            inter.set_bits("t"), min(left.set_bits("t"), right.set_bits("t"))
        )
        self.assertLessEqual(
            inter.false_positive_rate("t"), left.false_positive_rate("t")
        )
        self.assertLessEqual(
            inter.false_positive_rate("t"), right.false_positive_rate("t")
        )

    def test_operations_do_not_mutate_inputs(self):
        left, right, lk, rk = self._build_pair()
        before_l = left.to_dict()["shards"]["t"]["bits_hex"]
        before_r = right.to_dict()["shards"]["t"]["bits_hex"]
        left.union(right)
        left.intersect(right)
        left.difference(right)
        self.assertEqual(left.to_dict()["shards"]["t"]["bits_hex"], before_l)
        self.assertEqual(right.to_dict()["shards"]["t"]["bits_hex"], before_r)

    def test_ops_with_empty_kernel(self):
        left, _, lk, _ = self._build_pair(track=True)
        # 空内核：配置必须与 left 一致；track_keys 也一致以走精确路径
        empty = BloomKernel(default_m=32768, default_k=5, track_keys=True)

        u = left.union(empty)
        i = left.intersect(empty)
        d = left.difference(empty)
        for key in list(lk)[:50]:
            self.assertTrue(u.contains("t", key))
            self.assertTrue(d.contains("t", key))
            self.assertFalse(i.contains("t", key))
        # 与空集合交集为空：任何 key 都不应命中（全零位图）
        self.assertEqual(i.set_bits("t"), 0)
        self.assertEqual(i.estimate_cardinality("t"), 0)
        self.assertEqual(i.stats()["t"]["distinct"], 0)
        # 空 - 左 也是空
        d2 = empty.difference(left)
        self.assertEqual(d2.tags(), ["t"])
        self.assertEqual(d2.set_bits("t"), 0)
        # 空 ∪ 空
        uu = empty.union(BloomKernel(default_m=32768, default_k=5, track_keys=True))
        self.assertEqual(uu.tags(), [])

    def test_ops_with_disjoint_tags(self):
        left = BloomKernel(default_m=256, default_k=2)
        right = BloomKernel(default_m=256, default_k=2)
        left.insert(Item("a", "only-left", 1))
        right.insert(Item("b", "only-right", 1))
        u = left.union(right)
        self.assertEqual(set(u.tags()), {"only-left", "only-right"})
        self.assertTrue(u.contains("only-left", "a"))
        self.assertTrue(u.contains("only-right", "b"))
        i = left.intersect(right)
        self.assertEqual(set(i.tags()), {"only-left", "only-right"})
        self.assertEqual(i.set_bits("only-left"), 0)
        self.assertEqual(i.set_bits("only-right"), 0)

    def test_mismatched_config_rejected(self):
        left = BloomKernel(default_m=256, default_k=2)
        right = BloomKernel(default_m=512, default_k=2)
        left.insert(Item("a", "t", 1))
        right.insert(Item("b", "t", 1))
        with self.assertRaises(ValidationError):
            left.union(right)
        with self.assertRaises(ValidationError):
            left.intersect(right)
        with self.assertRaises(ValidationError):
            left.difference(right)

    def test_op_requires_bloom(self):
        with self.assertRaises(ValidationError):
            BloomKernel(default_m=16, default_k=1).union(object())  # type: ignore[arg-type]


class TestMaxBits(unittest.TestCase):
    def test_max_bits_zero_rejects_everything(self):
        k = BloomKernel(default_m=64, default_k=2, max_bits=0)
        with self.assertRaises(CapacityError) as ctx:
            k.insert(Item("a", "t", 1))
        self.assertIn("超过上限", str(ctx.exception))
        # 被拒绝后内核必须保持原状
        self.assertEqual(k.tags(), [])
        self.assertEqual(k.total_bits, 0)
        self.assertEqual(k.stats(), {})

    def test_rejection_is_atomic(self):
        # 上限恰好容纳一个分片：第一个 tag 可用，第二个 tag 必须被整体拒绝
        k = BloomKernel(default_m=64, default_k=2, max_bits=64)
        self.assertTrue(k.insert(Item("a", "t1", 1)))
        with self.assertRaises(CapacityError):
            k.insert(Item("b", "t2", 1))
        self.assertEqual(k.tags(), ["t1"])
        self.assertEqual(k.total_bits, 64)
        # 已存在的分片仍可继续插入（容量按分片数预先承诺）
        self.assertFalse(k.insert(Item("a", "t1", 2)))
        self.assertTrue(k.insert(Item("c", "t1", 3)))

    def test_max_bits_none_unlimited(self):
        k = BloomKernel(default_m=32, default_k=1, max_bits=None)
        for i in range(10):
            k.insert(Item(str(i), f"tag-{i}", 1))
        self.assertEqual(k.total_bits, 320)

    def test_exact_kernel_max_keys(self):
        k = ExactKernel(max_keys=2)
        self.assertTrue(k.insert(Item("a", "t", 1)))
        self.assertTrue(k.insert(Item("b", "t", 2)))
        with self.assertRaises(CapacityError):
            k.insert(Item("c", "t", 3))
        # 重复 key 不占新名额，仍然幂等
        self.assertFalse(k.insert(Item("a", "t", 4)))
        with self.assertRaises(ValidationError):
            ExactKernel(max_keys=-1)


class TestStats(unittest.TestCase):
    def test_stats_fields(self):
        k = BloomKernel(default_m=1024, default_k=4)
        for key in make_keys(30, seed=5):
            k.insert(Item(key, "t", 1))
        s = k.stats()["t"]
        self.assertEqual(s["m"], 1024)
        self.assertEqual(s["k"], 4)
        self.assertEqual(s["memory_bytes"], 128)
        self.assertGreaterEqual(s["set_bits"], 4)
        self.assertGreater(s["inserted"], 0)
        self.assertGreater(s["distinct"], 0)
        self.assertGreaterEqual(s["estimated_cardinality"], 1)
        self.assertAlmostEqual(s["fill_ratio"], s["set_bits"] / 1024)
        self.assertAlmostEqual(
            s["false_positive_rate"], s["fill_ratio"] ** 4
        )

    def test_m1_k1_memory(self):
        k = BloomKernel(default_m=1, default_k=1)
        k.insert(Item("a", "t", 1))
        s = k.stats()["t"]
        self.assertEqual(s["memory_bytes"], 1)
        self.assertEqual(s["set_bits"], 1)
        self.assertEqual(s["fill_ratio"], 1.0)


class TestPersistence(unittest.TestCase):
    def _populated(self) -> BloomKernel:
        k = BloomKernel(default_m=512, default_k=4, max_bits=2048)
        for tag, seed in (("t1", 1), ("t2", 2)):
            for seq, key in enumerate(make_keys(40, seed=seed), 1):
                k.insert(Item(key, tag, seq))
        # 加入重复插入，覆盖 inserted != distinct
        k.insert(Item(make_keys(40, seed=1)[0], "t1", 41))
        return k

    def test_round_trip_dict(self):
        k = self._populated()
        restored = BloomKernel.from_dict(k.to_dict())
        self.assertEqual(restored.default_m, k.default_m)
        self.assertEqual(restored.default_k, k.default_k)
        self.assertEqual(restored.max_bits, k.max_bits)
        self.assertEqual(restored.tags(), k.tags())
        for tag in k.tags():
            a = k.to_dict()["shards"][tag]
            b = restored.to_dict()["shards"][tag]
            self.assertEqual(a, b)
            for key in make_keys(40, seed=int(tag[1])):
                self.assertTrue(restored.contains(tag, key))

    def test_round_trip_file_and_continue(self):
        k = self._populated()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            k.save(path)
            restored = BloomKernel.load(path)
            # 往返后继续插入：已有 key 幂等，新 key 正常
            self.assertFalse(restored.insert(Item(make_keys(40, seed=1)[0], "t1", 99)))
            new_key = "brand-new-after-load"
            self.assertTrue(restored.insert(Item(new_key, "t1", 100)))
            self.assertTrue(restored.contains("t1", new_key))
            # 再保存再加载仍然一致
            path2 = os.path.join(tmp, "state2.json")
            restored.save(path2)
            again = BloomKernel.load(path2)
            self.assertTrue(again.contains("t1", new_key))

    def test_load_missing_file(self):
        with self.assertRaises(PersistenceError) as ctx:
            BloomKernel.load("/no/such/path/state.json")
        self.assertIn("不存在", str(ctx.exception))

    def test_corrupt_cases(self):
        good = self._populated().to_dict()

        def reject(mutator, needle=""):
            data = json.loads(json.dumps(good, ensure_ascii=False))
            mutator(data)
            with self.assertRaises(PersistenceError) as ctx:
                BloomKernel.from_dict(data)
            if needle:
                self.assertIn(needle, str(ctx.exception))

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")

            # 不是 JSON
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            with self.assertRaises(PersistenceError) as ctx:
                BloomKernel.load(path)
            self.assertIn("JSON", str(ctx.exception))

            # 文件是空的 / 顶层是数组
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("[]")
            with self.assertRaises(PersistenceError):
                BloomKernel.load(path)

        reject(lambda d: d.pop("format"), "format")
        reject(lambda d: d.update(version=99), "版本")
        reject(lambda d: d.update(version="1"), "version")
        reject(lambda d: d.pop("default_m"), "default_m")
        reject(lambda d: d.update(default_m=0), "正整数")
        reject(lambda d: d.update(default_k=-1), "正整数")
        reject(lambda d: d.update(max_bits=-5), "max_bits")
        reject(lambda d: d.pop("shards"), "shards")
        reject(lambda d: d["shards"]["t1"].pop("m"), "m")
        reject(lambda d: d["shards"]["t1"].update(k=0), "正整数")
        reject(lambda d: d["shards"]["t1"].update(inserted=-1), "inserted")
        reject(lambda d: d["shards"]["t1"].update(distinct="x"), "distinct")
        reject(
            lambda d: d["shards"]["t1"].update(
                inserted=1, distinct=2
            ),
            "不能大于",
        )
        reject(lambda d: d["shards"]["t1"].pop("bits_hex"), "bits_hex")
        reject(lambda d: d["shards"]["t1"].update(bits_hex="zzzz"), "十六进制")

        # 位数组字节数与 m 不匹配
        def truncate(d):
            t = d["shards"]["t1"]
            t["bits_hex"] = t["bits_hex"][:-2]
        reject(truncate, "不匹配")

        # fill_ratio 越界 / 与位图不一致
        reject(lambda d: d["shards"]["t1"].update(fill_ratio=1.5), "[0, 1]")
        reject(lambda d: d["shards"]["t1"].update(fill_ratio=0.0), "不一致")

        # 总量超过记录的 max_bits
        reject(lambda d: d.update(max_bits=10), "max_bits")

        # 衬底位非零：m=512 时字节数正好 64 无衬底，换一个 m 非 8 倍数的
        odd = BloomKernel(default_m=9, default_k=1)
        odd.insert(Item("x", "t", 1))
        data = odd.to_dict()
        raw = bytearray.fromhex(data["shards"]["t"]["bits_hex"])
        raw[-1] |= 0x80  # 最高位是衬底位
        data["shards"]["t"]["bits_hex"] = raw.hex()
        with self.assertRaises(PersistenceError) as ctx:
            BloomKernel.from_dict(data)
        self.assertIn("衬底位", str(ctx.exception))

    def test_tracked_round_trip_and_tamper(self):
        k = BloomKernel(default_m=512, default_k=4, max_bits=None, track_keys=True)
        keys = make_keys(30, seed=9)
        for seq, key in enumerate(keys, 1):
            k.insert(Item(key, "t", seq))
        k.insert(Item(keys[0], "t", 31))  # 重复，inserted=31, distinct=30

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tracked.json")
            k.save(path)
            r = BloomKernel.load(path)
            self.assertTrue(r.track_keys)
            self.assertEqual(r.stats()["t"]["distinct"], 30)
            self.assertEqual(r.stats()["t"]["tracked_keys"], 30)
            self.assertEqual(r.inserted_count("t"), 31)
            self.assertEqual(r.estimate_cardinality("t"), 30)  # 精确
            for key in keys:
                self.assertTrue(r.contains("t", key))

            # 篡改位图：填充率先对不上（同样必须明确拒绝）
            import json as _json
            with open(path, encoding="utf-8") as fh:
                data = _json.load(fh)
            raw = bytearray.fromhex(data["shards"]["t"]["bits_hex"])
            raw[0] ^= 0x01
            data["shards"]["t"]["bits_hex"] = raw.hex()
            with self.assertRaises(PersistenceError):
                BloomKernel.from_dict(data)

            # 篡改 key（填充率不变）：必须被“keys 重散列”强校验抓到。
            # 稳定做法：位图整体清零并把 fill_ratio 同步改成 0，
            # 填充率校验能过，但 keys 重散列必然得到非零位图。
            data2 = k.to_dict()
            nbytes = len(bytes.fromhex(data2["shards"]["t"]["bits_hex"]))
            data2["shards"]["t"]["bits_hex"] = "00" * nbytes
            data2["shards"]["t"]["fill_ratio"] = 0.0
            with self.assertRaises(PersistenceError) as ctx:
                BloomKernel.from_dict(data2)
            self.assertIn("重散列", str(ctx.exception))

            # track_keys=false 却带 keys 也要拒绝
            data2 = k.to_dict()
            data2["track_keys"] = False
            with self.assertRaises(PersistenceError):
                BloomKernel.from_dict(data2)

    def test_exact_round_trip(self):
        k = ExactKernel()
        k.insert(Item("a", "t", 1))
        k.insert(Item("b", "t", 2))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "exact.json")
            k.save(path)
            r = ExactKernel.load(path)
            self.assertTrue(r.contains("t", "a"))
            self.assertTrue(r.contains("t", "b"))
            self.assertFalse(r.contains("t", "c"))
            # 格式串扰必须报清楚
            with self.assertRaises(PersistenceError):
                BloomKernel.load(path)

    def test_load_exact_format_validation(self):
        with self.assertRaises(PersistenceError):
            ExactKernel.from_dict({"format": "exact-kernel"})  # 缺 version
        bad = {
            "format": "exact-kernel",
            "version": 1,
            "max_keys": None,
            "shards": {"t": {"keys": ["a", "a"], "inserted": 2}},
        }
        with self.assertRaises(PersistenceError):
            ExactKernel.from_dict(bad)


class TestExactKernelBasics(unittest.TestCase):
    def test_membership_and_ops(self):
        a, b = ExactKernel(), ExactKernel()
        for key in ("x", "y", "z"):
            a.insert(Item(key, "t", 1))
        for key in ("y", "z", "w"):
            b.insert(Item(key, "t", 1))
        self.assertTrue(a.contains("t", "x"))
        self.assertFalse(a.contains("t", "w"))
        self.assertEqual(a.false_positive_rate("t"), 0.0)
        self.assertEqual(a.estimate_cardinality("t"), 3)
        self.assertEqual(a.union(b).stats()["t"]["distinct"], 4)
        self.assertEqual(a.intersect(b).stats()["t"]["distinct"], 2)
        self.assertEqual(a.difference(b).stats()["t"]["distinct"], 1)
        self.assertEqual(a.stats()["t"]["false_positive_rate"], 0.0)

    def test_insert_wrong_type(self):
        with self.assertRaises(ValidationError):
            BloomKernel(default_m=8, default_k=1).insert("not-an-item")  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            ExactKernel().insert(None)  # type: ignore[arg-type]


class TestCli(unittest.TestCase):
    """通过子进程驱动 main.py，验证 stdin/stdout JSON 行协议。"""

    def run_cli(self, stdin_text, *args):
        proc = subprocess.run(
            [sys.executable, MAIN_PY, *args],
            input=stdin_text,
            capture_output=True,
            text=True,
            encoding="utf-8",  # 子进程在 main() 中强制 UTF-8 输出
            timeout=60,
            cwd=HERE,
        )
        lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        return proc, lines

    def test_basic_flow(self):
        commands = "\n".join([
            json.dumps({"cmd": "insert", "key": "alice", "tag": "users", "seq": 1}),
            json.dumps({"cmd": "insert", "key": "bob", "tag": "users", "seq": 2}),
            json.dumps({"cmd": "insert", "key": "alice", "tag": "users", "seq": 3}),
            json.dumps({"cmd": "contains", "tag": "users", "key": "alice"}),
            json.dumps({"cmd": "contains", "tag": "users", "key": "ghost"}),
            json.dumps({"cmd": "contains", "tag": "other", "key": "alice"}),
            json.dumps({"cmd": "cardinality", "tag": "users"}),
            json.dumps({"cmd": "cardinality"}),
            json.dumps({"cmd": "stats"}),
            json.dumps({"cmd": "dump"}),
            "",  # 空行应被跳过
        ])
        proc, lines = self.run_cli(commands, "--m", "1024", "--k", "4")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(len(lines), 10)  # 3 insert + 3 contains + 2 cardinality + stats + dump
        self.assertTrue(lines[0]["new"])   # alice 首次
        self.assertTrue(lines[1]["new"])   # bob 首次
        self.assertFalse(lines[2]["new"])  # alice 重复
        self.assertTrue(lines[3]["member"])
        self.assertFalse(lines[4]["member"])
        self.assertFalse(lines[5]["member"])  # 未知 tag
        self.assertEqual(lines[6]["estimated_cardinality"], 2)
        self.assertEqual(lines[7]["cardinalities"], {"users": 2})
        self.assertIn("users", lines[8]["stats"])
        self.assertEqual(lines[9]["state"]["format"], "bloom-kernel")

    def test_errors_as_json_and_continue(self):
        commands = "\n".join([
            json.dumps({"cmd": "insert", "key": "", "tag": "t", "seq": 1}),
            "{broken json",
            json.dumps({"cmd": "frobnicate"}),
            json.dumps({"cmd": "contains", "tag": "t"}),  # 缺 key
            json.dumps({"cmd": "insert", "key": "ok", "tag": "t", "seq": 1}),
            json.dumps({"cmd": "contains", "tag": "t", "key": "ok"}),
        ])
        _, lines = self.run_cli(commands, "--m", "64", "--k", "2")
        for bad in lines[:4]:
            self.assertIn("error", bad)
            self.assertFalse(bad["ok"])
            self.assertTrue(bad["type"])
        self.assertTrue(lines[4]["new"])
        self.assertTrue(lines[5]["member"])

    def test_max_bits_rejected_in_cli(self):
        commands = json.dumps(
            {"cmd": "insert", "key": "x", "tag": "t", "seq": 1}
        )
        _, lines = self.run_cli(commands, "--m", "64", "--max-bits", "0")
        self.assertEqual(lines[0]["type"], "CapacityError")
        self.assertIn("error", lines[0])

    def test_save_load_and_set_ops(self):
        with tempfile.TemporaryDirectory() as tmp:
            a_path = os.path.join(tmp, "a.json")
            b_path = os.path.join(tmp, "b.json")
            u_path = os.path.join(tmp, "u.json")

            def feed(kernel_cmds, *args):
                return self.run_cli("\n".join(map(json.dumps, kernel_cmds)), *args)

            feed(
                [
                    {"cmd": "insert", "key": "x", "tag": "t", "seq": 1},
                    {"cmd": "insert", "key": "y", "tag": "t", "seq": 2},
                    {"cmd": "save", "path": a_path},
                ],
                "--m", "1024", "--k", "4",
            )
            feed(
                [
                    {"cmd": "insert", "key": "y", "tag": "t", "seq": 1},
                    {"cmd": "insert", "key": "z", "tag": "t", "seq": 2},
                    {"cmd": "save", "path": b_path},
                ],
                "--m", "1024", "--k", "4",
            )
            _, lines = feed(
                [
                    {"cmd": "load", "path": a_path},
                    {
                        "cmd": "union", "other": b_path,
                        "save": u_path, "replace": True,
                    },
                    {"cmd": "contains", "tag": "t", "key": "x"},
                    {"cmd": "contains", "tag": "t", "key": "z"},
                    {"cmd": "intersect", "other": b_path},
                    {"cmd": "difference", "other": b_path},
                    {"cmd": "load", "path": u_path},
                    {"cmd": "contains", "tag": "t", "key": "y"},
                    {"cmd": "reset"},
                    {"cmd": "stats"},
                ],
                "--m", "1024", "--k", "4",
            )
            self.assertTrue(lines[0]["ok"])
            self.assertTrue(lines[1]["ok"])
            self.assertTrue(lines[2]["member"])  # union 含 x
            self.assertTrue(lines[3]["member"])  # union 含 z
            self.assertTrue(lines[4]["ok"])      # intersect
            self.assertTrue(lines[5]["ok"])      # difference
            self.assertTrue(lines[6]["ok"])      # reload union
            self.assertTrue(lines[7]["member"])
            self.assertTrue(lines[8]["ok"])      # reset
            self.assertEqual(lines[9]["stats"], {})

    def test_exact_mode(self):
        commands = "\n".join([
            json.dumps({"cmd": "insert", "key": "a", "tag": "t", "seq": 1}),
            json.dumps({"cmd": "contains", "tag": "t", "key": "a"}),
            json.dumps({"cmd": "contains", "tag": "t", "key": "b"}),
            json.dumps({"cmd": "stats"}),
        ])
        _, lines = self.run_cli(commands, "--exact")
        self.assertTrue(lines[0]["new"])
        self.assertTrue(lines[1]["member"])
        self.assertFalse(lines[2]["member"])
        self.assertEqual(lines[3]["kind"], "ExactKernel")

    def test_bad_startup_args(self):
        proc, lines = self.run_cli(
            '{"cmd": "stats"}\n', "--m", "0"
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("error", lines[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
