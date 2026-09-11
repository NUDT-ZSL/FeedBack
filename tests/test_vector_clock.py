"""向量时钟合法性校验的测试。"""

from __future__ import annotations

import unittest

from causal_engine import CausalEngine, Event, InvalidEventError, UnknownProcessError


class TestVectorClockValidation(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = CausalEngine()
        self.engine.register_process("p1")
        self.engine.register_process("p2")
        self.engine.append(Event("a1", "p1", 1, {"p1": 0}))
        self.engine.append(Event("b1", "p2", 1, {"p2": 0}))
        # p1 的第二个事件声明已知 b1
        self.engine.append(Event("a2", "p1", 2, {"p1": 1, "p2": 1}))

    def test_valid_vectors_accepted(self) -> None:
        self.engine.append(Event("b2", "p2", 2, {"p1": 1, "p2": 1}))
        self.assertEqual(
            self.engine.get_state()["processes"]["p2"]["vector"],
            {"p2": 2, "p1": 1},
        )

    def test_own_component_must_equal_seq_minus_one(self) -> None:
        # 缺发送者自己
        with self.assertRaises(InvalidEventError) as ctx:
            self.engine.append(Event("b2", "p2", 2, {"p1": 1}))
        self.assertIn("p2", str(ctx.exception))
        # 值不等于 seq - 1
        with self.assertRaises(InvalidEventError) as ctx:
            self.engine.append(Event("b2", "p2", 2, {"p1": 1, "p2": 0}))
        self.assertIn("seq - 1 = 1", str(ctx.exception))

    def test_value_must_not_exceed_known_max(self) -> None:
        # p1 当前只有 seq 2，却声称知道 p1 seq 5
        with self.assertRaises(InvalidEventError) as ctx:
            self.engine.append(Event("b2", "p2", 2, {"p1": 5, "p2": 1}))
        self.assertIn("exceeds current max seq 2", str(ctx.exception))
        self.assertIn("p1", str(ctx.exception))
        self.assertIn("5", str(ctx.exception))

    def test_vector_references_unregistered_process(self) -> None:
        with self.assertRaises(UnknownProcessError) as ctx:
            self.engine.append(
                Event("b2", "p2", 2, {"p1": 1, "p2": 1, "ghost": 0})
            )
        self.assertEqual(ctx.exception.process_id, "ghost")
        self.assertIn("vector", str(ctx.exception))

    def test_vector_must_keep_previously_seen_processes(self) -> None:
        # a2 之后 p1 已知 p2；p1 的下一个事件不能丢掉 p2
        with self.assertRaises(InvalidEventError) as ctx:
            self.engine.append(Event("a3", "p1", 3, {"p1": 2}))
        self.assertIn("drops previously seen", str(ctx.exception))
        self.assertIn("p2", str(ctx.exception))

    def test_vector_cannot_regress(self) -> None:
        # p1 已知 p2=1，新事件却把 p2 写回 0
        with self.assertRaises(InvalidEventError) as ctx:
            self.engine.append(Event("a3", "p1", 3, {"p1": 2, "p2": 0}))
        self.assertIn("regresses", str(ctx.exception))

    def test_rejected_event_leaves_state_unchanged(self) -> None:
        before = self.engine.get_state()
        with self.assertRaises(InvalidEventError):
            self.engine.append(Event("bad", "p1", 3, {"p1": 99}))
        self.assertEqual(self.engine.get_state(), before)
        self.assertIsNone(self.engine.get_event("bad"))
        # 合法的 seq 3 仍可追加
        self.engine.append(Event("a3", "p1", 3, {"p1": 2, "p2": 1}))
        self.assertEqual(
            self.engine.get_state()["processes"]["p1"]["vector"],
            {"p1": 3, "p2": 1},
        )

    def test_first_event_vector_is_just_self_zero(self) -> None:
        engine = CausalEngine()
        engine.register_process("solo")
        with self.assertRaises(InvalidEventError):
            engine.append(Event("e", "solo", 1, {}))
        engine.append(Event("e", "solo", 1, {"solo": 0}))
        self.assertEqual(engine.list_events("solo")[0].vector, {"solo": 0})


if __name__ == "__main__":
    unittest.main()
