"""离线验收测试：逐条对应需求 1-8。

运行： python -m unittest discover -s tests -v
或：   python tests/test_orchestrator.py
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import link_orchestrator as lo
from link_orchestrator.persistence import save_state, load_state, snapshot_dict
from link_orchestrator import errors as err


def build_three_links(classes=("control", "telemetry", "bulk")):
    o = lo.LinkOrchestrator(list(classes))
    o.add_link("L1", 1, 1000)
    o.add_link("L2", 2, 600)
    o.add_link("L3", 2, 600)  # 与 L2 同优先级、同初始容量，用于字典序平局
    return o


class Requirement1LinksReports(unittest.TestCase):
    """需求1：链路维护、幂等上报、带宽/时刻拒绝并指出位置。"""

    def test_link_fields_and_duplicate(self):
        o = lo.LinkOrchestrator()
        link = o.add_link("wan-a", 3, 5000)
        self.assertEqual((link.id, link.priority, link.bandwidth), ("wan-a", 3, 5000))
        with self.assertRaises(err.DuplicateIdError) as cm:
            o.add_link("wan-a", 1, 100)
        self.assertIn("wan-a", str(cm.exception))

    def test_bandwidth_must_be_positive_with_location(self):
        o = lo.LinkOrchestrator()
        for bad in (0, -1):
            with self.assertRaises(err.ValidationError) as cm:
                o.add_link("X", 1, bad)
            self.assertEqual(cm.exception.location, "links[X].bandwidth")
            self.assertIn(str(bad), str(cm.exception))

    def test_idempotent_duplicate_report(self):
        o = build_three_links()
        r1 = o.report_health("L2", 5, False, "probe")
        self.assertFalse(r1["duplicate"])
        r2 = o.report_health("L2", 5, False, "probe")  # 完全重复
        self.assertTrue(r2["duplicate"])
        self.assertEqual(len(o.reports["L2"]), 1)

    def test_clock_regression_rejected_with_location(self):
        o = build_three_links()
        o.report_health("L2", 10, True, "probe")
        with self.assertRaises(err.ClockRejectedError) as cm:
            o.report_health("L2", 9, True, "probe")
        self.assertEqual(cm.exception.link_id, "L2")
        self.assertIn("reports", cm.exception.location)
        self.assertIn("倒退", str(cm.exception))
        # 被拒绝的上报不得进入存储
        self.assertEqual([r.time for r in o.reports["L2"]], [10])

    def test_report_on_unknown_link(self):
        o = build_three_links()
        with self.assertRaises(err.NotFoundError):
            o.report_health("ZZ", 1, True, "probe")


class Requirement2SessionsMigrations(unittest.TestCase):
    """需求2：会话维护与迁移记录，迁移到不存在/失效链路被拒并说明。"""

    def test_session_fields_and_initial_placement(self):
        o = build_three_links()
        rec = o.add_session("S1", "control", 300)
        self.assertEqual(rec.from_link, None)
        self.assertEqual(rec.to_link, "L1")
        s = o.sessions["S1"]
        self.assertEqual((s.id, s.service_class, s.bytes_sent, s.current_link),
                         ("S1", "control", 300, "L1"))

    def test_duplicate_session(self):
        o = build_three_links()
        o.add_session("S1", "control", 10)
        with self.assertRaises(err.DuplicateIdError):
            o.add_session("S1", "telemetry", 20)

    def test_migrate_records_from_to_time(self):
        o = build_three_links()
        o.add_session("S1", "control", 100)
        rec = o.migrate("S1", "L2", time=7, reason="维护切换")
        self.assertEqual((rec.from_link, rec.to_link, rec.time), ("L1", "L2", 7))
        self.assertEqual(o.get_carrier("S1"), "L2")

    def test_migrate_to_unknown_link(self):
        o = build_three_links()
        o.add_session("S1", "control", 100)
        with self.assertRaises(err.NotFoundError):
            o.migrate("S1", "NOPE")

    def test_migrate_to_failed_link(self):
        o = build_three_links()
        o.add_session("S1", "control", 100)
        o.report_health("L2", 1, False, "probe")
        with self.assertRaises(err.LinkUnavailableError) as cm:
            o.migrate("S1", "L2")
        self.assertEqual(cm.exception.link_id, "L2")
        self.assertIn("不可用", str(cm.exception))
        # 被拒绝后承载链路不变
        self.assertEqual(o.get_carrier("S1"), "L1")


class Requirement3EvacuationAndCapacity(unittest.TestCase):
    """需求3：故障按业务类别优先级迁移，容量超限拒绝并给剩余容量。"""

    def test_evacuation_order_and_capacity_respected(self):
        o = build_three_links()
        o.add_session("A", "control", 300)    # 类别优先级最高
        o.add_session("B", "telemetry", 400)
        o.add_session("C", "bulk", 200)
        r = o.report_health("L1", 1, False, "probe")
        # control 先迁 → L2（剩 300）；telemetry 400 放不下 L2 → L3（剩 200）；
        # bulk 200：L2 剩 300、L3 剩 200，同优先级同剩余 → 字典序 L2
        moved = {m.session_id: m.to_link for m in r["migrations"]}
        self.assertEqual(moved, {"A": "L2", "B": "L3", "C": "L2"})
        # 迁移记录的时间顺序即业务类别优先级顺序
        self.assertEqual([m.session_id for m in r["migrations"]], ["A", "B", "C"])
        self.assertLessEqual(o.link_inflight("L2"), 600)
        self.assertLessEqual(o.link_inflight("L3"), 600)

    def test_evacuation_does_not_touch_unaffected_sessions(self):
        o = build_three_links()
        o.report_health("L2", 1, False, "probe")  # L2 一开始就不可用
        o.add_session("S", "control", 100)       # 自动放到 L1
        o.report_health("L3", 1, False, "probe")  # L3 不可用，L1 上的会话不受影响
        self.assertEqual(o.get_carrier("S"), "L1")

    def test_capacity_exceeded_reports_free(self):
        o = build_three_links()
        o.add_session("BIG", "bulk", 500, initial_link="L2")  # L2 剩 100
        o.add_session("NEW", "control", 200)                  # 落到 L1
        o.report_health("L1", 1, False, "probe")
        # NEW 需要 200：L2 只剩 100，L3 剩 600 → 去 L3，不超限
        self.assertEqual(o.get_carrier("NEW"), "L3")
        with self.assertRaises(err.CapacityExceededError) as cm:
            o.migrate("BIG", "L3")  # L3 已占 NEW 的 200，再放 500 > 600
        self.assertEqual(cm.exception.link_id, "L3")
        self.assertEqual(cm.exception.free_capacity, 400)
        self.assertEqual(cm.exception.need, 500)

    def test_session_too_big_for_every_link_strands_with_free_table(self):
        o = lo.LinkOrchestrator(["control"])
        o.add_link("SLOW", 1, 100)
        with self.assertRaises(err.CapacityExceededError) as cm:
            o.add_session("HUGE", "control", 999)
        self.assertIsNone(cm.exception.link_id)
        self.assertIn("999", str(cm.exception))
        self.assertEqual(cm.exception.free_table, {"SLOW": 100})


class Requirement4DeterministicSelection(unittest.TestCase):
    """需求4：确定性选路 (优先级, 剩余容量降序, 标识字典序)。"""

    def test_priority_then_free_then_id(self):
        o = build_three_links()
        # 全部空闲：L1 优先级最高
        self.assertEqual(o._choose_link(10), "L1")
        o.report_health("L1", 1, False, "probe")
        # L2/L3 同优先级同空闲 → 字典序 L2
        self.assertEqual(o._choose_link(10), "L2")
        o.add_session("X", "bulk", 100, initial_link="L2")  # L2 剩 500
        # L3 剩余容量更大（600 > 500）→ L3
        self.assertEqual(o._choose_link(550), "L3")

    def test_repeated_selection_identical(self):
        o = build_three_links()
        seq = [tuple(o._choose_link(50) for _ in range(3))]
        self.assertEqual(seq, [("L1", "L1", "L1")])
        # 重放后选路结果完全一致
        ref = o.replay()
        self.assertEqual(ref._choose_link(50), o._choose_link(50))


class Requirement5Conflicts(unittest.TestCase):
    """需求5：矛盾健康状态双方保留、可读冲突记录、不静默择一、不中断其他会话。"""

    def test_conflict_keeps_both_and_records(self):
        o = build_three_links()
        o.add_session("S1", "control", 100, initial_link="L1")
        o.add_session("S2", "control", 100, initial_link="L2")
        r1 = o.report_health("L1", 1, False, "probe-a")
        self.assertTrue(r1["migrations"])           # 一致的首个上报触发迁出
        r2 = o.report_health("L1", 1, True, "probe-b")
        self.assertTrue(r2["conflicts"])
        self.assertTrue(r2["undone"])               # 动作被撤销
        states = {r.source: r.available for r in o.reports["L1"] if r.time == 1}
        self.assertEqual(states, {"probe-a": False, "probe-b": True})  # 双方保留
        conflicts = o.unresolved_conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual((c.link_id, c.source_a, c.source_b),
                         ("L1", "probe-a", "probe-b"))
        text = c.describe()
        for word in ("L1", "probe-a", "probe-b", "可用", "不可用"):
            self.assertIn(word, text)
        # 撤销后 S1 回到 L1；L2 上原本的 S2 从未被打断
        self.assertEqual(o.get_carrier("S1"), "L1")
        self.assertEqual(o.get_carrier("S2"), "L2")

    def test_conflict_without_state_flip_does_nothing(self):
        # 链路一直可用，同刻一个说可用一个说不可用：冲突记录在案，无迁移
        o = build_three_links()
        o.add_session("S", "control", 10, initial_link="L1")
        o.report_health("L1", 1, True, "a")
        r = o.report_health("L1", 1, False, "b")
        self.assertTrue(r["conflicts"])
        self.assertFalse(r["migrations"])
        self.assertEqual(o.get_carrier("S"), "L1")

    def test_third_agreeing_report_stays_conflicted(self):
        o = build_three_links()
        o.report_health("L1", 1, True, "a")
        self.assertTrue(o.report_health("L1", 1, False, "b")["conflicts"])
        # 再来一个“可用”：与 b 构成新的一对矛盾 (b,c)，冲突仍不能静默消除
        r = o.report_health("L1", 1, True, "c")
        self.assertEqual(len(r["conflicts"]), 1)
        pair = r["conflicts"][0]
        self.assertEqual((pair.source_a, pair.source_b), ("b", "c"))
        self.assertEqual(len(o.unresolved_conflicts()), 2)
        # 三方意见不一，链路维持冲突前状态（可用），不触发任何迁移
        self.assertEqual(o.available_links(100), ["L1", "L2", "L3"])

    def test_same_source_cannot_flip_at_same_time(self):
        o = build_three_links()
        o.report_health("L1", 1, True, "a")
        with self.assertRaises(err.ValidationError):
            o.report_health("L1", 1, False, "a")


class Requirement6Recovery(unittest.TestCase):
    """需求6：恢复只重算受影响会话，且与从头重排完全一致。"""

    def test_recompute_matches_replay_and_keeps_unaffected(self):
        o = build_three_links()
        o.add_session("A", "control", 300)
        o.add_session("B", "telemetry", 400)
        o.add_session("C", "bulk", 50, initial_link="L2")  # 从不在 L1 上
        o.report_health("L1", 1, False, "probe")
        displaced_a = o.get_carrier("A")
        displaced_b = o.get_carrier("B")
        before_c = o.get_carrier("C")
        r = o.report_health("L1", 3, True, "probe")
        moved_sessions = {m.session_id for m in r["migrations"]}
        self.assertEqual(moved_sessions, {"A", "B"})    # C 未受影响
        self.assertEqual(o.get_carrier("C"), before_c)
        self.assertNotEqual(o.get_carrier("A"), displaced_a)
        # 增量结果 == 事件日志从头重排
        o.verify_consistency()
        ref = o.replay()
        for sid in ("A", "B", "C"):
            self.assertEqual(o.get_carrier(sid), ref.get_carrier(sid))

    def test_recovery_brings_back_stranded_session(self):
        o = lo.LinkOrchestrator(["control", "bulk"])
        o.add_link("MAIN", 1, 100)
        o.add_link("BACKUP", 2, 60)
        o.add_session("BIG", "bulk", 90, initial_link="MAIN")
        o.report_health("MAIN", 1, False, "probe")     # BACKUP 放不下 → 搁浅
        self.assertIsNone(o.get_carrier("BIG"))
        r = o.report_health("MAIN", 2, True, "probe")  # 恢复 → 回迁
        self.assertEqual([(m.session_id, m.to_link) for m in r["migrations"]],
                         [("BIG", "MAIN")])
        o.verify_consistency()


class Requirement7Queries(unittest.TestCase):
    """需求7：承载链路/轨迹、在途/剩余、任意时刻可用集合、未解决冲突，稳定顺序。"""

    def test_queries_stable_order(self):
        o = build_three_links()
        o.add_session("Z", "bulk", 100)
        o.add_session("A", "control", 200)
        o.report_health("L1", 1, False, "probe-a")
        o.report_health("L1", 1, True, "probe-b")  # 冲突
        # 迁移轨迹按序号
        traj = [(m.from_link, m.to_link) for m in o.get_trajectory("Z")]
        self.assertEqual(traj[0], (None, "L1"))
        # 在途/剩余
        load = o.get_link_load("L1")
        self.assertEqual(load["inflight"], 300)
        self.assertEqual(load["free"], 700)
        # 任意时刻可用集合（字典序）
        self.assertEqual(o.available_links(at_time=0), ["L1", "L2", "L3"])
        # 未解决冲突稳定
        self.assertEqual([c.link_id for c in o.unresolved_conflicts()], ["L1"])


class Requirement8Persistence(unittest.TestCase):
    """需求8：单文件保存/载入、校验、损坏清晰报错且失败不改变内存。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snapshot.json")

    def _complex(self):
        o = build_three_links()
        o.add_session("A", "control", 300)
        o.add_session("B", "telemetry", 400)
        o.add_session("C", "bulk", 200)
        o.report_health("L1", 1, False, "probe-a")
        o.report_health("L1", 1, True, "probe-b")
        o.report_health("L1", 3, True, "probe-a")
        o.resolve_conflict("C0001", "现场已核实，按可用处置")
        return o

    def test_roundtrip(self):
        o = self._complex()
        save_state(self.path, o)
        loaded = load_state(self.path)
        self.assertEqual(loaded._state_signature(), o._state_signature())
        loaded.verify_consistency()

    def test_corrupt_json_reports_position(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{ not json")
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertIn("JSON", str(cm.exception))

    def test_missing_field_rejected(self):
        o = self._complex()
        raw = snapshot_dict(o)
        del raw["links"][0]["bandwidth"]
        self._recompute_checksum(raw)  # 绕过校验和，直达字段级校验
        self._write(raw)
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertIn("bandwidth", str(cm.exception))

    def test_raw_deletion_without_checksum_rejected_as_corruption(self):
        # 不重算校验和直接删字段：应被清晰地判为损坏（校验和不匹配）
        o = self._complex()
        raw = snapshot_dict(o)
        del raw["links"][0]["bandwidth"]
        self._write(raw)
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertIn("校验和", str(cm.exception))

    def test_checksum_tamper_rejected(self):
        o = self._complex()
        save_state(self.path, o)
        raw = self._read()
        raw["clock"] = raw["clock"] + 1  # 改内容但不改 checksum
        self._write(raw)
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertIn("校验和", str(cm.exception))

    def test_capacity_violation_rejected(self):
        o = self._complex()
        raw = snapshot_dict(o)
        raw["sessions"][0]["bytes_sent"] = 10 ** 9
        self._recompute_checksum(raw)
        self._write(raw)
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertIn("带宽上限", str(cm.exception))

    def test_duplicate_ids_rejected(self):
        o = self._complex()
        raw = snapshot_dict(o)
        raw["links"][1]["id"] = raw["links"][0]["id"]
        self._recompute_checksum(raw)
        self._write(raw)
        with self.assertRaises(err.PersistenceError):
            load_state(self.path)

    def test_illegal_migration_source_rejected(self):
        o = self._complex()
        raw = snapshot_dict(o)
        # 把某条非首条迁移的来源改成不存在的链路
        mig = next(m for m in raw["migrations"] if m["from_link"] is not None)
        mig["from_link"] = "GHOST"
        self._recompute_checksum(raw)
        self._write(raw)
        with self.assertRaises(err.PersistenceError) as cm:
            load_state(self.path)
        self.assertTrue("迁移来源" in str(cm.exception) or "不存在" in str(cm.exception))

    def test_failed_load_keeps_memory_intact(self):
        good = self._complex()
        save_state(self.path, good)
        target = load_state(self.path)
        sig_before = target._state_signature()

        bad = snapshot_dict(self._complex())
        bad["sessions"][0]["bytes_sent"] = -7
        self._recompute_checksum(bad)
        badpath = os.path.join(self.tmp, "bad.json")
        with open(badpath, "w", encoding="utf-8") as f:
            json.dump(bad, f)
        with self.assertRaises(err.PersistenceError):
            lo.load_state_into(badpath, target)
        self.assertEqual(target._state_signature(), sig_before)

    def _read(self):
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write(self, raw):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(raw, f)

    @staticmethod
    def _recompute_checksum(raw):
        import hashlib
        payload = {k: v for k, v in raw.items() if k != "checksum"}
        canon = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":")).encode("utf-8")
        raw["checksum"] = hashlib.sha256(canon).hexdigest()


if __name__ == "__main__":
    unittest.main(verbosity=2)
