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

    def test_ack_up_to_repeated_and_earlier_offset_idempotent(self):
        # 重复确认、以及确认一个更早的位移，都是幂等空操作且不报错。
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        r1 = b.ack_up_to("s", "m3")
        self.assertEqual(r1["acked_ids"], ["m1", "m2", "m3"])
        # 重复：没有新确认。
        r2 = b.ack_up_to("s", "m3")
        self.assertTrue(r2["found"])
        self.assertEqual(r2["acked_ids"], [])
        # 更早的位移 m1：也没有新确认、不报错。
        r3 = b.ack_up_to("s", "m1")
        self.assertTrue(r3["found"])
        self.assertEqual(r3["acked_ids"], [])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["inflight"], 0)
        self.assertEqual(st["acked"], 3)

    def test_ack_up_to_does_not_touch_unredelivered_after_offline(self):
        # 核心回归：掉线后部分消息还没重新投出时，ack_up_to 不能误确认它们。
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        b.ack("s", "m1")          # 先确认掉 m1
        b.set_online("s", False)  # m2,m3 回队（pending）
        b.set_online("s", True)
        # 只重新投出 m2（max_messages=1）。
        self.assertEqual(ids(b.deliver("s", 1)), ["m2"])
        # 游标确认到 m2：只能确认在途的 m2；m3 仍在队列，不能被误确认。
        r = b.ack_up_to("s", "m2")
        self.assertEqual(r["acked_ids"], ["m2"])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["pending"], 1)
        self.assertEqual(st["inflight"], 0)
        # m3 之后仍能正常投递，且是重投标记。
        m3 = b.deliver("s", 1)["messages"][0]
        self.assertEqual(m3["msg_id"], "m3")
        self.assertTrue(m3["redelivered"])

    def test_ack_up_to_after_offline_requeue(self):
        # 新语义：ack_up_to 只确认真实在途(inflight)的前缀。掉线回队后，
        # 在重新投递之前调用 ack_up_to 不得确认仍在待投递队列里的消息。
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        b.set_online("s", False)  # 全部回队（此时都是 pending）
        # 还没重新投递：ack_up_to 不应误杀待投递消息。
        r = b.ack_up_to("s", "m2")
        self.assertTrue(r["found"])
        self.assertEqual(r["acked_ids"], [])
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["pending"], 3)
        self.assertEqual(st["inflight"], 0)
        # 全部消息仍可重新投递。
        b.set_online("s", True)
        self.assertEqual(ids(b.deliver("s", 10)), ["m1", "m2", "m3"])
        # 重新投递后 ack_up_to 正常确认在途前缀。
        r2 = b.ack_up_to("s", "m2")
        self.assertEqual(r2["acked_ids"], ["m1", "m2"])
        self.assertEqual(ids(b.deliver("s", 10)), [])

    def test_ack_up_to_partial_after_partial_redelivery(self):
        # 掉线后只重新投递了前两条，ack_up_to 到 m2 只确认这两条在途消息，
        # 队列里尚未投出的 m3,m4 不受影响。
        b = MessageBus()
        b.subscribe("s", max_inflight=2, max_queue=10)
        for mid in ["m1", "m2", "m3", "m4"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 2)  # m1,m2 inflight；m3,m4 仍在队列（从未投出）
        b.set_online("s", False)  # m1,m2 回队
        b.set_online("s", True)
        # 队列现在 [m3,m4,m1,m2]，按优先级同档 + 同 produced_at 按 msg_id：
        # 但全序键下 m1<m2<m3<m4，先取到 m1,m2。
        got = b.deliver("s", 2)["messages"]
        self.assertEqual([m["msg_id"] for m in got], ["m1", "m2"])
        r = b.ack_up_to("s", "m2")
        self.assertEqual(r["acked_ids"], ["m1", "m2"])
        # m3,m4 依旧待投递且不会被误确认。
        self.assertEqual(ids(b.deliver("s", 10)), ["m3", "m4"])


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

    def test_backpressure_counts_blocked_deliver_calls(self):
        # 口径：背压次数 == deliver 因 inflight 打满而被挡下（返回空）的调用次数。
        b = MessageBus()
        b.subscribe("s", max_inflight=2, max_queue=10)
        for mid in ["m1", "m2", "m3", "m4"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 2)  # 打满，不计数（这次取到了消息）
        b.deliver("s", 2)  # 被挡 #1
        b.deliver("s", 2)  # 被挡 #2
        b.deliver("s", 0)  # max_messages=0 不算背压
        self.assertEqual(b.get_state()["subscriptions"]["s"]["backpressure_count"], 2)
        b.ack("s", "m1")
        r = b.deliver("s", 2)  # 恢复，取到 m3，不计背压
        self.assertEqual(ids(r), ["m3"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["backpressure_count"], 2)

    def test_redelivery_batch_count_one_per_offline_cycle(self):
        # 一次掉线无论回队多少条消息，redelivered_count 只 +1。
        b = MessageBus()
        b.subscribe("s", max_inflight=10)
        for mid in ["m1", "m2", "m3", "m4"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        b.set_online("s", False)  # 4 条一起回队 = 1 个批次
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)
        b.set_online("s", True)
        b.deliver("s", 10)
        b.set_online("s", False)  # 再来一次 = 2 个批次
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 2)
        # 取回的每条消息仍各自带 redelivered 标记。
        b.set_online("s", True)
        got = b.deliver("s", 10)["messages"]
        self.assertTrue(all(m["redelivered"] for m in got))

    def test_timeout_batch_count_one_per_scan_with_due(self):
        # 一次 check_timeouts 命中同一订阅者多条消息只算 1 个批次；
        # 没有到期消息的扫描不计数。
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", max_inflight=10, ack_timeout=5)
        for mid in ["m1", "m2", "m3"]:
            b.publish(make_msg(mid, priority=5, produced_at=0))
        b.deliver("s", 10)
        clock.advance(4)
        self.assertEqual(b.check_timeouts(), [])  # 未到期，不计
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 0)
        clock.advance(1)
        due = b.check_timeouts()  # 3 条同批到期
        self.assertEqual(sorted(due), ["m1", "m2", "m3"])
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)

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
        # 一次掉线 = 一个重投递批次，无论涉及几条消息都只计 1。
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)

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

    def test_one_offline_multi_topic_multi_message_is_single_batch(self):
        # 核心：一次掉线，跨多个主题、多条未确认消息，只算 1 个重投递批次。
        b = MessageBus()
        b.subscribe("s", topics=["A", "B", "C"], max_inflight=30)
        stream = [("a1", "A"), ("a2", "A"), ("b1", "B"), ("b2", "B"),
                  ("c1", "C"), ("c2", "C")]
        for i, (mid, topic) in enumerate(stream):
            # 优先级与 produced_at 故意各不相同，确保跨主题混排。
            b.publish(make_msg(mid, topic=topic, priority=i % 3,
                               produced_at=100 - i))
        first = b.deliver("s", 30)
        self.assertEqual(len(first["messages"]), 6)
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 0)

        r = b.set_online("s", False)
        self.assertEqual(len(r["returned"]), 6)
        st = b.get_state()["subscriptions"]["s"]
        self.assertEqual(st["redelivered_count"], 1)   # 只有一个批次
        self.assertEqual(st["inflight"], 0)
        self.assertEqual(st["pending"], 6)

        # 尚未再次掉线，计数不应增长（即使中间查询状态/重新投递）。
        b.set_online("s", True)
        b.deliver("s", 30)
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)

        # 再次掉线才产生第 2 个批次。
        b.set_online("s", False)
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 2)

    def test_offline_with_no_inflight_after_timeout_adds_no_batch(self):
        # 消息已被超时回队（计了一个批次）后再掉线，因无在途消息，不另计批次。
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", topics=["A", "B"], max_inflight=20, ack_timeout=5)
        for mid, topic in [("a1", "A"), ("b1", "B"), ("a2", "A")]:
            b.publish(make_msg(mid, topic=topic, priority=5, produced_at=0))
        b.deliver("s", 20)
        clock.advance(5)
        due = b.check_timeouts()          # 超时批次 +1
        self.assertEqual(sorted(due), ["a1", "a2", "b1"])
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)
        # 此刻没有 inflight；掉线不应再产生批次计数。
        b.set_online("s", False)
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 1)

    def test_timeout_and_offline_are_separate_batches_when_redelivered(self):
        # 超时回队后又被重新投出（重新在途），随后掉线是第二个独立批次。
        clock = _ManualClock(0)
        b = MessageBus(clock=clock)
        b.subscribe("s", topics=["A", "B"], max_inflight=20, ack_timeout=5)
        for mid, topic in [("a1", "A"), ("b1", "B")]:
            b.publish(make_msg(mid, topic=topic, priority=5, produced_at=0))
        b.deliver("s", 20)
        clock.advance(5)
        b.check_timeouts()               # 批次 1：超时
        b.deliver("s", 20)               # 重新投出 -> 再次在途
        b.set_online("s", False)         # 批次 2：掉线
        self.assertEqual(
            b.get_state()["subscriptions"]["s"]["redelivered_count"], 2)

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
        # 3 次掉线 = 3 个重投递批次（不是 3*2 条）。
        self.assertEqual(st["redelivered_count"], 3)

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
        # 3 次超时扫描 = 3 个重投递批次。
        self.assertEqual(b.get_state()["subscriptions"]["s"]["redelivered_count"], 3)


class _ManualClock:
    def __init__(self, start=0):
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, n):
        self.t += n
        return self.t


class UnsubscribeTests(unittest.TestCase):
    def test_cleanup_policy_keeps_other_subscribers(self):
        b = MessageBus()  # 默认 cleanup
        b.subscribe("a")
        b.subscribe("b")
        b.publish(make_msg("m1"))
        r = b.unsubscribe("a")
        self.assertEqual(r["policy"], "cleanup")  # 规范名
        self.assertEqual(r["dropped"], ["m1"])
        self.assertEqual(r["cleaned_up_count"], 1)
        self.assertEqual(r["transferred_count"], 0)
        # b 仍持有，消息本体还在。
        self.assertIsNotNone(b.get_message("m1"))
        self.assertEqual(ids(b.deliver("b", 5)), ["m1"])
        # a 彻底消失。
        with self.assertRaises(BusError):
            b.deliver("a", 1)
        self.assertEqual(b.list_subscriptions(), ["b"])
        # 注销后计数仍在总线状态中可查。
        st = b.get_state()
        self.assertEqual(st["unsubscribe_cleanup_count"], 1)
        self.assertEqual(st["unsubscribe_transfer_count"], 0)

    def test_drop_alias_equals_cleanup(self):
        # 旧名 "drop" 仍是合法策略，行为与 cleanup 完全一致。
        b = MessageBus(unsubscribe_policy="drop")
        self.assertIs(b.unsubscribe_policy, UnsubscribePolicy.CLEANUP)
        b.subscribe("a")
        b.publish(make_msg("m1"))
        r = b.unsubscribe("a", policy="drop")
        self.assertEqual(r["policy"], "cleanup")  # 归一到规范值
        self.assertEqual(r["cleaned_up_count"], 1)
        self.assertIsNone(b.get_message("m1"))

    def test_cleanup_gcs_message_when_last_holder(self):
        b = MessageBus()
        b.subscribe("a")
        b.publish(make_msg("m1"))
        b.deliver("a")
        r = b.unsubscribe("a")
        self.assertEqual(r["cleaned_up_count"], 1)
        self.assertIsNone(b.get_message("m1"))  # 没有静默泄漏

    def test_transfer_policy_delivered_message(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"])
        b.publish(make_msg("m1", topic="t"))
        b.deliver("a")  # m1 已投递给 a（inflight）
        b.subscribe("b", topics=["t"])  # 发布后才订阅，因此不持有 m1
        r = b.unsubscribe("a")
        self.assertEqual(r["transferred"], ["m1"])
        self.assertEqual(r["transferred_count"], 1)
        self.assertEqual(r["cleaned_up_count"], 0)
        self.assertEqual(b.get_state()["unsubscribe_transfer_count"], 1)
        red = b.deliver("b")["messages"][0]
        self.assertEqual(red["msg_id"], "m1")
        self.assertTrue(red["redelivered"])  # 曾投递过 -> 重投标记

    def test_transfer_never_delivered_message_not_flagged(self):
        # 从未投出的待投递消息转移后保持“首次投递”语义，不打 redelivered。
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"])
        b.publish(make_msg("m1", topic="t"))  # 只入队给 a，未 deliver
        b.subscribe("b", topics=["t"])        # 发布后才订阅，不持有 m1
        r = b.unsubscribe("a")
        self.assertEqual(r["transferred"], ["m1"])
        red = b.deliver("b")["messages"][0]
        self.assertEqual(red["msg_id"], "m1")
        self.assertFalse(red["redelivered"])
        self.assertEqual(red["delivery_no"], 1)

    def test_transfer_preserves_priority_order(self):
        # 转移多条不同优先级消息，接收方取消息时仍按全序（优先级降序…）。
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"], max_inflight=10)
        for mid, pri, ts in [("low", 1, 0), ("high", 9, 5), ("mid", 5, 2)]:
            b.publish(make_msg(mid, topic="t", priority=pri, produced_at=ts))
        b.subscribe("b", topics=["t"], max_inflight=10)
        b.unsubscribe("a")
        self.assertEqual(ids(b.deliver("b", 10)), ["high", "mid", "low"])

    def test_transfer_tie_breaks_stably_by_msg_id(self):
        # 同优先级、同 produced_at、不同 msg_id，且以非字典序发布：
        # 转移后接收方必须严格按 msg_id 字典序稳定排列。
        publish_order = ["m-zebra", "m-alpha", "m-mike", "m-beta", "m-gamma"]
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("x", topics=["t"], max_queue=50)
        for mid in publish_order:
            b.publish(make_msg(mid, topic="t", priority=5, produced_at=0))
        b.subscribe("y", topics=["t"], max_queue=50)
        b.unsubscribe("x")
        # 接收方物理待投递队列本身就是规范全序（不仅是 deliver 输出）。
        physical = [p.msg_id for p in b._pending["y"]]
        delivered = ids(b.deliver("y", 50))
        self.assertEqual(physical, sorted(publish_order))
        self.assertEqual(delivered, sorted(publish_order))

    def test_transfer_order_matches_direct_delivery(self):
        # 关键对照：同一批消息“直接投递给 b”与“先给 a 再 transfer 给 b”，
        # 接收方看到的顺序必须完全一致；接收方原有的一条*低优先级*消息要被
        # 转移进来的高优先级消息正确越过（物理队列与 deliver 输出都校验）。
        entries = [("x-lo", 1, 9), ("x-hi", 9, 1), ("x-mid", 5, 5),
                   ("x-tie1", 5, 5), ("x-tie2", 5, 5)]
        # 全序：x-hi(9,1) > x-mid(5,5)=x-tie1=x-tie2(按id) > b-prelow(1,0) > x-lo(1,9)
        expected = ["x-hi", "x-mid", "x-tie1", "x-tie2", "b-prelow", "x-lo"]

        def direct():
            b = MessageBus()
            b.subscribe("b", topics=["t"], max_queue=50, max_inflight=50)
            b.publish(make_msg("b-prelow", topic="t", priority=1, produced_at=0))
            for mid, pri, ts in entries:
                b.publish(make_msg(mid, topic="t", priority=pri, produced_at=ts))
            return ids(b.deliver("b", 50))

        def via_transfer():
            b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
            b.subscribe("x", topics=["t"], max_queue=50, max_inflight=50)
            for mid, pri, ts in entries:
                b.publish(make_msg(mid, topic="t", priority=pri, produced_at=ts))
            b.subscribe("b", topics=["t"], max_queue=50, max_inflight=50)
            # b 自己的低优先级消息（x 也匹配 -> 注销 x 时对它判 retained）。
            b.publish(make_msg("b-prelow", topic="t", priority=1, produced_at=0))
            b.unsubscribe("x")
            return b

        self.assertEqual(direct(), expected)
        tb = via_transfer()
        # 物理待投递队列本身即规范全序（转移后立即检查，先于 deliver 排序）。
        self.assertEqual([p.msg_id for p in tb._pending["b"]], expected)
        # deliver 输出与直接投递完全一致。
        self.assertEqual(ids(tb.deliver("b", 50)), expected)

    def test_transfer_skips_offline_and_full_queue(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.TRANSFER)
        b.subscribe("a", topics=["t"])
        b.subscribe("offline", topics=["other"], online=False)
        b.subscribe("full", topics=["t"], max_queue=0)
        b.publish(make_msg("m1", topic="t"))  # 只有 a 接收
        r = b.unsubscribe("a")
        self.assertEqual(r["dropped"], ["m1"])
        self.assertEqual(r["transferred"], [])
        # 无处可去 -> 计入清理计数（而非转移计数）。
        self.assertEqual(r["cleaned_up_count"], 1)
        self.assertEqual(b.get_state()["unsubscribe_cleanup_count"], 1)
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
        # retained 既不算转移也不算清理。
        self.assertEqual(r["transferred_count"], 0)
        self.assertEqual(r["cleaned_up_count"], 0)
        st = b.get_state()
        self.assertEqual(st["unsubscribe_transfer_count"], 0)
        self.assertEqual(st["unsubscribe_cleanup_count"], 0)
        self.assertIsNotNone(b.get_message("m1"))

    def test_cleanup_counts_accumulate_across_unsubscribes(self):
        b = MessageBus()
        b.subscribe("a")
        b.subscribe("b")
        b.publish(make_msg("m1"))
        b.publish(make_msg("m2"))
        b.unsubscribe("a")  # a 持有 m1,m2 -> 清理 2（b 也持有，本体保留）
        b.unsubscribe("b")  # b 持有的 m1,m2 成为最后副本 -> 再清理 2
        st = b.get_state()
        self.assertEqual(st["unsubscribe_cleanup_count"], 4)
        self.assertIsNone(b.get_message("m1"))
        self.assertIsNone(b.get_message("m2"))

    def test_unsubscribe_unknown(self):
        b = MessageBus()
        with self.assertRaises(BusError):
            b.unsubscribe("ghost")

    def test_unsubscribe_invalid_policy(self):
        b = MessageBus()
        b.subscribe("a")
        with self.assertRaises(BusError):
            b.unsubscribe("a", policy="explode")


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

    def test_old_snapshot_drop_policy_and_missing_counters_compatible(self):
        # 旧格式：policies.unsubscribe == "drop"，counters 里没有
        # unsubscribe_cleanup / unsubscribe_transfer 两个新字段。
        b = MessageBus()
        b.subscribe("s", topics=["t"])
        b.publish(make_msg("m1", topic="t", priority=1))
        data = b.to_dict()
        data["policies"]["unsubscribe"] = "drop"  # 旧值
        for key in ("unsubscribe_cleanup", "unsubscribe_transfer"):
            self.assertIn(key, data["counters"])
            del data["counters"][key]

        b2 = MessageBus.from_dict(data)
        # 旧 "drop" 归一到 cleanup 语义。
        self.assertIs(b2.unsubscribe_policy, UnsubscribePolicy.CLEANUP)
        self.assertEqual(b2.get_state()["unsubscribe_policy"], "cleanup")
        # 缺失的新计数器按 0 加载。
        self.assertEqual(b2.get_state()["unsubscribe_cleanup_count"], 0)
        self.assertEqual(b2.get_state()["unsubscribe_transfer_count"], 0)
        # 功能与 cleanup 一致：注销清理，消息本体回收。
        b2.unsubscribe("s")
        self.assertEqual(b2.get_state()["unsubscribe_cleanup_count"], 1)
        self.assertIsNone(b2.get_message("m1"))

    def test_unsubscribe_counters_persist_across_snapshot(self):
        b = MessageBus(unsubscribe_policy=UnsubscribePolicy.CLEANUP)
        b.subscribe("a")
        b.publish(make_msg("m1"))
        b.unsubscribe("a")  # cleanup +1
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "u.json")
            b.save(path)
            b2 = MessageBus.load(path)
        self.assertEqual(b2.get_state()["unsubscribe_cleanup_count"], 1)
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

    def test_cli_cleanup_unsubscribe_and_state_counts(self):
        lines = [
            '{"cmd":"subscribe","sub_id":"a","topics":["t"]}',
            '{"cmd":"subscribe","sub_id":"b","topics":["t"]}',
            '{"cmd":"publish","msg_id":"m1","topic":"t","priority":1,"produced_at":0}',
            '{"cmd":"unsubscribe","sub_id":"a","policy":"cleanup"}',
            '{"cmd":"state"}',
            '{"cmd":"unsubscribe","sub_id":"b","policy":"drop"}',  # 旧别名
            '{"cmd":"state"}',
            '{"cmd":"get","msg_id":"m1"}',
        ]
        out = [json.loads(x) for x in climain.process_lines(lines)]
        self.assertTrue(out[3]["ok"])
        self.assertEqual(out[3]["cleaned_up_count"], 1)
        self.assertEqual(out[3]["policy"], "cleanup")
        # a 注销后状态里仍能看到清理计数（b 还持有 m1，本体未回收）。
        self.assertEqual(out[4]["unsubscribe_cleanup_count"], 1)
        self.assertIn("b", out[4]["subscriptions"])
        # b 用旧名 drop 注销，再清理 1 条；m1 成为最后副本被回收。
        self.assertEqual(out[6]["unsubscribe_cleanup_count"], 2)
        self.assertFalse(out[7]["exists"])

    def test_cli_transfer_unsubscribe_preserves_order(self):
        lines = [
            '{"cmd":"subscribe","sub_id":"a","topics":["t"],"max_inflight":10}',
            '{"cmd":"publish","msg_id":"lo","topic":"t","priority":1,"produced_at":0}',
            '{"cmd":"publish","msg_id":"hi","topic":"t","priority":9,"produced_at":0}',
            '{"cmd":"subscribe","sub_id":"b","topics":["t"]}',
            '{"cmd":"unsubscribe","sub_id":"a","policy":"transfer"}',
            '{"cmd":"deliver","sub_id":"b","max_messages":10}',
            '{"cmd":"state"}',
        ]
        out = [json.loads(x) for x in climain.process_lines(lines)]
        self.assertEqual(out[4]["transferred"], ["hi", "lo"])
        self.assertEqual([m["msg_id"] for m in out[5]["messages"]], ["hi", "lo"])
        self.assertEqual(out[6]["unsubscribe_transfer_count"], 2)
        # 转移的是从未投出的消息，不带 redelivered。
        self.assertTrue(all(not m["redelivered"] for m in out[5]["messages"]))


if __name__ == "__main__":
    unittest.main()
