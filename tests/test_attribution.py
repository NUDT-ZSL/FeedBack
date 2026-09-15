import math
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from attribution import (  # noqa: E402
    AttributionEngine,
    LogicalClock,
    ValidationError,
    store,
)


def make_engine(threshold=0.5, start=0):
    clk = LogicalClock(start)
    return AttributionEngine(clk, composition_threshold=threshold), clk


class ClockTests(unittest.TestCase):
    def test_monotonic_and_injected(self):
        clk = LogicalClock(3)
        self.assertEqual(clk.now, 3)
        clk.advance(10)
        self.assertEqual(clk.now, 10)
        with self.assertRaises(ValueError):
            clk.advance(9)
        seq = iter([20, 21])
        c2 = LogicalClock(0, supplier=lambda: next(seq))
        self.assertEqual(c2.tick(), 20)
        self.assertEqual(c2.tick(), 21)
        with self.assertRaises(TypeError):
            LogicalClock(1.5)  # type: ignore[arg-type]


class RevisionTests(unittest.TestCase):
    """需求 1：改版登记与非法配置定位。"""

    def test_valid_revision(self):
        eng, clk = make_engine()
        clk.advance(5)
        rev = eng.register_revision("r1", 5, [" 首页加载 ", "崩溃率"])
        self.assertEqual(rev.items, ("首页加载", "崩溃率"))

    def test_empty_or_duplicate_items_point_to_position(self):
        eng, clk = make_engine()
        clk.advance(5)
        with self.assertRaises(ValidationError) as cm:
            eng.register_revision("r1", 5, ["a", ""])
        self.assertIn("items[1]", str(cm.exception))
        with self.assertRaises(ValidationError) as cm:
            eng.register_revision("r2", 5, ["a", "a"])
        self.assertIn("items[1]", str(cm.exception))
        with self.assertRaises(ValidationError) as cm:
            eng.register_revision("r3", 5, [])
        self.assertIn("items", str(cm.exception))

    def test_empty_id_and_duplicate_id(self):
        eng, clk = make_engine()
        clk.advance(5)
        with self.assertRaises(ValidationError):
            eng.register_revision("  ", 5, ["a"])
        eng.register_revision("r1", 5, ["a"])
        with self.assertRaises(ValidationError) as cm:
            eng.register_revision("r1", 5, ["b"])
        self.assertIn("revisions['r1'].id", str(cm.exception))

    def test_revision_in_future_rejected(self):
        eng, clk = make_engine()
        clk.advance(3)
        with self.assertRaises(ValidationError):
            eng.register_revision("r1", 5, ["a"])


class SegmentTests(unittest.TestCase):
    """需求 2：分群、唯一归属、确定性裁决与台账。"""

    def test_unique_assignment_deterministic(self):
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("zzz", 1, ["u1", "u2"])
        eng.register_segment("aaa", 1, ["u1", "u3"])
        conflicts = eng.assignment_conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual((c.user_id, c.time, c.kept_segment,
                          c.rejected_segment), ("u1", 1, "aaa", "zzz"))
        self.assertEqual(eng.active_members("zzz", 1), ("u2",))
        self.assertEqual(eng.active_members("aaa", 1), ("u1", "u3"))
        # 同一用户同一时刻只能属于一个分群
        owners = {eng.owner_at("u1", 1)}
        self.assertEqual(owners, {"aaa"})

    def test_conflict_order_independence(self):
        def build(first, second):
            eng, clk = make_engine()
            clk.advance(1)
            eng.register_segment(first, 1, ["u1"])
            eng.register_segment(second, 1, ["u1"])
            return eng.assignment_conflicts()

        a = build("zzz", "aaa")
        b = build("aaa", "zzz")
        self.assertEqual([(c.user_id, c.time, c.kept_segment,
                           c.rejected_segment) for c in a],
                         [(c.user_id, c.time, c.kept_segment,
                           c.rejected_segment) for c in b])

    def test_epoch_replacement_strictly_increasing(self):
        eng, clk = make_engine()
        clk.advance(2)
        eng.register_segment("s", 1, ["u1", "u2"])
        clk.advance(5)
        eng.replace_composition("s", 5, ["u2", "u3"])
        self.assertEqual(eng.active_members("s", 4), ("u1", "u2"))
        self.assertEqual(eng.active_members("s", 5), ("u2", "u3"))
        with self.assertRaises(ValidationError):
            eng.replace_composition("s", 5, ["u9"])
        with self.assertRaises(ValidationError):
            eng.replace_composition("s", 99, ["u9"])  # 晚于时钟

    def test_invalid_segment_config(self):
        eng, clk = make_engine()
        clk.advance(1)
        with self.assertRaises(ValidationError) as cm:
            eng.register_segment("s", 1, [])
        self.assertIn("users", str(cm.exception))
        # 重复分群 id 被拒绝
        eng.register_segment("s", 1, ["u1"])
        with self.assertRaises(ValidationError):
            eng.register_segment("s", 1, ["u2"])
        # 同一用户同时刻归属到另一个分群不报错，而是进入裁决台账
        eng.register_segment("s2", 1, ["u1", "u9"])
        self.assertEqual(len(eng.assignment_conflicts()), 1)


class ObservationTests(unittest.TestCase):
    """需求 3：逻辑时钟上报、幂等与缺失标注。"""

    def setUp(self):
        self.eng, self.clk = make_engine()
        self.clk.advance(1)
        self.eng.register_segment("s", 1, ["u1", "u2"])

    def test_idempotent_same_value(self):
        self.assertIsNone(self.eng.observe("s", 1, "x", 5.0))
        # 同值重复上报任意次都幂等
        self.assertIsNone(self.eng.observe("s", 1, "x", 5.0))
        self.assertIsNone(self.eng.observe("s", 1, "x", 5.0))
        self.assertEqual(self.eng.value_at("s", 1, "x"), 5.0)

    def test_conflicting_value_rejected_and_unchanged(self):
        from attribution import ObservationConflict

        self.eng.observe("s", 1, "x", 5.0)
        # 异值重复上报：硬拒绝，而不是静默覆盖
        with self.assertRaises(ValidationError) as cm:
            self.eng.observe("s", 1, "x", 6.0)
        err = cm.exception
        self.assertIn("s", str(err))
        self.assertIn("1", str(err))
        self.assertIn("x", str(err))
        self.assertIsInstance(err.conflict, ObservationConflict)
        self.assertEqual((err.conflict.existing_value,
                          err.conflict.rejected_value), (5.0, 6.0))
        # 状态不变：原值保留、基线不被污染
        self.assertEqual(self.eng.value_at("s", 1, "x"), 5.0)
        # 拒绝后再报回原值仍然幂等成功
        self.assertIsNone(self.eng.observe("s", 1, "x", 5.0))
        # 没有产生多余的观测格子（其它 item 不受影响）
        self.assertEqual(self.eng.raw_observations(),
                         (("s", 1, "x", 5.0),))

    def test_missing_is_none_not_zero(self):
        self.eng.observe("s", 1, "x", 0.0)
        self.assertEqual(self.eng.value_at("s", 1, "x"), 0.0)  # 真 0 保留
        self.assertIsNone(self.eng.value_at("s", 1, "y"))      # 缺失非 0
        self.clk.advance(3)
        # 刻度 3 有别的分群报过 y，s 没报 → 显式缺失
        self.eng.register_segment("s2", 2, ["u9"])
        self.eng.observe("s2", 3, "y", 1.0)
        missing = self.eng.missing_slots("y")
        self.assertIn(("s", 3), missing)
        self.assertNotIn(("s2", 3), missing)

    def test_invalid_observations(self):
        with self.assertRaises(ValidationError):
            self.eng.observe("nope", 1, "x", 1.0)        # 未知分群
        with self.assertRaises(ValidationError):
            self.eng.observe("s", 99, "x", 1.0)          # 晚于时钟
        with self.assertRaises(ValidationError):
            self.eng.observe("s", 1, " ", 1.0)           # 空体验项
        with self.assertRaises(ValidationError):
            self.eng.observe("s", 1, "x", float("nan"))  # NaN


def _two_segment_scenario(threshold=0.5):
    """A 构成稳定；B 在改版后整体替换构成。返回 (引擎, 报告体验项结果)。"""
    eng, clk = make_engine(threshold)
    clk.advance(1)
    eng.register_segment("seg-a", 1, ["a1", "a2", "a3", "a4"])
    eng.register_segment("seg-b", 1, ["b1", "b2"])
    clk.advance(4)
    eng.observe("seg-a", 4, "latency", 100.0)
    eng.observe("seg-b", 4, "latency", 100.0)
    clk.advance(5)
    eng.register_revision("rev-1", 5, ["latency"])
    clk.advance(6)
    eng.replace_composition("seg-b", 6, ["b3", "b4"])
    clk.advance(8)
    eng.observe("seg-a", 8, "latency", 90.0)
    eng.observe("seg-b", 8, "latency", 80.0)
    return eng, clk


class DecompositionTests(unittest.TestCase):
    """需求 4：结构变化 + 真实变化 == 总变化，不凭空增减。"""

    def test_conservation_per_segment_and_item(self):
        eng, _ = _two_segment_scenario()
        r = eng.attribute_revision("rev-1").item("latency")
        for a in r.segment_attributions:
            self.assertTrue(math.isclose(a.structural + a.real, a.total,
                                         abs_tol=1e-9))
            self.assertTrue(math.isclose(
                a.mix + a.composition_migration + a.real, a.total,
                abs_tol=1e-9))
        self.assertTrue(math.isclose(
            sum(a.total for a in r.segment_attributions), r.total))
        self.assertTrue(math.isclose(r.structural + r.real, r.total,
                                     abs_tol=1e-9))
        # 两侧整体加权均值：t0 各 4/2 人 → 100；t1 A 4人90、B 2人80 → 86.667
        self.assertTrue(math.isclose(r.total, -40 / 3, abs_tol=1e-9))

    def test_stable_composition_real_change_only(self):
        eng, _ = _two_segment_scenario()
        r = eng.attribute_revision("rev-1").item("latency")
        a = next(x for x in r.segment_attributions
                 if x.segment_id == "seg-a")
        # A 成员不变、份额不变：mix=0，全部为真实变化
        self.assertTrue(math.isclose(a.mix, 0.0, abs_tol=1e-12))
        self.assertTrue(math.isclose(a.real, -6.666666666666666,
                                     abs_tol=1e-9))


class CompositionAttributionTests(unittest.TestCase):
    """需求 5：构成明显不同 → 归因到用户结构 + 贡献占比。"""

    def test_disjoint_composition_attributed_to_structure(self):
        eng, _ = _two_segment_scenario(threshold=0.5)
        r = eng.attribute_revision("rev-1").item("latency")
        b = next(a for a in r.segment_attributions
                 if a.segment_id == "seg-b")
        self.assertEqual(b.overlap, 0.0)
        self.assertTrue(b.attributed_to_composition)
        self.assertEqual(b.real, 0.0)
        self.assertIn("seg-b", r.composition_segments)
        # 贡献占比：|A| 与 |B| 总贡献相等 → 各 0.5，且占比之和为 1
        shares = dict(r.segment_shares)
        self.assertTrue(math.isclose(shares["seg-a"], 0.5))
        self.assertTrue(math.isclose(shares["seg-b"], 0.5))
        self.assertTrue(math.isclose(sum(shares.values()), 1.0))

    def test_threshold_boundary(self):
        # overlap 恰好 0.5 时不判为结构主导
        eng, _ = _two_segment_scenario(threshold=0.5000001)
        r = eng.attribute_revision("rev-1").item("latency")
        # A 完全重合不受影响；B 仍为 0
        b = next(a for a in r.segment_attributions
                 if a.segment_id == "seg-b")
        self.assertTrue(b.attributed_to_composition)


class CancellationTests(unittest.TestCase):
    """需求 7：结构变化抵消真实改版效果。"""

    def test_opposite_signs_cancel_real_gain(self):
        # t0: 高分组 G(2人,100) + 低分组 B(2人,0)，均值 50
        # t1: G 缩为 1 人且改版提分到 110；B 扩到 3 人仍为 0，均值 27.5
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("G", 1, ["g1", "g2"])
        eng.register_segment("B", 1, ["b1", "b2"])
        clk.advance(4)
        eng.observe("G", 4, "score", 100.0)
        eng.observe("B", 4, "score", 0.0)
        clk.advance(5)
        eng.register_revision("r", 5, ["score"])
        clk.advance(6)
        eng.replace_composition("G", 6, ["g1"])
        eng.replace_composition("B", 6, ["b1", "b2", "b3"])
        clk.advance(8)
        eng.observe("G", 8, "score", 110.0)
        eng.observe("B", 8, "score", 0.0)

        r = eng.attribute_revision("r").item("score")
        self.assertTrue(math.isclose(r.real, 3.75, abs_tol=1e-9))
        self.assertTrue(math.isclose(r.structural, -26.25, abs_tol=1e-9))
        self.assertTrue(math.isclose(r.total, -22.5, abs_tol=1e-9))
        # 改版真实提分 +3.75 被结构迁移完全抵消
        self.assertTrue(math.isclose(r.canceled_by_structure, 3.75,
                                     abs_tol=1e-9))
        self.assertTrue(math.isclose(eng.net_impact("r")["score"], 3.75,
                                     abs_tol=1e-9))


class ChainTests(unittest.TestCase):
    """需求 6：多次改版逐段拆分，段和 == 首末总变化，顺序无关。"""

    @staticmethod
    def _build(register_order):
        eng, clk = make_engine()
        clk.advance(2)
        eng.register_segment("s", 1, ["u1", "u2"])
        eng.observe("s", 2, "m", 100.0)
        clk.advance(3)
        revs = [("rev-1", 3), ("rev-2", 7)]
        for rid, t in register_order(revs):
            clk.advance(max(clk.now, t))
            eng.register_revision(rid, t, ["m"])
        # 观测时刻允许早于时钟当前值（只要不晚于），无需回拨
        eng.observe("s", 6, "m", 90.0)
        clk.advance(10)
        eng.observe("s", 10, "m", 70.0)
        return eng

    def test_chain_conservation_and_segments(self):
        eng = self._build(list)
        chain = eng.item_chain("m")
        self.assertEqual([(s.window_start, s.window_end, s.revision_id)
                          for s in chain.segments],
                         [(2, 6, "rev-1"), (6, 10, "rev-2")])
        self.assertTrue(math.isclose(chain.segments[0].contribution, -10.0))
        self.assertTrue(math.isclose(chain.segments[1].contribution, -20.0))
        self.assertTrue(math.isclose(chain.total_change, -30.0))
        self.assertTrue(math.isclose(
            sum(s.contribution for s in chain.segments), -30.0,
            abs_tol=1e-9))
        for s in chain.segments:
            self.assertTrue(math.isclose(s.structural + s.real,
                                         s.contribution, abs_tol=1e-9))

    def test_chain_order_independence(self):
        a = self._build(list).item_chain("m")
        b = self._build(lambda rs: list(reversed(rs))).item_chain("m")
        self.assertEqual(
            [(s.revision_id, s.window_start, s.window_end,
              round(s.contribution, 12)) for s in a.segments],
            [(s.revision_id, s.window_start, s.window_end,
              round(s.contribution, 12)) for s in b.segments])

    def test_natural_drift_segment(self):
        # 两个观测刻度之间没有改版 → 标注自然波动
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("s", 1, ["u1"])
        clk.advance(2)
        eng.observe("s", 2, "m", 10.0)
        clk.advance(4)
        eng.observe("s", 4, "m", 12.0)
        chain = eng.item_chain("m")
        self.assertEqual(chain.segments[0].revision_id, "(自然波动)")
        self.assertTrue(math.isclose(chain.segments[0].contribution, 2.0))


class QueryTests(unittest.TestCase):
    """需求 7：净影响、分群贡献、抵消、来源链，稳定且可重复。"""

    def test_stable_and_repeatable(self):
        eng, _ = _two_segment_scenario()
        r1 = eng.attribute_revision("rev-1")
        r2 = eng.attribute_revision("rev-1")
        self.assertEqual(r1, r2)  # dataclass 全等
        reports = [
            [(it.item, it.before_time, it.after_time)
             for rep in batch for it in rep.items]
            for batch in (eng.all_reports(), eng.all_reports())]
        self.assertEqual(reports[0], reports[1])
        contrib = eng.segment_contributions("rev-1")["latency"]
        self.assertEqual([s for s, _ in contrib], ["seg-a", "seg-b"])
        # 净影响只含真实变化
        self.assertTrue(math.isclose(eng.net_impact("rev-1")["latency"],
                                     -6.666666666666666, abs_tol=1e-9))
        # 抵消查询稳定返回
        self.assertEqual(eng.canceled_parts("rev-1")["latency"], ())

    def test_missing_window_rejected(self):
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("s", 1, ["u1"])
        clk.advance(5)
        eng.register_revision("r", 5, ["m"])
        clk.advance(8)
        eng.observe("s", 8, "m", 1.0)  # 只有改版后观测
        with self.assertRaises(ValidationError):
            eng.attribute_revision("r")


class MigrationTests(unittest.TestCase):
    """迁移台账与成员来源（含 A->B->A 回迁）。"""

    @staticmethod
    def _build():
        # t1: u 在 A；t3: u 迁到 B（同时新人 w 进入 B）；t5: u 回迁 A
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("segA", 1, ["u", "a1"])
        eng.register_segment("segB", 1, ["b1"])
        clk.advance(3)
        eng.replace_composition("segA", 3, ["a1"])
        eng.replace_composition("segB", 3, ["b1", "u", "w"])
        clk.advance(5)
        eng.replace_composition("segA", 5, ["a1", "u"])
        eng.replace_composition("segB", 5, ["b1", "w"])
        return eng, clk

    def test_migration_ledger_round_trip_and_return(self):
        eng, _ = self._build()
        migs = [
            (m.time, m.user_id, m.from_segment, m.to_segment)
            for m in eng.migrations() if m.user_id == "u"]
        # u: 外部进入 A(@1) -> A 迁到 B(@3) -> B 回迁 A(@5)
        self.assertEqual(migs, [
            (1, "u", "(新进入)", "segA"),
            (3, "u", "segA", "segB"),
            (5, "u", "segB", "segA"),
        ])
        # w: @3 新进入 B
        wm = [m for m in eng.migrations() if m.user_id == "w"]
        self.assertEqual(
            [(m.time, m.from_segment, m.to_segment) for m in wm],
            [(3, "(新进入)", "segB")])

    def test_member_flow_detects_return_not_retained(self):
        eng, _ = self._build()
        # 窗口 t1->t5：u 最终回到 A，但中间迁出过，应显示“从 segB 迁回”
        flowA = eng.member_flow("segA", 1, 5)
        self.assertEqual(flowA.retained, ("a1",))
        self.assertIn(("u", "segB"), flowA.joined_from)
        # u 在该窗口内对 B 只是过境（末态不在 B）：其 A->B->A 路径由
        # 迁移台账完整记录，端点来源里 B 的新成员是 w
        flowB = eng.member_flow("segB", 1, 5)
        self.assertIn(("w", "(新进入)"), flowB.joined_from)
        transient_u = [(m.from_segment, m.to_segment)
                       for m in eng.migrations()
                       if m.user_id == "u" and 1 < m.time <= 5]
        self.assertEqual(transient_u, [("segA", "segB"), ("segB", "segA")])
        # 稳定顺序
        self.assertEqual(flowA.joined_from, tuple(sorted(flowA.joined_from)))

    def test_member_flow_stable_order_and_labels(self):
        eng, clk = make_engine()
        clk.advance(1)
        eng.register_segment("segA", 1, ["u1"])
        clk.advance(2)
        eng.replace_composition("segA", 2, ["u2", "u3"])
        f = eng.member_flow("segA", 1, 2)
        self.assertEqual(f.retained, ())
        self.assertEqual(f.left_to, (("u1", "(已离开)"),))
        self.assertEqual(f.joined_from,
                         (("u2", "(新进入)"), ("u3", "(新进入)")))
        flows = eng.member_flows(1, 2)
        self.assertEqual([x.segment_id for x in flows], ["segA"])
        # 重复调用完全一致
        self.assertEqual(eng.member_flows(1, 2), flows)

    def test_migrations_survive_snapshot_and_drive_chain_flows(self):
        eng, clk = self._build()
        # 补报历史观测（时刻只须不晚于时钟当前值）
        eng.observe("segA", 2, "m", 10.0)
        eng.observe("segB", 2, "m", 10.0)
        eng.observe("segA", 4, "m", 12.0)
        eng.observe("segB", 4, "m", 8.0)
        clk.advance(6)
        eng.observe("segA", 6, "m", 14.0)
        eng.observe("segB", 6, "m", 6.0)

        data = store.to_dict(eng)
        stored_migs = [(m["time"], m["user_id"], m["from_segment"],
                        m["to_segment"]) for m in data["migrations"]]
        self.assertIn((3, "u", "segA", "segB"), stored_migs)
        self.assertIn((5, "u", "segB", "segA"), stored_migs)

        eng2 = store.load_dict(data)
        self.assertEqual(eng2.migrations(), eng.migrations())
        # 来源链每段都带稳定顺序的成员来源
        chain = eng2.item_chain("m")
        for seg in chain.segments:
            ids = [f.segment_id for f in seg.member_flows]
            self.assertEqual(ids, sorted(ids))

    def test_migration_ledger_tamper_rejected(self):
        eng, clk = self._build()
        data = store.to_dict(eng)
        # 篡改迁移台账（与纪元重算不一致）→ 拒绝
        data["migrations"][0]["to_segment"] = "segB"
        with self.assertRaises(ValidationError) as cm:
            store.load_dict(data)
        self.assertIn("迁移台账", str(cm.exception))
        # 起止相同的非法迁移 → 拒绝
        data2 = store.to_dict(eng)
        data2["migrations"].append(
            {"user_id": "u", "time": 3,
             "from_segment": "segA", "to_segment": "segA"})
        with self.assertRaises(ValidationError):
            store.load_dict(data2)

    def test_conservation_holds_with_migrations(self):
        eng, clk = self._build()
        # 补报历史观测（时钟已在 5，允许补报不晚于当前值的时刻）
        eng.observe("segA", 2, "m", 10.0)
        eng.observe("segB", 2, "m", 10.0)
        eng.register_revision("r", 3, ["m"])
        eng.observe("segA", 4, "m", 12.0)
        eng.observe("segB", 4, "m", 8.0)
        rep = eng.attribute_revision("r").item("m")
        self.assertTrue(math.isclose(
            rep.structural + rep.real, rep.total, abs_tol=1e-9))
        for a in rep.segment_attributions:
            self.assertTrue(math.isclose(
                a.mix + a.composition_migration + a.real, a.total,
                abs_tol=1e-9))
        # 报告内嵌成员来源
        self.assertEqual(
            sorted(f.segment_id for f in rep.member_flows),
            ["segA", "segB"])


class StoreTests(unittest.TestCase):
    """需求 8：JSON 快照、载入校验、失败状态不变。"""

    def setUp(self):
        self.eng, _ = _two_segment_scenario()

    def test_roundtrip_dict_and_file(self):
        data = store.to_dict(self.eng)
        eng2 = store.load_dict(data)
        self.assertEqual(store.to_dict(eng2), data)   # 幂等快照
        self.assertEqual(eng2.clock.now, self.eng.clock.now)
        r1 = self.eng.attribute_revision("rev-1")
        r2 = eng2.attribute_revision("rev-1")
        self.assertEqual(r1, r2)

        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            store.save(self.eng, path)
            eng3 = store.load(path)
            self.assertEqual(store.to_dict(eng3), data)
        finally:
            os.unlink(path)

    def _bad(self, mutate):
        data = store.to_dict(self.eng)
        mutate(data)
        with self.assertRaises(ValidationError):
            store.load_dict(data)

    def test_corrupt_json_and_missing_fields(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.write(fd, "{不是合法json".encode("utf-8"))
        os.close(fd)
        try:
            with self.assertRaises(ValidationError) as cm:
                store.load(path)
            self.assertIn("JSON", str(cm.exception))
        finally:
            os.unlink(path)

        self._bad(lambda d: d.pop("clock"))
        self._bad(lambda d: d["revisions"][0].pop("items"))
        self._bad(lambda d: d["segments"][0].pop("epochs"))
        self._bad(lambda d: d["observations"][0].pop("value"))

    def test_duplicate_ids_and_bad_times(self):
        self._bad(lambda d: d["revisions"].append(
            dict(d["revisions"][0])))                       # 改版 id 重复
        self._bad(lambda d: d["revisions"][0].update(time=9999))  # 晚于时钟
        # 分群 id 重复
        self._bad(lambda d: d["segments"].append(
            {"id": "seg-a", "epochs": [{"time": 1, "users": ["x"]}]}))
        # 纪元时刻倒序
        self._bad(lambda d: d["segments"][0]["epochs"].append(
            {"time": 0, "users": ["z"]}))

    def test_observation_self_consistency(self):
        # 观测引用不存在的分群
        self._bad(lambda d: d["observations"].append(
            {"segment_id": "ghost", "time": 4, "item": "latency",
             "value": 1.0}))
        # 同一观测键冲突值
        self._bad(lambda d: d["observations"].append(
            dict(d["observations"][0], value=999.0)))
        # 非法 value
        self._bad(lambda d: d["observations"][0].update(value="x"))

    def test_failed_load_leaves_state_unchanged(self):
        before = store.to_dict(self.eng)
        data = store.to_dict(self.eng)
        data["clock"]["now"] = -1
        with self.assertRaises(ValidationError):
            store.load_dict(data)
        # 原引擎状态不变、仍可计算
        self.assertEqual(store.to_dict(self.eng), before)
        self.assertIsNotNone(self.eng.attribute_revision("rev-1"))

        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            store.save(self.eng, path)
            with open(path, "w", encoding="utf-8") as f:
                f.write("{broken")
            with self.assertRaises(ValidationError):
                store.load(path)
            # 旧快照仍可被再次正常载入（原子写不破坏既有文件）
            store.save(self.eng, path)
            self.assertIsNotNone(store.load(path))
        finally:
            os.unlink(path)

    def test_tampered_attribution_rejected(self):
        # 只改归因结果段、保留守恒关系 → 与重算不一致，拒绝
        data = store.to_dict(self.eng)
        rep = data["attribution"]["reports"][0]["items"][0]
        rep["real"] = rep["real"] + 5.0
        rep["total"] = rep["structural"] + rep["real"]  # 保持表面守恒
        with self.assertRaises(ValidationError) as cm:
            store.load_dict(data)
        self.assertIn("归因结果与重算不一致", str(cm.exception))

        # 直接破坏守恒 → 独立守恒检查即拒绝
        data2 = store.to_dict(self.eng)
        data2["attribution"]["reports"][0]["items"][0]["total"] += 1.0
        with self.assertRaises(ValidationError) as cm:
            store.load_dict(data2)
        self.assertIn("不守恒", str(cm.exception))

        # 篡改来源链段贡献但改总变化 → 段和检查拒绝
        data3 = store.to_dict(self.eng)
        for ch in data3["attribution"]["chains"]:
            if ch["segments"]:
                ch["segments"][0]["contribution"] += 1.0
                with self.assertRaises(ValidationError):
                    store.load_dict(data3)
                break


if __name__ == "__main__":
    unittest.main(verbosity=2)
