"""world_kernel 的离线验收测试。"""

import time

import pytest

from world_kernel import EntityNotFound, SnapshotError, World


# ----------------------------------------------------------------------
# 1. 实体生命周期
# ----------------------------------------------------------------------

class TestEntityLifecycle:
    def test_ids_monotonic_and_never_reused(self):
        w = World()
        ids = [w.create() for _ in range(5)]
        assert ids == [1, 2, 3, 4, 5]
        w.destroy(2)
        w.destroy(4)
        # 销毁后的 id 不复用，分配器继续单调递增
        assert w.create() == 6
        assert w.create() == 7

    def test_destroy_twice_returns_false(self):
        w = World()
        e = w.create()
        assert w.destroy(e) is True
        assert w.destroy(e) is False
        assert w.destroy(9999) is False

    def test_components_invisible_after_destroy(self):
        w = World()
        e = w.create()
        w.set(e, "pos", (1, 2))
        w.set(e, "hp", 100)
        w.destroy(e)
        assert w.query("pos") == []
        assert w.query("hp") == []
        assert w.query() == []

    def test_set_get_on_destroyed_entity_raises_with_eid(self):
        w = World()
        e = w.create()
        w.set(e, "pos", (0, 0))
        w.destroy(e)
        with pytest.raises(EntityNotFound) as exc_info:
            w.set(e, "pos", (1, 1))
        assert exc_info.value.eid == e
        with pytest.raises(EntityNotFound) as exc_info:
            w.get(e, "pos")
        assert exc_info.value.eid == e
        with pytest.raises(EntityNotFound) as exc_info:
            w.remove(e, "pos")
        assert exc_info.value.eid == e


# ----------------------------------------------------------------------
# 2. 组件增删改
# ----------------------------------------------------------------------

class TestComponents:
    def test_set_overwrites_and_get_default(self):
        w = World()
        e = w.create()
        assert w.get(e, "hp") is None
        assert w.get(e, "hp", 42) == 42
        w.set(e, "hp", 100)
        assert w.get(e, "hp") == 100
        w.set(e, "hp", 80)  # 覆盖旧值
        assert w.get(e, "hp") == 80

    def test_remove_returns_whether_deleted(self):
        w = World()
        e = w.create()
        assert w.remove(e, "hp") is False
        w.set(e, "hp", 100)
        assert w.remove(e, "hp") is True
        assert w.remove(e, "hp") is False
        assert w.get(e, "hp") is None

    def test_arbitrary_values_stored_by_reference(self):
        w = World()
        e = w.create()
        payload = {"tags": ["a"], "nested": object()}
        w.set(e, "data", payload)
        assert w.get(e, "data") is payload  # 内核不深拷贝

    def test_register_component_idempotent(self):
        w = World()
        w.register_component("pos")
        w.register_component("pos")
        e = w.create()
        w.set(e, "pos", (1, 1))
        assert w.query("pos") == [e]


# ----------------------------------------------------------------------
# 3. 查询：正确性、排序、性能
# ----------------------------------------------------------------------

class TestQuery:
    def test_query_matches_and_sorted(self):
        w = World()
        e1, e2, e3 = w.create(), w.create(), w.create()
        w.set(e1, "pos", 1)
        w.set(e2, "pos", 1)
        w.set(e2, "vel", 2)
        w.set(e3, "vel", 3)
        assert w.query("pos") == [e1, e2]
        assert w.query("vel") == [e2, e3]
        assert w.query("pos", "vel") == [e2]
        assert w.query() == [e1, e2, e3]

    def test_result_independent_of_insertion_order(self):
        w = World()
        ids = [w.create() for _ in range(50)]
        # 乱序插入组件
        for e in reversed(ids):
            w.set(e, "pos", e)
        assert w.query("pos") == sorted(ids)

    def test_query_performance_100k_entities(self):
        w = World()
        types = [f"c{i}" for i in range(8)]
        n = 100_000
        for _ in range(n):
            e = w.create()
            # 平均每实体 4 个组件，确定性分布
            for i in range(4):
                w.set(e, types[(e + i) % 8], e)
        start = time.perf_counter()
        result = w.query("c0", "c1")
        elapsed = time.perf_counter() - start
        assert elapsed < 0.05, f"query took {elapsed * 1000:.1f}ms"
        assert result == sorted(result)
        # 连续 4 个组件的窗口覆盖 {c0,c1} 的是 e%8 ∈ {0, 7, 6} 三批
        assert len(result) == 3 * (n // 8)


# ----------------------------------------------------------------------
# 4. 查询缓存：命中与定向失效
# ----------------------------------------------------------------------

class TestQueryCache:
    def test_repeat_query_hits_cache(self):
        w = World()
        e = w.create()
        w.set(e, "pos", 1)
        assert w.query("pos") == [e]
        assert w.stats()["hits"] == 0
        w.query("pos")
        w.query("pos")
        assert w.stats()["hits"] == 2
        assert w.stats()["entries"] == 1

    def test_targeted_invalidation(self):
        w = World()
        e = w.create()
        w.set(e, "a", 1)
        w.set(e, "b", 2)
        w.query("a")
        w.query("b")
        w.query("a", "b")
        assert w.stats()["entries"] == 3
        # 修改 c 组件：与 a/b 相关的缓存都不受影响
        w.set(e, "c", 3)
        assert w.stats()["entries"] == 3
        assert w.stats()["invalidations"] == 0
        # 新增 a 组件到另一个实体：只失效含 a 的缓存项
        e2 = w.create()
        w.set(e2, "a", 1)
        assert w.stats()["invalidations"] == 2  # ("a") 和 ("a","b")
        assert w.stats()["entries"] == 1        # 只剩 ("b")
        assert w.query("b") == [e]              # 缓存仍可用

    def test_overwrite_does_not_invalidate(self):
        w = World()
        e = w.create()
        w.set(e, "a", 1)
        w.query("a")
        w.set(e, "a", 999)  # 覆盖值，实体集合没变
        assert w.stats()["invalidations"] == 0
        w.query("a")
        assert w.stats()["hits"] == 1

    def test_remove_and_destroy_invalidate(self):
        w = World()
        e1, e2 = w.create(), w.create()
        w.set(e1, "a", 1)
        w.set(e2, "a", 2)
        w.set(e2, "b", 3)
        w.query("a")
        w.query("b")
        w.remove(e2, "b")
        assert w.stats()["invalidations"] == 1  # 只有 ("b")
        w.destroy(e1)
        # e1 只有 a：失效 ("a")；空查询 () 未缓存，不计
        assert w.stats()["invalidations"] == 2
        assert w.query("a") == [e2]

    def test_stats_shape(self):
        w = World()
        s = w.stats()
        assert s == {"hits": 0, "invalidations": 0, "entries": 0}


# ----------------------------------------------------------------------
# 5. 快照：字节稳定、往返、损坏拒绝
# ----------------------------------------------------------------------

class TestSnapshot:
    def _build_world(self):
        w = World()
        e1 = w.create()
        e2 = w.create()
        w.set(e1, "pos", {"x": 1, "y": 2})
        w.set(e1, "hp", 100)
        w.set(e2, "pos", {"x": 3, "y": 4})
        w.query("pos")  # 让缓存统计非零
        w.query("pos")
        return w

    def test_snapshot_bytes_deterministic(self):
        w1 = self._build_world()
        w2 = self._build_world()
        assert w1.snapshot() == w2.snapshot()
        # 同一世界连续两次快照字节相同
        assert w1.snapshot() == w1.snapshot()

    def test_roundtrip(self):
        w = self._build_world()
        data = w.snapshot()
        stats_before = w.stats()

        w2 = World()
        w2.restore(data)
        # 缓存统计恢复到快照时刻（先做任何会改变统计的操作之前断言）
        assert w2.stats()["hits"] == stats_before["hits"]
        assert w2.stats()["invalidations"] == stats_before["invalidations"]
        # 恢复后立即再快照，字节与原快照一致
        assert w2.snapshot() == data
        # 查询结果一致
        assert w2.query("pos") == w.query("pos")
        assert w2.query("hp") == w.query("hp")
        assert w2.get(1, "pos") == {"x": 1, "y": 2}
        # id 分配器恢复：新实体接着快照时刻的 id 分配
        assert w2.create() == w.create()

    def test_corrupt_snapshot_rejected_and_world_unchanged(self):
        w = self._build_world()
        corrupt_cases = [
            b"",                                  # 空
            b"XXXX" + w.snapshot()[4:],           # 魔数错
            w.snapshot()[: len(w.snapshot()) // 2],  # 截断
            w.snapshot()[:-5] + b"\xff" * 5,      # 尾部损坏
            b"WSK1" + b"not a pickle at all",     # 载荷非法
        ]
        for bad in corrupt_cases:
            # 每次尝试前重新取样：查询会推进命中计数，属于正常状态变化
            prior = w.snapshot()
            with pytest.raises(SnapshotError):
                w.restore(bad)
            # 失败不改变当前世界
            assert w.snapshot() == prior
            assert w.query("pos") == [1, 2]


# ----------------------------------------------------------------------
# 6. 系统调度：顺序与异常中断
# ----------------------------------------------------------------------

class TestSystems:
    def test_phase_order_then_registration_order(self):
        w = World()
        calls = []
        w.register_system("s3", lambda w, dt: calls.append("s3"), phase=2)
        w.register_system("s1", lambda w, dt: calls.append("s1"), phase=1)
        w.register_system("s2", lambda w, dt: calls.append("s2"), phase=1)
        w.register_system("s0", lambda w, dt: calls.append("s0"), phase=-1)
        w.run(0.016)
        assert calls == ["s0", "s1", "s2", "s3"]

    def test_system_receives_world_and_dt(self):
        w = World()
        seen = []
        w.register_system("s", lambda w, dt: seen.append((w, dt)), phase=0)
        w.run(0.5)
        assert seen == [(w, 0.5)]

    def test_exception_aborts_run_and_world_consistent(self):
        w = World()
        e = w.create()
        w.set(e, "hp", 100)

        def good(w, dt):
            w.set(e, "hp", 50)  # 先完成的系统，写入生效

        def bad(w, dt):
            raise RuntimeError("boom")

        def never(w, dt):
            w.set(e, "hp", 1)  # 异常后的系统不应执行

        w.register_system("good", good, phase=0)
        w.register_system("bad", bad, phase=1)
        w.register_system("never", never, phase=2)

        with pytest.raises(RuntimeError, match="boom"):
            w.run(0.016)
        # 世界仍可查询，且没有半更新的组件
        assert w.get(e, "hp") == 50
        assert w.query("hp") == [e]
        # 异常中断的 run 也可以回滚
        assert w.rollback() is True
        assert w.get(e, "hp") == 100


# ----------------------------------------------------------------------
# 7. 确定性回滚
# ----------------------------------------------------------------------

class TestRollback:
    def test_rollback_restores_state_and_id_allocator(self):
        w = World()
        e1 = w.create()
        w.set(e1, "hp", 100)

        w.register_system("spawn", lambda w, dt: w.set(w.create(), "hp", 1), phase=0)
        w.run(0.016)
        assert w.query("hp") == [e1, 2]  # run 里新建了实体 2

        assert w.rollback() is True
        assert w.query("hp") == [e1]
        assert w.get(e1, "hp") == 100
        # id 分配器回退：重放同一批输入得到相同 id
        w.run(0.016)
        assert w.query("hp") == [e1, 2]

    def test_multi_level_rollback(self):
        w = World()
        w.register_system("spawn", lambda w, dt: w.create(), phase=0)
        w.run(1)   # 检查点 A：空世界；run 后实体 1
        w.run(1)   # 检查点 B：实体 1；run 后实体 1,2
        w.run(1)   # 检查点 C：实体 1,2；run 后实体 1,2,3
        assert w.query() == [1, 2, 3]
        assert w.rollback() is True
        assert w.query() == [1, 2]
        assert w.rollback() is True
        assert w.query() == [1]
        assert w.rollback() is True
        assert w.query() == []
        assert w.rollback() is False  # 栈空

    def test_rollback_covers_mutation_and_destroy(self):
        w = World()
        e = w.create()
        w.set(e, "pos", [0, 0])

        def sys(w, dt):
            w.get(e, "pos").append(99)  # 原地修改可变对象
            w.destroy(e)

        w.register_system("sys", sys, phase=0)
        w.run(1)
        assert w.query() == []
        w.rollback()
        # 检查点走的是序列化字节，原地修改也被回退
        assert w.get(e, "pos") == [0, 0]
        assert w.query("pos") == [e]

    def test_replay_determinism(self):
        """回滚后重放同一批系统，世界状态字节级一致。"""
        w = World()
        w.register_system("spawn", lambda w, dt: w.set(w.create(), "n", dt), phase=0)
        w.run(1)
        first = w.snapshot()
        w.rollback()
        w.run(1)
        assert w.snapshot() == first
