"""快照导入/导出的单元测试：往返一致性、校验与失败原子性。"""

import json
import os
import tempfile
import unittest

from leasekernel.clock import ManualClock
from leasekernel.kernel import (
    FORMAT_VERSION,
    LeaseKernel,
    LeaseState,
    PersistenceError,
)


def _scripted_kernel() -> LeaseKernel:
    k = LeaseKernel(ManualClock(1000.0))
    k.register_resource("r1", ttl=100, epsilon=10)
    k.register_resource("r2", ttl=50, epsilon=0)
    k.acquire("r1", "a")
    k.clock.advance(40)
    k.renew("r1", "a", 1, local_time=1040.0)
    k.acquire("r2", "b")
    k.clock.advance(60)  # r2 到期（expire=1090）
    return k


class RoundTripTest(unittest.TestCase):
    def test_dict_roundtrip_preserves_state_and_log(self) -> None:
        k = _scripted_kernel()
        data = k.to_dict()
        k2 = LeaseKernel.from_dict(data)
        self.assertEqual(k2.to_dict(), data)
        st1 = k.status("r1").to_dict()
        st2 = k2.status("r1").to_dict()
        self.assertEqual(st1, st2)
        self.assertEqual(
            [e.to_dict() for e in k.events],
            [e.to_dict() for e in k2.events],
        )
        self.assertEqual(k2.clock.now, 1100.0)
        self.assertEqual(k2.clock.monotonic, 1100.0)

    def test_file_roundtrip(self) -> None:
        k = _scripted_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snapshot.json")
            k.export_json(path)
            k2 = LeaseKernel(ManualClock(0.0))
            k2.import_json(path)
            self.assertEqual(k2.to_dict(), k.to_dict())

    def test_roundtrip_after_clock_rollback(self) -> None:
        k = LeaseKernel(ManualClock(0.0))
        k.register_resource("r", ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(100)
        k.clock.set_time(50)  # now=50 但高水位 100
        data = k.to_dict()
        k2 = LeaseKernel.from_dict(data)
        self.assertEqual(k2.clock.now, 50.0)
        self.assertEqual(k2.clock.monotonic, 100.0)
        self.assertEqual(k2.status("r").state, LeaseState.EXPIRED)

    def test_operations_continue_after_restore(self) -> None:
        k = _scripted_kernel()
        k2 = LeaseKernel.from_dict(k.to_dict())
        k2.reclaim()  # r2 到期应可回收
        self.assertEqual(k2.status("r2").state, LeaseState.FREE)


class CorruptionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.good = _scripted_kernel().to_dict()

    def _expect_error(self, data: object) -> PersistenceError:
        with self.assertRaises(PersistenceError):
            LeaseKernel.from_dict(data)  # type: ignore[arg-type]
        # 对“导入到现有内核”还要验证原子性，由各用例单独断言。

    def test_top_level_not_object(self) -> None:
        self._expect_error([1, 2, 3])
        self._expect_error("nope")

    def test_bad_format_version(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["format_version"] = 999
        self._expect_error(bad)

    def test_missing_fields(self) -> None:
        for key in ("format_version", "seq", "clock", "resources", "events"):
            bad = json.loads(json.dumps(self.good))
            del bad[key]
            self._expect_error(bad)

    def test_clock_missing_field(self) -> None:
        bad = json.loads(json.dumps(self.good))
        del bad["clock"]["high"]
        self._expect_error(bad)

    def test_lease_expire_before_grant_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        lease = bad["resources"]["r1"]["lease"]
        lease["expire_mono"] = lease["grant_mono"] - 1
        self._expect_error(bad)

    def test_negative_epsilon_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["resources"]["r1"]["epsilon"] = -1
        self._expect_error(bad)

    def test_negative_ttl_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["resources"]["r1"]["ttl"] = 0
        self._expect_error(bad)

    def test_lease_generation_beyond_resource_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["resources"]["r1"]["lease"]["generation"] = 999
        self._expect_error(bad)

    def test_lease_wrong_resource_link_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["resources"]["r1"]["lease"]["resource"] = "r2"
        self._expect_error(bad)

    def test_event_seq_gap_rejected(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["events"][-1]["seq"] = 999
        self._expect_error(bad)

    def test_seq_event_count_mismatch(self) -> None:
        bad = json.loads(json.dumps(self.good))
        bad["seq"] = bad["seq"] + 1
        self._expect_error(bad)

    def test_event_missing_field(self) -> None:
        bad = json.loads(json.dumps(self.good))
        del bad["events"][0]["reason"]
        self._expect_error(bad)

    def test_broken_json_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not json")
            k = LeaseKernel()
            with self.assertRaises(PersistenceError) as cm:
                k.import_json(path)
            self.assertIn("JSON", str(cm.exception))

    def test_missing_file(self) -> None:
        k = LeaseKernel()
        with self.assertRaises(PersistenceError):
            k.import_json(os.path.join(tempfile.gettempdir(), "no-such-xyz.json"))

    def test_import_failure_leaves_state_unchanged(self) -> None:
        k = _scripted_kernel()
        before = k.to_dict()
        bad = json.loads(json.dumps(before))
        bad["resources"]["r1"]["lease"]["expire_mono"] = -999
        with self.assertRaises(PersistenceError):
            k.import_dict(bad)
        self.assertEqual(k.to_dict(), before)

    def test_import_failure_from_broken_file_leaves_state(self) -> None:
        k = _scripted_kernel()
        before = k.to_dict()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("[")
            with self.assertRaises(PersistenceError):
                k.import_json(path)
        self.assertEqual(k.to_dict(), before)

    def test_two_active_leases_cannot_be_constructed(self) -> None:
        # 结构上每个资源只保存一条当前租约；直接构造冲突字典会因
        # lease 段必须是对象/字段校验失败而无法产生“双持有者”。
        bad = json.loads(json.dumps(self.good))
        bad["resources"]["r1"]["lease"] = [
            bad["resources"]["r1"]["lease"],
            bad["resources"]["r1"]["lease"],
        ]
        self._expect_error(bad)

    def test_format_version_value(self) -> None:
        self.assertEqual(self.good["format_version"], FORMAT_VERSION)


if __name__ == "__main__":
    unittest.main()
