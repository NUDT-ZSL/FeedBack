"""Scheduler 的单元测试。

运行方式（标准库 unittest，无第三方依赖）::

    python -m unittest -v test_scheduler
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest

from scheduler import Scheduler, SchedulerError
import main as cli


def make(scheduler_tasks, lease_duration=3):
    """快速构造一个调度器。

    scheduler_tasks: [(task_id, schedule), ...]，节点不预注册。
    """
    s = Scheduler(lease_duration=lease_duration)
    for task_id, schedule in scheduler_tasks:
        s.register_task(task_id, schedule)
    return s


class ScheduleParsingTests(unittest.TestCase):
    def test_valid_expressions(self):
        cases = {
            "7": (frozenset({7}), None),
            "*/5": (frozenset(), 5),
            "3,7": (frozenset({3, 7}), None),
            "*/5,7": (frozenset({7}), 5),
            " 2 , */3 ": (frozenset({2}), 3),
        }
        for expr, expected in cases.items():
            with self.subTest(expr=expr):
                self.assertEqual(Scheduler.parse_schedule(expr), expected)

    def test_invalid_expressions(self):
        bad = [
            "",
            "   ",
            "abc",
            "-1",
            "1,-2",
            "*/0",
            "*/-5",
            "*/abc",
            "1,",
            ",1",
            "1,,2",
            "*/2,*/3",   # 只允许一个步长分段
            "0",         # 时钟 0 永不触发
            "*/5/2",
            "1-3",       # 明确不支持范围语法
        ]
        for expr in bad:
            with self.subTest(expr=expr):
                with self.assertRaises(SchedulerError):
                    Scheduler.parse_schedule(expr)

    def test_non_string_schedule_rejected(self):
        with self.assertRaises(SchedulerError):
            Scheduler(3).register_task("t", 5)  # type: ignore[arg-type]


class RegistrationTests(unittest.TestCase):
    def test_duplicate_task_raises(self):
        s = make([("t1", "*/5")])
        with self.assertRaises(SchedulerError):
            s.register_task("t1", "7")

    def test_duplicate_node_raises(self):
        s = make([])
        s.add_node("n1")
        with self.assertRaises(SchedulerError):
            s.add_node("n1")

    def test_blank_ids_rejected(self):
        s = make([])
        with self.assertRaises(SchedulerError):
            s.register_task("  ", "*/5")
        with self.assertRaises(SchedulerError):
            s.add_node("")

    def test_bad_lease_duration(self):
        for bad in (0, -1, 1.5, True, "3"):
            with self.subTest(bad=bad):
                with self.assertRaises(SchedulerError):
                    Scheduler(lease_duration=bad)  # type: ignore[arg-type]


class BasicDispatchTests(unittest.TestCase):
    def test_empty_scheduler_acquire(self):
        s = make([])
        s.add_node("n1")
        self.assertEqual(s.acquire("n1"), [])

    def test_single_task_single_node_step_schedule(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.tick(4)
        self.assertEqual(s.acquire("n1"), [])       # 时钟 4 未触发
        s.tick(1)                                  # 时钟 5
        self.assertEqual(s.acquire("n1"), ["t1"])
        info = s.get_task("t1")
        self.assertEqual(info["owner"], "n1")
        self.assertEqual(info["lease_expire_at"], 8)
        self.assertEqual(info["last_fired_at"], 5)

    def test_exact_tick_schedule(self):
        s = make([("t1", "7")])
        s.add_node("n1")
        s.tick(7)
        self.assertEqual(s.acquire("n1"), ["t1"])
        s.complete("n1", "t1")
        s.tick(1)
        self.assertEqual(s.acquire("n1"), [])       # "7" 只在第 7 单位触发
        self.assertEqual(s.get_orphaned_tasks(), [])

    def test_multi_value_schedule(self):
        s = make([("t1", "3,7")])
        s.add_node("n1")
        s.tick(3)
        self.assertEqual(s.acquire("n1"), ["t1"])
        s.complete("n1", "t1")
        s.tick(4)                                  # 时钟 7
        self.assertEqual(s.acquire("n1"), ["t1"])

    def test_union_schedule(self):
        # */5 与显式值取并集：5、7、10...
        s = make([("t1", "*/5,7")])
        s.add_node("n1")
        s.tick(7)
        self.assertEqual(s.acquire("n1"), ["t1"])
        s.complete("n1", "t1")
        s.tick(3)                                  # 时钟 10
        self.assertEqual(s.acquire("n1"), ["t1"])

    def test_tick_must_be_positive(self):
        s = make([])
        with self.assertRaises(SchedulerError):
            s.tick(0)
        with self.assertRaises(SchedulerError):
            s.tick(-1)

    def test_zero_clock_never_fires(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        self.assertEqual(s.acquire("n1"), [])


class MutualExclusionTests(unittest.TestCase):
    """易错点一：同一任务同一时钟单位最多被一个节点持有。"""

    def test_two_nodes_acquire_same_clock(self):
        s = make([("t1", "*/5"), ("t2", "7")])
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        self.assertEqual(s.acquire("n1"), ["t1"])
        # 同一时钟单位，第二个节点不能拿到 t1，t2 在时钟 5 也不到点
        self.assertEqual(s.acquire("n2"), [])
        # 同一节点重复 acquire 也不会重复返回
        self.assertEqual(s.acquire("n1"), [])
        self.assertEqual(s.get_node("n1")["tasks"], ["t1"])
        self.assertEqual(s.get_node("n2")["tasks"], [])

    def test_lease_blocks_preemption_before_expiry(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")                            # expire_at = 8
        s.tick(2)                                  # 时钟 7，租约仍有效
        self.assertEqual(s.acquire("n2"), [])
        self.assertEqual(s.get_task("t1")["owner"], "n1")

    def test_remove_node_does_not_refire_same_clock(self):
        # 即使原持有者同单位下线，该任务这个时钟单位也不能再被分走
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")
        self.assertEqual(s.remove_node("n1"), ["t1"])
        self.assertIsNone(s.get_task("t1")["owner"])
        self.assertEqual(s.acquire("n2"), [])

    def test_complete_does_not_refire_same_clock(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")
        s.complete("n1", "t1")
        self.assertEqual(s.acquire("n2"), [])
        # 但下一个触发点可以正常再分配
        s.tick(5)                                  # 时钟 10
        self.assertEqual(s.acquire("n2"), ["t1"])


class LeaseBoundaryTests(unittest.TestCase):
    """易错点二：lease_expire_at == 当前时钟 即过期（闭区间失效）。"""

    def test_lease_valid_one_unit_before_expiry(self):
        s = make([("t1", "*/5")], lease_duration=3)
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")                            # expire_at = 8
        s.tick(2)                                  # 时钟 7 < 8
        self.assertEqual(s.get_task("t1")["owner"], "n1")
        self.assertEqual(s.acquire("n2"), [])

    def test_lease_expires_exactly_at_boundary_via_tick(self):
        s = make([("t1", "*/5")], lease_duration=3)
        s.add_node("n1")
        s.tick(5)
        s.acquire("n1")                            # expire_at = 8
        s.tick(3)                                  # 时钟 8 == expire_at → 失效
        self.assertIsNone(s.get_task("t1")["owner"])
        self.assertIsNone(s.get_task("t1")["lease_expire_at"])
        self.assertEqual(s.get_node("n1")["tasks"], [])

    def test_lease_expires_at_boundary_on_next_due_clock(self):
        # 时钟 8 已回收但 */5 不到点；时钟 10 才能重新分配
        s = make([("t1", "*/5")], lease_duration=3)
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")
        s.tick(5)                                  # 时钟 10，早已过期
        self.assertEqual(s.acquire("n2"), ["t1"])
        self.assertEqual(s.get_task("t1")["owner"], "n2")

    def test_boundary_step_by_step(self):
        # 租约长度 3、在时钟 2 acquire：时钟 4 仍有效，时钟 5 立即失效
        s = make([("t1", "2")], lease_duration=3)
        s.add_node("n1")
        s.tick(2)
        s.acquire("n1")                            # expire_at = 5
        s.tick(2)                                  # 时钟 4，仍有效
        self.assertEqual(s.get_task("t1")["owner"], "n1")
        s.tick(1)                                  # 时钟 5 == expire_at
        self.assertIsNone(s.get_task("t1")["owner"])


class HeartbeatTests(unittest.TestCase):
    def test_heartbeat_renews_owned_tasks(self):
        s = make([("t1", "7")])
        s.add_node("n1")
        s.tick(7)
        s.acquire("n1")                            # expire 10
        self.assertEqual(s.heartbeat("n1"), ["t1"])
        self.assertEqual(s.get_task("t1")["lease_expire_at"], 10)

    def test_heartbeat_only_renews_own_tasks(self):
        """易错点三：不能续约别人的任务。"""
        s = make([("t1", "*/5")], lease_duration=3)
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")                            # t1 expire 8
        s.tick(1)                                  # 时钟 6
        s.heartbeat("n2")                          # n2 什么都没持有
        self.assertEqual(s.get_task("t1")["lease_expire_at"], 8)
        s.tick(2)                                  # 时钟 8：t1 必须失效
        self.assertIsNone(s.get_task("t1")["owner"])

    def test_heartbeat_unknown_node(self):
        s = make([("t1", "*/5")])
        with self.assertRaises(SchedulerError):
            s.heartbeat("ghost")

    def test_acquire_unknown_node(self):
        s = make([("t1", "*/5")])
        s.tick(5)
        with self.assertRaises(SchedulerError):
            s.acquire("ghost")

    def test_heartbeat_keeps_lease_alive_across_boundary(self):
        s = make([("t1", "2")], lease_duration=3)
        s.add_node("n1")
        s.tick(2)
        s.acquire("n1")                            # expire 5
        s.tick(2)                                  # 时钟 4
        s.heartbeat("n1")                          # expire 7
        s.tick(1)                                  # 时钟 5，原本到期，续约后仍有效
        self.assertEqual(s.get_task("t1")["owner"], "n1")
        self.assertEqual(s.get_task("t1")["lease_expire_at"], 7)


class CompleteTests(unittest.TestCase):
    def test_complete_by_non_owner_raises(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        s.acquire("n1")
        with self.assertRaises(SchedulerError):
            s.complete("n2", "t1")

    def test_complete_unassigned_task_raises(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.tick(5)
        with self.assertRaises(SchedulerError):
            s.complete("n1", "t1")

    def test_complete_unknown_task_or_node(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        with self.assertRaises(SchedulerError):
            s.complete("n1", "ghost")
        with self.assertRaises(SchedulerError):
            s.complete("ghost", "t1")

    def test_complete_clears_owner_and_node_set(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.tick(5)
        s.acquire("n1")
        s.complete("n1", "t1")
        self.assertIsNone(s.get_task("t1")["owner"])
        self.assertEqual(s.get_node("n1")["tasks"], [])


class RemoveNodeTests(unittest.TestCase):
    def test_remove_unknown_node(self):
        s = make([])
        with self.assertRaises(SchedulerError):
            s.remove_node("ghost")

    def test_remove_node_releases_all_tasks(self):
        # "1" 的触发点（时钟 1）在注册前错过，时钟 2 只有 t2 可分配
        s = make([("t1", "1"), ("t2", "2")])
        s.add_node("n1")
        s.tick(2)
        self.assertEqual(s.acquire("n1"), ["t2"])
        released = s.remove_node("n1")
        self.assertEqual(released, ["t2"])
        self.assertIsNone(s.get_task("t2")["owner"])
        self.assertEqual(s.list_nodes(), [])


class QueryTests(unittest.TestCase):
    def test_get_task_unknown(self):
        s = make([])
        with self.assertRaises(SchedulerError):
            s.get_task("ghost")

    def test_get_node_unknown(self):
        s = make([])
        with self.assertRaises(SchedulerError):
            s.get_node("ghost")

    def test_lists_sorted(self):
        s = make([("b", "*/5"), ("a", "7")])
        s.add_node("n2")
        s.add_node("n1")
        self.assertEqual([t["task_id"] for t in s.list_tasks()], ["a", "b"])
        self.assertEqual([n["node_id"] for n in s.list_nodes()], ["n1", "n2"])

    def test_orphaned_tasks(self):
        s = make([("due", "*/5"), ("notdue", "7")])
        s.add_node("n1")
        self.assertEqual(s.get_orphaned_tasks(), [])
        s.tick(5)
        # 已到触发点但还没被任何节点 acquire
        self.assertEqual(s.get_orphaned_tasks(), ["due"])
        s.acquire("n1")
        self.assertEqual(s.get_orphaned_tasks(), [])
        s.complete("n1", "due")
        # 同一时钟单位已触发过，不算积压
        self.assertEqual(s.get_orphaned_tasks(), [])
        # 租约过期但当时不是触发点：不算 orphaned；到下一个触发点才算
        s2 = make([("t", "*/5")], lease_duration=3)
        s2.add_node("n1")
        s2.tick(5)
        s2.acquire("n1")                           # expire 8
        s2.tick(3)                                 # 时钟 8，已回收但 */5 不命中
        self.assertEqual(s2.get_orphaned_tasks(), [])
        s2.tick(2)                                 # 时钟 10
        self.assertEqual(s2.get_orphaned_tasks(), ["t"])

    def test_returned_dicts_are_copies(self):
        # 外部篡改查询结果不能影响调度器内部状态
        s = make([("t1", "*/5")])
        s.add_node("n1")
        info = s.get_task("t1")
        info["owner"] = "hacker"
        info["ticks"].append(999)
        node = s.get_node("n1")
        node["tasks"].append("t1")
        self.assertIsNone(s.get_task("t1")["owner"])
        self.assertEqual(s.get_node("n1")["tasks"], [])


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _path(self, name="snapshot.json"):
        return os.path.join(self.tmpdir, name)

    def test_round_trip_preserves_state(self):
        s = make([("t1", "*/5,7"), ("t2", "3")], lease_duration=4)
        s.add_node("n1")
        s.add_node("n2")
        s.tick(7)
        s.acquire("n1")                            # t1
        s.heartbeat("n1")
        before = s.snapshot()
        path = self._path()
        s.save(path)

        loaded = Scheduler.load(path)
        self.assertEqual(loaded.snapshot(), before)
        self.assertEqual(loaded.clock, 7)
        self.assertEqual(loaded.lease_duration, 4)
        self.assertEqual(loaded.get_task("t1")["owner"], "n1")
        # 加载回来的调度器可以继续工作
        self.assertEqual(loaded.acquire("n2"), [])

    def test_save_load_after_failover_state(self):
        s = make([("t1", "*/5")])
        s.add_node("n1")
        s.tick(5)
        s.acquire("n1")
        s.tick(3)                                  # 失联回收
        path = self._path("after.json")
        s.save(path)
        loaded = Scheduler.load(path)
        self.assertIsNone(loaded.get_task("t1")["owner"])
        self.assertEqual(loaded.get_node("n1")["tasks"], [])

    def test_load_missing_file(self):
        with self.assertRaises(SchedulerError):
            Scheduler.load(self._path("nope.json"))

    def test_load_corrupt_json(self):
        path = self._path("bad.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaises(SchedulerError) as ctx:
            Scheduler.load(path)
        self.assertIn("JSON", str(ctx.exception))

    def test_load_missing_fields(self):
        path = self._path("missing.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "clock": 0}, fh)
        with self.assertRaises(SchedulerError) as ctx:
            Scheduler.load(path)
        self.assertIn("缺少字段", str(ctx.exception))

    def test_load_wrong_version(self):
        path = self._path("ver.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"version": 99, "clock": 0, "lease_duration": 3,
                       "tasks": [], "nodes": []}, fh)
        with self.assertRaises(SchedulerError):
            Scheduler.load(path)

    def test_load_dangling_owner(self):
        bad = {
            "version": 1, "clock": 5, "lease_duration": 3,
            "tasks": [{
                "task_id": "t1", "schedule": "*/5", "owner": "ghost",
                "lease_expire_at": 8, "last_fired_at": 5,
            }],
            "nodes": [],
        }
        with self.assertRaisesRegex(SchedulerError, "owner.*不存在"):
            Scheduler.restore(bad)

    def test_load_node_holds_missing_task(self):
        bad = {
            "version": 1, "clock": 5, "lease_duration": 3,
            "tasks": [],
            "nodes": [{
                "node_id": "n1", "last_heartbeat": 5, "tasks": ["ghost"],
            }],
        }
        with self.assertRaisesRegex(SchedulerError, "持有不存在的任务"):
            Scheduler.restore(bad)

    def test_load_owner_task_set_mismatch(self):
        # 任务说 owner 是 n1，但 n1 的集合里没有它
        bad = {
            "version": 1, "clock": 5, "lease_duration": 3,
            "tasks": [{
                "task_id": "t1", "schedule": "*/5", "owner": "n1",
                "lease_expire_at": 8, "last_fired_at": 5,
            }],
            "nodes": [{"node_id": "n1", "last_heartbeat": 5, "tasks": []}],
        }
        with self.assertRaises(SchedulerError):
            Scheduler.restore(bad)

    def test_load_negative_lease_time(self):
        bad = {
            "version": 1, "clock": 5, "lease_duration": 3,
            "tasks": [{
                "task_id": "t1", "schedule": "*/5", "owner": "n1",
                "lease_expire_at": -1, "last_fired_at": 5,
            }],
            "nodes": [{
                "node_id": "n1", "last_heartbeat": 5, "tasks": ["t1"],
            }],
        }
        with self.assertRaisesRegex(SchedulerError, "负数"):
            Scheduler.restore(bad)

    def test_load_last_fired_not_matching_schedule(self):
        bad = {
            "version": 1, "clock": 6, "lease_duration": 3,
            "tasks": [{
                "task_id": "t1", "schedule": "*/5", "owner": None,
                "lease_expire_at": None, "last_fired_at": 6,
            }],
            "nodes": [],
        }
        with self.assertRaisesRegex(SchedulerError, "last_fired_at"):
            Scheduler.restore(bad)

    def test_load_owner_without_expiry(self):
        bad = {
            "version": 1, "clock": 5, "lease_duration": 3,
            "tasks": [{
                "task_id": "t1", "schedule": "*/5", "owner": "n1",
                "lease_expire_at": None, "last_fired_at": 5,
            }],
            "nodes": [{
                "node_id": "n1", "last_heartbeat": 5, "tasks": ["t1"],
            }],
        }
        with self.assertRaises(SchedulerError):
            Scheduler.restore(bad)

    def test_load_garbage_bytes(self):
        path = self._path("garbage.json")
        with open(path, "wb") as fh:
            fh.write(b"\xff\xfe\x00\x01not-json-at-all")
        with self.assertRaises(SchedulerError):
            Scheduler.load(path)


class FailoverSimulationTests(unittest.TestCase):
    """验收场景：3 节点、20 任务轮流 acquire，失联后重分配。"""

    def test_three_nodes_twenty_tasks_no_double_holding(self):
        s = Scheduler(lease_duration=3)
        for i in range(20):
            # 混合调度：步长 + 显式时钟
            schedule = "*/5" if i % 2 == 0 else f"{5 + (i % 5) * 5}"
            s.register_task(f"t{i:02d}", schedule)
        node_ids = ["n1", "n2", "n3"]
        for nid in node_ids:
            s.add_node(nid)

        ownership = {}  # task_id -> owner，任意时刻至多一个
        for clock in range(1, 31):
            s.tick(1)
            rotation = node_ids[clock % 3:] + node_ids[: clock % 3]
            for nid in rotation:
                got = s.acquire(nid)
                for tid in got:
                    self.assertNotIn(tid, ownership,
                                     f"{tid} 在时钟 {clock} 被二次分配")
                    ownership[tid] = nid
            # 在持节点心跳续约；随机风格地完成一些任务
            for nid in node_ids:
                held = s.get_node(nid)["tasks"]
                if held:
                    s.heartbeat(nid)
                for tid in list(held):
                    if clock % 4 == 0:
                        s.complete(nid, tid)
                        ownership.pop(tid, None)
            # 每个时钟结束都校验：任务 owner 与节点集合一致，且全局唯一
            owners = set()
            for t in s.list_tasks():
                if t["owner"] is not None:
                    self.assertNotIn(t["task_id"], owners)
                    owners.add(t["task_id"])
                    self.assertIn(t["task_id"],
                                  s.get_node(t["owner"])["tasks"])
            for nid in node_ids:
                for tid in s.get_node(nid)["tasks"]:
                    self.assertEqual(s.get_task(tid)["owner"], nid)

    def test_dead_node_tasks_fail_over(self):
        s = Scheduler(lease_duration=3)
        for i in range(5):
            s.register_task(f"t{i}", "*/5")
        s.add_node("n1")
        s.add_node("n2")
        s.tick(5)
        held = s.acquire("n1")
        self.assertEqual(len(held), 5)
        # n1 拿到任务后彻底停跳心跳；时钟越过租约
        s.tick(5)                                  # 时钟 10
        # 旧任务在时钟 8 已失联，时钟 10 到了新的触发点
        recovered = s.acquire("n2")
        self.assertEqual(sorted(recovered), [f"t{i}" for i in range(5)])
        for tid in recovered:
            self.assertEqual(s.get_task(tid)["owner"], "n2")
        self.assertEqual(s.get_node("n1")["tasks"], [])
        self.assertEqual(s.get_node("n2")["tasks"],
                         [f"t{i}" for i in range(5)])
        # n1 即使"复活"发心跳也拿不回任务，且只续约自己（空）集合
        self.assertEqual(s.heartbeat("n1"), [])
        for i in range(5):
            self.assertEqual(s.get_task(f"t{i}")["owner"], "n2")


class CliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def run_cli(self, lines, lease_duration=3):
        stdin = io.StringIO("\n".join(lines) + "\n")
        stdout = io.StringIO()
        cli.run(stdin, stdout, lease_duration=lease_duration)
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_happy_path(self):
        out = self.run_cli([
            json.dumps({"op": "register_task", "task_id": "t1",
                        "schedule": "*/5"}),
            json.dumps({"op": "add_node", "node_id": "n1"}),
            json.dumps({"op": "tick", "n": 5}),
            json.dumps({"op": "acquire", "node_id": "n1"}),
            json.dumps({"op": "orphaned"}),
            json.dumps({"op": "complete", "node_id": "n1", "task_id": "t1"}),
        ])
        self.assertTrue(all(r["ok"] for r in out), out)
        self.assertEqual(out[3]["tasks"], ["t1"])
        self.assertEqual(out[4]["tasks"], [])

    def test_errors_returned_as_json(self):
        out = self.run_cli([
            "{not json",
            json.dumps({"op": "bogus"}),
            json.dumps({"op": "heartbeat", "node_id": "ghost"}),
            json.dumps({"op": "register_task", "task_id": "t1",
                        "schedule": ""}),
            json.dumps({"op": "register_task"}),  # 缺参数
            json.dumps({"op": "tick", "n": 0}),
            json.dumps([1, 2, 3]),
        ])
        self.assertEqual(len(out), 7)
        for r in out:
            self.assertFalse(r["ok"])
            self.assertIn("error", r)
        # 出错后下一条仍可正常执行
        out2 = self.run_cli([
            json.dumps({"op": "register_task", "task_id": "t",
                        "schedule": "*/5"}),
            "{bad",
            json.dumps({"op": "status"}),
        ])
        self.assertTrue(out2[0]["ok"])
        self.assertFalse(out2[1]["ok"])
        self.assertTrue(out2[2]["ok"])
        self.assertEqual(len(out2[2]["tasks"]), 1)

    def test_status_and_dump(self):
        out = self.run_cli([
            json.dumps({"op": "register_task", "task_id": "t1",
                        "schedule": "7"}),
            json.dumps({"op": "add_node", "node_id": "n1"}),
            json.dumps({"op": "status"}),
            json.dumps({"op": "dump"}),
        ])
        self.assertEqual(out[2]["clock"], 0)
        self.assertEqual(out[2]["lease_duration"], 3)
        self.assertIn("snapshot", out[3])

    def test_save_load_via_cli(self):
        path = os.path.join(self.tmpdir, "snap.json")
        out = self.run_cli([
            json.dumps({"op": "register_task", "task_id": "t1",
                        "schedule": "*/5"}),
            json.dumps({"op": "add_node", "node_id": "n1"}),
            json.dumps({"op": "tick", "n": 5}),
            json.dumps({"op": "acquire", "node_id": "n1"}),
            json.dumps({"op": "save", "path": path}),
            json.dumps({"op": "load", "path": path}),
            json.dumps({"op": "status"}),
        ])
        self.assertTrue(all(r["ok"] for r in out), out)
        self.assertEqual(out[5]["clock"], 5)
        self.assertEqual(out[6]["tasks"][0]["owner"], "n1")

    def test_load_bad_file_via_cli(self):
        path = os.path.join(self.tmpdir, "broken.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{}")
        out = self.run_cli([json.dumps({"op": "load", "path": path})])
        self.assertFalse(out[0]["ok"])
        self.assertIn("error", out[0])

    def test_remove_node_via_cli(self):
        out = self.run_cli([
            json.dumps({"op": "register_task", "task_id": "t1",
                        "schedule": "*/5"}),
            json.dumps({"op": "add_node", "node_id": "n1"}),
            json.dumps({"op": "add_node", "node_id": "n2"}),
            json.dumps({"op": "tick", "n": 5}),
            json.dumps({"op": "acquire", "node_id": "n1"}),
            json.dumps({"op": "remove_node", "node_id": "n1"}),
            json.dumps({"op": "status"}),
        ])
        self.assertTrue(all(r["ok"] for r in out), out)
        self.assertEqual(out[5]["released"], ["t1"])
        remaining_nodes = [n["node_id"] for n in out[6]["nodes"]]
        self.assertEqual(remaining_nodes, ["n2"])


if __name__ == "__main__":
    unittest.main()
