"""相似度与差异报告的单元测试。"""

from __future__ import annotations

import random
import unittest

from cdiff import ChunkConfig, compare, diff
from cdiff.delta import Add, Copy

CFG = ChunkConfig(avg_size=1024, min_size=256, max_size=4096)


def _pseudo_bytes(seed: int, n: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


class SimilarityTests(unittest.TestCase):
    """相似度边界与定义。"""

    def test_identical_is_one(self) -> None:
        data = _pseudo_bytes(60, 50000)
        report = compare(data, data, CFG)
        self.assertEqual(report.similarity, 1.0)
        self.assertEqual(report.common_bytes, len(data))
        self.assertEqual(report.added_bytes, 0)
        self.assertEqual(report.deleted_bytes, 0)
        self.assertEqual(report.changed_chunks, 0)

    def test_both_empty_is_one(self) -> None:
        report = compare(b"", b"", CFG)
        self.assertEqual(report.similarity, 1.0)
        self.assertEqual(
            (report.common_bytes, report.added_bytes, report.deleted_bytes),
            (0, 0, 0),
        )

    def test_completely_different_is_zero(self) -> None:
        old = _pseudo_bytes(61, 50000)
        new = _pseudo_bytes(62, 50000)
        report = compare(old, new, CFG)
        self.assertEqual(report.similarity, 0.0)
        self.assertEqual(report.common_bytes, 0)
        self.assertEqual(report.added_bytes, len(new))
        self.assertEqual(report.deleted_bytes, len(old))

    def test_empty_vs_nonempty(self) -> None:
        data = _pseudo_bytes(63, 10000)
        r1 = compare(b"", data, CFG)
        r2 = compare(data, b"", CFG)
        self.assertEqual(r1.similarity, 0.0)
        self.assertEqual(r1.added_bytes, len(data))
        self.assertEqual(r1.deleted_bytes, 0)
        self.assertEqual(r2.similarity, 0.0)
        self.assertEqual(r2.added_bytes, 0)
        self.assertEqual(r2.deleted_bytes, len(data))

    def test_similarity_in_unit_interval(self) -> None:
        old = _pseudo_bytes(64, 100000)
        new = old[:50000] + b"X" * 300 + old[50000:]
        report = compare(old, new, CFG)
        self.assertGreater(report.similarity, 0.9)
        self.assertLess(report.similarity, 1.0)

    def test_invariants_with_patch_ops(self) -> None:
        old = _pseudo_bytes(65, 80000)
        new = b"HEAD" + old[:60000] + b"MID" + old[60000:]
        delta = diff(old, new, CFG)
        report = compare(old, new, CFG, _delta=delta)
        copied = sum(o.length for o in delta.ops if isinstance(o, Copy))
        added = sum(len(o.data) for o in delta.ops if isinstance(o, Add))
        self.assertEqual(report.common_bytes, copied)
        self.assertEqual(report.added_bytes, added)
        self.assertEqual(report.common_bytes + report.added_bytes, len(new))
        self.assertEqual(report.deleted_bytes, len(old) - copied)
        expected = 2.0 * copied / (len(old) + len(new))
        self.assertAlmostEqual(report.similarity, expected, places=12)
        self.assertGreaterEqual(report.changed_chunks, 0)

    def test_serialization(self) -> None:
        report = compare(b"abc", b"abd")
        doc = report.to_dict()
        for key in (
            "common_bytes",
            "added_bytes",
            "deleted_bytes",
            "similarity",
            "changed_chunks",
            "old_size",
            "new_size",
        ):
            self.assertIn(key, doc)
        self.assertEqual(doc["old_size"], 3)
        self.assertEqual(doc["new_size"], 3)


if __name__ == "__main__":
    unittest.main()
