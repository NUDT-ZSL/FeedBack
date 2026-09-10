# -*- coding: utf-8 -*-
"""WindowAggregator 的单元测试。

覆盖：聚合正确性、重叠窗口、乱序等价性（含随机测试）、retract 匹配
（含提前撤回）、watermark 与迟到事件、快照往返、CLI 以及全部错误处理。
"""

from __future__ import annotations

import io
import json
import math
import os
import random
import sys
import tempfile
import unittest
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from aggregator import (
    AGGREGATORS,
    Event,
    IngestResult,
    SnapshotError,
    WindowAggregator,
    window_starts_for_ts,
)
import main as cli


# ---------------------------------------------------------------------------
# 参考实现：把"合法事件"按 (ts, event_id) 排序后一次性批处理
# ---------------------------------------------------------------------------

def reference_batch(
    events: List[Event],
    window_size: int,
    slide: int,
    agg: str,
    query_start: int,
    query_end: int,
) -> Dict[Tuple[str, int], Optional[float]]:
    """排序批处理参考实现，合法事件判定规则与流式引擎完全一致。

    * 重复 event_id 的 add：只有第一条生效；
    * retract 必须匹配到 key/ts/value 完全一致、且未被撤回的 add；
    * 提前 retract：等待对应 add，add 到达即抵消；与 add 不一致则非法；
    * 然后把所有活跃 add 按 (ts, event_id) 排序，贡献进覆盖它的区间。
    """
    adds: Dict[str, Event] = {}
    retracted: set = set()
    pending: Dict[str, Event] = {}
    alive: Dict[str, Event] = {}

    for ev in events:
        if ev.op == "add":
            if ev.event_id in adds:
                continue
            adds[ev.event_id] = ev
            pr = pending.pop(ev.event_id, None)
            if pr is None:
                alive[ev.event_id] = ev
            elif pr.key == ev.key and pr.ts == ev.ts and pr.value == ev.value:
                retracted.add(ev.event_id)
            else:
                # 提前 retract 与 add 不一致：retract 非法，add 活跃
                alive[ev.event_id] = ev
        else:
            if ev.event_id in pending:
                continue
            add = adds.get(ev.event_id)
            if add is None:
                pending[ev.event_id] = ev
            elif ev.event_id in retracted:
                continue
            elif add.key != ev.key or add.ts != ev.ts or add.value != ev.value:
                continue
            else:
                retracted.add(ev.event_id)
                alive.pop(ev.event_id, None)

    # 批处理的"顺序处理"：按 (ts, event_id) 排序后累加。
    ordered = sorted(alive.values(), key=lambda e: (e.ts, e.event_id))
    buckets: Dict[Tuple[str, int], List[float]] = defaultdict(list)
    for ev in ordered:
        for s in window_starts_for_ts(ev.ts, window_size, slide):
            buckets[(ev.key, s)].append(ev.value)

    def floor(x: int) -> int:
        return (x // slide) * slide

    def ceil(x: int) -> int:
        return (-((-x) // slide)) * slide

    start = floor(query_start)
    end = ceil(query_end) if query_end > query_start else start
    out: Dict[Tuple[str, int], Optional[float]] = {}
    keys = sorted({e.key for e in ordered})
    for key in keys:
        s = start
        while s < end:
            vals = buckets.get((key, s))
            if agg == "sum":
                out[(key, s)] = math.fsum(vals) if vals else 0.0
            elif agg == "count":
                out[(key, s)] = len(vals) if vals else 0
            elif agg == "min":
                out[(key, s)] = min(vals) if vals else None
            elif agg == "max":
                out[(key, s)] = max(vals) if vals else None
            s += slide
    return out


def make_engine(events: List[Event], **kw: Any) -> WindowAggregator:
    agg = WindowAggregator(
        window_size=kw.get("window_size", 10),
        slide=kw.get("slide", 5),
        default_agg=kw.get("default_agg", "sum"),
    )
    for ev in events:
        agg.ingest(ev)
    return agg


# ---------------------------------------------------------------------------
# 基础行为
# ---------------------------------------------------------------------------

class EventModelTests(unittest.TestCase):
    def test_valid_event_normalizes_value_to_float(self) -> None:
        ev = Event("e1", "k", 3, "add", 2)
        self.assertEqual(ev.value, 2.0)
        self.assertIsInstance(ev.value, float)

    def test_event_is_frozen(self) -> None:
        ev = Event("e1", "k", 3, "add", 1.0)
        with self.assertRaises(Exception):
            ev.ts = 5  # type: ignore[misc]

    def test_invalid_events(self) -> None:
        bad: List[Tuple[Any, ...]] = [
            ("", "k", 1, "add", 1.0),       # 空 event_id
            ("e", "", 1, "add", 1.0),       # 空 key
            ("e", "k", 1.5, "add", 1.0),    # 浮点 ts
            ("e", "k", True, "add", 1.0),   # bool ts
            ("e", "k", 1, "put", 1.0),      # 非法 op
            ("e", "k", 1, "add", -0.1),     # 负 value
            ("e", "k", 1, "add", float("nan")),
            ("e", "k", 1, "add", float("inf")),
            ("e", "k", 1, "add", "1"),      # 字符串 value
        ]
        for args in bad:
            with self.assertRaises(ValueError, msg=f"应拒绝 {args}"):
                Event(*args)

    def test_negative_ts_is_allowed(self) -> None:
        ev = Event("e", "k", -7, "add", 1.0)
        self.assertEqual(ev.ts, -7)

    def test_from_dict_rejects_unknown_and_missing(self) -> None:
        with self.assertRaises(ValueError):
            Event.from_dict({"event_id": "e", "key": "k", "ts": 1,
                             "op": "add", "value": 1.0, "x": 2})
        with self.assertRaises(ValueError):
            Event.from_dict({"event_id": "e", "key": "k", "ts": 1})


class WindowConfigTests(unittest.TestCase):
    def test_slide_must_divide_window_size(self) -> None:
        with self.assertRaises(ValueError):
            WindowAggregator(window_size=10, slide=3)
        with self.assertRaises(ValueError):
            WindowAggregator(window_size=10, slide=0)
        with self.assertRaises(ValueError):
            WindowAggregator(window_size=0, slide=1)
        with self.assertRaises(ValueError):
            WindowAggregator(window_size=-4, slide=2)
        with self.assertRaises(ValueError):
            WindowAggregator(window_size=4, slide=2, default_agg="avg")

    def test_window_starts_covering(self) -> None:
        # size=10, slide=5：每个点最多落入 2 个区间
        self.assertEqual(window_starts_for_ts(0, 10, 5), [-5, 0])
        self.assertEqual(window_starts_for_ts(4, 10, 5), [-5, 0])
        self.assertEqual(window_starts_for_ts(5, 10, 5), [0, 5])
        self.assertEqual(window_starts_for_ts(7, 10, 5), [0, 5])
        # 边界左闭右开：ts=10 不属于 [0,10)
        self.assertEqual(window_starts_for_ts(10, 10, 5), [5, 10])
        # slide == size：恰好一个区间
        self.assertEqual(window_starts_for_ts(13, 10, 10), [10])
        # 负时间戳
        self.assertEqual(window_starts_for_ts(-1, 10, 5), [-10, -5])
        # size=6 slide=2：3 个重叠区间
        self.assertEqual(window_starts_for_ts(3, 6, 2), [-2, 0, 2])


class BasicAggregationTests(unittest.TestCase):
    def _ev(self, eid: str, ts: int, v: float, op: str = "add",
            key: str = "k") -> Event:
        return Event(eid, key, ts, op, v)

    def test_single_event_contributes_to_overlapping_windows(self) -> None:
        agg = make_engine([self._ev("a", 7, 3.0)])
        rows = {r.window_start: r.value for r in agg.query("k", -10, 20)}
        # ts=7 属于 [0,10) 和 [5,15)
        self.assertEqual(
            rows, {-10: 0.0, -5: 0.0, 0: 3.0, 5: 3.0, 10: 0.0, 15: 0.0}
        )

    def test_sum_count_min_max(self) -> None:
        events = [
            self._ev("a", 1, 2.0),
            self._ev("b", 2, 5.0),
            self._ev("c", 3, 1.0),
        ]
        agg = make_engine(events, window_size=5, slide=5)
        rows = {r.window_start: r for r in agg.query("k", 0, 5)}
        self.assertEqual(rows[0].value, 8.0)
        self.assertEqual(agg.query("k", 0, 5, "count")[0].value, 3)
        self.assertEqual(agg.query("k", 0, 5, "min")[0].value, 1.0)
        self.assertEqual(agg.query("k", 0, 5, "max")[0].value, 5.0)

    def test_min_max_null_on_empty_window(self) -> None:
        agg = make_engine([self._ev("a", 1, 2.0)], window_size=5, slide=5)
        rows = {r.window_start: r for r in agg.query("k", 5, 10, "min")}
        self.assertIsNone(rows[5].value)
        rows = {r.window_start: r for r in agg.query("k", 5, 10, "max")}
        self.assertIsNone(rows[5].value)
        # 空引擎 query 也一样
        empty = WindowAggregator(5, 5)
        self.assertIsNone(empty.query("k", 0, 5, "min")[0].value)
        self.assertEqual(empty.query("k", 0, 5, "sum")[0].value, 0.0)
        self.assertEqual(empty.query("k", 0, 5, "count")[0].value, 0)

    def test_min_max_after_retract_removing_extreme(self) -> None:
        events = [
            self._ev("a", 1, 10.0),
            self._ev("b", 2, 2.0),
            self._ev("c", 3, 7.0),
            Event("a", "k", 1, "retract", 10.0),
        ]
        agg = make_engine(events, window_size=5, slide=5)
        self.assertEqual(agg.query("k", 0, 5, "min")[0].value, 2.0)
        self.assertEqual(agg.query("k", 0, 5, "max")[0].value, 7.0)
        self.assertEqual(agg.query("k", 0, 5, "count")[0].value, 2)

    def test_keys_are_isolated(self) -> None:
        agg = make_engine([
            self._ev("a", 1, 2.0, key="dev1"),
            self._ev("b", 1, 8.0, key="dev2"),
        ], window_size=5, slide=5)
        self.assertEqual(agg.query("dev1", 0, 5)[0].value, 2.0)
        self.assertEqual(agg.query("dev2", 0, 5)[0].value, 8.0)
        all_rows = agg.query_all(0, 5)
        self.assertEqual([(r.key, r.value) for r in all_rows],
                         [("dev1", 2.0), ("dev2", 8.0)])

    def test_query_alignment_and_empty_ranges(self) -> None:
        agg = make_engine([self._ev("a", 5, 1.0)], window_size=10, slide=5)
        # [3, 7) 外扩对齐到 [0, 10)，网格区间 0 和 5
        starts = [r.window_start for r in agg.query("k", 3, 7)]
        self.assertEqual(starts, [0, 5])
        # 空范围 / 反范围 -> 没有结果
        self.assertEqual(agg.query("k", 5, 5), [])
        self.assertEqual(agg.query("k", 9, 3), [])
        # 未对齐的 end 向上取整：[0,6) -> 区间 0,5
        self.assertEqual(
            [r.window_start for r in agg.query("k", 0, 6)], [0, 5]
        )
        # 负边界也能对齐
        self.assertEqual(
            [r.window_start for r in agg.query("k", -7, -1)], [-10, -5]
        )

    def test_query_bad_arguments(self) -> None:
        agg = WindowAggregator(5, 5)
        with self.assertRaises(ValueError):
            agg.query("", 0, 5)
        with self.assertRaises(ValueError):
            agg.query("k", 0, 5, "avg")
        with self.assertRaises(ValueError):
            agg.query("k", 0.5, 5)  # type: ignore[arg-type]

    def test_window_end_field(self) -> None:
        agg = WindowAggregator(10, 5)
        r = agg.query("k", 0, 5)[0]
        self.assertEqual((r.window_start, r.window_end), (0, 10))


# ---------------------------------------------------------------------------
# Retract
# ---------------------------------------------------------------------------

class RetractTests(unittest.TestCase):
    def _add(self, eid: str, ts: int, v: float, key: str = "k") -> Event:
        return Event(eid, key, ts, "add", v)

    def _ret(self, eid: str, ts: int, v: float, key: str = "k") -> Event:
        return Event(eid, key, ts, "retract", v)

    def test_basic_retract_rolls_back(self) -> None:
        agg = make_engine([
            self._add("a", 1, 10.0),
            self._add("b", 2, 5.0),
            self._ret("a", 1, 10.0),
        ], window_size=5, slide=5)
        self.assertEqual(agg.query("k", 0, 5, "sum")[0].value, 5.0)
        self.assertEqual(agg.query("k", 0, 5, "count")[0].value, 1)
        state = agg.get_state()
        self.assertEqual(state["retracted_events"], 1)
        self.assertEqual(state["illegal_events"], 0)

    def test_retract_unknown_event_is_pending(self) -> None:
        agg = WindowAggregator(5, 5)
        res = agg.ingest(self._ret("x", 1, 3.0))
        self.assertTrue(res.accepted)
        self.assertEqual(res.status, "pending_retract")
        self.assertEqual(agg.get_state()["pending_retracts"], 1)
        # 对应的 add 后到：立即抵消，不影响聚合
        res2 = agg.ingest(self._add("x", 1, 3.0))
        self.assertEqual(res2.status, "retracted")
        self.assertTrue(res2.pending_matched)
        self.assertEqual(res2.windows, [])
        self.assertEqual(agg.query("k", 0, 5, "sum")[0].value, 0.0)
        self.assertEqual(agg.query("k", 0, 5, "count")[0].value, 0)
        self.assertEqual(agg.get_state()["pending_retracts"], 0)

    def test_pending_retract_then_mismatched_add_is_rejected_retract(self) -> None:
        agg = WindowAggregator(5, 5)
        agg.ingest(self._ret("x", 1, 3.0))
        # add 的 value 与提前 retract 不一致
        res = agg.ingest(self._add("x", 1, 4.0))
        self.assertTrue(res.accepted)
        self.assertEqual(res.status, "applied")
        self.assertIsNotNone(res.warning)
        self.assertEqual(agg.get_state()["illegal_events"], 1)
        self.assertEqual(agg.query("k", 0, 5, "sum")[0].value, 4.0)

    def test_pending_retract_mismatched_key(self) -> None:
        agg = WindowAggregator(5, 5)
        agg.ingest(self._ret("x", 1, 3.0, key="k1"))
        res = agg.ingest(self._add("x", 1, 3.0, key="k2"))
        self.assertTrue(res.accepted)
        self.assertEqual(res.status, "applied")
        self.assertIsNotNone(res.warning)
        self.assertEqual(agg.query("k2", 0, 5, "sum")[0].value, 3.0)
        self.assertEqual(agg.query("k1", 0, 5, "sum")[0].value, 0.0)

    def test_retract_unknown_without_ever_add_is_illegal_in_batch_but_pending_here(self) -> None:
        # 只有一条悬空 retract：保持暂存，不产生任何聚合
        agg = make_engine([self._ret("ghost", 1, 1.0)], window_size=5, slide=5)
        self.assertEqual(agg.query_all(0, 5), [])
        self.assertEqual(agg.get_state()["pending_retracts"], 1)

    def test_double_retract_rejected(self) -> None:
        agg = WindowAggregator(5, 5)
        r1 = self._ret("a", 1, 1.0)
        agg.ingest(r1)  # pending
        r2 = self._ret("a", 1, 1.0)
        res = agg.ingest(r2)
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_kind, "duplicate_pending_retract")

        agg.ingest(self._add("a", 1, 1.0))  # 与第一条 pending 配对
        res = agg.ingest(self._ret("a", 1, 1.0))
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_kind, "double_retract")

    def test_retract_mismatch_fields(self) -> None:
        agg = make_engine([self._add("a", 1, 10.0)], window_size=5, slide=5)
        for bad in (
            self._ret("a", 1, 9.0),
            self._ret("a", 2, 10.0),
            self._ret("a", 1, 10.0, key="other"),
        ):
            res = agg.ingest(bad)
            self.assertFalse(res.accepted, msg=bad)
            self.assertEqual(res.error_kind, "retract_mismatch")
        # 原 add 仍在
        self.assertEqual(agg.query("k", 0, 5, "sum")[0].value, 10.0)
        self.assertEqual(agg.get_state()["illegal_events"], 3)

    def test_duplicate_add_rejected(self) -> None:
        agg = WindowAggregator(5, 5)
        agg.ingest(self._add("a", 1, 10.0))
        res = agg.ingest(self._add("a", 1, 10.0))
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_kind, "duplicate_add")
        self.assertEqual(agg.query("k", 0, 5, "count")[0].value, 1)

    def test_illegal_dict_event_is_counted_not_raised(self) -> None:
        agg = WindowAggregator(5, 5)
        res = agg.ingest({"event_id": "a", "key": "k", "ts": 1,
                          "op": "add", "value": -5})
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_kind, "invalid_event")
        self.assertEqual(agg.get_state()["illegal_events"], 1)

    def test_ingest_result_lists_affected_windows(self) -> None:
        agg = WindowAggregator(10, 5)
        res = agg.ingest(self._add("a", 7, 1.0))
        self.assertEqual(res.windows, [0, 5])


# ---------------------------------------------------------------------------
# 乱序等价性（核心验收）
# ---------------------------------------------------------------------------

class OutOfOrderEquivalenceTests(unittest.TestCase):
    def _stream_vs_reference(
        self, events: List[Event], window_size: int, slide: int,
        qstart: int, qend: int
    ) -> None:
        for agg_name in AGGREGATORS:
            ref = reference_batch(
                events, window_size, slide, agg_name, qstart, qend
            )
            engine = make_engine(
                events, window_size=window_size, slide=slide
            )
            got_rows = engine.query_all(qstart, qend, agg_name)
            # query_all 只返回活跃区间；参考实现也只生成有活跃 add 的 key。
            got = {(r.key, r.window_start): r.value for r in got_rows}
            # 参考实现里非零/非空的条目必须一致
            for k, v in ref.items():
                if v in (None, 0, 0.0):
                    continue
                self.assertIn(k, got, f"{agg_name}: 缺少区间 {k}")
                self.assertEqual(got[k], v, f"{agg_name}: 区间 {k} 不一致")
            for k, v in got.items():
                self.assertIn(k, ref, f"{agg_name}: 多出区间 {k}")
                self.assertEqual(v, ref[k], f"{agg_name}: 区间 {k} 不一致")

    def test_handcrafted_interleaving(self) -> None:
        events = [
            Event("a", "k", 1, "add", 10.0),
            Event("b", "k", 6, "add", 20.0),
            Event("c", "k", 11, "add", 30.0),
            # 提前撤回 d
            Event("d", "k", 3, "retract", 40.0),
            Event("d", "k", 3, "add", 40.0),
            # 乱序到达的老事件
            Event("e", "k", 2, "add", 5.0),
            # 撤回最早的 add
            Event("a", "k", 1, "retract", 10.0),
            Event("f", "k", 12, "add", 1.0),
            Event("b", "k", 6, "retract", 20.0),
        ]
        # 多种到达顺序都要等价
        orders = [
            events,
            list(reversed(events)),
            [events[i] for i in (3, 6, 0, 4, 1, 5, 2, 8, 7)],
            [events[i] for i in (8, 7, 6, 5, 4, 3, 2, 1, 0)],
        ]
        for order in orders:
            self._stream_vs_reference(order, 10, 5, -5, 20)

    def test_randomized_order_equivalence(self) -> None:
        rng = random.Random(20260910)
        for trial in range(60):
            window_size = rng.choice([4, 6, 8, 10])
            slide = rng.choice([d for d in (1, 2, 4, 5)
                                if window_size % d == 0])
            n = rng.randint(1, 25)
            events: List[Event] = []
            live_ids: List[str] = []
            all_ids: List[str] = []
            for i in range(n):
                eid = f"e{i}"
                all_ids.append(eid)
                roll = rng.random()
                if roll < 0.7 or not live_ids:
                    ts = rng.randint(-12, 24)
                    v = float(rng.randint(0, 50)) / 2  # .0 / .5
                    events.append(Event(eid, f"k{rng.randint(0, 2)}",
                                        ts, "add", v))
                    # 记住原始字段用于生成合法 retract
                    live_ids.append(eid)
                else:
                    target = live_ids.pop(rng.randrange(len(live_ids)))
                    add = next(e for e in events
                               if e.event_id == target and e.op == "add")
                    events.append(Event(target, add.key, add.ts,
                                        "retract", add.value))
            # 再掺入一些非法/特殊事件
            if rng.random() < 0.5 and events:
                src = rng.choice(events)
                events.append(Event(src.event_id, src.key, src.ts,
                                    "retract",
                                    src.value + (0.5 if src.value == 0 else 0)))
            if rng.random() < 0.3:
                # 悬空提前撤回（永不配对）
                events.append(Event("ghost", "k0", rng.randint(-12, 24),
                                    "retract", 1.0))
            rng.shuffle(events)
            self._stream_vs_reference(events, window_size, slide, -10, 25)

    def test_reversed_timestamp_order(self) -> None:
        events = [Event(f"e{i}", "k", i, "add", float(i))
                  for i in range(20)]
        events.reverse()
        self._stream_vs_reference(events, 5, 5, 0, 20)

    def test_sum_is_bit_identical_regardless_of_order(self) -> None:
        vals = [0.1, 0.2, 0.3, 1e16, 1e-10, 7.7, -0.0]
        base = [Event(f"e{i}", "k", 1, "add", v) for i, v in enumerate(vals)]
        r1 = make_engine(base, window_size=5, slide=5)
        r2 = make_engine(list(reversed(base)), window_size=5, slide=5)
        r3 = make_engine(
            [base[i] for i in (3, 0, 6, 1, 5, 2, 4)],
            window_size=5, slide=5,
        )
        v1 = r1.query("k", 0, 5, "sum")[0].value
        v2 = r2.query("k", 0, 5, "sum")[0].value
        v3 = r3.query("k", 0, 5, "sum")[0].value
        self.assertEqual(v1, v2)
        self.assertEqual(v1, v3)
        self.assertEqual(v1, math.fsum(vals))


# ---------------------------------------------------------------------------
# Watermark / 迟到
# ---------------------------------------------------------------------------

class WatermarkTests(unittest.TestCase):
    def test_watermark_finalizes_windows(self) -> None:
        agg = WindowAggregator(10, 5)
        agg.ingest(Event("a", "k", 1, "add", 1.0))
        agg.advance_watermark(10)  # [0,10) 结束
        rows = {r.window_start: r for r in agg.query("k", -5, 15)}
        self.assertTrue(rows[-5].finalized)   # [-5,5) 右端 5 <= 10
        self.assertTrue(rows[0].finalized)    # [0,10)
        self.assertFalse(rows[5].finalized)   # [5,15)
        self.assertFalse(rows[10].finalized)

    def test_watermark_must_be_monotone_and_nonneg(self) -> None:
        agg = WindowAggregator(10, 5)
        agg.advance_watermark(10)
        with self.assertRaises(ValueError):
            agg.advance_watermark(9)
        with self.assertRaises(ValueError):
            agg.advance_watermark(-1)
        # 相等是允许的（幂等）
        agg.advance_watermark(10)

    def test_late_event_updates_and_marks_dirty(self) -> None:
        agg = WindowAggregator(10, 5)
        agg.ingest(Event("a", "k", 1, "add", 1.0))
        agg.advance_watermark(10)
        self.assertFalse(agg.query("k", 0, 10)[0].finalized_dirty)

        res = agg.ingest(Event("b", "k", 2, "add", 4.0))  # 迟到
        # ts=2 同时属于 [-5,5) 与 [0,10)，wm=10 时两者结构上都已关闭
        self.assertTrue(res.late)
        self.assertEqual(res.dirty_windows, [-5, 0])
        self.assertEqual(agg.get_state()["late_events"], 1)
        row_old = agg.query("k", -5, 5)[0]   # [-5,5) 含 a(ts=1) 和 b
        row_cur = agg.query("k", 0, 10)[0]   # [0,10) 同样含两者
        # 被迟到事件改动过：finalized 回退为 False，finalized_dirty=True
        self.assertFalse(row_old.finalized)
        self.assertTrue(row_old.finalized_dirty)
        self.assertEqual(row_old.value, 5.0)
        self.assertFalse(row_cur.finalized)
        self.assertTrue(row_cur.finalized_dirty)
        self.assertEqual(row_cur.value, 5.0)

        # 迟到的 retract 也更新聚合、累加迟到计数，脏标记保持
        res2 = agg.ingest(Event("a", "k", 1, "retract", 1.0))
        self.assertTrue(res2.late)
        self.assertEqual(agg.get_state()["late_events"], 2)
        row = agg.query("k", 0, 10, "sum")[0]
        self.assertEqual(row.value, 4.0)
        self.assertFalse(row.finalized)
        self.assertTrue(row.finalized_dirty)

    def test_late_event_into_older_overlapping_window(self) -> None:
        agg = WindowAggregator(10, 5)
        agg.ingest(Event("a", "k", 6, "add", 1.0))  # 区间 0,5
        agg.advance_watermark(10)  # 0 已关闭；5 没有
        res = agg.ingest(Event("b", "k", 7, "add", 2.0))
        self.assertEqual(res.dirty_windows, [0])
        self.assertTrue(res.late)
        rows = {r.window_start: r for r in agg.query("k", 0, 10)}
        # 区间 0：被迟到改动 -> finalized 回退为 False、dirty=True、值已更新
        self.assertFalse(rows[0].finalized)
        self.assertTrue(rows[0].finalized_dirty)
        self.assertEqual(rows[0].value, 3.0)
        # 区间 5：本来就没关闭
        self.assertFalse(rows[5].finalized)
        self.assertFalse(rows[5].finalized_dirty)
        self.assertEqual(rows[5].value, 3.0)
        self.assertEqual(agg.get_state()["late_events"], 1)

    def test_watermark_none_initially(self) -> None:
        agg = WindowAggregator(10, 5)
        self.assertIsNone(agg.get_state()["watermark"])
        # 没有 watermark 时，负 ts 区间也不会 finalized
        self.assertFalse(agg.query("k", -10, -5)[0].finalized)


# ---------------------------------------------------------------------------
# 快照
# ---------------------------------------------------------------------------

class SnapshotTests(unittest.TestCase):
    def _populated(self) -> WindowAggregator:
        agg = WindowAggregator(10, 5, default_agg="max")
        for ev in [
            Event("a", "k1", 1, "add", 3.0),
            Event("b", "k1", 6, "add", 9.0),
            Event("c", "k2", 12, "add", 2.0),
            Event("z", "k1", 2, "retract", 7.0),  # 提前撤回，暂存
        ]:
            agg.ingest(ev)
        agg.advance_watermark(5)
        # 让一个 finalized 区间变脏
        agg.ingest(Event("d", "k1", 1, "add", 5.0))  # 落在 [-5,0)? ts=1 -> 区间 -5,0
        agg.ingest(Event("a", "k1", 1, "retract", 3.0))
        return agg

    def test_save_load_roundtrip_preserves_everything(self) -> None:
        agg = self._populated()
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "snap.json")
            agg.save(path)
            restored = WindowAggregator.load(path)

        self.assertEqual(restored.window_size, 10)
        self.assertEqual(restored.slide, 5)
        self.assertEqual(restored.default_agg, "max")
        self.assertEqual(restored.watermark, 5)
        self.assertEqual(restored.get_state(), agg.get_state())
        for key in ("k1", "k2"):
            for a in AGGREGATORS:
                before = {(r.window_start, r.value, r.finalized,
                           r.finalized_dirty)
                          for r in agg.query(key, -10, 20, a)}
                after = {(r.window_start, r.value, r.finalized,
                          r.finalized_dirty)
                         for r in restored.query(key, -10, 20, a)}
                self.assertEqual(before, after, msg=f"{key}/{a}")
        # pending retract 仍然在
        self.assertEqual(restored.get_state()["pending_retracts"], 1)
        # pending 配对仍然有效
        res = restored.ingest(Event("z", "k1", 2, "add", 7.0))
        self.assertTrue(res.pending_matched)

    def test_replay_equivalent_to_uninterrupted(self) -> None:
        events1 = [
            Event("a", "k", 1, "add", 1.0),
            Event("b", "k", 6, "add", 2.0),
            Event("c", "k", 11, "add", 4.0),
        ]
        events2 = [
            Event("a", "k", 1, "retract", 1.0),
            Event("d", "k", 2, "add", 8.0),
            Event("e", "k", 12, "retract", 5.0),  # 提前撤回
            Event("e", "k", 12, "add", 5.0),
        ]
        uninterrupted = make_engine(events1 + events2,
                                    window_size=10, slide=5)
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            make_engine(events1, window_size=10, slide=5).save(path)
            replayed, results = WindowAggregator.replay(path, events2)

        for a in AGGREGATORS:
            self.assertEqual(
                [r.to_dict() for r in uninterrupted.query_all(-5, 20, a)],
                [r.to_dict() for r in replayed.query_all(-5, 20, a)],
            )
        self.assertEqual(len(results), len(events2))
        self.assertEqual(uninterrupted.get_state(), replayed.get_state())

    def test_load_missing_and_bad_json(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(SnapshotError):
                WindowAggregator.load(os.path.join(td, "nope.json"))
            p = os.path.join(td, "bad.json")
            with open(p, "w", encoding="utf-8") as f:
                f.write("{not json")
            with self.assertRaises(SnapshotError):
                WindowAggregator.load(p)

    def test_load_detects_corruption(self) -> None:
        good = self._populated().to_snapshot()

        def expect_bad(mutated: Dict[str, Any], needle: str = "") -> None:
            with self.assertRaises(SnapshotError) as cm:
                WindowAggregator.from_snapshot(mutated)
            if needle:
                self.assertIn(needle, str(cm.exception))

        import copy

        bad = copy.deepcopy(good)
        bad["format"] = "other"
        expect_bad(bad, "format")

        bad = copy.deepcopy(good)
        bad["version"] = 99
        expect_bad(bad, "版本")

        bad = copy.deepcopy(good)
        bad["config"]["slide"] = 3
        expect_bad(bad, "config")

        bad = copy.deepcopy(good)
        bad["watermark"] = -2
        expect_bad(bad, "watermark")

        bad = copy.deepcopy(good)
        bad["windows"][0]["count"] += 1  # 与 values 长度不一致
        expect_bad(bad, "count")

        bad = copy.deepcopy(good)
        bad["windows"][0]["start"] = 7  # 不是 slide=5 的倍数
        expect_bad(bad, "整数倍")

        bad = copy.deepcopy(good)
        bad["events"][0]["value"] = -9
        expect_bad(bad)

        bad = copy.deepcopy(good)
        # windows[1] 是有两个活跃值的区间；同步 count/sum 绕过字段校验后，
        # 必须在"用事件记录重放"的整体一致性校验中被抓出来。
        w = bad["windows"][1]
        w["values"].append(999.0)
        w["count"] = len(w["values"])
        w["sum"] = math.fsum(w["values"])
        expect_bad(bad, "一致性")

        bad = copy.deepcopy(good)
        del bad["events"]
        expect_bad(bad, "events")

        bad = copy.deepcopy(good)
        bad["stats"]["retracted_events"] = 999
        expect_bad(bad, "retracted_events")

        bad = copy.deepcopy(good)
        bad["pending_retracts"][0]["op"] = "add"
        expect_bad(bad, "retract")

    def test_snapshot_file_is_json_with_no_nan(self) -> None:
        agg = WindowAggregator(5, 5)
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            agg.save(path)
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        self.assertEqual(raw["format"], "window-aggregator-snapshot")


# ---------------------------------------------------------------------------
# 回归测试：提前撤回 / 迟到事件 / 暂存区快照 / 混合等价性
# ---------------------------------------------------------------------------

class RegressionTests(unittest.TestCase):
    def test_pending_retract_minimal_repro(self) -> None:
        """最小复现：retract 先到、add 后到，贡献必须被完全抵消。"""
        agg = WindowAggregator(window_size=10, slide=5)
        r1 = agg.ingest(Event("e2", "k", 3, "retract", 5.0))
        self.assertEqual(r1.status, "pending_retract")
        r2 = agg.ingest(Event("e2", "k", 3, "add", 5.0))
        self.assertEqual(r2.status, "retracted")
        self.assertTrue(r2.pending_matched)
        # 抵消的 add 不进入任何区间
        self.assertEqual(r2.windows, [])
        # ts=3 覆盖区间 [-5,5) 和 [0,10)，两者 sum 都必须是 0
        self.assertEqual(
            [(r.window_start, r.value) for r in agg.query("k", -5, 10, "sum")],
            [(-5, 0.0), (0, 0.0), (5, 0.0)],
        )
        for agg_name in ("count", "min", "max"):
            rows = agg.query("k", -5, 10, agg_name)
            self.assertTrue(
                all(r.value in (0, 0.0, None) for r in rows),
                msg=agg_name,
            )
        state = agg.get_state()
        self.assertEqual(state["pending_retracts"], 0)
        self.assertEqual(state["retracted_events"], 1)
        self.assertEqual(state["illegal_events"], 0)
        # 配对后再撤回一次：double retract，仍非法
        r3 = agg.ingest(Event("e2", "k", 3, "retract", 5.0))
        self.assertFalse(r3.accepted)
        self.assertEqual(r3.error_kind, "double_retract")

    def test_late_event_minimal_repro(self) -> None:
        """最小复现：watermark=200 后到达的 ts=50 事件必须被接受。"""
        agg = WindowAggregator(window_size=10, slide=5)
        agg.ingest(Event("a", "k", 100, "add", 1.0))
        agg.advance_watermark(200)
        res = agg.ingest(Event("b", "k", 50, "add", 2.0))
        # 被接受、标记迟到、贡献进覆盖 ts=50 的两个区间
        self.assertTrue(res.accepted)
        self.assertTrue(res.late)
        self.assertEqual(res.dirty_windows, [45, 50])
        self.assertEqual(agg.get_state()["late_events"], 1)

        rows = {r.window_start: r for r in agg.query("k", 45, 60, "sum")}
        self.assertEqual(rows[45].value, 2.0)
        self.assertEqual(rows[50].value, 2.0)
        # 结构上已关闭、且被迟到改动：finalized 回退为 False
        self.assertFalse(rows[45].finalized)
        self.assertFalse(rows[50].finalized)
        self.assertTrue(rows[45].finalized_dirty)
        self.assertTrue(rows[50].finalized_dirty)
        # 未被改动的区间仍是 finalized=True
        self.assertTrue(rows[55].finalized)

    def test_pending_retract_survives_snapshot_roundtrip(self) -> None:
        """最小复现：暂存区的提前 retract 必须随快照持久化并能继续配对。"""
        agg = WindowAggregator(window_size=10, slide=5)
        agg.ingest(Event("e2", "k", 3, "retract", 5.0))
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            agg.save(path)
            restored = WindowAggregator.load(path)

        self.assertEqual(restored.get_state()["pending_retracts"], 1)
        res = restored.ingest(Event("e2", "k", 3, "add", 5.0))
        self.assertEqual(res.status, "retracted")
        self.assertTrue(res.pending_matched)
        self.assertEqual(
            [r.value for r in restored.query("k", 0, 10, "sum")],
            [0.0, 0.0],
        )

    def test_mixed_pending_late_snapshot_equivalence(self) -> None:
        """混合场景：提前撤回 + watermark 后迟到 + 快照往返，对拍参考实现。"""
        size, slide = 10, 5
        batch1 = [
            Event("e2", "k0", 3, "retract", 5.0),   # 提前撤回（暂存）
            Event("a", "k1", 1, "add", 10.0),
            Event("b", "k1", 7, "add", 20.0),
        ]
        late_and_after = [
            Event("c", "k1", 6, "add", 7.0),        # 迟到 add
            Event("e2", "k0", 3, "add", 5.0),       # 与暂存 retract 配对
            Event("a", "k1", 1, "retract", 10.0),   # 迟到 retract
            Event("d", "k2", 100, "add", 99.0),
            Event("b", "k1", 7, "retract", 20.0),   # 迟到 retract
            Event("g", "k2", 101, "retract", 3.0),  # 结束时仍暂存
        ]
        all_events = batch1 + late_and_after

        # 不中断的对照引擎
        uninterrupted = WindowAggregator(size, slide)
        for ev in batch1:
            uninterrupted.ingest(ev)
        uninterrupted.advance_watermark(15)
        for ev in late_and_after:
            uninterrupted.ingest(ev)

        # 快照切分：watermark 之后先 save/load，再继续处理
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            head = WindowAggregator(size, slide)
            for ev in batch1:
                head.ingest(ev)
            head.advance_watermark(15)
            head.ingest(late_and_after[0])  # 一次迟到写入也落在快照前
            head.save(path)
            restored = WindowAggregator.load(path)
            self.assertEqual(restored.get_state()["pending_retracts"], 1)
            self.assertEqual(restored.get_state()["late_events"], 1)
            for ev in late_and_after[1:]:
                restored.ingest(ev)
            # 再存一次：结束时的暂存 retract g 也要存活
            path2 = os.path.join(td, "s2.json")
            restored.save(path2)
            restored2 = WindowAggregator.load(path2)

        # 1) 与不中断处理的状态一致
        self.assertEqual(restored.get_state(), uninterrupted.get_state())
        self.assertEqual(restored2.get_state(), uninterrupted.get_state())
        self.assertEqual(uninterrupted.get_state()["late_events"], 3)
        self.assertEqual(uninterrupted.get_state()["pending_retracts"], 1)
        # e2（提前配对）、a、b 三条 add 当前处于撤回状态
        self.assertEqual(uninterrupted.get_state()["retracted_events"], 3)

        # 2) 与排序批处理参考实现逐区间一致（四种聚合）
        for agg_name in AGGREGATORS:
            ref = reference_batch(all_events, size, slide, agg_name, -10, 105)
            got = {
                (r.key, r.window_start): r.value
                for r in restored.query_all(-10, 105, agg_name)
            }
            got2 = {
                (r.key, r.window_start): r.value
                for r in uninterrupted.query_all(-10, 105, agg_name)
            }
            self.assertEqual(got, got2, msg=f"快照切分前后不一致: {agg_name}")
            # 参考实现中所有非空区间都必须在流式结果里且相等
            for coord, value in ref.items():
                if value in (None, 0, 0.0):
                    continue
                self.assertIn(coord, got, msg=f"{agg_name} 缺少区间 {coord}")
                self.assertEqual(got[coord], value,
                                 msg=f"{agg_name} 区间 {coord} 与批处理不一致")
            for coord, value in got.items():
                self.assertEqual(value, ref.get(coord),
                                 msg=f"{agg_name} 多出/不一致区间 {coord}")

        # 3) 迟到写入的区间：值已更新且 finalized 回退、dirty 置位
        rows = {r.window_start: r for r in restored.query("k1", 0, 10, "sum")}
        # [0,10)：a(10)+b(20)+c(7)-a(10)-b(20) = 7
        self.assertEqual(rows[0].value, 7.0)
        self.assertFalse(rows[0].finalized)
        self.assertTrue(rows[0].finalized_dirty)
        # 被抵消的 e2 对 k0 没有任何贡献
        self.assertEqual(
            [r.value for r in restored.query("k0", 0, 10, "sum")],
            [0.0, 0.0],
        )
        # 第二次快照恢复后暂存的 g 仍可配对
        res = restored2.ingest(Event("g", "k2", 101, "add", 3.0))
        self.assertTrue(res.pending_matched)
        self.assertEqual(
            [r.value for r in restored2.query("k2", 100, 105, "sum")],
            [99.0],
        )


    def test_pending_match_after_watermark_is_not_late(self) -> None:
        """retract 在 watermark 前暂存、add 在 watermark 后到：净贡献为 0，
        不算迟到、不弄脏任何已关闭区间。"""
        agg = WindowAggregator(10, 5)
        agg.ingest(Event("e", "k", 1, "retract", 4.0))
        agg.advance_watermark(10)
        res = agg.ingest(Event("e", "k", 1, "add", 4.0))
        self.assertTrue(res.pending_matched)
        self.assertFalse(res.late)
        self.assertEqual(res.dirty_windows, [])
        self.assertEqual(agg.get_state()["late_events"], 0)
        rows = agg.query("k", -5, 5, "sum")  # 对齐后区间 -5、0，均已关闭
        self.assertTrue(all(r.value == 0.0 for r in rows))
        self.assertTrue(all(r.finalized for r in rows))
        self.assertFalse(any(r.finalized_dirty for r in rows))

    def test_snapshot_rejects_negative_late_count(self) -> None:
        import copy
        snap = WindowAggregator(10, 5).to_snapshot()
        snap["stats"]["late_events"] = -1
        with self.assertRaises(SnapshotError):
            WindowAggregator.from_snapshot(copy.deepcopy(snap))
        # 旧版快照缺少 late_events 字段：按 0 兼容加载
        del snap["stats"]["late_events"]
        restored = WindowAggregator.from_snapshot(copy.deepcopy(snap))
        self.assertEqual(restored.get_state()["late_events"], 0)


# ---------------------------------------------------------------------------
# 状态摘要
# ---------------------------------------------------------------------------

class StateSummaryTests(unittest.TestCase):
    def test_empty_engine_state(self) -> None:
        s = WindowAggregator(5, 5).get_state()
        self.assertEqual(s["accepted_events"], 0)
        self.assertEqual(s["retracted_events"], 0)
        self.assertEqual(s["illegal_events"], 0)
        self.assertEqual(s["active_windows"], 0)
        self.assertIsNone(s["watermark"])

    def test_state_counters(self) -> None:
        agg = WindowAggregator(5, 5)
        agg.ingest(Event("a", "k", 1, "add", 1.0))
        agg.ingest(Event("b", "k", 2, "add", 2.0))
        agg.ingest(Event("a", "k", 1, "retract", 1.0))
        agg.ingest({"event_id": "x", "key": "k", "ts": 1,
                    "op": "add", "value": -1.0})  # 非法（字典路径不抛异常）
        agg.ingest(Event("ghost", "k", 1, "retract", 1.0))  # pending
        s = agg.get_state()
        self.assertEqual(s["accepted_events"], 4)  # 2 add + 1 retract + 1 pending
        self.assertEqual(s["retracted_events"], 1)
        self.assertEqual(s["illegal_events"], 1)
        self.assertEqual(s["tracked_adds"], 2)
        self.assertEqual(s["pending_retracts"], 1)
        self.assertEqual(s["active_windows"], 1)
        self.assertEqual(s["active_keys"], 1)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

class CliTests(unittest.TestCase):
    def _run(self, lines: List[str], argv: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        stdin = io.StringIO("\n".join(lines) + "\n")
        stdout = io.StringIO()
        old_in, old_out = sys.stdin, sys.stdout
        sys.stdin, sys.stdout = stdin, stdout
        try:
            code = cli.run(argv if argv is not None else [])
        finally:
            sys.stdin, sys.stdout = old_in, old_out
        self.assertEqual(code, 0)
        out = [json.loads(line) for line in stdout.getvalue().splitlines() if line]
        self.assertEqual(len(out), len(lines))
        return out

    def test_ingest_query_state_watermark(self) -> None:
        out = self._run([
            json.dumps({"cmd": "ingest", "event": {
                "event_id": "a", "key": "k", "ts": 1,
                "op": "add", "value": 3}}),
            json.dumps({"cmd": "retract", "event": {
                "event_id": "b", "key": "k", "ts": 2, "value": 5}}),
            json.dumps({"cmd": "ingest", "event": {
                "event_id": "b", "key": "k", "ts": 2,
                "op": "add", "value": 5}}),
            json.dumps({"cmd": "query", "key": "k", "start": 0,
                        "end": 5, "agg": "sum"}),
            json.dumps({"cmd": "watermark", "t": 5}),
            json.dumps({"cmd": "state"}),
        ], argv=["--window-size", "5", "--slide", "5"])
        self.assertTrue(out[0]["accepted"])
        self.assertEqual(out[1]["status"], "pending_retract")
        self.assertTrue(out[2]["pending_matched"])
        self.assertEqual(out[3]["results"][0]["value"], 3.0)
        self.assertEqual(out[4]["watermark"], 5)
        self.assertEqual(out[5]["state"]["watermark"], 5)

    def test_query_all_and_dump(self) -> None:
        out = self._run([
            json.dumps({"cmd": "ingest", "event": {
                "event_id": "a", "key": "x", "ts": 1,
                "op": "add", "value": 1}}),
            json.dumps({"cmd": "query_all", "start": 0, "end": 5}),
            json.dumps({"cmd": "dump"}),
        ], argv=["--window-size", "5", "--slide", "5"])
        self.assertEqual(out[1]["results"][0]["key"], "x")
        self.assertEqual(out[2]["snapshot"]["config"]["window_size"], 5)

    def test_errors_returned_as_json(self) -> None:
        out = self._run([
            "{bad json",
            json.dumps({"cmd": "frobnicate"}),
            json.dumps({"cmd": "ingest", "event": {
                "event_id": "a", "key": "k", "ts": 1,
                "op": "add", "value": -1}}),
            json.dumps({"cmd": "watermark", "t": 5}),
            json.dumps({"cmd": "watermark", "t": 4}),
            json.dumps({"cmd": "query", "key": "k"}),  # 缺字段
        ], argv=["--window-size", "5", "--slide", "5"])
        self.assertFalse(out[0]["ok"])
        self.assertEqual(out[0]["error_kind"], "bad_json")
        self.assertEqual(out[1]["error_kind"], "unknown_command")
        # 非法事件：命令本身 ok，但 accepted=False
        self.assertTrue(out[2]["ok"])
        self.assertFalse(out[2]["accepted"])
        self.assertTrue(out[3]["ok"])
        self.assertFalse(out[4]["ok"])
        self.assertIn("回退", out[4]["error"])
        self.assertFalse(out[5]["ok"])

    def test_save_load_via_cli(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "s.json")
            out = self._run([
                json.dumps({"cmd": "ingest", "event": {
                    "event_id": "a", "key": "k", "ts": 1,
                    "op": "add", "value": 2}}),
                json.dumps({"cmd": "save", "path": path}),
                json.dumps({"cmd": "load", "path": path}),
                json.dumps({"cmd": "query", "key": "k",
                            "start": 0, "end": 5}),
                json.dumps({"cmd": "load", "path": os.path.join(td, "x")}),
            ], argv=["--window-size", "5", "--slide", "5"])
            self.assertTrue(out[1]["ok"])
            self.assertTrue(out[2]["ok"])
            self.assertEqual(out[3]["results"][0]["value"], 2.0)
            self.assertFalse(out[4]["ok"])
            self.assertEqual(out[4]["error_kind"], "snapshot_error")

    def test_config_command_rebuilds_engine(self) -> None:
        out = self._run([
            json.dumps({"cmd": "config", "window_size": 10,
                        "slide": 5}),
            json.dumps({"cmd": "ingest", "event": {
                "event_id": "a", "key": "k", "ts": 7,
                "op": "add", "value": 1}}),
            json.dumps({"cmd": "query", "key": "k",
                        "start": 0, "end": 10}),
        ])
        self.assertTrue(out[0]["ok"])
        self.assertEqual(len(out[2]["results"]), 2)  # 区间 0 和 5

    def test_bad_startup_arguments(self) -> None:
        stdin = io.StringIO("")
        old_in = sys.stdin
        sys.stdin = stdin
        try:
            code = cli.run(["--window-size", "10", "--slide", "3"])
        finally:
            sys.stdin = old_in
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
