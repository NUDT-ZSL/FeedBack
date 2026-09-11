"""因果一致性快照 consistent_snapshot 的测试。"""

from __future__ import annotations

import unittest

from causal_engine import (
    CausalEngine,
    Event,
    InconsistentSnapshotError,
    InvalidCutError,
    UnknownProcessError,
)
from tests.helpers import CLOSURES, build_three_process_engine


class TestConsistentSnapshot(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = build_three_process_engine()

    def _snapshot_ids(self, cut: dict[str, int]) -> list[str]:
        return [e.event_id for e in self.engine.consistent_snapshot(cut)]

    def test_full_cut_returns_everything_sorted(self) -> None:
        ids = self._snapshot_ids({"p1": 3, "p2": 2, "p3": 2})
        self.assertEqual(ids, ["a1", "a2", "a3", "b1", "b2", "c1", "c2"])

    def test_zero_and_partial_cuts(self) -> None:
        self.assertEqual(self._snapshot_ids({}), [])
        self.assertEqual(self._snapshot_ids({"p1": 0, "p2": 0, "p3": 0}), [])
        self.assertEqual(self._snapshot_ids({"p1": 1}), ["a1"])
        self.assertEqual(
            self._snapshot_ids({"p1": 2, "p2": 0}), ["a1", "a2"]
        )

    def test_consistent_cut_with_cross_dependencies(self) -> None:
        # b2 依赖 a1：cut p1>=1, p2=2 合法
        self.assertEqual(
            self._snapshot_ids({"p1": 1, "p2": 2}),
            ["a1", "b1", "b2"],
        )
        # a3 依赖 b2；c1 依赖 a3+b2
        self.assertEqual(
            self._snapshot_ids({"p1": 3, "p2": 2}),
            ["a1", "a2", "a3", "b1", "b2"],
        )
        self.assertEqual(
            self._snapshot_ids({"p1": 3, "p2": 2, "p3": 1}),
            ["a1", "a2", "a3", "b1", "b2", "c1"],
        )

    def test_inconsistent_cut_reports_missing_predecessors(self) -> None:
        # b2 需要 a1，但 p1 cut=0
        with self.assertRaises(InconsistentSnapshotError) as ctx:
            self.engine.consistent_snapshot({"p1": 0, "p2": 2})
        self.assertEqual(ctx.exception.missing_predecessors, ["a1"])
        self.assertEqual(ctx.exception.required_by["a1"], ["b2"])

    def test_inconsistent_cut_at_merge_point(self) -> None:
        # c1 需要 a3；只给 p1=2 时缺 a3，p2 给全
        with self.assertRaises(InconsistentSnapshotError) as ctx:
            self.engine.consistent_snapshot({"p1": 2, "p2": 2, "p3": 1})
        self.assertEqual(ctx.exception.missing_predecessors, ["a3"])
        self.assertEqual(ctx.exception.required_by["a3"], ["c1"])

    def test_c2_requires_c1_and_everything(self) -> None:
        # 只回放 p3=2 但不给 p1/p2
        with self.assertRaises(InconsistentSnapshotError) as ctx:
            self.engine.consistent_snapshot({"p3": 2})
        missing = set(ctx.exception.missing_predecessors)
        self.assertEqual(missing, {"a3", "b2"})

    def test_snapshot_events_are_causally_closed(self) -> None:
        # 对多个合法 cut，断言返回集合内每个事件的直接前驱也在集合内
        for cut in (
            {"p1": 3, "p2": 2, "p3": 2},
            {"p1": 2, "p2": 1},
            {"p1": 3, "p2": 2, "p3": 1},
        ):
            events = self.engine.consistent_snapshot(cut)
            ids = {e.event_id for e in events}
            for event in events:
                for ref_pid, seq_no in event.vector.items():
                    if seq_no > 0:
                        pred = self.engine.list_events(ref_pid)[seq_no - 1]
                        self.assertIn(
                            pred.event_id,
                            ids,
                            f"{event.event_id} needs {pred.event_id} under {cut}",
                        )
            # 闭包应等于手写的预期集合
            expected: set[str] = set()
            for eid in ids:
                expected |= CLOSURES[eid]
            self.assertEqual(ids, expected)

    def test_cut_unknown_process(self) -> None:
        with self.assertRaises(UnknownProcessError) as ctx:
            self.engine.consistent_snapshot({"ghost": 1})
        self.assertEqual(ctx.exception.process_id, "ghost")

    def test_cut_beyond_max_seq(self) -> None:
        with self.assertRaises(InvalidCutError) as ctx:
            self.engine.consistent_snapshot({"p1": 99})
        self.assertIn("current max seq is 3", str(ctx.exception))

    def test_cut_invalid_value(self) -> None:
        with self.assertRaises(InvalidCutError):
            self.engine.consistent_snapshot({"p1": -1})
        with self.assertRaises(InvalidCutError):
            self.engine.consistent_snapshot({"p1": "1"})  # type: ignore[dict-item]

    def test_snapshot_with_unregistered_engine_processes_omitted(self) -> None:
        # cut 里不出现 p3 时按 0 处理
        self.assertEqual(
            self._snapshot_ids({"p1": 1, "p2": 1}), ["a1", "b1"]
        )


class TestSnapshotSingleProcess(unittest.TestCase):
    def test_single_process_prefixes(self) -> None:
        engine = CausalEngine()
        engine.register_process("p")
        for seq in range(1, 4):
            engine.append(Event(f"e{seq}", "p", seq, {"p": seq - 1}))
        self.assertEqual(
            [e.event_id for e in engine.consistent_snapshot({"p": 2})],
            ["e1", "e2"],
        )


if __name__ == "__main__":
    unittest.main()
