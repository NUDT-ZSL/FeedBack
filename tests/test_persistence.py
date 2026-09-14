"""JSON 快照导出 / 导入往返与错误处理测试。"""

from __future__ import annotations

import json
import os
import random
import tempfile
import unittest

from storage_repair import BlockStatus, StorageEngine
from storage_repair.models import SerializationError
from storage_repair.persistence import (
    export_engine,
    export_engine_to_dict,
    import_file,
    load_snapshot,
    parse_snapshot,
)


def build_rich_engine(seed: int = 11) -> StorageEngine:
    """构造含两条带、候选、修复历史、验证报告的引擎。"""
    random.seed(seed)
    engine = StorageEngine()
    data_a = [bytes(random.randrange(256) for _ in range(7)) for _ in range(3)]
    engine.create_stripe("alpha", k=3, m=2, data_blocks=data_a)
    engine.mark_missing("alpha", 0)
    engine.add_candidate("alpha", 0, "replica-1", data_a[0])
    engine.add_candidate("alpha", 0, "replica-2", data_a[0])
    engine.repair_stripe("alpha")
    engine.mark_corrupt("alpha", 4)
    engine.repair_stripe("alpha")

    data_b = [b"\x00\x11", b"\x22\x33"]
    engine.create_stripe("beta", k=2, m=1, data_blocks=data_b)
    return engine


class RoundTripTests(unittest.TestCase):
    """导出后重新导入，结构、内容、候选、历史、报告一致。"""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.temp_dir, "snapshot.json")

    def test_full_roundtrip(self) -> None:
        engine = build_rich_engine()
        export_engine(engine, self.path)
        imported = StorageEngine()
        import_file(imported, self.path)

        self.assertEqual(imported.list_stripes(), engine.list_stripes())
        for stripe_id in engine.list_stripes():
            self.assertEqual(
                imported.get_stripe(stripe_id).to_dict(),
                engine.get_stripe(stripe_id).to_dict(),
            )
            self.assertEqual(
                [record.to_dict() for record in imported.repair_history(stripe_id)],
                [record.to_dict() for record in engine.repair_history(stripe_id)],
            )
            self.assertEqual(
                imported.verify_stripe(stripe_id).to_dict(),
                engine.verify_stripe(stripe_id).to_dict(),
            )

    def test_imported_report_available(self) -> None:
        engine = build_rich_engine()
        export_engine(engine, self.path)
        imported = StorageEngine()
        import_file(imported, self.path)
        report = imported.imported_report("alpha")
        self.assertIsNotNone(report)
        self.assertEqual(
            report.to_dict(), engine.verify_stripe("alpha").to_dict()  # type: ignore[union-attr]
        )

    def test_snapshot_is_deterministic_bytes(self) -> None:
        engine = build_rich_engine()
        export_engine(engine, self.path)
        with open(self.path, "rb") as handle:
            first = handle.read()
        second_path = os.path.join(self.temp_dir, "again.json")
        export_engine(engine, second_path)
        with open(second_path, "rb") as handle:
            second = handle.read()
        self.assertEqual(first, second)

    def test_roundtrip_empty_and_single(self) -> None:
        engine = StorageEngine()
        engine.create_stripe("empty", 2, 2)
        engine.create_stripe("solo", 1, 1, [b"Q"])
        export_engine(engine, self.path)
        imported = StorageEngine()
        import_file(imported, self.path)
        self.assertEqual(imported.list_stripes(), ["empty", "solo"])
        self.assertEqual(
            imported.get_stripe("solo").block(0).content, b"Q"
        )

    def test_json_structure_fields(self) -> None:
        engine = build_rich_engine()
        snapshot = export_engine_to_dict(engine)
        for field_name in (
            "format", "format_version", "coding", "stripes",
            "repair_history", "verification_reports",
        ):
            self.assertIn(field_name, snapshot)
        # 重新解析该字典不报错。
        parse_snapshot(snapshot)

    def test_short_missing_block_roundtrip_preserves_padding(self) -> None:
        """短块缺失的导出/导入往返：结构、补零、记录、指纹与逻辑内容一致。"""
        import hashlib

        def build() -> StorageEngine:
            engine = StorageEngine()
            engine.create_stripe(
                "short", k=3, m=2, data_blocks=[b"A", b"BB", b"CCC"]
            )
            # 两个短数据块同时缺失（位置 0 pad=2、位置 1 pad=1）。
            engine.mark_missing("short", 0)
            engine.mark_missing("short", 1)
            return engine

        engine = build()
        path = os.path.join(self.temp_dir, "short.json")
        export_engine(engine, path)

        imported = StorageEngine()
        import_file(imported, path)

        # 1) 往返后缺失状态与“缺失块带的填充长度”都保留。
        for pos, pad in ((0, 2), (1, 1)):
            block = imported.get_stripe("short").block(pos)
            self.assertEqual(block.status, BlockStatus.MISSING)
            self.assertIsNone(block.content)
            self.assertEqual(block.pad_length, pad)
        # 结构（含 block_length、全部补零数）逐字段一致。
        self.assertEqual(
            imported.get_stripe("short").to_dict(),
            engine.get_stripe("short").to_dict(),
        )

        # 2) 在导出前状态与导入后状态上分别修复，记录必须完全一致。
        before_record = engine.repair_stripe("short").to_dict()
        after_record = imported.repair_stripe("short").to_dict()
        self.assertEqual(after_record, before_record)

        # 3) 重建内容被截回逻辑长度（不含补零），指纹对应逻辑内容。
        self.assertEqual(imported.get_stripe("short").block(0).content, b"A")
        self.assertEqual(imported.get_stripe("short").block(1).content, b"BB")
        self.assertEqual(imported.get_stripe("short").block(2).content, b"CCC")
        self.assertEqual(
            after_record["adopted_fingerprints"]["0"],
            hashlib.sha256(b"A").hexdigest(),
        )
        self.assertEqual(
            after_record["adopted_fingerprints"]["1"],
            hashlib.sha256(b"BB").hexdigest(),
        )
        # 修复后补零数恢复，验证报告往返一致。
        self.assertEqual(
            imported.get_stripe("short").block(0).pad_length, 2
        )
        repaired_path = os.path.join(self.temp_dir, "short_repaired.json")
        export_engine(imported, repaired_path)
        re_repaired = StorageEngine()
        import_file(re_repaired, repaired_path)
        self.assertEqual(
            re_repaired.get_stripe("short").to_dict(),
            imported.get_stripe("short").to_dict(),
        )
        self.assertEqual(
            re_repaired.verify_stripe("short").to_dict(),
            imported.verify_stripe("short").to_dict(),
        )

    def test_candidate_consistent_with_parity_roundtrip(self) -> None:
        """多数候选恰与校验推导一致：采纳一致那份并记录依据，往返保持。

        位置 0 缺失后登记 3 份候选：2 份与其余块推导出的校验值一致、
        1 份不一致。按写死的候选规则取严格多数（即与校验一致的那份），
        used_positions 为空（依据是候选来源而非校验块）。该结论与导出
        前完全一致。
        """
        data = [b"AAAA", b"BBBB", b"CCCC"]

        def build() -> StorageEngine:
            engine = StorageEngine()
            engine.create_stripe("cand", k=3, m=2, data_blocks=data)
            engine.mark_missing("cand", 0)
            engine.add_candidate("cand", 0, "good-a", data[0])
            engine.add_candidate("cand", 0, "good-b", data[0])
            engine.add_candidate("cand", 0, "bad-x", b"ZZZZ")
            return engine

        engine = build()
        record = engine.repair_stripe("cand")
        self.assertTrue(record.success, record.reason)
        self.assertEqual(engine.get_stripe("cand").block(0).content, data[0])
        self.assertEqual(record.candidate_sources, {0: "good-a"})
        self.assertEqual(record.used_positions, [])

        path = os.path.join(self.temp_dir, "cand.json")
        export_engine(engine, path)
        imported = StorageEngine()
        import_file(imported, path)

        # 条带结构（修复后候选已清空）、修复历史、验证报告全部一致。
        self.assertEqual(
            imported.get_stripe("cand").to_dict(),
            engine.get_stripe("cand").to_dict(),
        )
        self.assertEqual(
            [r.to_dict() for r in imported.repair_history("cand")],
            [r.to_dict() for r in engine.repair_history("cand")],
        )
        self.assertEqual(
            imported.verify_stripe("cand").to_dict(),
            engine.verify_stripe("cand").to_dict(),
        )
        self.assertTrue(imported.verify_stripe("cand").reconstructable)



class CorruptFileTests(unittest.TestCase):
    """损坏、缺字段、非法引用必须清晰拒绝，且状态不变。"""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.good_path = os.path.join(self.temp_dir, "good.json")
        engine = build_rich_engine()
        export_engine(engine, self.good_path)
        with open(self.good_path, encoding="utf-8") as handle:
            self.snapshot = json.load(handle)

    def _load(self, target: StorageEngine, snapshot: object) -> None:
        load_snapshot(target, snapshot)

    def _assert_rejected(self, snapshot: object, fragment: str = "") -> None:
        target = build_rich_engine()
        before = json.dumps(target.internal_state(), sort_keys=True)
        with self.assertRaises(SerializationError) as ctx:
            self._load(target, snapshot)
        if fragment:
            self.assertIn(fragment, str(ctx.exception))
        after = json.dumps(target.internal_state(), sort_keys=True)
        self.assertEqual(before, after)

    def test_not_json(self) -> None:
        path = os.path.join(self.temp_dir, "broken.json")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("{not valid json !!!")
        engine = StorageEngine()
        with self.assertRaises(SerializationError) as ctx:
            import_file(engine, path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_missing_file(self) -> None:
        engine = StorageEngine()
        with self.assertRaises(SerializationError):
            import_file(engine, os.path.join(self.temp_dir, "missing.json"))

    def test_root_not_object(self) -> None:
        self._assert_rejected([1, 2, 3])

    def test_missing_top_level_fields(self) -> None:
        for field_name in ("format", "format_version", "stripes"):
            broken = dict(self.snapshot)
            del broken[field_name]
            self._assert_rejected(broken, field_name)

    def test_bad_format_and_version(self) -> None:
        broken = dict(self.snapshot)
        broken["format"] = "something-else"
        self._assert_rejected(broken, "unsupported snapshot format")
        broken = dict(self.snapshot)
        broken["format_version"] = 99
        self._assert_rejected(broken, "unsupported snapshot version")

    def test_duplicate_stripe_id(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        broken["stripes"].append(broken["stripes"][0])
        self._assert_rejected(broken, "duplicate stripe id")

    def test_block_count_mismatch(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        alpha = broken["stripes"][0]
        alpha["blocks"].pop()
        self._assert_rejected(broken)

    def test_non_contiguous_positions(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        alpha = broken["stripes"][0]
        alpha["blocks"][-1]["position"] = 99
        self._assert_rejected(broken, "contiguous")

    def test_invalid_status(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        broken["stripes"][0]["blocks"][0]["status"] = "nonsense"
        self._assert_rejected(broken)

    def test_undecodable_content(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        broken["stripes"][0]["blocks"][1]["content"] = "!!!not base64!!!"
        self._assert_rejected(broken, "base64")

    def test_candidate_fingerprint_mismatch(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        # alpha 当前无候选；直接给 beta 条带加一条指纹错误的候选。
        beta = next(s for s in broken["stripes"] if s["stripe_id"] == "beta")
        beta["blocks"][0]["candidates"] = [
            {"source": "r", "content": "YQ==", "fingerprint": "0" * 64}
        ]
        self._assert_rejected(broken, "fingerprint mismatch")

    def test_padding_inconsistent(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        block = broken["stripes"][0]["blocks"][0]
        block["pad_length"] = 999
        self._assert_rejected(broken, "pad_length")

    def test_history_references_unknown_stripe(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        broken["repair_history"]["ghost"] = []
        self._assert_rejected(broken, "unknown stripe")

    def test_history_bad_sequence_and_position(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        records = broken["repair_history"]["alpha"]
        records[0]["sequence"] = 50
        self._assert_rejected(broken, "contiguous")
        broken = json.loads(json.dumps(self.snapshot))
        broken["repair_history"]["alpha"][0]["target_positions"] = [123]
        self._assert_rejected(broken)

    def test_history_failed_without_reason(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        record = broken["repair_history"]["alpha"][0]
        record["success"] = False
        record["reason"] = None
        self._assert_rejected(broken)

    def test_report_references_unknown_stripe(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        broken["verification_reports"]["ghost"] = {}
        self._assert_rejected(broken, "unknown stripe")

    def test_report_bad_position_key(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        report = broken["verification_reports"]["alpha"]
        report["positions"]["999"] = "intact"
        self._assert_rejected(broken)

    def test_intact_without_content(self) -> None:
        broken = json.loads(json.dumps(self.snapshot))
        block = broken["stripes"][0]["blocks"][1]
        block["status"] = "intact"
        block["content"] = None
        self._assert_rejected(broken)


if __name__ == "__main__":
    unittest.main()
