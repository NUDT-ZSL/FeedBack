"""部分回放 replay_closure 因果闭包的测试。"""

from __future__ import annotations

import unittest

from causal_engine import (
    CausalEngine,
    Event,
    InvalidEventError,
    UnknownEventError,
)
from tests.helpers import CLOSURES, build_three_process_engine


class TestReplayClosure(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = build_three_process_engine()

    def _closure_ids(self, seeds: list[str]) -> list[str]:
        return [e.event_id for e in self.engine.replay_closure(seeds)]

    def test_each_single_seed_closure(self) -> None:
        for seed, expected in CLOSURES.items():
            with self.subTest(seed=seed):
                self.assertEqual(set(self._closure_ids([seed])), expected)

    def test_closure_sorted_by_process_and_seq(self) -> None:
        events = self.engine.replay_closure(["c2"])
        keys = [(e.process_id, e.seq) for e in events]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(
            [e.event_id for e in events],
            ["a1", "a2", "a3", "b1", "b2", "c1", "c2"],
        )

    def test_multiple_seeds_union(self) -> None:
        # a2 的闭包 ∪ b2 的闭包
        self.assertEqual(
            set(self._closure_ids(["a2", "b2"])),
            CLOSURES["a2"] | CLOSURES["b2"],
        )

    def test_multiple_seeds_with_overlap(self) -> None:
        # c2 的闭包已经包含 c1；显式重复给不应有重复事件
        ids = self._closure_ids(["c2", "c1", "a3"])
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids), CLOSURES["c2"])

    def test_duplicate_seed_ids_dedup(self) -> None:
        once = self.engine.replay_closure(["b2"])
        repeated = self.engine.replay_closure(["b2", "b2", "b2"])
        self.assertEqual(
            [e.event_id for e in once], [e.event_id for e in repeated]
        )

    def test_empty_seeds_returns_empty(self) -> None:
        self.assertEqual(self.engine.replay_closure([]), [])

    def test_unknown_seed_lists_all_missing(self) -> None:
        with self.assertRaises(UnknownEventError) as ctx:
            self.engine.replay_closure(["a1", "nope1", "nope2"])
        self.assertEqual(ctx.exception.missing_ids, ["nope1", "nope2"])
        self.assertIn("nope1", str(ctx.exception))
        self.assertIn("nope2", str(ctx.exception))

    def test_all_seeds_missing(self) -> None:
        with self.assertRaises(UnknownEventError) as ctx:
            self.engine.replay_closure(["x", "y"])
        self.assertEqual(set(ctx.exception.missing_ids), {"x", "y"})

    def test_invalid_seed_type(self) -> None:
        with self.assertRaises(InvalidEventError):
            self.engine.replay_closure(["a1", ""])
        with self.assertRaises(InvalidEventError):
            self.engine.replay_closure([123])  # type: ignore[list-item]
        with self.assertRaises(InvalidEventError):
            self.engine.replay_closure("a1")  # type: ignore[arg-type]

    def test_closure_is_minimal(self) -> None:
        # 闭包内任何事件都不能被移除（每个事件都是某个 seed 的因果前驱）
        closure = {e.event_id for e in self.engine.replay_closure(["a3"])}
        for event_id in closure:
            # 至少存在一条从 a3 出发的依赖链经过它：用每个 id 的闭包
            # 对 a3 的闭包做覆盖论证
            self.assertTrue(
                event_id in CLOSURES["a3"],
                f"{event_id} should not be in minimal closure",
            )
        self.assertEqual(closure, CLOSURES["a3"])

    def test_diamond_dependency_dedup(self) -> None:
        # 构造菱形依赖：d 同时依赖两条在 x 汇合的链，闭包中 x 只出现一次
        engine = CausalEngine()
        for pid in ("p1", "p2", "p3", "p4"):
            engine.register_process(pid)
        engine.append(Event("x", "p1", 1, {"p1": 0}))
        engine.append(Event("l", "p2", 1, {"p1": 1, "p2": 0}))
        engine.append(Event("r", "p3", 1, {"p1": 1, "p3": 0}))
        engine.append(
            Event("d", "p4", 1, {"p1": 1, "p2": 1, "p3": 1, "p4": 0})
        )
        ids = [e.event_id for e in engine.replay_closure(["d"])]
        self.assertEqual(sorted(ids), ["d", "l", "r", "x"])
        self.assertEqual(len(ids), 4)


if __name__ == "__main__":
    unittest.main()
