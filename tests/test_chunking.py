"""内容定义分块的单元测试：边界规则、统计性质与局部稳定性。"""

from __future__ import annotations

import random
import unittest

from cdiff import ChunkConfig
from cdiff.chunking import (
    BUZ_TABLE,
    WINDOW_SIZE,
    chunk_data,
    content_defined_chunks,
)
from cdiff.errors import InvalidConfigError


def _pseudo_bytes(seed: int, n: int) -> bytes:
    """可复现的伪随机字节串（不依赖 random 的全局状态）。"""
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


class ChunkConfigTests(unittest.TestCase):
    """配置校验。"""

    def test_valid_config(self) -> None:
        cfg = ChunkConfig(avg_size=8, min_size=2, max_size=32)
        self.assertEqual(cfg.boundary_mask, 7)  # avg 8 -> 低 3 位全 0

    def test_avg_zero_rejected(self) -> None:
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=0)
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=-1)

    def test_min_greater_than_max_rejected(self) -> None:
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=16, min_size=64, max_size=32)

    def test_negative_min_max_rejected(self) -> None:
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=16, min_size=-1, max_size=32)
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=16, min_size=0, max_size=0)

    def test_bool_rejected_as_int(self) -> None:
        with self.assertRaises(InvalidConfigError):
            ChunkConfig(avg_size=True)  # type: ignore[arg-type]

    def test_config_dict_roundtrip(self) -> None:
        cfg = ChunkConfig(avg_size=11, min_size=3, max_size=99)
        self.assertEqual(ChunkConfig.from_dict(cfg.to_dict()), cfg)

    def test_config_from_dict_missing_field(self) -> None:
        with self.assertRaises(InvalidConfigError):
            ChunkConfig.from_dict({"avg_size": 8, "min_size": 2})
        with self.assertRaises(InvalidConfigError):
            ChunkConfig.from_dict("not-a-dict")  # type: ignore[arg-type]


class BuzTableTests(unittest.TestCase):
    """滚动哈希查表的基本性质。"""

    def test_table_is_permutation(self) -> None:
        self.assertEqual(len(BUZ_TABLE), 256)
        self.assertEqual(len(set(BUZ_TABLE)), 256, "256 个表项必须两两不同")
        self.assertTrue(all(0 < v <= 0xFFFFFFFF for v in BUZ_TABLE))

    def test_window_size_is_32(self) -> None:
        # 移出项的循环移位抵消依赖 W=32。
        self.assertEqual(WINDOW_SIZE, 32)


class ChunkingBasicTests(unittest.TestCase):
    """切块的结构不变量与边界尺寸。"""

    def test_empty_data_has_no_chunks(self) -> None:
        self.assertEqual(chunk_data(b"", ChunkConfig(avg_size=4)), [])

    def test_single_byte_is_one_final_chunk(self) -> None:
        chunks = chunk_data(b"x", ChunkConfig(avg_size=4, min_size=2, max_size=8))
        self.assertEqual(len(chunks), 1)
        offset, length, payload = chunks[0]
        self.assertEqual((offset, length, payload), (0, 1, b"x"))

    def test_offsets_contiguous_and_concat_equals_input(self) -> None:
        data = _pseudo_bytes(1, 20000)
        cfg = ChunkConfig(avg_size=512, min_size=128, max_size=2048)
        chunks = chunk_data(data, cfg)
        pos = 0
        for offset, length, payload in chunks:
            self.assertEqual(offset, pos)
            self.assertEqual(payload, data[offset : offset + length])
            pos += length
        self.assertEqual(pos, len(data))

    def test_chunk_sizes_respect_min_max(self) -> None:
        data = _pseudo_bytes(2, 100000)
        cfg = ChunkConfig(avg_size=512, min_size=128, max_size=2048)
        chunks = chunk_data(data, cfg)
        sizes = [length for _, length, _ in chunks]
        # 除最后一块外，块长都在 [min, max] 内。
        for length in sizes[:-1]:
            self.assertGreaterEqual(length, cfg.min_size)
            self.assertLessEqual(length, cfg.max_size)
        self.assertLessEqual(sizes[-1], cfg.max_size)

    def test_max_size_forces_boundary_on_pathological_data(self) -> None:
        # 全零数据即便极少/从不自然命中边界，也必须被 max_size 强制切开。
        data = b"\x00" * 1000
        cfg = ChunkConfig(avg_size=8, min_size=1, max_size=16)
        sizes = [length for _, length, _ in chunk_data(data, cfg)]
        self.assertTrue(all(s <= 16 for s in sizes))
        self.assertEqual(sum(sizes), 1000)

    def test_average_chunk_size_near_target(self) -> None:
        data = _pseudo_bytes(3, 400000)
        cfg = ChunkConfig(avg_size=1024, min_size=256, max_size=4096)
        sizes = [length for _, length, _ in chunk_data(data, cfg)]
        mean = sum(sizes) / len(sizes)
        # 掩码取整到 2 的幂，平均块长应在目标量级附近。
        self.assertGreater(mean, 512)
        self.assertLess(mean, 2048)

    def test_deterministic(self) -> None:
        data = _pseudo_bytes(4, 50000)
        cfg = ChunkConfig(avg_size=256, min_size=64, max_size=1024)
        self.assertEqual(chunk_data(data, cfg), chunk_data(data, cfg))

    def test_iterator_and_collector_agree(self) -> None:
        data = _pseudo_bytes(5, 5000)
        cfg = ChunkConfig()
        self.assertEqual(list(content_defined_chunks(data, cfg)), chunk_data(data, cfg))

    def test_rejects_non_bytes(self) -> None:
        with self.assertRaises(TypeError):
            chunk_data("string-not-bytes")  # type: ignore[arg-type]


class ContentDefinedLocalityTests(unittest.TestCase):
    """内容定义性：局部改动只影响局部块。"""

    def test_one_byte_change_touches_only_one_chunk_digest(self) -> None:
        data = _pseudo_bytes(6, 80000)
        cfg = ChunkConfig(avg_size=1024, min_size=256, max_size=4096)
        before = chunk_data(data, cfg)
        mutated = bytearray(data)
        mutated[40000] ^= 0xFF
        after = chunk_data(bytes(mutated), cfg)

        import hashlib

        def digests(chunks):
            return [hashlib.sha256(payload).hexdigest() for _, _, payload in chunks]

        d_before, d_after = digests(before), digests(after)
        self.assertGreaterEqual(len(d_before), 10)
        # 块数允许因边界平移 +/-1；变化的块指纹应当只有一个。
        changed = sum(1 for a, b in zip(d_before, d_after) if a != b)
        self.assertLessEqual(changed, 1, "改动一个字节只应改变一个块的内容")

    def test_insertion_shifts_boundaries_but_keeps_tail_chunks(self) -> None:
        data = _pseudo_bytes(7, 80000)
        cfg = ChunkConfig(avg_size=512, min_size=128, max_size=2048)
        before = [payload for _, _, payload in chunk_data(data, cfg)]
        inserted = data[:30000] + b"\xAB" + data[30000:]
        after = [payload for _, _, payload in chunk_data(inserted, cfg)]

        # 插入点之后的大部分块内容应原样保留（位置整体后移 1 字节）。
        common_tail = 0
        for a, b in zip(reversed(before), reversed(after)):
            if a == b:
                common_tail += 1
            else:
                break
        self.assertGreaterEqual(
            common_tail,
            len(before) // 2,
            "插入一个字节后，至少一半的尾部块必须逐字节不变",
        )


if __name__ == "__main__":
    unittest.main()
