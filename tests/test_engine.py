"""存储引擎：重建、候选、矛盾诊断、验证与错误处理测试。"""

from __future__ import annotations

import copy
import itertools
import random
import unittest

from storage_repair import BlockStatus, StorageEngine
from storage_repair.engine import DuplicateCandidateError
from storage_repair.models import (
    InvalidContentError,
    InvalidPositionError,
    SerializationError,
    StripeNotFoundError,
    VerificationReport,
)


def build_stripe(
    engine: StorageEngine,
    stripe_id: str = "s",
    k: int = 3,
    m: int = 2,
    length: int = 6,
    seed: int = 7,
):
    """构造一条带并返回 ``(stripe, data, all_blocks)``。"""
    random.seed(seed)
    data = [
        bytes(random.randrange(256) for _ in range(length)) for _ in range(k)
    ]
    engine.create_stripe(stripe_id, k=k, m=m, data_blocks=data)
    stripe = engine.get_stripe(stripe_id)
    all_blocks = [stripe.block(pos).content for pos in range(k + m)]
    return stripe, data, all_blocks


class StripeLifecycleTests(unittest.TestCase):
    """创建、查询、配置不可变与错误定位。"""

    def test_empty_engine(self) -> None:
        engine = StorageEngine()
        self.assertEqual(engine.list_stripes(), [])
        self.assertEqual(engine.internal_state()["stripes"], {})
        with self.assertRaises(StripeNotFoundError):
            engine.verify_stripe("nope")

    def test_create_without_data_starts_missing(self) -> None:
        engine = StorageEngine()
        stripe = engine.create_stripe("empty", k=2, m=1)
        self.assertEqual(stripe.total, 3)
        self.assertTrue(
            all(block.status == BlockStatus.MISSING for block in stripe.blocks)
        )

    def test_duplicate_id_and_bad_config(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("s", 2, 1)
        from storage_repair.models import (
            DuplicateStripeError,
            InvalidConfigError,
        )
        with self.assertRaises(DuplicateStripeError):
            engine.create_stripe("s", 2, 1)
        with self.assertRaises(InvalidConfigError):
            engine.create_stripe("", 2, 1)
        with self.assertRaises(InvalidConfigError):
            engine.create_stripe("x", 0, 1)
        with self.assertRaises(InvalidConfigError):
            engine.create_stripe("y", 2, -1)

    def test_position_validation_locates_stripe_and_position(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("s", 2, 1)
        with self.assertRaises(InvalidPositionError) as ctx:
            engine.write_block("s", 9, b"aa")
        self.assertEqual(ctx.exception.stripe_id, "s")
        self.assertEqual(ctx.exception.position, 9)
        self.assertIn("s", str(ctx.exception))
        self.assertIn("9", str(ctx.exception))
        with self.assertRaises(InvalidPositionError):
            engine.mark_missing("s", -1)

    def test_single_block_stripe(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("one", k=1, m=1, data_blocks=[b"\x5A"])
        stripe = engine.get_stripe("one")
        parity = stripe.block(1).content
        self.assertIsNotNone(parity)
        self.assertEqual(len(parity), 1)
        engine.mark_missing("one", 0)
        record = engine.repair_stripe("one")
        self.assertTrue(record.success)
        self.assertEqual(stripe.block(0).content, b"\x5A")
        # 再反向重建校验块。
        engine.mark_missing("one", 1)
        record = engine.repair_stripe("one")
        self.assertTrue(record.success)
        self.assertEqual(stripe.block(1).content, parity)

    def test_zero_parity_no_redundancy(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("raw", k=2, m=0, data_blocks=[b"aa", b"bb"])
        engine.mark_missing("raw", 0)
        record = engine.repair_stripe("raw")
        self.assertFalse(record.success)
        self.assertIn("exceeds repair capacity", record.reason)


class ReconstructionTests(unittest.TestCase):
    """单块、多块、恰好 m 与超过 m 的重建。"""

    def setUp(self) -> None:
        self.engine = StorageEngine()
        self.stripe, self.data, self.all_blocks = build_stripe(self.engine)

    def test_single_data_loss_byte_exact(self) -> None:
        self.engine.mark_missing("s", 1)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success, record.reason)
        self.assertEqual(record.target_positions, [1])
        self.assertEqual(record.used_positions, [0, 2, 3])
        self.assertEqual(self.stripe.block(1).content, self.data[1])
        self.assertEqual(self.stripe.block(1).status, BlockStatus.INTACT)

    def test_single_parity_loss(self) -> None:
        self.engine.mark_missing("s", 4)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success)
        self.assertEqual(self.stripe.block(4).content, self.all_blocks[4])

    def test_exactly_m_losses(self) -> None:
        for pos in (0, 4):
            self.engine.mark_missing("s", pos)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success, record.reason)
        self.assertEqual(self.stripe.block(0).content, self.data[0])
        self.assertEqual(self.stripe.block(4).content, self.all_blocks[4])

    def test_more_than_m_losses_fails_cleanly(self) -> None:
        for pos in (0, 1, 2):
            self.engine.mark_missing("s", pos)
        snapshot = [block.content for block in self.stripe.blocks]
        record = self.engine.repair_stripe("s")
        self.assertFalse(record.success)
        self.assertIn("exceeds repair capacity", record.reason)
        self.assertEqual(record.used_positions, [])
        # 没有伪造成功，状态不变。
        self.assertEqual(
            [block.content for block in self.stripe.blocks], snapshot
        )

    def test_all_data_blocks_lost_exceeds_m(self) -> None:
        for pos in range(3):
            self.engine.mark_missing("s", pos)
        record = self.engine.repair_stripe("s")
        self.assertFalse(record.success)
        self.assertEqual(self.stripe.block(0).content, None)

    def test_corrupt_marker_excludes_content(self) -> None:
        # 损坏标记即使内容还在，也不参与依据；恰好剩 k 个好块可重建。
        self.engine.mark_corrupt("s", 0)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success, record.reason)
        self.assertEqual(self.stripe.block(0).content, self.data[0])

    def test_repeated_marking_is_idempotent(self) -> None:
        self.engine.mark_missing("s", 2)
        self.engine.mark_missing("s", 2)
        self.engine.mark_corrupt("s", 3)
        self.engine.mark_corrupt("s", 3)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success, record.reason)

    def test_repair_reports_basis_positions(self) -> None:
        self.engine.mark_missing("s", 0)
        record = self.engine.repair_stripe("s")
        self.assertNotIn(0, record.used_positions)
        self.assertEqual(len(record.used_positions), 3)
        self.assertEqual(record.used_positions, sorted(record.used_positions))


class CandidateTests(unittest.TestCase):
    """多候选：一致、严格多数、平票冲突、来源去重、顺序无关。"""

    def setUp(self) -> None:
        self.engine = StorageEngine()
        self.stripe, self.data, _ = build_stripe(self.engine)

    def test_identical_candidates_unanimous(self) -> None:
        self.engine.mark_missing("s", 0)
        self.engine.add_candidate("s", 0, "r1", self.data[0])
        self.engine.add_candidate("s", 0, "r2", self.data[0])
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success)
        self.assertEqual(self.stripe.block(0).content, self.data[0])
        self.assertEqual(record.candidate_sources[0], "r1")

    def test_strict_majority_adopted(self) -> None:
        self.engine.mark_missing("s", 0)
        self.engine.add_candidate("s", 0, "a", self.data[0])
        self.engine.add_candidate("s", 0, "b", self.data[0])
        self.engine.add_candidate("s", 0, "c", b"WRONG!")
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success)
        self.assertEqual(self.stripe.block(0).content, self.data[0])
        self.assertEqual(record.candidate_sources[0], "a")

    def test_tie_conflict_refuses(self) -> None:
        self.engine.mark_missing("s", 0)
        self.engine.add_candidate("s", 0, "a", self.data[0])
        self.engine.add_candidate("s", 0, "b", b"WRONG!")
        report = self.engine.verify_stripe("s")
        self.assertEqual(report.positions[0], BlockStatus.CONFLICT)
        self.assertFalse(report.reconstructable)
        record = self.engine.repair_stripe("s")
        self.assertFalse(record.success)
        self.assertEqual(record.inconsistent_positions, [[0]])
        self.assertIsNone(self.stripe.block(0).content)

    def test_same_source_same_content_idempotent(self) -> None:
        self.engine.add_candidate("s", 0, "a", self.data[0])
        self.engine.add_candidate("s", 0, "a", self.data[0])
        self.assertEqual(len(self.stripe.block(0).candidates), 1)

    def test_same_source_different_content_rejected(self) -> None:
        self.engine.add_candidate("s", 0, "a", self.data[0])
        with self.assertRaises(DuplicateCandidateError):
            self.engine.add_candidate("s", 0, "a", b"other!")

    def test_order_independence(self) -> None:
        candidates = [
            ("a", self.data[0]),
            ("b", self.data[0]),
            ("c", b"WRONG!"),
        ]

        def run(order: list[int]):
            engine = StorageEngine()
            build_stripe(engine)
            engine.mark_missing("s", 0)
            for idx in order:
                source, content = candidates[idx]
                engine.add_candidate("s", 0, source, content)
            record = engine.repair_stripe("s")
            final = engine.get_stripe("s").block(0).content
            return record.to_dict(), final

        reference = run([0, 1, 2])
        for order in itertools.permutations(range(3)):
            self.assertEqual(run(list(order)), reference)


class ParityContradictionTests(unittest.TestCase):
    """需求 4：区分校验块损坏与数据块损坏/互相矛盾。"""

    def setUp(self) -> None:
        self.engine = StorageEngine()
        self.stripe, self.data, self.all_blocks = build_stripe(self.engine)

    def test_only_parity_wrong_recomputed_from_data(self) -> None:
        bad = bytearray(self.all_blocks[3])
        bad[0] ^= 0xFF
        self.engine.write_block("s", 3, bytes(bad))
        report = self.engine.verify_stripe("s")
        self.assertEqual(report.positions[3], BlockStatus.CORRUPT)
        self.assertTrue(report.reconstructable)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success)
        self.assertEqual(record.target_positions, [3])
        self.assertEqual(self.stripe.block(3).content, self.all_blocks[3])

    def test_single_silent_data_error_repaired(self) -> None:
        bad = bytearray(self.data[1])
        bad[2] ^= 0x01
        self.engine.write_block("s", 1, bytes(bad))
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success)
        self.assertEqual(self.stripe.block(1).content, self.data[1])

    def test_data_and_parity_both_silent_is_unresolvable(self) -> None:
        bad_data = bytearray(self.data[0])
        bad_data[0] ^= 0xFF
        bad_parity = bytearray(self.all_blocks[3])
        bad_parity[1] ^= 0x0F
        self.engine.write_block("s", 0, bytes(bad_data))
        self.engine.write_block("s", 3, bytes(bad_parity))
        before = [block.content for block in self.stripe.blocks]
        report = self.engine.verify_stripe("s")
        self.assertFalse(report.reconstructable)
        self.assertGreater(len(report.inconsistent_positions), 1)
        record = self.engine.repair_stripe("s")
        self.assertFalse(record.success)
        self.assertEqual(
            record.inconsistent_positions, report.inconsistent_positions
        )
        # 拒绝挑选，内容不变。
        self.assertEqual(
            [block.content for block in self.stripe.blocks], before
        )

    def test_explicit_marks_turn_ambiguity_into_erasures(self) -> None:
        bad_data = bytearray(self.data[0])
        bad_data[0] ^= 0xFF
        bad_parity = bytearray(self.all_blocks[3])
        bad_parity[1] ^= 0x0F
        self.engine.write_block("s", 0, bytes(bad_data))
        self.engine.write_block("s", 3, bytes(bad_parity))
        self.engine.mark_corrupt("s", 0)
        self.engine.mark_corrupt("s", 3)
        record = self.engine.repair_stripe("s")
        self.assertTrue(record.success, record.reason)
        self.assertEqual(self.stripe.block(0).content, self.data[0])
        self.assertEqual(self.stripe.block(3).content, self.all_blocks[3])


class VerifyReadonlyTests(unittest.TestCase):
    """需求 5：验证只读、确定、报告完整。"""

    def setUp(self) -> None:
        self.engine = StorageEngine()
        self.stripe, self.data, self.all_blocks = build_stripe(self.engine)

    def test_healthy_report(self) -> None:
        report = self.engine.verify_stripe("s")
        self.assertIsInstance(report, VerificationReport)
        self.assertTrue(report.reconstructable)
        self.assertEqual(
            set(report.positions), set(range(self.stripe.total))
        )
        self.assertTrue(
            all(status == BlockStatus.INTACT for status in report.positions.values())
        )
        self.assertEqual(report.inconsistent_positions, [])

    def test_verify_does_not_mutate(self) -> None:
        bad = bytearray(self.all_blocks[3])
        bad[0] ^= 1
        self.engine.write_block("s", 3, bytes(bad))
        before = copy.deepcopy(self.stripe.to_dict())
        for _ in range(3):
            self.engine.verify_stripe("s")
        self.assertEqual(self.stripe.to_dict(), before)
        # 报告层判为损坏，但条带里的标记仍是 intact（只读）。
        self.assertEqual(self.stripe.block(3).status, BlockStatus.INTACT)

    def test_verify_repeatable_and_ordered(self) -> None:
        self.engine.mark_missing("s", 2)
        first = self.engine.verify_stripe("s").to_dict()
        second = self.engine.verify_stripe("s").to_dict()
        self.assertEqual(first, second)
        self.assertEqual(list(first["positions"]), sorted(first["positions"], key=int))

    def test_mixed_statuses_report(self) -> None:
        self.engine.mark_missing("s", 0)
        self.engine.mark_corrupt("s", 4)
        report = self.engine.verify_stripe("s")
        self.assertEqual(report.positions[0], BlockStatus.MISSING)
        self.assertEqual(report.positions[4], BlockStatus.CORRUPT)


class RepairDeterminismTests(unittest.TestCase):
    """需求 6：相同初始状态重复修复，记录与最终内容完全一致。"""

    def test_repeat_repair_identical(self) -> None:
        def scenario():
            engine = StorageEngine()
            stripe, data, all_blocks = build_stripe(engine, stripe_id="d")
            engine.mark_missing("d", 0)
            engine.mark_missing("d", 4)
            engine.add_candidate("d", 0, "r1", data[0])
            record = engine.repair_stripe("d")
            return record.to_dict(), stripe.to_dict()

        first = scenario()
        second = scenario()
        self.assertEqual(first, second)

    def test_history_sequences_contiguous(self) -> None:
        engine = StorageEngine()
        build_stripe(engine)
        for pos in (1, 4, 0):
            engine.mark_missing("s", pos)
            engine.repair_stripe("s")
        history = engine.repair_history("s")
        self.assertEqual([record.sequence for record in history], [1, 2, 3])
        dictionaries = [record.to_dict() for record in history]
        self.assertEqual(dictionaries[0]["sequence"], 1)

    def test_failed_repair_also_recorded(self) -> None:
        engine = StorageEngine()
        build_stripe(engine)
        for pos in range(3):
            engine.mark_missing("s", pos)
        record = engine.repair_stripe("s")
        self.assertFalse(record.success)
        self.assertIsNotNone(record.reason)
        self.assertEqual(len(engine.repair_history("s")), 1)


class ContentValidationTests(unittest.TestCase):
    """内容类型与长度约束。"""

    def test_content_must_be_bytes(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("s", 2, 1)
        engine.write_block("s", 0, b"ab")
        with self.assertRaises(InvalidContentError):
            engine.write_block("s", 1, "ab")  # type: ignore[arg-type]
        with self.assertRaises(InvalidContentError):
            engine.add_candidate("s", 0, "src", "ab")  # type: ignore[arg-type]

    def test_candidate_too_long(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("s", 2, 1)
        engine.write_block("s", 0, b"ab")
        with self.assertRaises(InvalidContentError):
            engine.add_candidate("s", 1, "r", b"abc")


if __name__ == "__main__":
    unittest.main()
