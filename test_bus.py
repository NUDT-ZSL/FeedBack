"""bus.py / main.py 的 unittest 测试。

覆盖：优先级投递、主题与阈值过滤、确认幂等、ack_up_to、背压、
两种队列溢出策略、超时与掉线重投递、注销清理/转移、状态查询、
快照往返与一致性校验错误、CLI 端到端与边界情况。
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from typing import List

import bus
from bus import BusError, Message, MessageBus, OverflowPolicy, UnsubscribePolicy
import main as climain


def make_msg(msg_id: str, topic: str = "t", priority: int = 0,
             payload=None, produced_at: int = 0) -> dict:
    return {"msg_id": msg_id, "topic": topic, "priority": priority,
            "payload": payload, "produced_at": produced_at}


def ids(deliver_result: dict) -> List[str]:
    return [m["msg_id"] for m in deliver_result["messages"]]


class PriorityDeliveryTests(unittest.TestCase):
    def test_order_priority_then_time_then_id(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=100)
        # produced_at 故意乱序发布。
        for mid, pri, ts in [
            ("low-late", 1, 9), ("high-late", 9, 5),
            ("high-early", 9, 1), ("tie-a", 5, 3), ("tie-b", 5, 3),
            ("tie-c", 5, 2),
        ]:
            b.publish(make_msg(mid, priority=pri, produced_at=ts))
        got = ids(b.deliver("s", 100))
        self.assertEqual(
            got,
            ["high-early", "high-late", "tie-c", "tie-a", "tie-b", "low-late"],
        )

    def test_publish_does_not_deliver(self):
        b = MessageBus()
        b.subscribe("s")
        b.publish(make_msg("m1"))
        self.assertEqual(b.get_state()["subscriptions"]["s"]["pending"], 1)
        self.assertEqual(b.get_state()["subscriptions"]["s"]["inflight"], 0)

    def test_topic_filter_and_min_priority(self):
        b = MessageBus()
        b.subscribe("a", topics=["orders"])
        b.subscribe("b", topics=["payments"], min_priority=5)
        b.subscribe("c")  # 订阅全部主题
        b.publish(make_msg("m1", topic="orders", priority=1))
        b.publish(make_msg("m2", topic="payments", priority=4))  # b 阈值不够
        b.publish(make_msg("m3", topic="payments", priority=9))
        self.assertEqual(ids(b.deliver("a", 10)), ["m1"])
        self.assertEqual(ids(b.deliver("b", 10)), ["m3"])
        self.assertEqual(ids(b.deliver("c", 10)), ["m3", "m2", "m1"])
        self.assertEqual(b.list_subscriptions("orders"), ["a", "c"])
        self.assertEqual(b.list_subscriptions("payments"), ["b", "c"])

    def test_no_duplicate_inflight_redelivery(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        b.publish(make_msg("m1", priority=1))
        first = ids(b.deliver("s", 5))
        second = ids(b.deliver("s", 5))
        self.assertEqual(first, ["m1"])
        self.assertEqual(second, [])  # 未确认不重复投递

    def test_duplicate_msg_id_rejected(self):
        b = MessageBus()
        b.publish(make_msg("m1"))
        with self.assertRaises(BusError):
            b.publish(make_msg("m1"))

    def test_invalid_message_fields(self):
        b = MessageBus()
        with self.assertRaises(BusError):
            b.publish(make_msg("", topic="t"))
        with self.assertRaises(BusError):
            b.publish({"msg_id": "x", "topic": "t",
                       "priority": 1.5, "produced_at": 0})
        with self.assertRaises(BusError):
            b.publish({"msg_id": "x", "topic": "t",
                       "priority": True, "produced_at": 0})
        with self.assertRaises(BusError):
            b.publish({"msg_id": "x", "topic": "",
                       "priority": 1, "produced_at": 0})
        with self.assertRaises(BusError):
            b.publish({"msg_id": "x", "topic": "t", "priority": 1,
                       "produced_at": 0, "payload": {1, 2}})  # set 不可 JSON 化


class AckTests(unittest.TestCase):
    def test_ack_idempotent(self):
        b = MessageBus()
        b.subscribe("s")
        b.publish(make_msg("m1"))
        b.deliver("s")
        r1 = b.ack("s", "m1")
        r2 = b.ack("s", "m1")
        self.assertTrue(r1["acked"])
        self.assertFalse(r1["already_acked"])
        self.assertFalse(r2["acked"])
        self.assertTrue(r2["already_acked"])
        # 确认后不再投递。
        self.assertEqual(ids(b.deliver("s", 5)), [])

    def test_ack_unknown_message_and_subscriber(self):
        b = MessageBus()
        b.subscribe("s")
        r = b.ack("s", "ghost")  # 不存在的消息不报错
        self.assertFalse(r["acked"])
        self.assertFalse(r["known"])
        with self.assertRaises(BusError):
            b.ack("nobody", "m1")

    def test_ack_up_to_prefix(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for i, mid in enumerate(["m1", "m2", "m3", "m4"]):
            b.publish(make_msg(mid, priority=10 - i, produced_at=i))
        b.deliver("s", 10)  # m1..m4 全部 inflight
        r = b.ack_up_to("s", "m3")
        self.assertTrue(r["found"])
        self.assertEqual(r["acked_ids"], ["m1", "m2", "m3"])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["inflight"], 1)
        self.assertEqual(st["acked"], 3)
        # 重复幂等：本次没有新确认。
        r2 = b.ack_up_to("s", "m3")
        self.assertEqual(r2["acked_ids"], [])

    def test_ack_up_to_unknown_is_noop(self):
        b = MessageBus()
        b.subscribe("s")
        r = b.ack_up_to("s", "never")
        self.assertFalse(r["found"])
        self.assertEqual(r["acked_ids"], [])

    def test_ack_up_to_after_offline_requeue(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        b.set_online("s", False)  # 全部回队
        # 位移仍在：ack_up_to m2 应确认回队中的 m1,m2。
        r = b.ack_up_to("s", "m2")
        self.assertEqual(r["acked_ids"], ["m1", "m2"])
        b.set_online("s", True)
        self.assertEqual(ids(b.deliver("s", 10)), ["m3"])


class BackpressureTests(unittest.TestCase):
    def test_inflight_limit_backpressure(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=2, max_queue=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        r1 = b.deliver("s", 5)
        self.assertEqual(ids(r1), ["m1", "m2"])
        self.assertFalse(r1["backpressure"])
        r2 = b.deliver("s", 5)
        self.assertEqual(ids(r2), [])
        self.assertTrue(r2["backpressure"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["backpressure_count"], 1)
        # ack 一条后恢复。
        b.ack("s", "m1")
        r3 = b.deliver("s", 5)
        self.assertEqual(ids(r3), ["m3"])
        self.assertFalse(r3["backpressure"])

    def test_max_inflight_zero_always_backpressure(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=0, max_queue=5)
        b.publish(make_msg("m1"))
        r = b.deliver("s", 5)
        self.assertEqual(ids(r), [])
        self.assertTrue(r["backpressure"])

    def test_max_messages_zero_or_negative(self):
        b = MessageBus()
        b.subscribe("s")
        b.publish(make_msg("m1"))
        r = b.deliver("s", 0)
        self.assertEqual(ids(r), [])
        self.assertFalse(r["backpressure"])  # 调用方不取，不计背压

    def test_offline_deliver_empty_no_backpressure(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=1)
        b.publish(make_msg("m1"))
        b.set_online("s", False)
        r = b.deliver("s", 5)
        self.assertEqual(ids(r), [])
        self.assertFalse(r["backpressure"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["backpressure_count"], 0)

    def test_partial_capacity_no_backpressure(self):
        # 取走部分消息后仍有空位时不算背压；只有真正打满后再取才算。
        b = MessageBus()
        b.subscribe("s", max_inflight=3, max_queue=10)
        for mid in ["m1", "m2"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        r = b.deliver("s", 5)
        self.assertEqual(ids(r), ["m1", "m2"])
        self.assertFalse(r["backpressure"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["backpressure_count"], 0)

    def test_ack_up_to_after_partial_redelivery(self):
        # 重投后只取到部分消息，ack_up_to 不应越过游标误确认后面的消息。
        b = MessageBus()
        b.subscribe("s", max_inflight=3, max_queue=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        b.set_online("s", False)
        b.set_online("s", True)
        b.deliver("s", 1)  # 只重新取到 m1
        r = b.ack_up_to("s", "m1")
        self.assertEqual(r["acked_ids"], ["m1"])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["inflight"], 0)
        self.assertEqual(st["pending"], 2)
        self.assertEqual(ids(b.deliver("s", 10)), ["m2", "m3"])


class SubscribeUpdateTests(unittest.TestCase):
    def test_update_preserves_state_and_online(self):
        b = MessageBus()
        b.subscribe("s", topics=["t1"], max_inflight=1, max_queue=5)
        b.publish(make_msg("m1", topic="t1", priority=1))
        b.set_online("s", False)
        # 更新配置不会把离线状态冲掉。
        r = b.subscribe("s", topics=["t2"], max_inflight=2, max_queue=9)
        self.assertEqual(r["action"], "updated")
        self.assertFalse(b.get_state()["subscriptions"]["s"]["online"])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["pending"], 1)
        self.assertEqual(st["max_inflight"], 2)
        self.assertEqual(st["max_queue"], 9)
        # 变更前已入队的旧主题消息仍会投递；变更后只路由新主题。
        b.set_online("s", True)
        self.assertEqual(ids(b.deliver("s", 5)), ["m1"])
        b.publish(make_msg("m2", topic="t1", priority=1))  # 不再匹配
        b.publish(make_msg("m3", topic="t2", priority=1))
        self.assertEqual(ids(b.deliver("s", 5)), ["m3"])


class QueueOverflowTests(unittest.TestCase):
    def test_reject_policy(self):
        b = MessageBus(overflow_policy=OverflowPolicy.REJECT)
        b.subscribe("s", max_inflight=10, max_queue=2)
        r1 = b.publish(make_msg("m1", priority=5))
        r2 = b.publish(make_msg("m2", priority=5))
        r3 = b.publish(make_msg("m3", priority=5))
        self.assertTrue(r1["accepted"])
        self.assertTrue(r2["accepted"])
        self.assertFalse(r3["accepted"])
        self.assertEqual(r3["dropped"], ["s"])
        self.assertEqual(b.get_state()["dropped_count"], 1)

    def test_max_queue_zero_rejects_everything(self):
        b = MessageBus()
        b.subscribe("s", max_queue=0)
        r = b.publish(make_msg("m1"))
        self.assertFalse(r["accepted"])
        self.assertEqual(r["dropped"], ["s"])

    def test_drop_lowest_evicts_old_low_message(self):
        b = MessageBus(overflow_policy=OverflowPolicy.DROP_LOWEST)
        b.subscribe("s", max_inflight=10, max_queue=2)
        b.publish(make_msg("lo", priority=1, produced_at=0))
        b.publish(make_msg("mid", priority=5, produced_at=0))
        # 队列满；高优先级新消息挤掉最低的 lo。
        r = b.publish(make_msg("hi", priority=9, produced_at=0))
        self.assertTrue(r["accepted"])
        self.assertEqual(ids(b.deliver("s", 10)), ["hi", "mid"])

    def test_drop_lowest_new_message_is_lowest(self):
        b = MessageBus(overflow_policy=OverflowPolicy.DROP_LOWEST)
        b.subscribe("s", max_inflight=10, max_queue=2)
        b.publish(make_msg("a", priority=5, produced_at=0))
        b.publish(make_msg("b", priority=5, produced_at=0))
        # 新消息最低：旧队列不动，新消息被拒。
        r = b.publish(make_msg("c", priority=1, produced_at=0))
        self.assertFalse(r["accepted"])
        self.assertEqual(sorted(ids(b.deliver("s", 10))), ["a", "b"])

    def test_drop_lowest_tie_breaks_by_time_and_id(self):
        b = MessageBus(overflow_policy=OverflowPolicy.DROP_LOWEST)
        b.subscribe("s", max_inflight=10, max_queue=2)
        # 同优先级：produced_at 最大者被视为最低淘汰；再并列 msg_id 最大者。
        b.publish(make_msg("early", priority=5, produced_at=0))
        b.publish(make_msg("late", priority=5, produced_at=9))
        b.publish(make_msg("new", priority=9, produced_at=0))
        got = ids(b.deliver("s", 10))
        self.assertEqual(got, ["new", "early"])  # late 被淘汰

    def test_drop_lowest_evicts_previously_delivered_message(self):
        # 被挤掉的消息有过投递历史时，历史痕迹也必须清理，快照仍然合法。
        b = MessageBus(overflow_policy=OverflowPolicy.DROP_LOWEST)
        b.subscribe("s", max_inflight=10, max_queue=1)
        b.publish(make_msg("old-low", priority=1, produced_at=0))
        self.assertEqual(ids(b.deliver("s", 10)), ["old-low"])  # inflight
        b.publish(make_msg("held", priority=9, produced_at=0))  # 入队
        b.set_online("s", False)  # old-low 回队 -> 队列 [held, old-low]
        b.set_online("s", True)
        # 新消息优先级介于两者之间：old-low 最低被淘汰。
        r = b.publish(make_msg("mid", priority=5, produced_at=0))
        self.assertTrue(r["accepted"])
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            b.save(path)
            b2 = MessageBus.load(path)
        got = ids(b2.deliver("s", 10))
        self.assertIn("held", got)
        self.assertIn("mid", got)
        self.assertNotIn("old-low", got)


class OfflineRecoveryTests(unittest.TestCase):
    def test_offline_requeue_preserves_order_and_flag(self):
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid, pri in [("m1", 1), ("m2", 9), ("m3", 5)]:
            b.publish(make_msg(mid, priority=pri, produced_at=0))
        first = b.deliver("s", 10)
        self.assertEqual(ids(first), ["m2", "m3", "m1"])
        self.assertTrue(all(not m["redelivered"] for m in first["messages"]))

        b.set_online("s", False)
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["pending"], 3)
        self.assertEqual(st["inflight"], 0)

        # 离线期间新消息照常排队。
        b.publish(make_msg("m4", priority=7, produced_at=0))
        b.set_online("s", True)
        second = b.deliver("s", 10)["messages"]
        self.assertEqual([m["msg_id"] for m in second],
                         ["m2", "m4", "m3", "m1"])
        self.assertTrue(all(m["redelivered"] for m in second if m["msg_id"] != "m4"))
        self.assertFalse(next(m for m in second if m["msg_id"] == "m4")["redelivered"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 3)

    def test_set_online_same_state_is_noop(self):
        b = MessageBus()
        b.subscribe("s")
        b.publish(make_msg("m1"))
        b.deliver("s")
        r = b.set_online("s", True)
        self.assertEqual(r["returned"], [])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["inflight"], 1)

    def test_timeout_redelivery_with_injected_clock(self):
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", max_inflight=10, ack_timeout=5)
        b.publish(make_msg("m1", priority=5, produced_at=0))
        b.deliver("s")  # delivered_at=0
        clock.advance(4)
        self.assertEqual(b.check_timeouts(), [])
        clock.advance(1)  # now=5，超时
        self.assertEqual(b.check_timeouts(), ["m1"])
        red = b.deliver("s")["messages"][0]
        self.assertTrue(red["redelivered"])
        self.assertEqual(red["delivery_no"], 2)

    def test_external_clock_cannot_tick(self):
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        with self.assertRaises(BusError):
            b.tick()

    def test_offline_messages_skip_timeout_scan(self):
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", ack_timeout=5)
        b.publish(make_msg("m1"))
        b.deliver("s")
        b.set_online("s", False)  # 已回队
        clock.advance(100)
        self.assertEqual(b.check_timeouts(), [])

    def test_repeated_offline_cycles_never_duplicate_queue(self):
        # 回归：重投后投递历史含重复 id，再次掉线/超时回队不得重复入队。
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        for _ in range(3):
            b.deliver("s", 10)
            b.set_online("s", False)
            b.set_online("s", True)
        r = b.deliver("s", 10)
        self.assertEqual(sorted(ids(r)), ["m1", "m2"])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["inflight"], 2)
        self.assertEqual(st["pending"], 0)

    def test_repeated_timeout_cycles_never_duplicate_queue(self):
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", max_inflight=10, ack_timeout=5)
        for mid in ["m1", "m2"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        for _ in range(3):
            b.deliver("s", 10)
            clock.advance(5)
            due = b.check_timeouts()
            self.assertEqual(sorted(due), ["m1", "m2"])  # 不重复
        self.assertEqual(sorted(ids(b.deliver("s", 10))), ["m1", "m2"])


class _ManualClock:
    def __init__(self, start=0):
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, n):
        self.t += n
        return self.t


class UnsubscribeTests(unittest.TestCase):
    def test_drop_policy_keeps_other_subscribers(self):
        b = MessageBus()
        b.subscribe("a")
        b.subscribe("b")
        b.publish(make_msg("m1"))
        r = b.unsubscribe("a")
        self.assertEqual(r["policy"], "drop")
        self.assertEqual(r["dropped"], ["m1"])
        # b 仍持有，消息本体还在。
        self.assertIsNotNone(b.get_message("m1"))
        self.assertEqual(ids(b.deliver("b", 5)), ["m1"])
        # a 彻底消失。
        with self.assertRaises(BusError):
            b.deliver("a", 1)
        self.assertEqual(b.list_subscriptions(), ["b"])

    def test_drop_gcs_message_when_last_holder(self):
        b = MessageBus()
        b.subscribe("a")
        b.publish(make_msg("m1"))
        b.deliver("a")
        b.unsubscribe("a")
        self.assertIsNone(b.get_message("m1"))  # 没有静默泄漏

    def test_transfer_policy(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"])
        b.publish(make_msg("m1", topic="t"))
        b.deliver("a")  # m1 在 a 的 inflight
        b.subscribe("b", topics=["t"])  # 发布后才订阅，因此不持有 m1
        r = b.unsubscribe("a")
        self.assertEqual(r["transferred"], ["m1"])
        red = b.deliver("b")["messages"][0]
        self.assertEqual(red["msg_id"], "m1")
        self.assertTrue(red["redelivered"])

    def test_transfer_skips_offline_and_full_queue(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"])
        b.subscribe("offline", topics=["other"], online=False)
        b.subscribe("full", topics=["t"], max_queue=0)
        b.publish(make_msg("m1", topic="t"))  # 只有 a 接收
        r = b.unsubscribe("a")
        self.assertEqual(r["dropped"], ["m1"])
        self.assertEqual(r["transferred"], [])
        self.assertIsNone(b.get_message("m1"))

    def test_transfer_retained_when_already_held(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", max_inflight=10)
        b.subscribe("b", max_inflight=10)
        b.publish(make_msg("m1"))
        b.deliver("a", 10)
        b.deliver("b", 10)  # b 也持有 m1
        r = b.unsubscribe("a")
        self.assertEqual(r["retained"], ["m1"])
        self.assertIsNotNone(b.get_message("m1"))

    def test_unsubscribe_unknown(self):
        b = MessageBus()
        with self.assertRaises(BusError):
            b.unsubscribe("ghost")


class StateAndQueryTests(unittest.TestCase):
    def test_empty_bus_state(self):
        b = MessageBus()
        st = b.get_state()
        self.assertEqual(st["topics"], 0)
        self.assertEqual(st["subscribers"], 0)
        self.assertEqual(st["messages"], 0)
        self.assertEqual(st["clock"], 0)
        self.assertEqual(b.list_subscriptions(), [])
        self.assertIsNone(b.get_message("nope"))

    def test_publish_without_subscribers_is_kept(self):
        b = MessageBus()
        r = b.publish(make_msg("m1", topic="lonely"))
        self.assertFalse(r["accepted"])
        self.assertIsNotNone(b.get_message("m1"))  # 消息保留可查
        self.assertEqual(b.get_state()["topics"], 1)
        # 之后新订阅不会补发。
        b.subscribe("late", topics=["lonely"])
        self.assertEqual(ids(b.deliver("late", 5)), [])

    def test_clock_advances(self):
        b = MessageBus()
        self.assertEqual(b.tick(3), 3)
        self.assertEqual(b.now(), 3)
        self.assertEqual(b.get_state()["clock"], 3)

    def test_message_object_api_and_payload(self):
        b = MessageBus()
        b.subscribe("s")
        m = Message(msg_id="m1", topic="t", priority=2,
                    payload={"k": [1, 2]}, produced_at=7)
        b.publish(m)
        got = b.get_message("m1")
        self.assertEqual(got["payload"], {"k": [1, 2]})
        self.assertEqual(got["produced_at"], 7)


class SnapshotTests(unittest.TestCase):
    def _complex_bus(self):
        clock = _ManualClock(10)
        b = MessageBus(clock=clock,
                       overflow_policy=OverflowPolicy.DROP_LOWEST,
                       unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t1"], min_priority=0,
                    max_inflight=2, max_queue=5, ack_timeout=3)
        b.subscribe("b", max_inflight=1, max_queue=4)
        b.publish(make_msg("m1", topic="t1", priority=5, produced_at=1))
        b.publish(make_msg("m2", topic="t1", priority=2, produced_at=2))
        b.publish(make_msg("m3", topic="t2", priority=9, produced_at=0))
        clock.advance(2)
        b.deliver("a", 2)
        b.deliver("b", 1)
        clock.advance(1)
        b.ack("b", "m3")
        b.set_online("a", False)
        b.set_online("a", True)
        b.deliver("a", 1)  # 触发一次 redelivered 计数
        clock.advance(4)
        return b

    def test_round_trip_dict_equal(self):
        b = self._complex_bus()
        data = b.to_dict()
        b2 = MessageBus.from_dict(data)
        self.assertEqual(
            json.dumps(b2.to_dict(), sort_keys=True, ensure_ascii=False),
            json.dumps(data, sort_keys=True, ensure_ascii=False),
        )

    def test_round_trip_file_functional(self):
        b = self._complex_bus()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "state.json")
            b.save(path)
            b2 = MessageBus.load(path)
        # 策略恢复。
        self.assertIs(b2.overflow_policy, OverflowPolicy.DROP_LOWEST)
        self.assertIs(b2.unsubscribe_policy, UnsubscribePolicy.TRANSFER)
        # 状态一致。
        self.assertEqual(b2.get_state(), b.get_state())
        # 仍可继续投递/确认。
        st_before = b2.get_state()["subscriptions"]["a"]
        r = b2.deliver("a", 10)
        self.assertTrue(all(m["redelivered"] for m in r["messages"]))
        self.assertGreaterEqual(st_before["pending"], 1)

    def test_save_load_empty_bus(self):
        b = MessageBus()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "e.json")
            b.save(path)
            b2 = MessageBus.load(path)
        self.assertEqual(b2.get_state(), b.get_state())

    def _write_and_expect_error(self, data, fragment):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bad.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            with self.assertRaises(BusError) as ctx:
                MessageBus.load(path)
        self.assertIn(fragment, str(ctx.exception))

    def test_corrupt_json_reports_position(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bad.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{broken")
            with self.assertRaises(BusError) as ctx:
                MessageBus.load(path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_missing_file(self):
        with self.assertRaises(BusError):
            MessageBus.load(os.path.join(tempfile.gettempdir(),
                                         "definitely-missing-xyz.json"))

    def test_validation_errors(self):
        good = {
            "version": 1, "clock": 0, "topics": ["t"],
            "policies": {"overflow": "reject", "unsubscribe": "drop"},
            "counters": {"dropped": 0, "backpressure": {}, "redelivered": {}},
            "messages": [make_msg("m1", "t", 1, produced_at=0)],
            "subscriptions": [{
                "sub_id": "s", "topics": ["t"], "min_priority": 0,
                "max_inflight": 10, "max_queue": 10, "ack_timeout": None,
                "online": True,
                "pending": [{"msg_id": "m1", "enqueued_at": 0,
                             "redelivered": False}],
                "inflight": [], "delivery_order": [], "acked": [],
            }],
        }

        def mutate(**kw):
            d = json.loads(json.dumps(good))
            for path, value in kw.items():
                node = d
                parts = path.split(".")
                for p in parts[:-1]:
                    node = node[int(p)] if p.isdigit() else node[p]
                last = parts[-1]
                node[int(last) if last.isdigit() else last] = value
            return d

        # 缺字段
        d = mutate(**{"messages": []})
        d.pop("clock")
        self._write_and_expect_error(d, "missing field")
        # 版本不对
        self._write_and_expect_error(mutate(version=99), "version")
        # 重复 msg_id
        d = json.loads(json.dumps(good))
        d["messages"].append(make_msg("m1", "t", 1))
        self._write_and_expect_error(d, "uniqueness")
        # priority 非整数
        self._write_and_expect_error(
            mutate(**{"messages.0.priority": "high"}), "priority")
        # 订阅引用未知 topic
        self._write_and_expect_error(
            mutate(**{"subscriptions.0.topics": ["nope"]}), "unknown topic")
        # pending 引用未知消息
        self._write_and_expect_error(
            mutate(**{"subscriptions.0.pending.0.msg_id": "ghost"}),
            "unknown msg_id")
        # inflight 不在 delivery_order
        d = json.loads(json.dumps(good))
        d["subscriptions"][0]["pending"] = []
        d["subscriptions"][0]["inflight"] = [{
            "msg_id": "m1", "delivered_at": 0,
            "delivery_no": 1, "redelivered": False}]
        d["subscriptions"][0]["delivery_order"] = []
        self._write_and_expect_error(d, "missing from delivery_order")
        # delivery_order 里的消息三不管
        d = json.loads(json.dumps(good))
        d["subscriptions"][0]["pending"] = []
        d["subscriptions"][0]["delivery_order"] = ["m1"]
        self._write_and_expect_error(d, "neither")
        # 已确认消息仍在队列
        d = json.loads(json.dumps(good))
        d["subscriptions"][0]["acked"] = ["m1"]
        self._write_and_expect_error(d, "cannot be acked")
        # 同一条消息既 pending 又 inflight
        d = json.loads(json.dumps(good))
        d["subscriptions"][0]["inflight"] = [{
            "msg_id": "m1", "delivered_at": 0,
            "delivery_no": 1, "redelivered": False}]
        d["subscriptions"][0]["delivery_order"] = ["m1"]
        self._write_and_expect_error(d, "both pending and inflight")
        # max_queue=0 却有待投递
        self._write_and_expect_error(
            mutate(**{"subscriptions.0.max_queue": 0}), "max_queue is 0")
        # 非法策略
        self._write_and_expect_error(
            mutate(**{"policies.overflow": "explode"}), "invalid policy")
        # 计数器引用未知订阅者
        d = mutate()
        d["counters"]["backpressure"] = {"ghost": 1}
        self._write_and_expect_error(d, "unknown subscriber")
        # 重复订阅者
        d = json.loads(json.dumps(good))
        d["subscriptions"].append(dict(d["subscriptions"][0]))
        self._write_and_expect_error(d, "duplicate subscription")

    def test_filter_change_allows_held_mismatch_after_roundtrip(self):
        # 运行时变更过滤器后，已在队列中的消息不匹配新过滤器，但仍会投递，
        # 这种状态的快照必须能正常往返。
        b = MessageBus()
        b.subscribe("s", topics=["t1"])
        b.publish(make_msg("m1", topic="t1", priority=1))
        b.subscribe("s", topics=["t2"])  # 变更过滤器，旧消息保留
        data = b.to_dict()
        b2 = MessageBus.from_dict(data)
        self.assertEqual(ids(b2.deliver("s", 5)), ["m1"])


class CLITests(unittest.TestCase):
    def test_full_session(self):
        lines = [
            '{"cmd":"subscribe","sub_id":"a","topics":["t"],"max_inflight":2,"max_queue":3}',
            '{"cmd":"publish","msg_id":"m1","topic":"t","priority":5,"produced_at":1}',
            '{"cmd":"publish","msg_id":"m2","topic":"t","priority":9,"produced_at":0}',
            '{"cmd":"deliver","sub_id":"a","max_messages":5}',
            '{"cmd":"deliver","sub_id":"a","max_messages":5}',
            '{"cmd":"ack","sub_id":"a","msg_id":"m2"}',
            '{"cmd":"set_online","sub_id":"a","online":false}',
            '{"cmd":"set_online","sub_id":"a","online":true}',
            '{"cmd":"deliver","sub_id":"a","max_messages":5}',
            '{"cmd":"state"}',
            '{"cmd":"get","msg_id":"m1"}',
            '{"cmd":"get","msg_id":"ghost"}',
            '{"cmd":"list","topic":"t"}',
        ]
        out = [json.loads(x) for x in climain.process_lines(lines)]
        self.assertEqual([m["msg_id"] for m in out[3]["messages"]], ["m2", "m1"])
        self.assertTrue(out[4]["backpressure"])
        self.assertTrue(all(m["redelivered"] for m in out[8]["messages"]
                            if m["msg_id"] == "m1"))
        self.assertEqual(out[9]["subscribers"], 1)
        self.assertTrue(out[10]["exists"])
        self.assertFalse(out[11]["exists"])
        self.assertEqual(out[12]["subscribers"], ["a"])

    def test_errors_are_json_with_error_field(self):
        lines = [
            "not json",
            '{"cmd":"deliver","sub_id":"x"}',
            '{"cmd":"publish"}',
            '{"cmd":"ack","sub_id":"x"}',
            '{"cmd":"state"}',  # 错误不中断后续命令
        ]
        out = [json.loads(x) for x in climain.process_lines(lines)]
        for row in out[:4]:
            self.assertIn("error", row)
            self.assertFalse(row["ok"])
        self.assertTrue(out[4]["ok"])

    def test_save_load_via_cli(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            lines = [
                '{"cmd":"subscribe","sub_id":"a","max_inflight":10}',
                '{"cmd":"publish","msg_id":"m1","topic":"t","priority":1,"produced_at":0}',
                json.dumps({"cmd": "save", "path": path}),
                json.dumps({"cmd": "load", "path": path}),
                '{"cmd":"deliver","sub_id":"a","max_messages":5}',
            ]
            out = [json.loads(x) for x in climain.process_lines(lines)]
            self.assertTrue(out[2]["saved"])
            self.assertTrue(out[3]["loaded"])
            self.assertEqual([m["msg_id"] for m in out[4]["messages"]], ["m1"])

    def test_load_bad_file_via_cli(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "b.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("///")
            out = [json.loads(x) for x in climain.process_lines(
                [json.dumps({"cmd": "load", "path": path})])]
        self.assertIn("error", out[0])

    def test_invalid_policy_is_json_error_not_crash(self):
        lines = [
            '{"cmd":"config","overflow":"explode"}',
            '{"cmd":"subscribe","sub_id":"a"}',
            '{"cmd":"unsubscribe","sub_id":"a","policy":"nope"}',
            '{"cmd":"state"}',  # 前几个错误不中断会话
        ]
        out = [json.loads(x) for x in climain.process_lines(lines)]
        self.assertIn("error", out[0])
        self.assertIn("error", out[2])
        self.assertTrue(out[3]["ok"])

    def test_kernel_invalid_policy_raises_bus_error(self):
        with self.assertRaises(BusError):
            MessageBus(overflow_policy="explode")
        b = MessageBus()
        b.subscribe("s")
        with self.assertRaises(BusError):
            b.unsubscribe("s", policy="nope")


if __name__ == "__main__":
    unittest.main()
