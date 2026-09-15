# -*- coding: utf-8 -*-
"""emission_engine 验收测试：纯标准库 unittest，可离线运行。

覆盖场景：正常达标、单季突增、连续缺失、矛盾上报、目标摊回（均摊/权重）、
幂等上报、非法配置拒绝、导出导入一致性与损坏拒绝。
"""

import json
import os
import tempfile
import unittest

from emission_engine import (
    CalibrationEngine,
    StateError,
    ValidationError,
    format_quarter,
    parse_quarter,
)


def make_engine(tolerance=0.05, missing_threshold=2):
    return CalibrationEngine(tolerance_rate=tolerance,
                             missing_threshold=missing_threshold)


def stages_4q(each=100.0):
    """四个单季度阶段，总额度 4*each。"""
    return [
        {"stage_id": "S1", "start": "2026Q1", "end": "2026Q1", "allowance": each},
        {"stage_id": "S2", "start": "2026Q2", "end": "2026Q2", "allowance": each},
        {"stage_id": "S3", "start": "2026Q3", "end": "2026Q3", "allowance": each},
        {"stage_id": "S4", "start": "2026Q4", "end": "2026Q4", "allowance": each},
    ]


class QuarterUtilTest(unittest.TestCase):
    def test_parse_and_format_roundtrip(self):
        self.assertEqual(parse_quarter("2026Q1"), 2026 * 4)
        self.assertEqual(parse_quarter("2026-Q3"), 2026 * 4 + 2)
        self.assertEqual(parse_quarter("2026q4"), 2026 * 4 + 3)
        self.assertEqual(format_quarter(2026 * 4 + 2), "2026Q3")

    def test_parse_rejects_garbage(self):
        for bad in ["2026Q0", "2026Q5", "Q1", "2026-13", "", None, 1.5]:
            with self.assertRaises(ValidationError, msg=repr(bad)):
                parse_quarter(bad)


class StageValidationTest(unittest.TestCase):
    def test_overlap_rejected_with_position(self):
        eng = make_engine()
        bad = [
            {"stage_id": "S1", "start": "2026Q1", "end": "2026Q2", "allowance": 100},
            {"stage_id": "S2", "start": "2026Q2", "end": "2026Q3", "allowance": 100},
        ]
        with self.assertRaises(ValidationError) as ctx:
            eng.register_park("P1", 1000.0, bad)
        msg = str(ctx.exception)
        self.assertIn("P1", msg)
        self.assertIn("S2", msg)  # 指出出问题的阶段
        self.assertIn("重叠", msg)

    def test_gap_rejected_with_position(self):
        eng = make_engine()
        bad = [
            {"stage_id": "S1", "start": "2026Q1", "end": "2026Q1", "allowance": 100},
            {"stage_id": "S2", "start": "2026Q3", "end": "2026Q3", "allowance": 100},
        ]
        with self.assertRaises(ValidationError) as ctx:
            eng.register_park("P1", 1000.0, bad)
        msg = str(ctx.exception)
        self.assertIn("不连续", msg)
        self.assertIn("2026Q2", msg)  # 指出缺失的季度

    def test_other_illegal_configs(self):
        eng = make_engine()
        with self.assertRaises(ValidationError):  # 空阶段
            eng.register_park("P1", 1000.0, [])
        with self.assertRaises(ValidationError):  # 起止倒置
            eng.register_park("P1", 1000.0, [
                {"stage_id": "S1", "start": "2026Q2", "end": "2026Q1",
                 "allowance": 100}])
        with self.assertRaises(ValidationError):  # 非正额度
            eng.register_park("P1", 1000.0, [
                {"stage_id": "S1", "start": "2026Q1", "end": "2026Q1",
                 "allowance": 0}])
        eng.register_park("P1", 1000.0, stages_4q())
        with self.assertRaises(ValidationError):  # 重复园区标识
            eng.register_park("P1", 1000.0, stages_4q())


class DeviationTest(unittest.TestCase):
    """需求 2/3：累计口径偏差、偏差率、幂等、归因。"""

    def setUp(self):
        self.eng = make_engine(tolerance=0.05)
        self.eng.register_park("P1", 1000.0, [
            {"stage_id": "S1", "start": "2026Q1", "end": "2026Q2",
             "allowance": 200.0},
            {"stage_id": "S2", "start": "2026Q3", "end": "2026Q4",
             "allowance": 200.0},
        ])

    def test_on_track_cumulative_rate(self):
        self.eng.report("P1", "2026Q1", 90.0, source="meter")
        self.eng.report("P1", "2026Q2", 95.0, source="meter")
        st = self.eng.status("P1", as_of="2026Q2")
        self.assertEqual(st["state"], "on_track")
        self.assertAlmostEqual(st["cum_actual"], 185.0)
        self.assertAlmostEqual(st["cum_target"], 200.0)
        self.assertAlmostEqual(st["deviation"], -15.0)
        self.assertAlmostEqual(st["deviation_rate"], -0.075)
        self.assertTrue(st["data_complete"])

    def test_single_quarter_spike_attribution(self):
        self.eng.report("P1", "2026Q1", 90.0)
        self.eng.report("P1", "2026Q2", 160.0)  # 单季突增
        st = self.eng.status("P1", as_of="2026Q2")
        self.assertEqual(st["state"], "deviated")
        self.assertAlmostEqual(st["deviation"], 50.0)
        self.assertAlmostEqual(st["deviation_rate"], 0.25)
        # 归因必须指出是 S1 段累计超出，且落到 2026Q2
        contrib = [a for a in st["attribution"] if a["is_contributor"]]
        self.assertEqual([a["stage_id"] for a in contrib], ["S1"])
        self.assertAlmostEqual(contrib[0]["excess"], 50.0)
        q2 = [q for q in contrib[0]["quarters"] if q["quarter"] == "2026Q2"][0]
        self.assertAlmostEqual(q2["excess"], 60.0)  # 160 - 单季份额 100

    def test_prorated_mid_stage_target(self):
        # 只过了一个季度，累计目标应按阶段内线性折算
        self.eng.report("P1", "2026Q1", 120.0)
        st = self.eng.status("P1", as_of="2026Q1")
        self.assertAlmostEqual(st["cum_target"], 100.0)  # 200 * 1/2
        self.assertAlmostEqual(st["deviation_rate"], 0.2)

    def test_idempotent_and_correction(self):
        r1 = self.eng.report("P1", "2026Q1", 90.0, source="meter")
        self.assertEqual(r1["result"], "accepted")
        clock = self.eng.clock
        r2 = self.eng.report("P1", "2026Q1", 90.0, source="meter")
        self.assertEqual(r2["result"], "duplicate")
        self.assertEqual(self.eng.clock, clock)  # 幂等：状态与逻辑时钟不变
        self.assertAlmostEqual(
            self.eng.status("P1", as_of="2026Q1")["cum_actual"], 90.0)
        r3 = self.eng.report("P1", "2026Q1", 95.0, source="meter")
        self.assertEqual(r3["result"], "correction")
        self.assertAlmostEqual(
            self.eng.status("P1", as_of="2026Q1")["cum_actual"], 95.0)

    def test_report_out_of_horizon_rejected(self):
        with self.assertRaises(ValidationError) as ctx:
            self.eng.report("P1", "2027Q1", 10.0)
        self.assertIn("超出目标区间", str(ctx.exception))
        with self.assertRaises(ValidationError):
            self.eng.report("P1", "2026Q1", -5.0)


class MissingDataTest(unittest.TestCase):
    """需求 5：连续缺失标记、缺失不计入也不按零虚增达标。"""

    def test_consecutive_missing_marks_data_missing(self):
        eng = make_engine(missing_threshold=2)
        eng.register_park("P1", 1000.0, stages_4q(100.0))
        eng.report("P1", "2026Q1", 10.0)  # 远低于目标，若缺失按零算会"虚增达标"
        st = eng.status("P1", as_of="2026Q4")
        self.assertEqual(st["state"], "data_missing")
        self.assertEqual(st["missing_quarters"], ["2026Q2", "2026Q3", "2026Q4"])
        self.assertEqual(st["tail_missing_count"], 3)
        self.assertFalse(st["data_complete"])
        # 缺失季度不计入累计实绩（不是按 0 填充后再汇总）
        self.assertAlmostEqual(st["cum_actual"], 10.0)

    def test_single_missing_quarter_flagged_but_not_data_missing(self):
        eng = make_engine(missing_threshold=2)
        eng.register_park("P1", 1000.0, stages_4q(100.0))
        eng.report("P1", "2026Q1", 90.0)
        eng.report("P1", "2026Q2", 90.0)
        st = eng.status("P1", as_of="2026Q3")
        self.assertEqual(st["state"], "on_track")  # 尾部只缺 1 季，未达阈值
        self.assertEqual(st["missing_quarters"], ["2026Q3"])
        self.assertFalse(st["data_complete"])


class ConflictTest(unittest.TestCase):
    """需求 6：矛盾上报双方保留、可读冲突记录、不静默选择。"""

    def setUp(self):
        self.eng = make_engine()
        self.eng.register_park("P1", 1000.0, stages_4q(100.0))

    def test_conflict_record_keeps_both_sides(self):
        self.eng.report("P1", "2026Q1", 100.0, source="园区自报")
        r = self.eng.report("P1", "2026Q1", 130.0, source="第三方核查")
        self.assertIn("conflict", r)
        conflicts = self.eng.conflicts("P1")
        self.assertEqual(len(conflicts), 1)
        rec = conflicts[0]
        self.assertTrue(rec["active"])
        self.assertEqual(rec["quarter"], "2026Q1")
        self.assertEqual(rec["values"], {"园区自报": 100.0, "第三方核查": 130.0})
        # 冲突季度不计入累计实绩，且被明确标注
        st = self.eng.status("P1", as_of="2026Q1")
        self.assertAlmostEqual(st["cum_actual"], 0.0)
        self.assertEqual(st["conflict_quarters"], ["2026Q1"])
        self.assertFalse(st["data_complete"])

    def test_conflict_resolved_by_correction(self):
        self.eng.report("P1", "2026Q1", 100.0, source="A")
        self.eng.report("P1", "2026Q1", 130.0, source="B")
        self.eng.report("P1", "2026Q1", 100.0, source="B")  # B 更正，与 A 一致
        rec = self.eng.conflicts("P1")[0]
        self.assertFalse(rec["active"])
        self.assertIsNotNone(rec["resolved_clock"])
        st = self.eng.status("P1", as_of="2026Q1")
        self.assertAlmostEqual(st["cum_actual"], 100.0)
        self.assertEqual(st["conflict_quarters"], [])


class AdjustTest(unittest.TestCase):
    """需求 4（收紧后口径）：已结束阶段按实绩结算、当前阶段不变、
    超出量由当前阶段之后的剩余阶段承担、总量严格守恒。"""

    def setUp(self):
        self.eng = make_engine(tolerance=0.05)
        self.eng.register_park("P1", 1000.0, stages_4q(100.0))
        self.eng.report("P1", "2026Q1", 150.0)  # S1 结束，超 50

    def test_even_spread_conserves_total(self):
        rec = self.eng.adjust("P1", strategy="even", as_of="2026Q1")
        self.assertAlmostEqual(rec["excess"], 50.0)
        self.assertEqual(rec["settled_stages"], ["S1"])
        self.assertEqual(rec["current_stage"], "S2")
        stages = {s["stage_id"]: s for s in self.eng.targets("P1")}
        self.assertAlmostEqual(stages["S1"]["allowance"], 150.0)   # 已结束阶段按实绩结算
        self.assertAlmostEqual(stages["S2"]["allowance"], 100.0)   # 当前阶段保持不变
        for sid in ("S3", "S4"):                                    # 剩余阶段均摊 50
            self.assertAlmostEqual(stages[sid]["allowance"], 75.0)
        # 总量守恒：调整后之和 == 原总目标 400
        total = sum(s["allowance"] for s in stages.values())
        self.assertAlmostEqual(total, 400.0, places=9)
        self.assertAlmostEqual(rec["total_allowance"], 400.0, places=9)
        # 调整后已结束阶段被追认，回到达标
        self.assertEqual(self.eng.status("P1", as_of="2026Q1")["state"],
                         "on_track")

    def test_weighted_spread(self):
        rec = self.eng.adjust(
            "P1", strategy="weighted",
            weights={"S3": 1.0, "S4": 3.0}, as_of="2026Q1")
        stages = {s["stage_id"]: s for s in self.eng.targets("P1")}
        self.assertAlmostEqual(stages["S1"]["allowance"], 150.0)
        self.assertAlmostEqual(stages["S2"]["allowance"], 100.0)  # 当前阶段不变
        self.assertAlmostEqual(stages["S3"]["allowance"], 100.0 - 12.5)
        self.assertAlmostEqual(stages["S4"]["allowance"], 100.0 - 37.5)
        total = sum(s["allowance"] for s in stages.values())
        self.assertAlmostEqual(total, 400.0, places=9)
        self.assertEqual(rec["strategy"], "weighted")

    def test_zero_weight_stage_excluded(self):
        """权重为零的阶段不参与分配，额度不变，总量仍守恒。"""
        self.eng.adjust("P1", strategy="weighted",
                        weights={"S3": 0.0, "S4": 1.0}, as_of="2026Q1")
        stages = {s["stage_id"]: s for s in self.eng.targets("P1")}
        self.assertAlmostEqual(stages["S2"]["allowance"], 100.0)  # 当前阶段不变
        self.assertAlmostEqual(stages["S3"]["allowance"], 100.0)  # 零权重不参与
        self.assertAlmostEqual(stages["S4"]["allowance"], 50.0)   # 独自承担 50
        total = sum(s["allowance"] for s in stages.values())
        self.assertAlmostEqual(total, 400.0, places=9)

    def test_weighted_default_proportional_to_allowance(self):
        eng = make_engine()
        eng.register_park("P9", 1000.0, [
            {"stage_id": "A", "start": "2026Q1", "end": "2026Q1",
             "allowance": 100.0},
            {"stage_id": "B", "start": "2026Q2", "end": "2026Q2",
             "allowance": 100.0},
            {"stage_id": "C", "start": "2026Q3", "end": "2026Q3",
             "allowance": 100.0},
            {"stage_id": "D", "start": "2026Q4", "end": "2026Q4",
             "allowance": 300.0},
        ])
        eng.report("P9", "2026Q1", 200.0)  # A 结束，超 100
        eng.adjust("P9", strategy="weighted", as_of="2026Q1")
        stages = {s["stage_id"]: s for s in eng.targets("P9")}
        self.assertAlmostEqual(stages["A"]["allowance"], 200.0)  # 结算
        self.assertAlmostEqual(stages["B"]["allowance"], 100.0)  # 当前阶段不变
        # C:D = 1:3 → 各扣 25 / 75
        self.assertAlmostEqual(stages["C"]["allowance"], 75.0)
        self.assertAlmostEqual(stages["D"]["allowance"], 225.0)
        self.assertAlmostEqual(
            sum(s["allowance"] for s in stages.values()), 600.0, places=9)

    def test_adjust_requires_deviated_state(self):
        eng = make_engine()
        eng.register_park("P2", 1000.0, stages_4q(100.0))
        eng.report("P2", "2026Q1", 50.0)
        with self.assertRaises(StateError):
            eng.adjust("P2", as_of="2026Q1")

    def test_adjust_rejected_without_remaining_stages(self):
        eng = make_engine()
        eng.register_park("P3", 1000.0, [
            {"stage_id": "S1", "start": "2026Q1", "end": "2026Q1",
             "allowance": 100.0},
        ])
        eng.report("P3", "2026Q1", 150.0)
        with self.assertRaises(StateError) as ctx:
            eng.adjust("P3", as_of="2026Q1")
        self.assertIn("没有剩余阶段", str(ctx.exception))

    def test_mid_stage_excess_not_settled_yet(self):
        """超出发生在尚未结束的当前阶段时，已结束阶段无超出可结算，拒绝调整。"""
        eng = make_engine()
        eng.register_park("P4", 1000.0, [
            {"stage_id": "S1", "start": "2026Q1", "end": "2026Q2",
             "allowance": 200.0},
            {"stage_id": "S2", "start": "2026Q3", "end": "2026Q4",
             "allowance": 200.0},
        ])
        eng.report("P4", "2026Q1", 250.0)  # 当前阶段 S1 未结束
        self.assertEqual(eng.status("P4", as_of="2026Q1")["state"], "deviated")
        with self.assertRaises(StateError) as ctx:
            eng.adjust("P4", as_of="2026Q1")
        self.assertIn("未结束", str(ctx.exception))

    def test_adjust_rejected_when_data_incomplete(self):
        eng = make_engine()
        eng.register_park("P5", 1000.0, stages_4q(100.0))
        eng.report("P5", "2026Q1", 250.0)
        eng.report("P5", "2026Q3", 100.0)  # Q2 缺失（未达连续缺失阈值）
        self.assertEqual(eng.status("P5", as_of="2026Q3")["state"], "deviated")
        with self.assertRaises(StateError) as ctx:
            eng.adjust("P5", as_of="2026Q3")
        self.assertIn("数据不完整", str(ctx.exception))

    def test_adjustment_history_recorded(self):
        self.eng.adjust("P1", strategy="even", as_of="2026Q1")
        hist = self.eng.adjustment_history("P1")
        self.assertEqual(len(hist), 1)
        rec = hist[0]
        self.assertEqual(rec["seq"], 1)
        self.assertEqual(rec["settled_stages"], ["S1"])
        self.assertEqual(rec["current_stage"], "S2")
        self.assertAlmostEqual(rec["changes"]["S1"]["before"], 100.0)
        self.assertAlmostEqual(rec["changes"]["S1"]["after"], 150.0)
        self.assertAlmostEqual(rec["changes"]["S3"]["before"], 100.0)
        self.assertAlmostEqual(rec["changes"]["S3"]["after"], 75.0)
        self.assertNotIn("S2", rec["changes"])  # 当前阶段未动


class PersistenceTest(unittest.TestCase):
    """需求 7：导出/载入、校验、失败状态不变。"""

    def build_engine(self):
        eng = make_engine(tolerance=0.1)
        eng.register_park("PA", 800.0, stages_4q(100.0))
        eng.register_park("PB", 1200.0, [
            {"stage_id": "T1", "start": "2026Q1", "end": "2026Q1",
             "allowance": 100.0},
            {"stage_id": "T2", "start": "2026Q2", "end": "2026Q2",
             "allowance": 200.0},
            {"stage_id": "T3", "start": "2026Q3", "end": "2026Q4",
             "allowance": 300.0},
        ])
        eng.report("PA", "2026Q1", 150.0, source="meter")
        eng.report("PA", "2026Q1", 155.0, source="audit")  # 冲突
        eng.report("PB", "2026Q1", 200.0, source="meter")  # 累计 200 vs 100 → 偏离
        eng.adjust("PB", strategy="even", as_of="2026Q1")
        return eng

    def test_roundtrip_preserves_everything(self):
        eng = self.build_engine()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            eng.export_json(path)
            loaded = CalibrationEngine.import_json(path)
            # 状态查询结果一致
            for pid, as_of in (("PA", "2026Q1"), ("PB", "2026Q1")):
                a = eng.status(pid, as_of=as_of)
                b = loaded.status(pid, as_of=as_of)
                self.assertEqual(a, b)
            self.assertEqual(eng.conflicts("PA"), loaded.conflicts("PA"))
            self.assertEqual(eng.adjustment_history("PB"),
                             loaded.adjustment_history("PB"))
            self.assertEqual(eng.clock, loaded.clock)
            # 再导出，文件内容一致
            path2 = os.path.join(tmp, "state2.json")
            loaded.export_json(path2)
            with open(path, encoding="utf-8") as f:
                d1 = json.load(f)
            with open(path2, encoding="utf-8") as f:
                d2 = json.load(f)
            self.assertEqual(d1, d2)

    def test_import_rejects_corrupted_and_state_unchanged(self):
        eng = self.build_engine()
        before = eng.status("PB", as_of="2026Q1")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            eng.export_json(path)
            with open(path, encoding="utf-8") as f:
                data = json.load(f)

            # 1) 文件被截断（非法 JSON）
            bad1 = os.path.join(tmp, "bad1.json")
            with open(path, encoding="utf-8") as f:
                content = f.read()
            with open(bad1, "w", encoding="utf-8") as f:
                f.write(content[: len(content) // 2])
            with self.assertRaises(ValidationError):
                eng.load_json(bad1)

            # 2) 破坏总量守恒
            bad2 = os.path.join(tmp, "bad2.json")
            d2 = json.loads(content)
            for p in d2["parks"]:
                if p["park_id"] == "PB":
                    p["stages"][0]["allowance"] += 10.0
            with open(bad2, "w", encoding="utf-8") as f:
                json.dump(d2, f)
            with self.assertRaises(ValidationError) as ctx:
                eng.load_json(bad2)
            self.assertIn("守恒", str(ctx.exception))

            # 3) 阶段不连续
            bad3 = os.path.join(tmp, "bad3.json")
            d3 = json.loads(content)
            for p in d3["parks"]:
                if p["park_id"] == "PA":
                    p["stages"][1]["start"] = "2026Q3"
                    p["stages"][1]["original_allowance"] = 100.0
            with open(bad3, "w", encoding="utf-8") as f:
                json.dump(d3, f)
            with self.assertRaises(ValidationError):
                eng.load_json(bad3)

            # 4) 重复园区标识
            bad4 = os.path.join(tmp, "bad4.json")
            d4 = json.loads(content)
            d4["parks"].append(dict(d4["parks"][0]))
            with open(bad4, "w", encoding="utf-8") as f:
                json.dump(d4, f)
            with self.assertRaises(ValidationError) as ctx:
                eng.load_json(bad4)
            self.assertIn("重复", str(ctx.exception))

            # 5) 缺少字段
            bad5 = os.path.join(tmp, "bad5.json")
            d5 = json.loads(content)
            del d5["parks"][0]["stages"]
            with open(bad5, "w", encoding="utf-8") as f:
                json.dump(d5, f)
            with self.assertRaises(ValidationError) as ctx:
                eng.load_json(bad5)
            self.assertIn("stages", str(ctx.exception))

            # 6) 实绩季度超出目标区间
            bad6 = os.path.join(tmp, "bad6.json")
            d6 = json.loads(content)
            d6["parks"][0]["reports"].append(
                {"quarter": "2027Q2", "source": "x", "value": 1.0})
            with open(bad6, "w", encoding="utf-8") as f:
                json.dump(d6, f)
            with self.assertRaises(ValidationError):
                eng.load_json(bad6)

        # 所有失败之后，原引擎状态完全不变
        self.assertEqual(eng.status("PB", as_of="2026Q1"), before)
        self.assertEqual(len(eng.parks()), 2)

    def test_conflict_clocks_survive_roundtrip(self):
        """冲突记录（含已解决）的来源、数值与逻辑时钟导出导入后逐项一致。"""
        eng = make_engine()
        eng.register_park("P1", 1000.0, stages_4q(100.0))
        eng.report("P1", "2026Q1", 100.0, source="A")      # clock 2
        eng.report("P1", "2026Q1", 130.0, source="B")      # clock 3 → 活跃冲突
        eng.report("P1", "2026Q2", 90.0, source="A")       # clock 4
        eng.report("P1", "2026Q2", 95.0, source="B")       # clock 5 → 冲突
        eng.report("P1", "2026Q2", 90.0, source="B")       # clock 6 → 冲突解除
        before = eng.conflicts("P1")
        self.assertEqual(len(before), 2)
        self.assertEqual(before[0]["detected_clock"], 3)
        self.assertIsNone(before[0]["resolved_clock"])
        self.assertEqual(before[1]["detected_clock"], 5)
        self.assertEqual(before[1]["resolved_clock"], 6)
        # 已解决记录仍保留当时双方各自数值
        self.assertEqual(before[1]["values"], {"A": 90.0, "B": 95.0})

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            eng.export_json(path)
            loaded = CalibrationEngine.import_json(path)
        after = loaded.conflicts("P1")
        self.assertEqual(before, after)  # 来源、数值、时刻逐项一致
        # 逻辑时钟连续：载入后新的上报从原时钟继续递增
        self.assertEqual(loaded.clock, eng.clock)
        loaded.report("P1", "2026Q3", 80.0, source="A")
        self.assertEqual(loaded.clock, eng.clock + 1)


class AcceptanceScenarioTest(unittest.TestCase):
    """需求 8：多园区多季度综合场景，逐步推导比对。"""

    def test_multi_park_scenario(self):
        eng = make_engine(tolerance=0.05, missing_threshold=2)

        # 园区 A：正常达标
        eng.register_park("A", 1000.0, stages_4q(100.0))
        for q, v in (("2026Q1", 95.0), ("2026Q2", 98.0), ("2026Q3", 102.0)):
            eng.report("A", q, v, source="meter")
        sta = eng.status("A", as_of="2026Q3")
        self.assertEqual(sta["state"], "on_track")
        self.assertAlmostEqual(sta["cum_actual"], 295.0)
        self.assertAlmostEqual(sta["cum_target"], 300.0)
        self.assertAlmostEqual(sta["deviation_rate"], -5.0 / 300.0)

        # 园区 B：单季突增 → 偏离 → 归因 S2 → 均摊摊回
        eng.register_park("B", 1000.0, stages_4q(100.0))
        eng.report("B", "2026Q1", 90.0)
        eng.report("B", "2026Q2", 190.0)  # 突增：累计 280 vs 200
        stb = eng.status("B", as_of="2026Q2")
        self.assertEqual(stb["state"], "deviated")
        self.assertAlmostEqual(stb["deviation"], 80.0)
        self.assertAlmostEqual(stb["deviation_rate"], 0.4)
        contrib = [a["stage_id"] for a in stb["attribution"]
                   if a["is_contributor"]]
        self.assertEqual(contrib, ["S2"])
        rec = eng.adjust("B", strategy="even", as_of="2026Q2")
        self.assertAlmostEqual(rec["excess"], 80.0)
        self.assertEqual(rec["settled_stages"], ["S1", "S2"])
        self.assertEqual(rec["current_stage"], "S3")
        stages_b = {s["stage_id"]: s["allowance"] for s in eng.targets("B")}
        self.assertAlmostEqual(stages_b["S1"], 90.0)    # 已结束阶段按实绩结算
        self.assertAlmostEqual(stages_b["S2"], 190.0)
        self.assertAlmostEqual(stages_b["S3"], 100.0)   # 当前阶段保持不变
        self.assertAlmostEqual(stages_b["S4"], 20.0)    # 剩余阶段承担全部 80
        self.assertAlmostEqual(sum(stages_b.values()), 400.0, places=9)

        # 园区 C：连续缺失 → 数据缺失标记
        eng.register_park("C", 1000.0, stages_4q(100.0))
        eng.report("C", "2026Q1", 10.0)
        stc = eng.status("C", as_of="2026Q3")
        self.assertEqual(stc["state"], "data_missing")
        self.assertEqual(stc["missing_quarters"], ["2026Q2", "2026Q3"])
        self.assertAlmostEqual(stc["cum_actual"], 10.0)

        # 园区 D：矛盾上报 → 冲突记录
        eng.register_park("D", 1000.0, stages_4q(100.0))
        eng.report("D", "2026Q1", 100.0, source="自报")
        eng.report("D", "2026Q1", 140.0, source="核查")
        recs = eng.conflicts("D")
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["quarter"], "2026Q1")
        self.assertEqual(recs[0]["values"], {"自报": 100.0, "核查": 140.0})
        std = eng.status("D", as_of="2026Q1")
        self.assertEqual(std["conflict_quarters"], ["2026Q1"])
        self.assertAlmostEqual(std["cum_actual"], 0.0)

        # 导出 → 载入 → 结果不变
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "acceptance.json")
            eng.export_json(path)
            loaded = CalibrationEngine.import_json(path)
            for pid, as_of in (("A", "2026Q3"), ("B", "2026Q2"),
                               ("C", "2026Q3"), ("D", "2026Q1")):
                self.assertEqual(eng.status(pid, as_of=as_of),
                                 loaded.status(pid, as_of=as_of))
            self.assertEqual(eng.conflicts("D"), loaded.conflicts("D"))
            self.assertEqual(eng.adjustment_history("B"),
                             loaded.adjustment_history("B"))


if __name__ == "__main__":
    unittest.main()
