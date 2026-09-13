"""排期引擎的 unittest 验收测试。

覆盖：基础建模与校验、冲突检测（多冲突全量列出 / 端点相接）、
级联顺延（线性、菱形去重、优先级与字典序）、顺延阻塞回退
（冲突 / 超出可用区间 / 阻断下游传播）、查询接口、快照往返与
坏快照错误、以及 main.py 的行式 JSON 命令行。
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from typing import Any, Dict, List, Optional, Sequence, Tuple

from schedule import (
    ConflictError,
    NotFoundError,
    ScheduleEngine,
    ScheduleError,
    SnapshotError,
)
import main as cli


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------


def make_engine(
    resources: Optional[Dict[str, Sequence[Sequence[int]]]] = None,
    tasks: Optional[List[Tuple[str, str, int, int, int, Sequence[str]]]] = None,
) -> ScheduleEngine:
    """按声明式描述快速构造引擎。

    tasks 元素为 (task_id, resource_id, start, end, priority, deps)。
    """

    engine = ScheduleEngine()
    for rid, av in (resources or {}).items():
        engine.add_resource(rid, list(av))
    for tid, rid, s, e, pri, deps in tasks or []:
        engine.add_task(tid, rid, s, e, pri, list(deps))
    return engine


def run_cli(lines: List[str]) -> List[Dict[str, Any]]:
    """把命令行喂给 CLI 并解析回每行一个 dict。"""

    stdin = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
    stdout = io.StringIO()
    cli.run(stdin, stdout)
    return [json.loads(line) for line in stdout.getvalue().splitlines()]


# ---------------------------------------------------------------------------
# 基础建模
# ---------------------------------------------------------------------------


class BasicModelTests(unittest.TestCase):
    def test_empty_engine(self) -> None:
        engine = ScheduleEngine()
        self.assertEqual(engine.list_tasks(), [])
        with self.assertRaises(NotFoundError):
            engine.get_task("nope")
        with self.assertRaises(NotFoundError):
            engine.get_dependency_chain("nope")
        with self.assertRaises(NotFoundError):
            engine.get_resource_timeline("r", 0, 10)

    def test_single_task_roundtrip(self) -> None:
        engine = make_engine({"r": [[0, 100]]}, [("a", "r", 0, 5, 0, [])])
        task = engine.get_task("a")
        self.assertEqual(task["start"], 0)
        self.assertEqual(task["end"], 5)
        self.assertEqual(task["duration"], 5)
        self.assertEqual(task["deps"], [])

    def test_multiple_availability_windows(self) -> None:
        engine = ScheduleEngine()
        engine.add_resource("r", [[0, 5], [10, 15]])
        engine.add_task("a", "r", 10, 14)  # 落在第二个窗口
        with self.assertRaises(ScheduleError):  # 横跨中间空档
            engine.add_task("b", "r", 3, 12)

    def test_endpoint_touch_is_not_conflict(self) -> None:
        engine = make_engine({"r": [[0, 100]]})
        engine.add_task("a", "r", 0, 2)
        engine.add_task("b", "r", 2, 4)  # 同时间点相接，合法
        self.assertEqual(len(engine.list_tasks()), 2)

    def test_same_timepoint_same_resource_conflicts(self) -> None:
        engine = make_engine({"r": [[0, 100]]})
        engine.add_task("a", "r", 0, 4)
        with self.assertRaises(ConflictError):
            engine.add_task("b", "r", 2, 6)

    def test_same_timepoint_different_resources_ok(self) -> None:
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 5, 0, []),
                ("b", "r2", 0, 5, 0, []),
            ],
        )
        self.assertEqual(len(engine.list_tasks()), 2)

    def test_add_validation_errors(self) -> None:
        engine = ScheduleEngine()
        with self.assertRaises(ScheduleError):
            engine.add_resource("", [[0, 1]])
        with self.assertRaises(ScheduleError):
            engine.add_resource("r", [])  # 空可用区间
        with self.assertRaises(ScheduleError):
            engine.add_resource("r", [[5, 5]])  # start == end
        with self.assertRaises(ScheduleError):
            engine.add_resource("r", [[0, 10], [5, 15]])  # 区间重叠

        engine.add_resource("r", [[0, 100]])
        with self.assertRaises(NotFoundError):
            engine.add_task("a", "missing", 0, 1)
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", 5, 5)
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", 90, 110)  # 超出可用区间
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", 0, 2, deps=["a"])  # 自依赖
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", 0, 2, deps=["x", "x"])  # 重复依赖
        with self.assertRaises(NotFoundError):
            engine.add_task("a", "r", 0, 2, deps=["ghost"])
        engine.add_task("base", "r", 10, 12)
        with self.assertRaises(ScheduleError):  # start 早于依赖 end
            engine.add_task("a", "r", 11, 13, deps=["base"])
        engine.add_task("a", "r", 0, 2)
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", 4, 6)  # 重复 id
        with self.assertRaises(ScheduleError):
            engine.add_resource("r", [[0, 1]])  # 重复资源

    def test_boolean_is_not_a_time(self) -> None:
        engine = make_engine({"r": [[0, 100]]})
        with self.assertRaises(ScheduleError):
            engine.add_task("a", "r", True, 1)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# move 与冲突检测
# ---------------------------------------------------------------------------


class MoveConflictTests(unittest.TestCase):
    def test_move_nonexistent(self) -> None:
        engine = make_engine({"r": [[0, 100]]})
        with self.assertRaises(NotFoundError):
            engine.move("ghost", 0, 2)

    def test_move_bad_interval_and_duration(self) -> None:
        engine = make_engine({"r": [[0, 100]]}, [("a", "r", 0, 4, 0, [])])
        with self.assertRaises(ScheduleError):
            engine.move("a", 5, 5)  # start >= end
        with self.assertRaises(ScheduleError):
            engine.move("a", 2, 5)  # 时长 3 != 原时长 4

    def test_move_outside_availability(self) -> None:
        engine = make_engine({"r": [[0, 10], [20, 30]]}, [("a", "r", 0, 4, 0, [])])
        # 移动到另一个合法窗口可以成功
        result = engine.move("a", 25, 29)
        self.assertTrue(result.success)
        with self.assertRaises(ScheduleError):  # 横跨空档
            engine.move("a", 8, 12)
        with self.assertRaises(ScheduleError):  # 完全越界
            engine.move("a", 40, 44)

    def test_move_violates_own_dependency(self) -> None:
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("base", "r1", 10, 12, 0, []),
                ("a", "r2", 12, 14, 0, ["base"]),
            ],
        )
        with self.assertRaises(ScheduleError):
            engine.move("a", 8, 10)

    def test_move_single_conflict_fails_atomically(self) -> None:
        engine = make_engine(
            {"r": [[0, 100]]},
            [
                ("a", "r", 0, 2, 0, []),
                ("p", "r", 5, 7, 0, []),
            ],
        )
        result = engine.move("a", 5, 7)
        self.assertFalse(result.success)
        self.assertIsNone(result.final_start)
        self.assertEqual(len(result.conflicts), 1)
        c = result.conflicts[0]
        self.assertEqual((c.task_id, c.other_task_id), ("a", "p"))
        self.assertEqual((c.overlap_start, c.overlap_end), (5, 7))
        # 状态不变
        self.assertEqual((engine.get_task("a")["start"], engine.get_task("a")["end"]), (0, 2))
        self.assertEqual(result.adjusted, [])
        self.assertEqual(result.blocked, [])

    def test_move_reports_all_conflicts(self) -> None:
        engine = make_engine(
            {"r": [[0, 100]]},
            [
                ("a", "r", 0, 2, 0, []),
                ("p", "r", 4, 5, 0, []),
                ("q", "r", 5, 7, 0, []),
            ],
        )
        result = engine.move("a", 4, 6)  # 同时压住 p 和 q
        self.assertFalse(result.success)
        others = [c.other_task_id for c in result.conflicts]
        self.assertEqual(others, ["p", "q"])
        overlaps = [(c.overlap_start, c.overlap_end) for c in result.conflicts]
        self.assertEqual(overlaps, [(4, 5), (5, 6)])
        # 序列化结构完整
        payload = result.to_dict()
        self.assertFalse(payload["success"])
        self.assertEqual(len(payload["conflicts"]), 2)
        self.assertEqual(payload["conflicts"][0]["overlap"], [4, 5])

    def test_move_endpoint_touch_succeeds(self) -> None:
        engine = make_engine(
            {"r": [[0, 100]]},
            [
                ("a", "r", 0, 2, 0, []),
                ("p", "r", 2, 4, 0, []),
            ],
        )
        result = engine.move("a", 2, 4)  # 与 p 完全重合才算冲突——这里确实重合
        self.assertFalse(result.success)
        # 真正的端点相接：a 贴到 p 之后
        result = engine.move("a", 4, 6)
        self.assertTrue(result.success)

    def test_conflict_blocks_cascade_entirely(self) -> None:
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 4, 0, ["a"]),
                ("parked", "r1", 5, 7, 0, []),
            ],
        )
        result = engine.move("a", 5, 7)  # 与 parked 冲突
        self.assertFalse(result.success)
        self.assertEqual(result.conflicts[0].other_task_id, "parked")
        self.assertEqual(result.adjusted, [])
        # b 未被联动
        self.assertEqual(engine.get_task("b")["start"], 2)


# ---------------------------------------------------------------------------
# 依赖联动
# ---------------------------------------------------------------------------


class CascadeTests(unittest.TestCase):
    def test_linear_cascade(self) -> None:
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]], "r3": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 4, 0, ["a"]),
                ("c", "r3", 4, 6, 0, ["b"]),
            ],
        )
        result = engine.move("a", 1, 3)
        self.assertTrue(result.success)
        self.assertEqual(
            [(x.task_id, x.new_start, x.new_end) for x in result.adjusted],
            [("b", 3, 5), ("c", 5, 7)],
        )
        self.assertEqual(engine.get_task("b")["start"], 3)
        self.assertEqual(engine.get_task("c")["start"], 5)
        # 时长不变
        for tid in ("a", "b", "c"):
            t = engine.get_task(tid)
            self.assertEqual(t["end"] - t["start"], 2)

    def test_diamond_dependency_adjusted_once(self) -> None:
        engine = make_engine(
            {
                "r1": [[0, 100]],
                "r2": [[0, 100]],
                "r3": [[0, 100]],
                "r4": [[0, 100]],
            },
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 4, 0, ["a"]),
                ("c", "r3", 2, 6, 0, ["a"]),
                ("d", "r4", 6, 8, 0, ["b", "c"]),
            ],
        )
        result = engine.move("a", 1, 3)
        self.assertTrue(result.success)
        moved = {x.task_id: (x.new_start, x.new_end) for x in result.adjusted}
        # 菱形汇合点 d 必须取所有依赖的最晚 end，且每个任务只顺延一次
        self.assertEqual(moved, {"b": (3, 5), "c": (3, 7), "d": (7, 9)})
        ids = [x.task_id for x in result.adjusted]
        self.assertEqual(sorted(ids), sorted(set(ids)))  # 无重复
        self.assertEqual(ids, ["b", "c", "d"])  # 拓扑序：b,c 先于 d

    def test_cascade_priority_order_with_taskid_tiebreak(self) -> None:
        # a 大幅延后后，b、c 都要顺延到同一空位 [10,12)；
        # 同优先级按 task_id 字典序，b 先处理先得，c 阻塞并留在原位。
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 4, 1, ["a"]),
                ("c", "r2", 4, 6, 1, ["a"]),
            ],
        )
        result = engine.move("a", 8, 10)
        self.assertTrue(result.success)
        adjusted = {x.task_id for x in result.adjusted}
        blocked = {x.task_id for x in result.blocked}
        self.assertEqual(adjusted, {"b"})
        self.assertEqual(blocked, {"c"})
        self.assertEqual(engine.get_task("b")["start"], 10)
        self.assertEqual((engine.get_task("c")["start"], engine.get_task("c")["end"]), (4, 6))

    def test_cascade_higher_priority_wins_slot(self) -> None:
        # 同样竞争 [10,12)，c 优先级更高，应当 c 得到、b 阻塞。
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 4, 1, ["a"]),
                ("c", "r2", 4, 6, 9, ["a"]),
            ],
        )
        result = engine.move("a", 8, 10)
        self.assertTrue(result.success)
        self.assertEqual({x.task_id for x in result.adjusted}, {"c"})
        self.assertEqual({x.task_id for x in result.blocked}, {"b"})
        self.assertEqual(engine.get_task("c")["start"], 10)
        self.assertEqual(engine.get_task("b")["start"], 2)

    def test_no_unnecessary_shift_when_already_satisfies(self) -> None:
        # b 与 a 之间留有空隙，小幅移动不触及 b。
        engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 4, 6, 0, ["a"]),
            ],
        )
        result = engine.move("a", 1, 3)
        self.assertTrue(result.success)
        self.assertEqual(result.adjusted, [])
        self.assertEqual(engine.get_task("b")["start"], 4)


# ---------------------------------------------------------------------------
# 顺延阻塞
# ---------------------------------------------------------------------------


class BlockedCascadeTests(unittest.TestCase):
    def _build(self, r2_avail: Sequence[Sequence[int]]) -> ScheduleEngine:
        return make_engine(
            {
                "r1": [[0, 100]],
                "r2": [list(w) for w in r2_avail],
                "r3": [[0, 100]],
                "r4": [[0, 100]],
            },
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 5, 0, ["a"]),       # 时长 3
                ("c", "r3", 5, 7, 0, ["b"]),       # b 的下游
                ("d", "r4", 7, 9, 0, ["c"]),       # 更远的下游
            ],
        )

    def test_blocked_by_conflict_rolls_back_and_cuts_branch(self) -> None:
        engine = self._build([[0, 100]])
        engine.add_task("q", "r2", 6, 7)  # b 顺延后的落点 [6,9) 会撞上 q
        result = engine.move("a", 4, 6)
        self.assertTrue(result.success)
        self.assertEqual(len(result.blocked), 1)
        blk = result.blocked[0]
        self.assertEqual(blk.task_id, "b")
        self.assertEqual(blk.reason, "conflict")
        self.assertEqual((blk.attempted_start, blk.attempted_end), (6, 9))
        self.assertEqual(
            [(x.other_task_id, x.overlap_start, x.overlap_end)
             for x in blk.conflicts],
            [("q", 6, 7)],
        )
        # b 回退原位
        self.assertEqual((engine.get_task("b")["start"], engine.get_task("b")["end"]), (2, 5))
        # b 的下游 c、d 不参与本次联动
        self.assertEqual(engine.get_task("c")["start"], 5)
        self.assertEqual(engine.get_task("d")["start"], 7)
        self.assertEqual(result.adjusted, [])

    def test_blocked_by_availability_cuts_branch(self) -> None:
        engine = self._build([[0, 8]])  # b 想顺延到 [8,11)，超出窗口
        result = engine.move("a", 6, 8)
        self.assertTrue(result.success)
        self.assertEqual(len(result.blocked), 1)
        blk = result.blocked[0]
        self.assertEqual(blk.task_id, "b")
        self.assertEqual(blk.reason, "out_of_availability")
        self.assertEqual((blk.attempted_start, blk.attempted_end), (8, 11))
        self.assertEqual(engine.get_task("b")["start"], 2)
        self.assertEqual(engine.get_task("c")["start"], 5)

    def test_blocked_branch_does_not_affect_sibling_branch(self) -> None:
        # 菱形：b 分支被阻塞，c 分支仍正常顺延，汇合点 d 因 b 被排除而不动。
        engine = make_engine(
            {
                "r1": [[0, 100]],
                "r2": [[0, 100]],
                "r3": [[0, 100]],
                "r4": [[0, 100]],
            },
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r2", 2, 5, 0, ["a"]),
                ("c", "r3", 2, 4, 0, ["a"]),
                ("d", "r4", 5, 7, 0, ["b", "c"]),
            ],
        )
        engine.add_task("q", "r2", 6, 10)  # b 的落点 [6,9) 撞 q
        result = engine.move("a", 4, 6)
        self.assertTrue(result.success)
        blocked_ids = {b.task_id for b in result.blocked}
        adjusted_ids = {x.task_id for x in result.adjusted}
        self.assertEqual(blocked_ids, {"b"})
        self.assertEqual(adjusted_ids, {"c"})  # 兄弟分支照常联动
        self.assertEqual(engine.get_task("c")["start"], 6)
        self.assertEqual(engine.get_task("d")["start"], 5)  # 汇合点不参与


# ---------------------------------------------------------------------------
# 查询
# ---------------------------------------------------------------------------


class QueryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = make_engine(
            {"r1": [[0, 100]], "r2": [[0, 100]]},
            [
                ("a", "r1", 0, 2, 0, []),
                ("b", "r1", 2, 5, 2, ["a"]),
                ("c", "r2", 5, 9, 1, ["b"]),
            ],
        )

    def test_list_filters_and_sorts(self) -> None:
        all_tasks = self.engine.list_tasks()
        self.assertEqual([t["task_id"] for t in all_tasks], ["a", "b", "c"])
        r1 = self.engine.list_tasks("r1")
        self.assertEqual([t["task_id"] for t in r1], ["a", "b"])
        with self.assertRaises(NotFoundError):
            self.engine.list_tasks("nope")

    def test_timeline_window_semantics(self) -> None:
        # [start,end) 半开：端点相接不算落在窗口内
        self.assertEqual(
            [t["task_id"] for t in self.engine.get_resource_timeline("r1", 0, 2)],
            ["a"],
        )
        self.assertEqual(
            [t["task_id"] for t in self.engine.get_resource_timeline("r1", 2, 10)],
            ["b"],
        )
        self.assertEqual(
            [t["task_id"] for t in self.engine.get_resource_timeline("r1", 1, 3)],
            ["a", "b"],
        )
        self.assertEqual(self.engine.get_resource_timeline("r1", 50, 60), [])
        with self.assertRaises(ScheduleError):
            self.engine.get_resource_timeline("r1", 5, 5)

    def test_dependency_chain_topological(self) -> None:
        chain = self.engine.get_dependency_chain("c")
        self.assertEqual(chain, ["a", "b"])
        self.assertEqual(self.engine.get_dependency_chain("a"), [])

    def test_diamond_chain_order(self) -> None:
        engine = make_engine(
            {f"r{i}": [[0, 100]] for i in range(4)},
            [
                ("a", "r0", 0, 1, 0, []),
                ("b", "r1", 1, 2, 0, ["a"]),
                ("c", "r2", 1, 2, 0, ["a"]),
                ("d", "r3", 2, 3, 0, ["b", "c"]),
            ],
        )
        chain = engine.get_dependency_chain("d")
        self.assertEqual(chain[0], "a")
        self.assertEqual(set(chain), {"a", "b", "c"})
        self.assertEqual(chain[1:3], ["b", "c"])  # 同层字典序


# ---------------------------------------------------------------------------
# 持久化
# ---------------------------------------------------------------------------


class SnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.mkdtemp()

    def _path(self, name: str) -> str:
        return os.path.join(self.tmpdir, name)

    def test_save_load_roundtrip(self) -> None:
        engine = make_engine(
            {
                "r1": [[0, 10], [20, 30]],
                "r2": [[0, 100]],
            },
            [
                ("a", "r1", 0, 2, 5, []),
                ("b", "r2", 2, 6, 1, ["a"]),
                ("c", "r2", 6, 8, 9, ["a"]),
                ("d", "r2", 8, 10, 0, ["b", "c"]),
            ],
        )
        path = self._path("snap.json")
        engine.save(path)
        loaded = ScheduleEngine.load(path)
        self.assertEqual(loaded.to_dict(), engine.to_dict())

        # 在原引擎与重建引擎上做同样的移动，结果一致
        r1 = engine.move("a", 2, 4)
        r2 = loaded.move("a", 2, 4)
        self.assertEqual(r1.to_dict(), r2.to_dict())
        self.assertEqual(loaded.to_dict(), engine.to_dict())

    def test_save_load_empty_engine(self) -> None:
        path = self._path("empty.json")
        ScheduleEngine().save(path)
        loaded = ScheduleEngine.load(path)
        self.assertEqual(loaded.list_tasks(), [])

    def _bad_snapshot(self, data: Any) -> None:
        path = self._path("bad.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(SnapshotError):
            ScheduleEngine.load(path)

    def test_bad_json_reports_location(self) -> None:
        path = self._path("broken.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not valid json")
        with self.assertRaises(SnapshotError) as ctx:
            ScheduleEngine.load(path)
        self.assertIn("JSON", str(ctx.exception))

    def test_missing_file(self) -> None:
        with self.assertRaises(SnapshotError):
            ScheduleEngine.load(self._path("nope.json"))

    def test_bad_snapshots(self) -> None:
        good = {
            "version": 1,
            "resources": [{"resource_id": "r", "availability": [[0, 100]]}],
            "tasks": [
                {"task_id": "a", "resource_id": "r", "start": 0,
                 "end": 2, "priority": 0, "deps": []},
                {"task_id": "b", "resource_id": "r", "start": 2,
                 "end": 4, "priority": 0, "deps": ["a"]},
            ],
        }

        def mutate(**changes: Any) -> Any:
            data = json.loads(json.dumps(good))
            data.update(changes)
            return data

        self._bad_snapshot("not-an-object")
        self._bad_snapshot({})  # 缺顶层字段
        self._bad_snapshot(mutate(version=99))  # 不支持的版本
        self._bad_snapshot(mutate(resources="nope"))
        # 缺任务字段
        bad = json.loads(json.dumps(good))
        del bad["tasks"][0]["start"]
        self._bad_snapshot(bad)
        # task_id 重复
        bad = json.loads(json.dumps(good))
        bad["tasks"][1]["task_id"] = "a"
        self._bad_snapshot(bad)
        # resource_id 不存在
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["resource_id"] = "ghost"
        self._bad_snapshot(bad)
        # start >= end
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["end"] = 0
        self._bad_snapshot(bad)
        # 依赖不存在
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["deps"] = ["ghost"]
        self._bad_snapshot(bad)
        # 自依赖 / 重复依赖
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["deps"] = ["a"]
        self._bad_snapshot(bad)
        bad = json.loads(json.dumps(good))
        bad["tasks"][1]["deps"] = ["a", "a"]
        self._bad_snapshot(bad)
        # 环：a -> b -> a
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["deps"] = ["b"]
        bad["tasks"][0]["start"] = 4
        bad["tasks"][0]["end"] = 6
        self._bad_snapshot(bad)
        # 依赖时序违反：b 早于 a 结束
        bad = json.loads(json.dumps(good))
        bad["tasks"][1]["start"] = 1
        bad["tasks"][1]["end"] = 3
        self._bad_snapshot(bad)
        # 同资源初始冲突
        bad = json.loads(json.dumps(good))
        bad["tasks"][1]["start"] = 1
        bad["tasks"][1]["deps"] = []
        self._bad_snapshot(bad)
        # 任务落在可用区间外
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["start"] = 100
        bad["tasks"][0]["end"] = 102
        self._bad_snapshot(bad)
        # 资源可用区间非法
        bad = json.loads(json.dumps(good))
        bad["resources"][0]["availability"] = [[5, 1]]
        self._bad_snapshot(bad)
        # resource_id 重复
        bad = json.loads(json.dumps(good))
        bad["resources"].append({"resource_id": "r", "availability": [[0, 1]]})
        self._bad_snapshot(bad)
        # 字段类型错误
        bad = json.loads(json.dumps(good))
        bad["tasks"][0]["priority"] = "high"
        self._bad_snapshot(bad)


# ---------------------------------------------------------------------------
# 命令行
# ---------------------------------------------------------------------------


class CliTests(unittest.TestCase):
    def test_happy_path(self) -> None:
        lines = [
            json.dumps({"cmd": "add_resource", "resource_id": "r1",
                        "availability": [[0, 100]]}),
            json.dumps({"cmd": "add_resource", "resource_id": "r2",
                        "availability": [[0, 100]]}),
            json.dumps({"cmd": "add_task", "task_id": "a",
                        "resource_id": "r1", "start": 0, "end": 2}),
            json.dumps({"cmd": "add_task", "task_id": "b",
                        "resource_id": "r2", "start": 2, "end": 4,
                        "priority": 3, "deps": ["a"]}),
            json.dumps({"cmd": "move", "task_id": "a",
                        "new_start": 5, "new_end": 7}),
            json.dumps({"cmd": "get", "task_id": "b"}),
            json.dumps({"cmd": "list"}),
            json.dumps({"cmd": "list", "resource_id": "r2"}),
            json.dumps({"cmd": "timeline", "resource_id": "r2",
                        "start": 0, "end": 20}),
            json.dumps({"cmd": "chain", "task_id": "b"}),
            json.dumps({"cmd": "dump"}),
        ]
        out = run_cli(lines)
        self.assertTrue(all(row["ok"] for row in out), out)
        move_result = out[4]["result"]
        self.assertTrue(move_result["success"])
        self.assertEqual(
            [(x["task_id"], x["new_start"]) for x in move_result["adjusted"]],
            [("b", 7)],
        )
        self.assertEqual(out[5]["result"]["start"], 7)
        self.assertEqual(out[9]["result"], ["a"])
        self.assertEqual(out[10]["result"]["tasks"][0]["task_id"], "a")

    def test_conflict_and_errors_are_json_lines(self) -> None:
        lines = [
            json.dumps({"cmd": "add_resource", "resource_id": "r",
                        "availability": [[0, 100]]}),
            json.dumps({"cmd": "add_task", "task_id": "a",
                        "resource_id": "r", "start": 0, "end": 2}),
            json.dumps({"cmd": "add_task", "task_id": "p",
                        "resource_id": "r", "start": 5, "end": 7}),
            json.dumps({"cmd": "move", "task_id": "a",
                        "new_start": 5, "new_end": 7}),
            json.dumps({"cmd": "move", "task_id": "ghost",
                        "new_start": 1, "new_end": 3}),
            json.dumps({"cmd": "move", "task_id": "a",
                        "new_start": 0, "new_end": 9}),  # 时长变了
            json.dumps({"cmd": "frobnicate"}),
            json.dumps({"cmd": "get"}),  # 缺字段
            "{broken json",
            "",
            json.dumps({"cmd": "list", "resource_id": "nope"}),
        ]
        out = run_cli(lines)
        self.assertEqual(len(out), 10)  # 空行不产出
        # 冲突是正常结果，success=false 而不是错误行
        self.assertTrue(out[3]["ok"])
        self.assertFalse(out[3]["result"]["success"])
        self.assertEqual(
            [c["other_task_id"] for c in out[3]["result"]["conflicts"]],
            ["p"],
        )
        for idx in (4, 5, 6, 7, 8, 9):
            self.assertFalse(out[idx]["ok"], idx)
            self.assertIn("error", out[idx])

    def test_save_then_load_replaces_state(self) -> None:
        tmpdir = tempfile.mkdtemp()
        path = os.path.join(tmpdir, "snap.json")
        lines = [
            json.dumps({"cmd": "add_resource", "resource_id": "r",
                        "availability": [[0, 100]]}),
            json.dumps({"cmd": "add_task", "task_id": "a",
                        "resource_id": "r", "start": 0, "end": 2}),
            json.dumps({"cmd": "save", "path": path}),
            json.dumps({"cmd": "add_task", "task_id": "extra",
                        "resource_id": "r", "start": 8, "end": 9}),
            json.dumps({"cmd": "load", "path": path}),
            json.dumps({"cmd": "list"}),
            json.dumps({"cmd": "load", "path": os.path.join(tmpdir, "x.json")}),
        ]
        out = run_cli(lines)
        self.assertTrue(all(row["ok"] for row in out[:6]), out)
        ids = [t["task_id"] for t in out[5]["result"]]
        self.assertEqual(ids, ["a"])  # load 后 extra 消失
        self.assertFalse(out[6]["ok"])
        self.assertIn("error", out[6])

    def test_empty_input(self) -> None:
        self.assertEqual(run_cli([]), [])


if __name__ == "__main__":
    unittest.main()
