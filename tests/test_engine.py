import json
import tempfile
import unittest
from pathlib import Path

from app import service
from app.db import connect
from app.engine import recompute_all


class ReadingEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test.db"
        self.conn = connect(self.db_path)

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def state(self, material_id):
        return dict(self.conn.execute(
            "SELECT * FROM material_states WHERE material_id=?", (material_id,)
        ).fetchone())

    def create(self, title="A", length=100, topic=""):
        data = service.create_material(self.conn, {
            "title": title, "source": "test", "length_units": length, "topic": topic
        })
        return next(item["id"] for item in data["materials"] if item["title"] == title)

    def add_event(self, material_id, kind, **kwargs):
        service.create_event(self.conn, material_id, {"kind": kind, **kwargs})

    def snapshot_states(self):
        rows = self.conn.execute(
            """SELECT material_id,status,progress_units,progress_ratio,
                      basis_event_ids,open_conflict_ids,propagated_status,
                      propagated
               FROM material_states ORDER BY material_id"""
        ).fetchall()
        return [tuple(row) for row in rows]

    def assertMatchesFullRecompute(self):
        incremental = self.snapshot_states()
        recompute_all(self.conn)
        self.assertEqual(incremental, self.snapshot_states())

    def test_cumulative_actions_derive_status_and_basis(self):
        a = self.create("文章", 100)
        self.assertEqual(self.state(a)["status"], "not_started")
        self.add_event(a, "read", delta_units=30, note="读了第一节",
                       acted_at="2026-01-01T10:00:00")
        self.assertEqual(self.state(a)["status"], "in_progress")
        self.assertEqual(self.state(a)["progress_units"], 30)
        self.add_event(a, "checkpoint", position=60,
                       acted_at="2026-01-02T10:00:00")
        self.add_event(a, "finish", note="完成",
                       acted_at="2026-01-03T10:00:00")
        state = self.state(a)
        self.assertEqual(state["status"], "digested")
        self.assertEqual(state["progress_units"], 100)
        self.assertEqual(len(json.loads(state["basis_event_ids"])), 3)
        self.add_event(a, "note", note="观点不进入推进量",
                       acted_at="2026-01-04T10:00:00")
        self.assertEqual(len(json.loads(self.state(a)["basis_event_ids"])), 3)

    def test_contradictory_progress_is_retained_and_blocks_conclusion(self):
        a = self.create("矛盾", 100)
        self.add_event(a, "checkpoint", position=70,
                       acted_at="2026-01-01T10:00:00")
        self.add_event(a, "checkpoint", position=30,
                       acted_at="2026-01-02T10:00:00")
        state = self.state(a)
        self.assertEqual(state["status"], "conflict")
        self.assertEqual(len(json.loads(state["open_conflict_ids"])), 1)
        conflicts = self.conn.execute("SELECT * FROM conflicts").fetchall()
        self.assertEqual(len(conflicts), 1)
        events = self.conn.execute(
            "SELECT COUNT(*) AS n FROM reading_events WHERE active=1"
        ).fetchone()["n"]
        self.assertEqual(events, 2)
        conflict_id = conflicts[0]["id"]
        service.resolve_conflict(self.conn, conflict_id, {
            "resolution": "reject_later", "rationale": "旧设备书签未同步"
        })
        self.assertEqual(self.state(a)["status"], "in_progress")
        self.assertEqual(self.state(a)["progress_units"], 70)
        with self.assertRaises(service.ServiceError):
            service.set_event_active(self.conn,
                                     self.conn.execute(
                                         "SELECT id FROM reading_events ORDER BY acted_at DESC LIMIT 1"
                                     ).fetchone()["id"], True)
        service.reopen_conflict(self.conn, conflict_id)
        self.assertEqual(self.state(a)["status"], "conflict")

    def test_relations_and_topics_propagate_visibility(self):
        a = self.create("源头", 100, "主题X")
        b = self.create("续读", 80, "其他")
        c = self.create("同主题", 60, "主题X")
        self.add_event(a, "finish", acted_at="2026-01-01T10:00:00")
        service.create_relation(self.conn, {
            "from_material_id": b, "to_material_id": a,
            "kind": "continuation", "label": "续读"
        })
        self.assertEqual(self.state(b)["propagated_status"], "digested")
        self.assertEqual(self.state(c)["propagated_status"], "digested")
        self.assertTrue(any(
            item["material_id"] == a for item in json.loads(self.state(c)["propagated"])
        ))

    def test_resolved_out_of_range_conflict_keeps_manual_decision(self):
        a = self.create("越界", 100)
        self.add_event(a, "checkpoint", position=120,
                       acted_at="2026-01-01T10:00:00")
        self.assertEqual(self.state(a)["status"], "conflict")
        conflict_id = self.conn.execute("SELECT id FROM conflicts").fetchone()["id"]
        service.resolve_conflict(self.conn, conflict_id, {
            "resolution": "ignore", "rationale": "篇幅可能少填"
        })
        self.assertEqual(self.state(a)["status"], "digested")
        service.update_material(self.conn, a, {
            "title": "越界-改标题", "source": "test", "length_units": 100,
            "topic": ""
        })
        self.assertEqual(self.state(a)["status"], "digested")
        service.update_material(self.conn, a, {
            "title": "越界-改标题", "source": "test", "length_units": 120,
            "topic": ""
        })
        self.assertEqual(self.state(a)["status"], "digested")
        self.assertEqual(
            self.conn.execute(
                "SELECT resolution FROM conflicts WHERE id=?", (conflict_id,)
            ).fetchone()["resolution"],
            "ignore",
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) AS n FROM conflicts WHERE resolution=''"
            ).fetchone()["n"],
            0,
        )

    def test_incremental_matches_full_after_edits_relations_and_resolution(self):
        a = self.create("A", 100, "T")
        b = self.create("B", 100, "T")
        c = self.create("C", 100, "U")
        self.add_event(a, "read", delta_units=20,
                       acted_at="2026-01-01T10:00:00")
        self.add_event(b, "checkpoint", position=40,
                       acted_at="2026-01-01T11:00:00")
        self.add_event(c, "read", delta_units=10,
                       acted_at="2026-01-01T12:00:00")
        service.create_relation(self.conn, {
            "from_material_id": a, "to_material_id": c, "kind": "citation"
        })
        self.assertMatchesFullRecompute()

        events = self.conn.execute(
            "SELECT id FROM reading_events WHERE material_id=? ORDER BY id", (a,)
        ).fetchall()
        service.update_event(self.conn, events[0]["id"], {
            "kind": "read", "delta_units": 90, "note": "修正页数",
            "acted_at": "2026-01-01T10:00:00"
        })
        self.assertMatchesFullRecompute()

        service.update_material(self.conn, a, {
            "title": "A2", "source": "test", "length_units": 80, "topic": "V"
        })
        self.assertMatchesFullRecompute()

        conflict = self.conn.execute("SELECT id FROM conflicts LIMIT 1").fetchone()
        self.assertIsNotNone(conflict)
        service.resolve_conflict(self.conn, conflict["id"], {
            "resolution": "reject_event", "rationale": "多记了页数"
        })
        self.assertMatchesFullRecompute()

        relation = self.conn.execute("SELECT id FROM relations LIMIT 1").fetchone()
        service.delete_relation(self.conn, relation["id"])
        self.assertMatchesFullRecompute()

    def test_note_does_not_change_position_but_remains_visible(self):
        a = self.create("带观点", 100)
        self.add_event(a, "read", delta_units=12,
                       acted_at="2026-01-01T10:00:00")
        self.add_event(a, "note", note="这篇文章的前提值得怀疑",
                       acted_at="2026-01-01T11:00:00")
        state = self.state(a)
        self.assertEqual(state["status"], "in_progress")
        self.assertEqual(state["progress_units"], 12)
        events = self.conn.execute(
            "SELECT COUNT(*) AS n FROM reading_events WHERE kind='note'"
        ).fetchone()["n"]
        self.assertEqual(events, 1)

    def test_read_after_checkpoint_starts_from_checkpoint(self):
        a = self.create("续点", 100)
        self.add_event(a, "checkpoint", position=60,
                       acted_at="2026-01-01T10:00:00")
        self.add_event(a, "read", delta_units=20,
                       acted_at="2026-01-01T11:00:00")
        self.assertEqual(self.state(a)["progress_units"], 80)


if __name__ == "__main__":
    unittest.main()
