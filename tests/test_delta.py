"""差分生成与补丁应用的单元测试：往返、最小性、指令、错误路径。"""

from __future__ import annotations

import random
import unittest

from cdiff import (
    ChunkConfig,
    CorruptPatchError,
    FingerprintMismatchError,
    diff,
    fingerprint,
    patch,
    patch_size,
)
from cdiff.delta import ADD, COPY, Add, Copy, Delta


def _pseudo_bytes(seed: int, n: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


CFG = ChunkConfig(avg_size=1024, min_size=256, max_size=4096)


class DiffRoundtripTests(unittest.TestCase):
    """各种内容形态下 diff -> patch 必须精确还原。"""

    def assertRoundtrips(self, old: bytes, new: bytes, cfg: ChunkConfig = CFG) -> Delta:
        delta = diff(old, new, cfg)
        rebuilt = patch(old, delta)
        self.assertEqual(rebuilt, new)
        return delta

    def test_empty_to_empty(self) -> None:
        delta = self.assertRoundtrips(b"", b"")
        self.assertEqual(delta.ops, ())
        self.assertEqual(patch_size(delta), 4)  # 只有魔数

    def test_empty_to_bytes_and_back(self) -> None:
        self.assertRoundtrips(b"", b"hello")
        self.assertRoundtrips(b"hello", b"")
        self.assertRoundtrips(b"", bytes(range(256)) * 10)

    def test_single_byte_cases(self) -> None:
        self.assertRoundtrips(b"a", b"a")
        self.assertRoundtrips(b"a", b"b")
        self.assertRoundtrips(b"", b"a")
        self.assertRoundtrips(b"a", b"")
        self.assertRoundtrips(b"a", b"ab")

    def test_identical_content_single_copy(self) -> None:
        old = _pseudo_bytes(30, 50000)
        delta = diff(old, old, CFG)
        self.assertTrue(delta.ops, "相同内容至少应有一条 COPY")
        self.assertTrue(all(isinstance(op, Copy) for op in delta.ops))
        # 相邻 COPY 被合并：整文件就是一条从头到尾的 COPY。
        self.assertEqual(len(delta.ops), 1)
        self.assertEqual(delta.ops[0], Copy(0, len(old)))
        self.assertEqual(sum(op.length for op in delta.ops), len(old))
        self.assertEqual(patch(old, delta), old)

    def test_completely_different(self) -> None:
        old = _pseudo_bytes(31, 40000)
        new = _pseudo_bytes(32, 40000)
        delta = self.assertRoundtrips(old, new)
        self.assertTrue(all(isinstance(op, Add) for op in delta.ops))

    def test_new_is_prefix_of_old(self) -> None:
        old = _pseudo_bytes(33, 60000)
        self.assertRoundtrips(old, old[:100])
        self.assertRoundtrips(old, old[:33000])

    def test_new_is_suffix_of_old(self) -> None:
        old = _pseudo_bytes(34, 60000)
        self.assertRoundtrips(old, old[59000:])
        self.assertRoundtrips(old, old[12345:])

    def test_old_is_prefix_of_new(self) -> None:
        old = _pseudo_bytes(35, 30000)
        self.assertRoundtrips(old, old + b"extra-tail" * 50)

    def test_insert_delete_modify_middle(self) -> None:
        old = _pseudo_bytes(36, 120000)
        variants = [
            old[:40000] + b"INSERTED" * 10 + old[40000:],
            old[:40000] + old[40100:],
            old[:40000] + b"X" * 200 + old[40200:],
            b"PREFIX" + old + b"SUFFIX",
            old[::-1],
        ]
        for new in variants:
            self.assertRoundtrips(old, new)

    def test_random_mutations_roundtrip(self) -> None:
        rng = random.Random(37)
        old = _pseudo_bytes(38, 200000)
        for trial in range(5):
            new = bytearray(old)
            for _ in range(rng.randrange(1, 8)):
                pos = rng.randrange(len(new))
                op = rng.choice(("flip", "insert", "delete"))
                if op == "flip":
                    new[pos] ^= 0xFF
                elif op == "insert":
                    new[pos : pos] = bytes(rng.randrange(256) for _ in range(rng.randrange(1, 200)))
                else:
                    del new[pos : pos + rng.randrange(1, 200)]
            self.assertRoundtrips(old, bytes(new))

    def test_repeated_blocks_reused(self) -> None:
        block = _pseudo_bytes(39, 3000)
        old = block * 8
        new = block * 12  # 重复块在旧内容中存在多份
        delta = self.assertRoundtrips(old, new)
        copied = sum(o.length for o in delta.ops if isinstance(o, Copy))
        self.assertGreaterEqual(copied, len(block) * 8)


class MinimalityTests(unittest.TestCase):
    """补丁大小要求。"""

    def test_patch_half_size_for_highly_similar_large_content(self) -> None:
        old = _pseudo_bytes(40, 300000)
        # 99% 以上相同：中间小插入 + 尾部小追加。
        new = old[:120000] + b"\x00" * 500 + old[120000:] + b"zz"
        delta = diff(old, new, CFG)
        self.assertEqual(patch(old, delta), new)
        self.assertLess(
            patch_size(delta),
            len(new) // 2,
            "高度相似内容的补丁必须小于新内容的一半",
        )

    def test_identical_patch_tiny(self) -> None:
        old = _pseudo_bytes(41, 300000)
        delta = diff(old, old, CFG)
        self.assertLess(patch_size(delta), len(old) // 100)

    def test_ops_use_only_copy_and_add(self) -> None:
        old = _pseudo_bytes(42, 50000)
        new = old[:25000] + b"!!" + old[25000:]
        delta = diff(old, new, CFG)
        for op in delta.ops:
            self.assertIsInstance(op, (Copy, Add))
        # 相邻同类指令应已合并：不出现连续两个 Copy / Add。
        kinds = [type(op) for op in delta.ops]
        self.assertEqual(kinds, [k for i, k in enumerate(kinds) if i == 0 or k != kinds[i - 1]])

    def test_records_old_and_new_fingerprints(self) -> None:
        old = _pseudo_bytes(43, 10000)
        new = old + b"new"
        delta = diff(old, new, CFG)
        self.assertEqual(delta.old_fingerprint.digest, fingerprint(old, CFG).digest)
        self.assertEqual(delta.new_fingerprint.digest, fingerprint(new, CFG).digest)


class OpSerializationTests(unittest.TestCase):
    """指令 JSON 与二进制编码。"""

    def test_op_dicts(self) -> None:
        self.assertEqual(
            Copy(3, 7).to_dict(), {"op": COPY, "offset": 3, "length": 7}
        )
        self.assertEqual(
            Add(b"\x00\xff").to_dict(),
            {"op": ADD, "data_b64": "AP8="},
        )

    def test_binary_roundtrip(self) -> None:
        old = _pseudo_bytes(44, 60000)
        new = old[:20000] + b"DATA" + old[20000:]
        delta = diff(old, new, CFG)
        blob = delta.encode()
        self.assertEqual(blob[:4], b"CDF1")
        decoded = Delta.decode_ops(blob)
        self.assertEqual(decoded, delta.ops)
        self.assertEqual(patch_size(delta), len(blob))

    def test_truncated_binary_rejected(self) -> None:
        # 手工构造固定布局：COPY(0,5) + ADD(b"x")，
        # 编码为 CDF1 | 01 + 16B | 02 + 8B + 1B，共 31 字节。
        fp_old = fingerprint(b"hello", CFG)
        fp_new = fingerprint(b"hellox", CFG)
        delta = Delta(
            ops=(Copy(0, 5), Add(b"x")),
            old_fingerprint=fp_old,
            new_fingerprint=fp_new,
        )
        blob = delta.encode()
        self.assertEqual(
            blob, b"CDF1" + b"\x01" + b"\x00" * 8 + (5).to_bytes(8, "big")
            + b"\x02" + (1).to_bytes(8, "big") + b"x"
        )
        self.assertEqual(len(blob), 31)
        bad_cuts = [
            0, 3,       # 魔数不完整/错误
            5, 10, 20,  # COPY 头被截断
            22, 29,     # ADD 头/数据被截断
        ]
        for cut in bad_cuts:
            with self.assertRaises(CorruptPatchError):
                Delta.decode_ops(blob[:cut])
        # 切点恰好落在指令边界是合法的（流提前结束但没有半截指令）：
        # 4 字节=只有魔数的空流，21 字节=恰好一条完整 COPY。
        self.assertEqual(Delta.decode_ops(blob[:4]), ())
        self.assertEqual(Delta.decode_ops(blob[:21]), (Copy(0, 5),))
        # 完整流精确还原。
        self.assertEqual(Delta.decode_ops(blob), delta.ops)

    def test_bad_magic_rejected(self) -> None:
        with self.assertRaises(CorruptPatchError):
            Delta.decode_ops(b"XXXX" + b"\x01" + b"\x00" * 16)


class PatchErrorTests(unittest.TestCase):
    """应用补丁时的错误处理，且不返回半成品。"""

    def test_wrong_old_fingerprint_reports_both_digests(self) -> None:
        old = _pseudo_bytes(50, 50000)
        new = old + b"changed"
        delta = diff(old, new, CFG)
        wrong_old = b"X" + old[1:]
        with self.assertRaises(FingerprintMismatchError) as ctx:
            patch(wrong_old, delta)
        err = ctx.exception
        self.assertEqual(err.expected, delta.old_fingerprint.digest)
        self.assertEqual(err.actual, fingerprint(wrong_old, CFG).digest)
        self.assertNotEqual(err.expected, err.actual)
        self.assertIn(err.expected, str(err))
        self.assertIn(err.actual, str(err))

    def test_copy_out_of_range_rejected(self) -> None:
        old_fp = fingerprint(b"hello world", CFG)
        new_fp = fingerprint(b"hello world!!", CFG)
        delta = Delta(
            ops=(Copy(0, 11), Add(b"!!"), Copy(8, 10)),  # 最后一条越界
            old_fingerprint=old_fp,
            new_fingerprint=new_fp,
        )
        with self.assertRaises(CorruptPatchError):
            patch(b"hello world", delta)

    def test_negative_copy_rejected(self) -> None:
        old_fp = fingerprint(b"hello", CFG)
        new_fp = fingerprint(b"hello", CFG)
        delta = Delta(
            ops=(Copy(-1, 3),), old_fingerprint=old_fp, new_fingerprint=new_fp
        )
        with self.assertRaises(CorruptPatchError):
            patch(b"hello", delta)

    def test_corrupt_delta_from_dict_gives_clear_error(self) -> None:
        good = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        bad_cases = [
            {},
            {"format": "cdiff-delta"},
            {"ops": [], "old_fingerprint": good["old_fingerprint"]},
        ]
        for doc in bad_cases:
            with self.assertRaises(CorruptPatchError):
                Delta.from_dict(doc)

    def test_unknown_op_rejected(self) -> None:
        doc = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        doc["ops"] = [{"op": "MOVE", "offset": 0, "length": 1}]
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_copy_range_checked_at_load_time(self) -> None:
        doc = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        doc["ops"] = [{"op": COPY, "offset": 4999, "length": 999999}]
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_negative_copy_checked_at_load_time(self) -> None:
        doc = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        doc["ops"] = [{"op": COPY, "offset": -2, "length": 1}]
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_add_bad_base64_rejected(self) -> None:
        doc = diff(b"a" * 5000, b"b" + b"a" * 5000, CFG).to_dict()
        doc["ops"] = [{"op": ADD, "data_b64": "@@@not-base64@@@"}]
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_ops_length_must_match_new_size(self) -> None:
        doc = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        # 塞一条多余 COPY，指令总长度与新指纹记录的大小不符。
        doc["ops"].append({"op": COPY, "offset": 0, "length": 5})
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_bad_fingerprint_inside_patch_rejected(self) -> None:
        doc = diff(b"a" * 5000, b"a" * 5000 + b"b", CFG).to_dict()
        doc["old_fingerprint"]["digest"] = "0" * 64
        with self.assertRaises(CorruptPatchError):
            Delta.from_dict(doc)

    def test_invalid_op_object_at_apply_time(self) -> None:
        old_fp = fingerprint(b"hi", CFG)
        delta = Delta(ops=("not-an-op",), old_fingerprint=old_fp, new_fingerprint=old_fp)
        with self.assertRaises(CorruptPatchError):
            patch(b"hi", delta)


if __name__ == "__main__":
    unittest.main()
