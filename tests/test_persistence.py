"""快照持久化测试：往返一致、损坏报错且失败后状态不变。"""
import json
import os
import tempfile
import unittest

from settlement import (
    CouponSpec,
    CouponStatus,
    OrderLine,
    SettlementEngine,
    dump_snapshot,
    load_snapshot,
)
from settlement.persistence import load_into
from settlement.errors import SnapshotFormatError


def build_engine():
    eng = SettlementEngine()
    eng.register_category("food", "食品")
    eng.register_category("book", "图书")
    eng.set_order(
        [
            OrderLine("L1", "food", 6000, 2, 12000),
            OrderLine("L2", "book", 4000, 1, 4000),
        ]
    )
    eng.add_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"], exclusive_group="G1", priority=1))
    eng.issue_coupon(CouponSpec.from_cents("C2", 1000, 900, ["book"]), "marketing", 1)
    eng.issue_coupon(CouponSpec.from_cents("C2", 1000, 800, ["book"]), "partner", 3)
    eng.resolve_conflict("C2", "partner")
    eng.solve()
    return eng


class SnapshotRoundTripTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snap.json")

    def test_round_trip_preserves_state_and_result(self):
        eng = build_engine()
        dump_snapshot(eng, self.path)
        loaded = load_snapshot(self.path)

        self.assertEqual([c.category_id for c in loaded.categories()], ["book", "food"])
        self.assertEqual([ln.line_id for ln in loaded.lines()], ["L1", "L2"])
        c2 = loaded.coupons()  # C1, C2 sorted
        ids = [c.coupon_id for c in c2]
        self.assertEqual(ids, ["C1", "C2"])
        self.assertEqual(next(c for c in c2 if c.coupon_id == "C2").status, CouponStatus.RESOLVED)

        res = loaded.last_result
        self.assertIsNotNone(res)
        # 重新求解必须得到完全相同的方案。
        again = loaded.solve()
        self.assertEqual(again.fingerprint, res.fingerprint)
        self.assertEqual(
            [(a.coupon_id, a.total_discount_cents) for a in again.applications],
            [(a.coupon_id, a.total_discount_cents) for a in res.applications],
        )

    def test_utf8_and_deterministic_bytes(self):
        eng = build_engine()
        dump_snapshot(eng, self.path)
        with open(self.path, "rb") as f:
            raw1 = f.read()
        dump_snapshot(eng, self.path)
        with open(self.path, "rb") as f:
            raw2 = f.read()
        self.assertEqual(raw1, raw2)  # 键排序 + 固定缩进 → 字节确定
        self.assertIn("食品".encode("utf-8"), raw1)

    def test_atomic_write_leaves_no_temp_files(self):
        eng = build_engine()
        dump_snapshot(eng, self.path)
        leftovers = [f for f in os.listdir(self.tmp) if f.startswith(".settlement-snap-")]
        self.assertEqual(leftovers, [])


class SnapshotCorruptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snap.json")
        dump_snapshot(build_engine(), self.path)
        with open(self.path, "rb") as f:
            self.original = f.read()

    def _write(self, payload):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(payload, f)

    def _mutate_text(self, old, new):
        text = self.original.decode("utf-8")
        self.assertIn(old, text)
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(text.replace(old, new, 1))

    def test_bad_json_rejected(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_missing_top_field_rejected(self):
        payload = json.loads(self.original)
        del payload["coupons"]
        self._write(payload)
        with self.assertRaises(SnapshotFormatError) as cm:
            load_snapshot(self.path)
        self.assertIn("coupons", str(cm.exception))

    def test_nonpositive_threshold_rejected(self):
        self._mutate_text('"threshold_cents": 5000', '"threshold_cents": -5')
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_duplicate_coupon_id_rejected(self):
        payload = json.loads(self.original)
        payload["coupons"][1]["coupon_id"] = "C1"
        for issue in payload["coupons"][1]["issues"]:
            issue["spec"]["coupon_id"] = "C1"
        self._write(payload)
        with self.assertRaises(SnapshotFormatError) as cm:
            load_snapshot(self.path)
        self.assertIn("重复", str(cm.exception))

    def test_line_references_unknown_category_rejected(self):
        self._mutate_text('"category_id": "food"', '"category_id": "ghost"', )
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_inconsistent_exclusive_status_rejected(self):
        # 状态标记为 conflicted 但把所有发放参数改成一致且删掉冲突记录 → 不自洽。
        payload = json.loads(self.original)
        c2 = next(c for c in payload["coupons"] if c["coupon_id"] == "C2")
        c2["issues"] = [c2["issues"][0], dict(c2["issues"][0])]
        c2["issues"][1]["source"] = "partner"
        c2["issues"][1]["version"] = 3
        self._write(payload)
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_tampered_result_fingerprint_rejected(self):
        payload = json.loads(self.original)
        payload["result"]["total_discount_cents"] += 1
        self._write(payload)
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_tampered_allocation_rejected(self):
        payload = json.loads(self.original)
        if payload["result"]["applications"]:
            payload["result"]["applications"][0]["allocations"][0][1] += 1
            payload["result"]["applications"][0]["total_discount_cents"] = (
                payload["result"]["applications"][0]["allocations"][0][1]
            )
        self._write(payload)
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(self.path)

    def test_failed_load_leaves_existing_engine_unchanged(self):
        good = build_engine()
        good_fp = good.solve().fingerprint

        self._mutate_text('"threshold_cents": 5000', '"threshold_cents": -5')
        with self.assertRaises(SnapshotFormatError):
            load_into(good, self.path)

        # 原引擎状态、求解结果不变。
        self.assertEqual(good.solve().fingerprint, good_fp)
        self.assertEqual(len(good.coupons()), 2)

    def test_missing_file_clear_error(self):
        with self.assertRaises(SnapshotFormatError):
            load_snapshot(os.path.join(self.tmp, "nope.json"))

    def test_unresolved_conflict_round_trips_frozen(self):
        eng = SettlementEngine()
        eng.register_category("food")
        eng.set_order([OrderLine("L1", "food", 6000, 1, 6000)])
        eng.issue_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]), "marketing", 1)
        eng.issue_coupon(CouponSpec.from_cents("C1", 3000, 1500, ["food"]), "partner", 2)
        res = eng.solve()
        self.assertEqual(res.selected_ids(), ())
        self.assertEqual(res.frozen_coupon_ids, ("C1",))
        path = os.path.join(self.tmp, "frozen.json")
        dump_snapshot(eng, path)
        loaded = load_snapshot(path)
        coupon = loaded.coupons()[0]
        self.assertEqual(coupon.status, CouponStatus.CONFLICTED)
        self.assertEqual(len(coupon.issues), 2)
        self.assertIsNone(coupon.conflict.resolved_source)
        loaded_res = loaded.last_result
        self.assertEqual(loaded_res.frozen_coupon_ids, ("C1",))
        self.assertEqual(loaded_res.selected_ids(), ())
        # 未选原因（frozen_conflict）也被复核。
        self.assertEqual(loaded_res.rejected[0].reason_code, "frozen_conflict")


if __name__ == "__main__":
    unittest.main()
