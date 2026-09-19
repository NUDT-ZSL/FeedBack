# -*- coding: utf-8 -*-
import json
import os
import unittest

from engine import Store

SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data.json")


def fresh():
    s = Store()
    s.load_seed(SEED)
    return s


def ship(store, sid):
    st = store.get_state()
    return next(x for x in st["shipments"] if x["id"] == sid)


class EngineTest(unittest.TestCase):
    def test_seed_conflict_pending_interrupts_sh001(self):
        s = fresh()
        sh = ship(s, "SH-001")
        self.assertEqual(sh["status"], "interrupted")
        self.assertEqual(sh["interruption"]["reason"], "unreachable")
        self.assertTrue(any(c["step"] == "冲突" for c in sh["interruption"]["chain"]))
        st = s.get_state()
        cf = [c for c in st["conflicts"] if c["shipment_id"] == "SH-001"]
        self.assertEqual(len(cf), 1)
        self.assertFalse(cf[0]["adjudicated"])
        self.assertEqual({x["id"] for x in cf[0]["signals"]}, {"SIG-A2", "SIG-A3"})

    def test_adjudicate_keep_recovery_clears_interruption(self):
        s = fresh()
        s.adjudicate("CONFLICT::SH-001::2", "SH-001", 2, ["SIG-A3"])
        sh = ship(s, "SH-001")
        self.assertNotEqual(sh["status"], "interrupted")
        self.assertIsNone(sh["interruption"])

    def test_adjudicate_keep_closure_keeps_interruption(self):
        s = fresh()
        s.adjudicate("CONFLICT::SH-001::2", "SH-001", 2, ["SIG-A2"])
        sh = ship(s, "SH-001")
        self.assertEqual(sh["status"], "interrupted")
        self.assertEqual(sh["interruption"]["reason"], "unreachable")

    def test_reroute_action_resolves_unreachable(self):
        s = fresh()
        s.adjudicate("CONFLICT::SH-001::2", "SH-001", 2, ["SIG-A2"])
        s.add_action({"shipment_id": "SH-001", "leg_index": 2, "kind": "reroute",
                      "owner": "dispatch", "signal_id": "SIG-A2"})
        sh = ship(s, "SH-001")
        self.assertNotEqual(sh["status"], "interrupted")
        leg2 = next(l for l in sh["legs"] if l["index"] == 2)
        self.assertEqual(leg2["action_delay"], 45)

    def test_sh002_interrupted_with_evidence_chain(self):
        s = fresh()
        sh = ship(s, "SH-002")
        self.assertEqual(sh["status"], "interrupted")
        chain = sh["interruption"]["chain"]
        self.assertTrue(any(c["step"] == "结论" for c in chain))
        unreachable_nodes = [n for n in sh["nodes"] if n["status"] == "unreachable"]
        self.assertTrue(unreachable_nodes)
        self.assertTrue(all(n["eta"] is None for n in unreachable_nodes))

    def test_correction_supersedes_original(self):
        s = fresh()
        self.assertEqual(s.signals["SIG-C2"]["status"], "superseded")
        sh = ship(s, "SH-003")
        leg1 = next(l for l in sh["legs"] if l["index"] == 1)
        self.assertEqual(leg1["signal_delay"], 25)

    def test_response_timeout_interrupts(self):
        s = fresh()
        s.add_signal({"shipment_id": "SH-004", "occurred_at": "2026-09-19T16:00",
                      "type": "congestion", "severity": 5, "source": "iot",
                      "leg_index": 0, "delay_minutes": 60, "note": "严重拥堵"})
        sh = ship(s, "SH-004")
        self.assertEqual(sh["status"], "interrupted")
        self.assertEqual(sh["interruption"]["reason"], "timeout")

    def test_manual_cancel_interrupts(self):
        s = fresh()
        s.add_action({"shipment_id": "SH-004", "leg_index": 1, "kind": "cancel_leg",
                      "owner": "dispatch"})
        sh = ship(s, "SH-004")
        self.assertEqual(sh["status"], "interrupted")
        self.assertEqual(sh["interruption"]["reason"], "manual_cancel")

    def test_incremental_matches_full_recompute(self):
        s = fresh()
        s.add_signal({"shipment_id": "SH-003", "occurred_at": "2026-09-19T11:30",
                      "type": "congestion", "severity": 3, "source": "iot",
                      "leg_index": 1, "delay_minutes": 40})
        s.adjudicate("CONFLICT::SH-001::2", "SH-001", 2, ["SIG-A3"])
        s.add_action({"shipment_id": "SH-001", "leg_index": 2, "kind": "expedite",
                      "owner": "carrier"})
        s.retract_signal("SIG-B2")
        s.add_signal({"shipment_id": "SH-004", "occurred_at": "2026-09-19T17:00",
                      "type": "weather", "severity": 2, "source": "dispatch",
                      "leg_index": 0, "delay_minutes": 15})
        inc = json.dumps(s.get_state()["shipments"], sort_keys=True)
        s.recompute_all()
        full = json.dumps(s.get_state()["shipments"], sort_keys=True)
        self.assertEqual(inc, full)

    def test_new_signal_after_adjudication_reopens_conflict(self):
        s = fresh()
        s.adjudicate("CONFLICT::SH-001::2", "SH-001", 2, ["SIG-A3"])
        s.add_signal({"shipment_id": "SH-001", "occurred_at": "2026-09-19T15:00",
                      "type": "road_closure", "severity": 4, "source": "iot",
                      "leg_index": 2, "unreachable": True, "note": "二次封闭"})
        st = s.get_state()
        cf = next(c for c in st["conflicts"] if c["shipment_id"] == "SH-001")
        self.assertFalse(cf["adjudicated"])
        self.assertEqual(ship(s, "SH-001")["status"], "interrupted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
