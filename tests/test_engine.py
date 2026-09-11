"""事件追加、进程注册与基本查询的测试。"""

from __future__ import annotations

import unittest

from causal_engine import (
    CausalEngine,
    DuplicateEventError,
    DuplicateProcessError,
    Event,
    InvalidEventError,
    UnknownProcessError,
)
from tests.helpers import build_three_process_engine


class TestProcessRegistration(unittest.TestCase):
    def test_register_and_list(self) -> None:
        engine = CausalEngine()
        self.assertEqual(engine.register_process("p1"), "p1")
        self.assertEqual(engine.registered_processes(), ["p1"])
        self.assertEqual(engine.get_state()["total_events"], 0)
        self.assertEqual(engine.get_state()["processes"]["p1"]["max_seq"], 0)
        self.assertEqual(
            engine.get_state()["processes"]["p1"]["vector"], {"p1": 0}
        )

    def test_duplicate_registration_raises_with_conflict_id(self) -> None:
        engine = CausalEngine()
        engine.register_process("p1")
        with self.assertRaises(DuplicateProcessError) as ctx:
            engine.register_process("p1")
        self.assertEqual(ctx.exception.process_id, "p1")
        self.assertIn("p1", str(ctx.exception))

    def test_register_invalid_id(self) -> None:
        engine = CausalEngine()
        with self.assertRaises(InvalidEventError):
            engine.register_process("")
        with self.assertRaises(InvalidEventError):
            engine.register_process(123)  # type: ignore[arg-type]


class TestAppendAndQuery(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = build_three_process_engine()

    def test_total_and_state(self) -> None:
        state = self.engine.get_state()
        self.assertEqual(state["total_events"], 7)
        self.assertEqual(state["processes"]["p1"]["max_seq"], 3)
        self.assertEqual(state["processes"]["p2"]["max_seq"], 2)
        self.assertEqual(state["processes"]["p3"]["max_seq"], 2)
        self.assertEqual(
            state["processes"]["p3"]["vector"], {"p3": 2, "p1": 3, "p2": 2}
        )

    def test_get_event_present_and_missing(self) -> None:
        event = self.engine.get_event("a1")
        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.seq, 1)
        self.assertEqual(event.payload, {"kind": "local"})
        self.assertIsNone(self.engine.get_event("nope"))

    def test_list_events_sorted_and_unknown_process(self) -> None:
        ids = [e.event_id for e in self.engine.list_events("p2")]
        self.assertEqual(ids, ["b1", "b2"])
        with self.assertRaises(UnknownProcessError) as ctx:
            self.engine.list_events("ghost")
        self.assertEqual(ctx.exception.process_id, "ghost")

    def test_append_unknown_process(self) -> None:
        with self.assertRaises(UnknownProcessError) as ctx:
            self.engine.append(Event("x", "ghost", 1, {"ghost": 0}))
        self.assertEqual(ctx.exception.process_id, "ghost")

    def test_append_wrong_type(self) -> None:
        with self.assertRaises(InvalidEventError):
            self.engine.append({"event_id": "x"})  # type: ignore[arg-type]

    def test_append_seq_must_be_next(self) -> None:
        engine = CausalEngine()
        engine.register_process("p1")
        engine.append(Event("a1", "p1", 1, {"p1": 0}))
        # 跳号
        with self.assertRaises(InvalidEventError) as ctx:
            engine.append(Event("a3", "p1", 3, {"p1": 1}))
        self.assertIn("expected 2", str(ctx.exception))
        # 被拒绝后状态不变，seq 2 可以正常追加
        engine.append(Event("a2", "p1", 2, {"p1": 1}))
        # seq 2 重复（下一个必须是 3）
        with self.assertRaises(InvalidEventError) as ctx:
            engine.append(Event("a2b", "p1", 2, {"p1": 1}))
        self.assertIn("expected 3", str(ctx.exception))

    def test_append_duplicate_event_id(self) -> None:
        engine = CausalEngine()
        engine.register_process("p1")
        engine.register_process("p2")
        engine.append(Event("same", "p1", 1, {"p1": 0}))
        with self.assertRaises(DuplicateEventError) as ctx:
            engine.append(Event("same", "p2", 1, {"p2": 0}))
        self.assertEqual(ctx.exception.event_id, "same")

    def test_event_is_frozen_and_vector_copied(self) -> None:
        vector = {"p1": 0}
        event = Event("a1", "p1", 1, vector)
        with self.assertRaises(Exception):
            event.seq = 2  # type: ignore[misc]
        vector["p1"] = 99
        self.assertEqual(event.vector, {"p1": 0})

    def test_event_field_validation(self) -> None:
        with self.assertRaises(InvalidEventError):
            Event("", "p1", 1, {"p1": 0})
        with self.assertRaises(InvalidEventError):
            Event("e", "", 1, {"": 0})
        with self.assertRaises(InvalidEventError):
            Event("e", "p1", 0, {"p1": -1})
        with self.assertRaises(InvalidEventError):
            Event("e", "p1", 1, {"p1": -1})
        with self.assertRaises(InvalidEventError):
            Event("e", "p1", 1, {"p1": True})  # type: ignore[dict-item]
        with self.assertRaises(InvalidEventError):
            Event("e", "p1", 1, "not a dict")  # type: ignore[arg-type]

    def test_non_json_serializable_payload_rejected(self) -> None:
        engine = CausalEngine()
        engine.register_process("p1")
        event = Event("bad", "p1", 1, {"p1": 0}, payload={"x": object()})
        with self.assertRaises(InvalidEventError) as ctx:
            engine.append(event)
        self.assertIn("JSON serializable", str(ctx.exception))
        self.assertIsNone(engine.get_event("bad"))

    def test_single_process_single_event(self) -> None:
        engine = CausalEngine()
        engine.register_process("only")
        event = Event("e1", "only", 1, {"only": 0}, payload="hi")
        engine.append(event)
        self.assertEqual(engine.get_state()["total_events"], 1)
        self.assertEqual(
            [e.event_id for e in engine.list_events("only")], ["e1"]
        )

    def test_empty_engine(self) -> None:
        engine = CausalEngine()
        self.assertEqual(engine.get_state()["total_events"], 0)
        self.assertEqual(engine.consistent_snapshot({}), [])
        self.assertEqual(engine.replay_closure([]), [])
        self.assertIsNone(engine.get_event("anything"))
        self.assertEqual(engine.registered_processes(), [])


if __name__ == "__main__":
    unittest.main()
