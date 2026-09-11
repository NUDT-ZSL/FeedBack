"""JSON 持久化 save/load 往返与损坏文件错误处理的测试。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from causal_engine import CausalEngine, PersistenceError
from tests.helpers import build_three_process_engine


class TestSaveLoadRoundTrip(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = os.path.join(self.tmpdir.name, "snapshot.json")

    def _round_trip(self, engine: CausalEngine) -> CausalEngine:
        engine.save(self.path)
        return CausalEngine.load(self.path)

    def test_empty_engine_round_trip(self) -> None:
        engine = CausalEngine()
        loaded = self._round_trip(engine)
        self.assertEqual(loaded.get_state(), engine.get_state())
        self.assertEqual(loaded.registered_processes(), [])

    def test_full_engine_round_trip_state_and_events(self) -> None:
        engine = build_three_process_engine()
        loaded = self._round_trip(engine)
        self.assertEqual(loaded.get_state(), engine.get_state())
        for pid in ("p1", "p2", "p3"):
            self.assertEqual(
                [e.to_dict() for e in loaded.list_events(pid)],
                [e.to_dict() for e in engine.list_events(pid)],
            )
        self.assertIsNotNone(loaded.get_event("c2"))
        self.assertEqual(loaded.get_event("c2").payload, None)
        self.assertEqual(loaded.get_event("a1").payload, {"kind": "local"})

    def test_round_trip_preserves_snapshot_and_closure(self) -> None:
        engine = build_three_process_engine()
        loaded = self._round_trip(engine)
        cut = {"p1": 3, "p2": 2, "p3": 1}
        self.assertEqual(
            [e.event_id for e in loaded.consistent_snapshot(cut)],
            [e.event_id for e in engine.consistent_snapshot(cut)],
        )
        self.assertEqual(
            [e.event_id for e in loaded.replay_closure(["c2"])],
            [e.event_id for e in engine.replay_closure(["c2"])],
        )

    def test_save_then_load_is_stable_across_two_rounds(self) -> None:
        engine = build_three_process_engine()
        engine.save(self.path)
        once = CausalEngine.load(self.path)
        path2 = os.path.join(self.tmpdir.name, "snapshot2.json")
        once.save(path2)
        twice = CausalEngine.load(path2)
        self.assertEqual(twice.dump(), once.dump())

    def test_save_creates_json_file(self) -> None:
        build_three_process_engine().save(self.path)
        with open(self.path, encoding="utf-8") as handle:
            data = json.load(handle)
        self.assertEqual(data["format"], "causal-engine-snapshot")
        self.assertEqual(len(data["events"]), 7)

    def test_load_missing_file(self) -> None:
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(os.path.join(self.tmpdir.name, "nope.json"))
        self.assertIn("not found", str(ctx.exception))

    # ---- 损坏文件 -------------------------------------------------
    def _write_raw(self, text: str) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def _valid_data(self) -> dict:
        engine = build_three_process_engine()
        return engine.dump()

    def test_corrupt_json(self) -> None:
        self._write_raw("{not valid json")
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_root_not_object(self) -> None:
        self._write_raw("[1, 2, 3]")
        with self.assertRaises(PersistenceError):
            CausalEngine.load(self.path)

    def test_missing_fields(self) -> None:
        for key in ("format", "version", "processes", "events", "vectors"):
            data = self._valid_data()
            del data[key]
            self._write_raw(json.dumps(data))
            with self.assertRaises(PersistenceError, msg=f"missing {key}"):
                CausalEngine.load(self.path)

    def test_bad_format_and_version(self) -> None:
        data = self._valid_data()
        data["format"] = "something-else"
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError):
            CausalEngine.load(self.path)

        data = self._valid_data()
        data["version"] = 999
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError):
            CausalEngine.load(self.path)

    def test_duplicate_event_id_rejected(self) -> None:
        data = self._valid_data()
        data["events"][1]["event_id"] = data["events"][0]["event_id"]
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("duplicate event_id", str(ctx.exception))

    def test_seq_gap_rejected(self) -> None:
        data = self._valid_data()
        # 删掉 a2（p1 seq 2），p1 只剩 seq 1、3 -> 不连续
        data["events"] = [e for e in data["events"] if e["event_id"] != "a2"]
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("seq continuity", str(ctx.exception))

    def test_vector_references_unregistered_process(self) -> None:
        data = self._valid_data()
        for event in data["events"]:
            if event["event_id"] == "a2":
                event["vector"]["ghost"] = 0
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("unregistered process", str(ctx.exception))

    def test_vector_value_exceeds_max_seq(self) -> None:
        data = self._valid_data()
        for event in data["events"]:
            if event["event_id"] == "b2":
                event["vector"]["p1"] = 99  # p1 全局最大 seq 只有 3
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("exceeds max seq", str(ctx.exception))

    def test_own_vector_component_wrong(self) -> None:
        data = self._valid_data()
        for event in data["events"]:
            if event["event_id"] == "a1":
                event["vector"]["p1"] = 1  # 必须为 seq-1 = 0
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("seq - 1", str(ctx.exception))

    def test_saved_vector_inconsistent_with_events(self) -> None:
        data = self._valid_data()
        data["vectors"]["p1"]["p2"] = 1  # 实际重算 p1 已见 p2=2
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("inconsistent with events", str(ctx.exception))

    def test_event_belonging_to_unregistered_process(self) -> None:
        data = self._valid_data()
        data["events"][0]["process_id"] = "ghost"
        data["events"][0]["vector"] = {"ghost": 0}
        self._write_raw(json.dumps(data))
        with self.assertRaises(PersistenceError) as ctx:
            CausalEngine.load(self.path)
        self.assertIn("unregistered process", str(ctx.exception))

    def test_from_dict_interleaved_event_order(self) -> None:
        # 文件事件顺序按 seq/进程交错也应能重建（内部按进程分组排序）
        data = self._valid_data()
        data["events"] = sorted(
            data["events"], key=lambda e: (e["seq"], e["process_id"])
        )
        # 交错后顺序形如 a1,b1,c1,a2,b2,c2,a3
        self.assertEqual(
            [e["event_id"] for e in data["events"]][:3], ["a1", "b1", "c1"]
        )
        loaded = CausalEngine.from_dict(data)
        self.assertEqual(
            [e.event_id for e in loaded.list_events("p1")], ["a1", "a2", "a3"]
        )
        self.assertEqual(loaded.dump()["events"], self._valid_data()["events"])


if __name__ == "__main__":
    unittest.main()
