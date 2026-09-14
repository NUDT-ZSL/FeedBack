"""验收脚本式端到端测试：多场景 + 顺序无关 + 导出导入比对。"""

from __future__ import annotations

import itertools
import os
import random
import tempfile
import unittest

from storage_repair import BlockStatus, StorageEngine
from storage_repair import persistence


def corrupt_byte(content: bytes, offset: int = 0) -> bytes:
    """翻转内容某一字节，返回新 bytes。"""
    buf = bytearray(content)
    buf[offset] ^= 0xFF
    return bytes(buf)


class AcceptanceScenarioTests(unittest.TestCase):
    """对应验收时人工构造的各类条带。"""

    def setUp(self) -> None:
        random.seed(2026)
        self.k, self.m = 4, 3
        self.data = [
            bytes(random.randrange(256) for _ in range(10))
            for _ in range(self.k)
        ]
        self.temp_dir = tempfile.mkdtemp()

    def _fresh(self) -> StorageEngine:
        engine = StorageEngine()
        engine.create_stripe("stripe", self.k, self.m, data_blocks=self.data)
        return engine

    def _original(self, engine: StorageEngine) -> list[bytes]:
        return [
            engine.get_stripe("stripe").block(pos).content  # type: ignore[misc]
            for pos in range(self.k + self.m)
        ]

    def test_single_loss(self) -> None:
        engine = self._fresh()
        original = self._original(engine)
        engine.mark_missing("stripe", 2)
        record = engine.repair_stripe("stripe")
        self.assertTrue(record.success)
        self.assertEqual(
            engine.get_stripe("stripe").block(2).content, original[2]
        )
        self.assertEqual(sorted(record.used_positions), record.used_positions)
        self.assertEqual(len(record.used_positions), self.k)
        self.assertNotIn(2, record.used_positions)

    def test_multi_loss_up_to_m(self) -> None:
        for missing in itertools.combinations(range(self.k + self.m), self.m):
            engine = self._fresh()
            original = self._original(engine)
            for pos in missing:
                engine.mark_missing("stripe", pos)
            record = engine.repair_stripe("stripe")
            self.assertTrue(record.success, (missing, record.reason))
            for pos in missing:
                self.assertEqual(
                    engine.get_stripe("stripe").block(pos).content,
                    original[pos],
                )

    def test_more_than_m_loss_explicit_failure(self) -> None:
        engine = self._fresh()
        missing = (0, 1, 2, 3)  # 4 > m=3
        for pos in missing:
            engine.mark_missing("stripe", pos)
        report = engine.verify_stripe("stripe")
        self.assertFalse(report.reconstructable)
        record = engine.repair_stripe("stripe")
        self.assertFalse(record.success)
        self.assertIn("exceeds repair capacity", record.reason)
        self.assertEqual(record.adopted_fingerprints, {})

    def test_parity_corruption_recomputed(self) -> None:
        engine = self._fresh()
        original = self._original(engine)
        engine.write_block("stripe", self.k, corrupt_byte(original[self.k]))
        report = engine.verify_stripe("stripe")
        self.assertEqual(report.positions[self.k], BlockStatus.CORRUPT)
        self.assertEqual(report.inconsistent_positions, [[self.k]])
        record = engine.repair_stripe("stripe")
        self.assertTrue(record.success)
        self.assertEqual(
            engine.get_stripe("stripe").block(self.k).content, original[self.k]
        )

    def test_data_parity_contradiction_lists_combos(self) -> None:
        # m=3 时单/两处随机损坏往往仍存在“经 1 个校验余力验证”的
        # 唯一解释，可被可证明地修复；要逼出拒绝，需损坏 3 处：任何
        # 解释都要删到只剩 k 个（零校验余力，不可验证），此时拒绝挑选。
        engine = self._fresh()
        original = self._original(engine)
        engine.write_block("stripe", 0, corrupt_byte(original[0]))
        engine.write_block("stripe", 1, corrupt_byte(original[1], 2))
        engine.write_block(
            "stripe", self.k, corrupt_byte(original[self.k], 1)
        )
        before = self._original(engine)
        report = engine.verify_stripe("stripe")
        self.assertFalse(report.reconstructable)
        self.assertGreater(len(report.inconsistent_positions), 1)
        record = engine.repair_stripe("stripe")
        self.assertFalse(record.success)
        self.assertEqual(
            record.inconsistent_positions, report.inconsistent_positions
        )
        self.assertEqual(self._original(engine), before)

    def test_two_errors_with_verifiable_unique_explanation_are_fixed(self) -> None:
        # k=4,m=3：两处损坏后仍有 k+1 个自洽块且解释唯一，可正确修复。
        engine = self._fresh()
        original = self._original(engine)
        engine.write_block("stripe", 0, corrupt_byte(original[0]))
        engine.write_block(
            "stripe", self.k, corrupt_byte(original[self.k], 1)
        )
        report = engine.verify_stripe("stripe")
        self.assertTrue(report.reconstructable)
        record = engine.repair_stripe("stripe")
        self.assertTrue(record.success)
        self.assertEqual(self._original(engine), original)

    def test_candidate_conflict_and_order_invariance(self) -> None:
        candidates = [
            ("replica-a", self.data[1]),
            ("replica-b", self.data[1]),
            ("repair-x", corrupt_byte(self.data[1])),
        ]

        def run(order: tuple[int, ...]):
            engine = self._fresh()
            engine.mark_missing("stripe", 1)
            for index in order:
                source, content = candidates[index]
                engine.add_candidate("stripe", 1, source, content)
            report = engine.verify_stripe("stripe").to_dict()
            record = engine.repair_stripe("stripe").to_dict()
            final = engine.get_stripe("stripe").block(1).content
            return report, record, final

        reference = run((0, 1, 2))
        # 2:1 严格多数，任意候选到达顺序结论一致。
        for order in itertools.permutations(range(3)):
            self.assertEqual(run(order), reference)
        self.assertTrue(reference[1]["success"])
        self.assertEqual(reference[2], self.data[1])

        # 1:1 平票 → 冲突拒绝。
        engine = self._fresh()
        engine.mark_missing("stripe", 1)
        engine.add_candidate("stripe", 1, "a", self.data[1])
        engine.add_candidate("stripe", 1, "b", corrupt_byte(self.data[1]))
        report = engine.verify_stripe("stripe")
        self.assertEqual(report.positions[1], BlockStatus.CONFLICT)
        self.assertFalse(engine.repair_stripe("stripe").success)

    def test_export_import_identity(self) -> None:
        engine = self._fresh()
        # 制造一次成功修复与一次失败修复，使历史同时包含两类记录。
        engine.mark_missing("stripe", 0)
        engine.add_candidate("stripe", 0, "r", self.data[0])
        engine.repair_stripe("stripe")
        for pos in range(self.m + 1):
            engine.mark_missing("stripe", pos)
        engine.repair_stripe("stripe")
        for pos in range(self.m + 1):
            engine.mark_missing("stripe", pos)

        path = os.path.join(self.temp_dir, "acceptance.json")
        persistence.export_engine(engine, path)
        restored = StorageEngine()
        persistence.import_file(restored, path)

        self.assertEqual(
            restored.get_stripe("stripe").to_dict(),
            engine.get_stripe("stripe").to_dict(),
        )
        self.assertEqual(
            [r.to_dict() for r in restored.repair_history("stripe")],
            [r.to_dict() for r in engine.repair_history("stripe")],
        )
        self.assertEqual(
            restored.verify_stripe("stripe").to_dict(),
            engine.verify_stripe("stripe").to_dict(),
        )

    def test_corrupt_import_rejected_clearly(self) -> None:
        engine = self._fresh()
        path = os.path.join(self.temp_dir, "good.json")
        persistence.export_engine(engine, path)
        target = self._fresh()  # 已有同名条带，导入前有数据
        with open(path, "rb") as handle:
            raw = handle.read()
        broken_path = os.path.join(self.temp_dir, "broken.json")
        with open(broken_path, "wb") as handle:
            handle.write(raw[: len(raw) // 2])  # 截断
        with self.assertRaises(persistence.SerializationError):
            persistence.import_file(target, broken_path)
        # 失败后原状态仍可正常验证。
        self.assertTrue(target.verify_stripe("stripe").reconstructable)


if __name__ == "__main__":
    unittest.main()
