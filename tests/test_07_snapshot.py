"""需求 8：JSON 快照保存/恢复、严格校验与失败原子性。"""

import json
import os
import tempfile
import unittest

import connpool as cp
from connpool.snapshot import kernel_to_dict, restore_from_text
from tests._helpers import make_kernel


def build_rich_kernel():
    k, clock = make_kernel(start=50)
    k.add_pool(cp.PoolConfig(
        "orders", capacity=3, idle_ttl=15, max_queue=4,
        quotas={"a": 2, "b": 3}))
    k.add_pool(cp.PoolConfig("pay", capacity=1, quotas={"a": 1}))
    c1 = k.acquire("orders", "a", "o1").connection_id
    c2 = k.acquire("orders", "b", "o2").connection_id
    k.release("orders", c1, "a")            # 空闲、a 亲缘
    k.acquire("orders", "a", "o3")          # 同租户复用 c1
    c3 = k.acquire("orders", "b", "o4").connection_id   # 新建第 3 条，池满
    q = k.acquire("orders", "b", "waiter")  # 池满 -> 排队
    assert q.is_queued
    pc = k.acquire("pay", "a", "pay-job").connection_id
    return k, clock, {"c1": c1, "c2": c2, "c3": c3, "pc": pc,
                      "ticket": q.ticket.ticket_id}


class TestSnapshotRoundTrip(unittest.TestCase):
    def test_round_trip_preserves_state(self):
        k, clock, refs = build_rich_kernel()
        clock.advance(7)
        data = kernel_to_dict(k)
        text = json.dumps(data, ensure_ascii=False)

        k2 = restore_from_text(text)
        self.assertEqual(k2.clock.now(), 57)
        # 池配置
        s1 = k.pool_stats("orders")
        s2 = k2.pool_stats("orders")
        self.assertEqual(s1, s2)
        self.assertEqual(k2.pool_stats("pay"), k.pool_stats("pay"))
        # 连接归属与借出时长
        v_before = k.connection_view("orders", refs["c1"])
        v_after = k2.connection_view("orders", refs["c1"])
        self.assertEqual(v_after.tenant, "a")
        self.assertEqual(v_after.purpose, "o3")
        self.assertEqual(v_after.borrow_duration, v_before.borrow_duration)
        v_idle = [c for c in k2.all_connections("orders") if c.state == "idle"]
        self.assertEqual(len(v_idle), 0)
        # 排队请求
        reqs = k2.queued_requests("orders")
        waiting = [r for r in reqs if r["status"] == "waiting"]
        self.assertEqual(len(waiting), 1)
        self.assertEqual(waiting[0]["ticket_id"], refs["ticket"])
        # 租户占用
        usage = {(u.pool_id, u.tenant): (u.quota, u.used)
                 for u in k2.all_tenant_usage()}
        self.assertEqual(usage[("orders", "a")], (2, 1))
        self.assertEqual(usage[("orders", "b")], (3, 2))
        self.assertEqual(usage[("pay", "a")], (1, 1))

    def test_restored_kernel_keeps_working_without_id_collision(self):
        k, clock, refs = build_rich_kernel()
        k2 = restore_from_text(json.dumps(kernel_to_dict(k)))
        # 新连接/票据号必须严格续号，不与快照内冲突
        k2.release("orders", refs["c2"], "b")
        # 队首 b 被兑现（复用 c2）
        st = k2.ticket_status("orders", refs["ticket"])
        self.assertEqual(st["status"], "fulfilled")
        self.assertEqual(st["conn_id"], refs["c2"])
        # 审计序号在快照基础上连续
        seqs = [e["seq"] for e in k2.events()]
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))

    def test_save_and_load_json_file(self):
        k, clock, refs = build_rich_kernel()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "snap.json")
            cp.save_json(k, path)
            k2 = cp.load_json(path)
            self.assertEqual(k2.list_pools(), k.list_pools())
            self.assertEqual(
                [c.conn_id for c in k2.all_connections()],
                [c.conn_id for c in k.all_connections()])

    def test_serialization_is_deterministic(self):
        k, _, _ = build_rich_kernel()
        t1 = json.dumps(kernel_to_dict(k), ensure_ascii=False, indent=2)
        t2 = json.dumps(kernel_to_dict(k), ensure_ascii=False, indent=2)
        self.assertEqual(t1, t2)

    def test_empty_kernel_round_trips(self):
        k, _ = make_kernel(start=3)
        k2 = restore_from_text(json.dumps(kernel_to_dict(k)))
        self.assertEqual(k2.list_pools(), [])
        self.assertEqual(k2.clock.now(), 3)

    def test_restore_is_idempotent_and_reproducible(self):
        # 保存 -> 恢复 -> 再保存，两次快照必须逐字段一致（可复现）
        k, _, _ = build_rich_kernel()
        d1 = kernel_to_dict(k)
        k2 = restore_from_text(json.dumps(d1))
        d2 = kernel_to_dict(k2)
        self.assertEqual(d1, d2)
        # 审计事件轨迹也完整恢复
        self.assertEqual(k2.events(), k.events())

    def test_replay_deterministic_from_snapshot(self):
        # 从同一份快照出发，执行相同的操作序列，结果必须完全一致
        def script(text):
            k = restore_from_text(text)
            c = k.all_connections("orders")
            held = next(x.conn_id for x in c if x.tenant == "b")
            k.release("orders", held, "b")
            k.clock.advance(5)
            return kernel_to_dict(k)

        text = json.dumps(kernel_to_dict(build_rich_kernel()[0]))
        self.assertEqual(script(text), script(text))


def _mutate(base, path, value):
    """简单 JSON 路径改写：'a.b.0.c'。"""
    parts = path.split(".")
    node = base
    for p in parts[:-1]:
        node = node[int(p)] if p.isdigit() else node[p]
    node[parts[-1]] = value
    return json.dumps(base, ensure_ascii=False)


def _delete(base, path):
    parts = path.split(".")
    node = base
    for p in parts[:-1]:
        node = node[int(p)] if p.isdigit() else node[p]
    del node[parts[-1]]
    return json.dumps(base, ensure_ascii=False)


class TestSnapshotValidation(unittest.TestCase):
    def setUp(self):
        k, self.clock, _ = build_rich_kernel()
        self.base = kernel_to_dict(k)

    def expect_error(self, text, reason=cp.Reason.SNAPSHOT_MISSING_FIELD):
        with self.assertRaises(cp.SnapshotError) as cm:
            restore_from_text(text)
        self.assertEqual(cm.exception.reason, reason)
        return cm.exception

    def test_corrupt_json(self):
        self.expect_error("{not json", cp.Reason.SNAPSHOT_CORRUPT)

    def test_wrong_version(self):
        e = self.expect_error(
            _mutate(self.base, "schema_version", 99),
            cp.Reason.SNAPSHOT_CORRUPT)
        self.assertIn("版本", str(e))

    def test_missing_top_level_fields(self):
        for f in ("schema_version", "clock_now", "pools", "events"):
            self.expect_error(_delete(kernel_to_dict(build_rich_kernel()[0]), f))

    def test_wrong_types(self):
        self.expect_error(
            _mutate(self.base, "clock_now", "50"),
            cp.Reason.SNAPSHOT_CORRUPT)
        pool = self.base["pools"]["orders"]
        self.expect_error(
            _mutate(self.base, "pools.orders.config.capacity", "3"),
            cp.Reason.SNAPSHOT_CORRUPT)

    def test_zero_capacity_rejected(self):
        e = self.expect_error(
            _mutate(self.base, "pools.orders.config.capacity", 0),
            cp.Reason.SNAPSHOT_INCONSISTENT)
        self.assertIn("容量", str(e))

    def test_negative_quota_rejected(self):
        self.expect_error(
            _mutate(self.base, "pools.orders.config.quotas.a", -1),
            cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_duplicate_connection_id(self):
        conns = self.base["pools"]["orders"]["connections"]
        conns.append(json.loads(json.dumps(conns[0])))
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_duplicate_ticket_id(self):
        q = self.base["pools"]["orders"]["queue"]
        q.append(json.loads(json.dumps(q[0])))
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_tenant_in_use_mismatch(self):
        # 把 b 的占用改错，连接实际归属统计对不上
        self.expect_error(
            _mutate(self.base, "pools.orders.tenant_in_use.b", 9),
            cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_usage_exceeds_quota(self):
        # 给 b 多记一条借出连接但不同步 tenant_in_use -> 占用不一致
        conns = self.base["pools"]["orders"]["connections"]
        borrowed = next(c for c in conns if c["tenant"] == "b")
        extra = json.loads(json.dumps(borrowed))
        extra["conn_id"] = "orders-900"
        conns.append(extra)
        self.base["pools"]["orders"]["tenant_in_use"]["b"] = 2
        # b 配额 3 不超；把 b 配额降到 1 -> 超配额
        self.expect_error(
            _mutate(self.base, "pools.orders.config.quotas.b", 1),
            cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_total_exceeds_capacity(self):
        conns = self.base["pools"]["orders"]["connections"]
        idle = {
            "conn_id": "orders-901", "pool_id": "orders", "born_at": 1,
            "idle_since": 2, "last_tenant": "a", "tenant": None,
            "borrowed_at": None, "purpose": None, "retire_on_return": False,
        }
        conns.append(idle)
        # 当前 3 条（全借出/复用），容量 3，加一条空闲 -> 4 > 3
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_borrowed_connection_missing_tenant(self):
        conns = self.base["pools"]["orders"]["connections"]
        c = next(c for c in conns if c["tenant"] is not None)
        c["tenant"] = None
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_idle_connection_missing_idle_since(self):
        # 造一条空闲连接再删掉 idle_since
        self.base["pools"]["orders"]["capacity"] = 5
        self.base["pools"]["orders"]["config"]["capacity"] = 5
        idle = {
            "conn_id": "orders-902", "pool_id": "orders", "born_at": 1,
            "idle_since": 2, "last_tenant": "a", "tenant": None,
            "borrowed_at": None, "purpose": None, "retire_on_return": False,
        }
        self.base["pools"]["orders"]["connections"].append(idle)
        del idle["idle_since"]
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_bad_pool_id_key_mismatch(self):
        self.base["pools"]["renamed"] = self.base["pools"].pop("orders")
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_fulfilled_ticket_bad_binding(self):
        # 造一个已兑现票据，绑定到持有租户不符的连接
        conns = self.base["pools"]["orders"]["connections"]
        a_conn = next(c for c in conns if c["tenant"] == "a")
        bad_ticket = {
            "ticket_id": 900, "pool_id": "orders", "tenant": "b",
            "purpose": "x", "enqueued_at": 1, "deadline": None,
            "status": "fulfilled", "conn_id": a_conn["conn_id"],
        }
        # next_seq 必须大于 900
        self.base["pools"]["orders"]["next_seq"] = 901
        self.base["pools"]["orders"]["queue"].append(bad_ticket)
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_historical_fulfilled_ticket_with_closed_connection_ok(self):
        # 已兑现票据引用的连接后来被正常关闭（TTL/收缩），属于合法历史
        ticket = {
            "ticket_id": 901, "pool_id": "orders", "tenant": "a",
            "purpose": "old", "enqueued_at": 1, "deadline": None,
            "status": "fulfilled", "conn_id": "orders-closed-1",
        }
        self.base["pools"]["orders"]["next_seq"] = 902
        self.base["pools"]["orders"]["queue"].append(ticket)
        k = restore_from_text(json.dumps(self.base))
        self.assertEqual(k.list_pools(), ["orders", "pay"])

    def test_event_seq_gap(self):
        events = self.base["events"]
        events[-1]["seq"] = events[-1]["seq"] + 1
        self.expect_error(
            json.dumps(self.base), cp.Reason.SNAPSHOT_INCONSISTENT)

    def test_next_seq_collision(self):
        conns = self.base["pools"]["orders"]["connections"]
        max_seq = max(int(c["conn_id"].rsplit("-", 1)[1]) for c in conns)
        self.expect_error(
            _mutate(self.base, "pools.orders.next_seq", max_seq),
            cp.Reason.SNAPSHOT_INCONSISTENT)


class TestLoadAtomicity(unittest.TestCase):
    def test_failed_load_into_live_kernel_keeps_state(self):
        k, clock, refs = build_rich_kernel()
        before_stats = k.pool_stats("orders")
        before_events = len(k.events())
        bad = kernel_to_dict(k)
        bad["pools"]["orders"]["config"]["capacity"] = 0
        with self.assertRaises(cp.SnapshotError):
            restore_from_text(json.dumps(bad), kernel=k)
        # 原实例一切照旧
        self.assertEqual(k.pool_stats("orders"), before_stats)
        self.assertEqual(len(k.events()), before_events)
        self.assertEqual(k.clock.now(), clock.now())
        # 仍可正常借还，ID 序列没被污染
        k.release("pay", refs["pc"], "a")
        again = k.acquire("pay", "a", "again")
        self.assertTrue(again.is_acquired)
        self.assertEqual(again.connection_id, refs["pc"])

    def test_clock_not_advanced_on_failure(self):
        k, clock, _ = build_rich_kernel()
        bad = kernel_to_dict(k)
        bad["clock_now"] = clock.now() + 1000
        bad["pools"]["orders"]["config"]["capacity"] = 0
        with self.assertRaises(cp.SnapshotError):
            restore_from_text(json.dumps(bad), kernel=k)
        self.assertNotEqual(k.clock.now(), clock.now() + 1000)


if __name__ == "__main__":
    unittest.main()
