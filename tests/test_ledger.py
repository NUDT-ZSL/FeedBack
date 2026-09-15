"""离线决策台账验收测试。

运行：
    python -m unittest discover -s tests -v

七条需求与测试方法的对应关系见每个类开头的注释。
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from decision_ledger import Ledger, store  # noqa: E402
from decision_ledger.cli import main as cli_main  # noqa: E402
from decision_ledger.errors import (  # noqa: E402
    ConflictError,
    NotFoundError,
    StateFlowError,
    ValidationError,
)
from decision_ledger.models import (  # noqa: E402
    CHOSEN,
    PENDING,
    REVIEWED,
)


class FakeClock:
    """按预设时间戳依次推进的可控时钟，保证测试不依赖真实当前时间。"""

    def __init__(self, *stamps):
        self._stamps = list(stamps)
        self._i = 0

    def __call__(self):
        stamp = self._stamps[min(self._i, len(self._stamps) - 1)]
        self._i += 1
        return stamp


def build_chosen_decision(ledger: Ledger, topic="是否接受外派",
                          bases=(("猎头反馈", 3.0, "supports", "薪资上浮 40%"),
                                 ("家人意见", 2.0, "contradicts", "希望留在本地"))):
    d = ledger.create_decision(topic, created_at="2026-01-05T09:00:00")
    ids = []
    for source, weight, stance, content in bases:
        ids.append(ledger.add_basis(d.decision_id, source, weight, stance,
                                    content).evidence_id)
    ledger.mark_chosen(d.decision_id, "接受外派", chosen_at="2026-01-06T10:00:00")
    return d, ids


# 需求 1：决策条目与状态机 ================================================ #

class Requirement1DecisionStateTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-09-01T08:00:00"))

    def test_decision_has_unique_id_topic_and_timestamp(self):
        d1 = self.ledger.create_decision("主题甲", created_at="2026-09-01T08:00:00")
        d2 = self.ledger.create_decision("主题乙", created_at="2026-09-02T08:00:00")
        self.assertEqual(d1.decision_id, "D-0001")
        self.assertEqual(d2.decision_id, "D-0002")
        self.assertEqual(d1.topic, "主题甲")
        self.assertEqual(d1.created_at, "2026-09-01T08:00:00")
        self.assertEqual(PENDING, d1.state)
        self.assertNotEqual(d1.decision_id, d2.decision_id)

    def test_legal_transitions(self):
        d = self.ledger.create_decision("X")
        self.assertEqual(PENDING, d.state)
        self.ledger.mark_chosen(d.decision_id, "方案一")
        self.assertEqual(CHOSEN, self.ledger.get_decision(d.decision_id).state)
        self.ledger.mark_reviewed(d.decision_id)
        self.assertEqual(REVIEWED, self.ledger.get_decision(d.decision_id).state)

    def test_illegal_skip_chosen_to_reviewed_rejected_with_reason(self):
        d = self.ledger.create_decision("X")
        with self.assertRaises(StateFlowError) as ctx:
            self.ledger.mark_reviewed(d.decision_id)
        msg = str(ctx.exception)
        self.assertIn("非法状态流转", msg)
        self.assertIn(PENDING, msg)
        self.assertIn(CHOSEN, msg)  # 说明了合法目标

    def test_illegal_backflow_and_terminal_rejected(self):
        d, _ = build_chosen_decision(self.ledger)
        # 已选择状态再次选择：拒绝并说明当前所处状态
        with self.assertRaises(StateFlowError) as ctx:
            self.ledger.mark_chosen(d.decision_id, "再选一次")
        self.assertIn(CHOSEN, str(ctx.exception))

        self.ledger.mark_reviewed(d.decision_id)
        # 已复盘是终态：不能再选择
        with self.assertRaises(StateFlowError) as ctx:
            self.ledger.mark_chosen(d.decision_id, "反悔")
        self.assertIn("终态", str(ctx.exception))
        # 也不能重复复盘
        with self.assertRaises(StateFlowError) as ctx:
            self.ledger.mark_reviewed(d.decision_id)
        self.assertIn(REVIEWED, str(ctx.exception))

    def test_missing_decision_is_rejected(self):
        with self.assertRaises(NotFoundError):
            self.ledger.mark_chosen("D-9999", "x")


# 需求 2：依据标识、来源与权重校验 ======================================== #

class Requirement2BasisValidationTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-01-05T09:00:00"))
        self.d = self.ledger.create_decision("买房还是租房",
                                             created_at="2026-01-05T09:00:00")

    def test_basis_gets_unique_id_and_is_listed(self):
        b = self.ledger.add_basis(self.d.decision_id, "中介带看", 2.5,
                                  "supports", "同片区租金上涨")
        self.assertEqual(b.evidence_id, "D-0001.B01")
        ids = [e.evidence_id for e in self.ledger.get_decision(
            self.d.decision_id).basis_list()]
        self.assertEqual(ids, ["D-0001.B01"])

    def test_duplicate_id_within_decision_rejected(self):
        self.ledger.add_basis(self.d.decision_id, "来源A", 1, "supports",
                              evidence_id="SAME")
        with self.assertRaises(ConflictError) as ctx:
            self.ledger.add_basis(self.d.decision_id, "来源B", 1, "supports",
                                  evidence_id="SAME")
        msg = str(ctx.exception)
        self.assertIn("依据标识重复", msg)
        self.assertIn("SAME", msg)
        # 被拒绝后只保留第一条
        self.assertEqual(
            len(self.ledger.get_decision(self.d.decision_id).basis_list()), 1)

    def test_same_basis_id_allowed_in_different_decisions(self):
        d2 = self.ledger.create_decision("另一件事", created_at="2026-01-06T09:00:00")
        self.ledger.add_basis(self.d.decision_id, "来源", 1, "supports",
                              evidence_id="E1")
        self.ledger.add_basis(d2.decision_id, "来源", 1, "supports",
                              evidence_id="E1")  # 不应抛错

    def test_non_positive_weight_rejected_and_points_to_position(self):
        with self.assertRaises(ValidationError) as ctx:
            self.ledger.add_basis(self.d.decision_id, "某报告", 0, "supports")
        msg = str(ctx.exception)
        self.assertIn("权重", msg)
        self.assertIn("非正", msg)
        self.assertIn("第 1 条依据", msg)  # 指出位置
        with self.assertRaises(ValidationError):
            self.ledger.add_basis(self.d.decision_id, "某报告", -2, "supports")

    def test_missing_source_rejected_with_position(self):
        with self.assertRaises(ValidationError) as ctx:
            self.ledger.add_basis(self.d.decision_id, "   ", 1, "supports")
        self.assertIn("来源", str(ctx.exception))
        self.assertIn("第 1 条依据", str(ctx.exception))

    def test_basis_only_addable_while_pending(self):
        self.ledger.mark_chosen(self.d.decision_id, "买房")
        with self.assertRaises(StateFlowError) as ctx:
            self.ledger.add_basis(self.d.decision_id, "迟到的依据", 1, "supports")
        self.assertIn("待定", str(ctx.exception))


# 需求 3：结果登记与迟到回填 ============================================== #

class Requirement3OutcomeBackfillTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                             "2026-01-06T10:00:00",
                                             "2026-01-06T10:00:00"))
        self.d, ids = build_chosen_decision(self.ledger)
        self.b1, self.b2 = ids

    def test_outcome_requires_decision_made(self):
        fresh = self.ledger.create_decision("还没定", created_at="2026-03-01T09:00:00")
        bid = self.ledger.add_basis(fresh.decision_id, "s", 1, "supports").evidence_id
        with self.assertRaises(StateFlowError):
            self.ledger.record_outcome(fresh.decision_id, bid, "v", "supports",
                                       1, "s", "2026-04-01T09:00:00")

    def test_outcome_must_reference_existing_basis(self):
        with self.assertRaises(NotFoundError) as ctx:
            self.ledger.record_outcome(self.d.decision_id, "D-0001.B99",
                                       "v", "supports", 1, "现场",
                                       "2026-02-01T09:00:00")
        self.assertIn("不存在", str(ctx.exception))

    def test_very_late_outcome_after_review_is_backfilled(self):
        self.ledger.mark_reviewed(self.d.decision_id,
                                  reviewed_at="2026-02-01T09:00:00")
        # 决策后将近一年才拿到的结果，发生时刻远晚于决策与复盘
        outcome, _, _ = self.ledger.record_outcome(
            self.d.decision_id, self.b1, "外派一年后绩效评优",
            "supports", 4, "年度考核报告", "2026-12-20T17:00:00")
        self.assertEqual(outcome.decision_id, self.d.decision_id)
        self.assertEqual(outcome.basis_id, self.b1)
        d = self.ledger.get_decision(self.d.decision_id)
        self.assertEqual(set(d.outcomes), {outcome.outcome_id})
        # 结果证据与结果一一对应、互相可追溯
        re = d.evidences[outcome.evidence_id]
        self.assertEqual(re.outcome_id, outcome.outcome_id)
        self.assertEqual(re.observed_at, "2026-12-20T17:00:00")

    def test_outcome_invalid_time_weight_source_rejected(self):
        with self.assertRaises(ValidationError):
            self.ledger.record_outcome(self.d.decision_id, self.b1, "", "supports",
                                       1, "来源", "not-a-time")
        with self.assertRaises(ValidationError):
            self.ledger.record_outcome(self.d.decision_id, self.b1, "v", "supports",
                                       -1, "来源", "2026-02-01T09:00:00")


# 需求 4：结论推导与变化轨迹 ============================================== #

class Requirement4ConclusionEvolutionTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                             "2026-01-06T10:00:01",
                                             "2026-01-06T10:00:02",
                                             "2026-01-06T10:00:03"))
        self.d, ids = build_chosen_decision(self.ledger)
        self.b_support, self.b_against = ids

    def test_initial_conclusion_is_pending_v0(self):
        d = self.ledger.create_decision("新事", created_at="2026-05-01T09:00:00")
        cur = self.ledger.current_conclusion(d.decision_id)
        self.assertEqual(cur.version, 0)
        self.assertEqual(cur.verdict, "待定")
        self.assertIsNone(cur.triggering_outcome_id)

    def test_choosing_forms_initial_substantive_verdict_from_bases(self):
        # supports 3 vs contradicts 2 → 成立
        cur = self.ledger.current_conclusion(self.d.decision_id)
        self.assertEqual(cur.verdict, "成立")
        self.assertEqual(cur.score_supports, 3.0)
        self.assertEqual(cur.score_contradicts, 2.0)
        self.assertIsNone(cur.triggering_outcome_id)

    def test_conclusion_changes_with_triggering_outcome_and_before_after(self):
        before = self.ledger.current_conclusion(self.d.decision_id)
        # 强反对结果（权重 5）到达：3 vs 7 → 不成立
        outcome, _, new_entry = self.ledger.record_outcome(
            self.d.decision_id, self.b_against, "外派后家庭矛盾激化",
            "contradicts", 5, "家庭沟通记录", "2026-03-01T20:00:00")
        self.assertIsNotNone(new_entry)
        self.assertEqual(new_entry.triggering_outcome_id, outcome.outcome_id)

        traj = self.ledger.conclusion_trajectory(self.d.decision_id)
        verdicts = [(e.version, e.verdict) for e in traj]
        # v0 待定（建决策）→ v1 成立（作出选择时）→ v2 不成立（结果触发）
        self.assertEqual(verdicts, [(0, "待定"), (1, "成立"), (2, "不成立")])
        self.assertEqual(traj[-1].triggering_outcome_id, outcome.outcome_id)
        self.assertEqual(traj[-2].verdict, "成立")   # 变化前
        self.assertEqual(traj[-1].verdict, "不成立")  # 变化后
        self.assertIn(outcome.outcome_id, traj[-1].note)

    def test_non_flipping_outcome_does_not_add_version(self):
        # 同方向再加一条小权重支持结果：结论仍为「成立」，轨迹不加版本
        _, _, new_entry = self.ledger.record_outcome(
            self.d.decision_id, self.b_support, "薪资如期到账",
            "supports", 0.5, "工资条", "2026-02-01T09:00:00")
        self.assertIsNone(new_entry)
        traj = self.ledger.conclusion_trajectory(self.d.decision_id)
        self.assertEqual(len(traj), 2)  # 仍只有 v0、v1

    def test_tie_is_pending_and_can_flip_both_ways(self):
        # 3 vs 2，补一条权重 1 的反对结果 → 3 vs 3 → 待定
        _, _, e1 = self.ledger.record_outcome(
            self.d.decision_id, self.b_against, "本地房价松动",
            "contradicts", 1, "行情简报", "2026-02-01T09:00:00")
        self.assertEqual(e1.verdict, "待定")
        # 再来支持结果 2 → 5 vs 3 → 成立（再次翻转）
        _, _, e2 = self.ledger.record_outcome(
            self.d.decision_id, self.b_support, "晋升提名",
            "supports", 2, "主管邮件", "2026-04-01T09:00:00")
        self.assertEqual(e2.verdict, "成立")
        self.assertEqual(
            [e.verdict for e in self.ledger.conclusion_trajectory(self.d.decision_id)],
            ["待定", "成立", "待定", "成立"])


# 需求 5：矛盾必须双方保留并生成可读冲突记录 ============================== #

class Requirement5ConflictTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00"))
        # 立场混合的真实场景：供应商承诺（支持，4）vs 同事提醒历史常延期（反对，2）
        self.d, ids = build_chosen_decision(
            self.ledger,
            bases=(("供应商承诺", 4.0, "supports", "对方承诺三个月交付"),
                   ("同事提醒", 2.0, "contradicts", "该供应商历史上常延期")))
        self.b_support, self.b_against = ids

    def test_contradictory_outcome_keeps_both_and_records_conflict(self):
        outcome, conflicts, _ = self.ledger.record_outcome(
            self.d.decision_id, self.b_support, "第五个月仍未交付",
            "contradicts", 5, "现场验收单", "2026-06-01T09:00:00")
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        # 冲突记录指出矛盾的依据、结果与分歧点
        self.assertEqual(c.basis_evidence_id, self.b_support)
        self.assertEqual(c.outcome_id, outcome.outcome_id)
        self.assertEqual(c.result_evidence_id, outcome.evidence_id)
        self.assertIn(self.b_support, c.point)
        self.assertIn(outcome.outcome_id, c.point)
        self.assertIn("立场对立", c.point)
        self.assertIn("第五个月仍未交付", c.point)

        d = self.ledger.get_decision(self.d.decision_id)
        # 旧依据没有被覆盖或删除
        self.assertIn(self.b_support, d.evidences)
        self.assertEqual(d.evidences[self.b_support].content, "对方承诺三个月交付")
        # 新结果也在
        self.assertIn(outcome.evidence_id, d.evidences)
        # 双向挂接
        self.assertIn(c.conflict_id, d.conflict_ids)
        self.assertIn(c.conflict_id, outcome.conflicts)

    def test_consistent_outcome_generates_no_conflict(self):
        # 单一立场的决策：唯一依据支持，结果也支持 → 无冲突
        d, (only,) = build_chosen_decision(
            self.ledger, topic="供应商乙是否合作",
            bases=(("尽调报告", 3.0, "supports", "交付记录良好"),))
        _, conflicts, _ = self.ledger.record_outcome(
            d.decision_id, only, "提前两周交付",
            "supports", 3, "验收单", "2026-03-15T09:00:00")
        self.assertEqual(conflicts, [])
        self.assertEqual(self.ledger.list_conflicts(d.decision_id), [])

    def test_conflict_against_every_opposing_basis(self):
        # 两条都是支持依据，反对结果到达 → 与两条依据分别冲突，逐条点名
        d, ids = build_chosen_decision(
            self.ledger, topic="供应商丙是否合作",
            bases=(("书面承诺", 4.0, "supports", "承诺三个月交付"),
                   ("销售口头保证", 1.0, "supports", "拍胸脯说没问题")))
        outcome, conflicts, _ = self.ledger.record_outcome(
            d.decision_id, ids[0], "严重延期",
            "contradicts", 5, "验收单", "2026-06-01T09:00:00")
        self.assertEqual(len(conflicts), 2)
        named = {c.basis_evidence_id for c in conflicts}
        self.assertEqual(named, set(ids))
        # 每条冲突都指向同一个结果
        self.assertTrue(all(c.outcome_id == outcome.outcome_id for c in conflicts))

    def test_conflict_recorded_even_when_verdict_does_not_flip(self):
        # setUp 中支持 4 vs 反对 2，结论成立；加一条权重 0.1 的反对结果，
        # 结论仍成立，但与承诺依据的矛盾照样记录
        _, conflicts, new_entry = self.ledger.record_outcome(
            self.d.decision_id, self.b_support, "小瑕疵",
            "contradicts", 0.1, "周报", "2026-02-01T09:00:00")
        self.assertEqual(len(conflicts), 1)
        self.assertIsNone(new_entry)


# 需求 6：经验固化与引用 ================================================== #

class Requirement6LessonTests(unittest.TestCase):

    def setUp(self):
        self.ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                             "2026-03-01T10:00:00"))
        self.d, ids = build_chosen_decision(self.ledger)
        self.b1, self.b2 = ids
        self.outcome, _, _ = self.ledger.record_outcome(
            self.d.decision_id, self.b1, "外派收益超预期",
            "supports", 4, "年度复盘", "2026-03-01T09:00:00")

    def test_crystallize_freezes_conclusion_with_supporting_chain(self):
        lesson = self.ledger.crystallize_lesson(
            self.d.decision_id, "高确定性涨薪值得去", "满足家庭沟通前提下优先选择")
        self.assertTrue(lesson.lesson_id.startswith("L-"))
        self.assertEqual(lesson.source_decision_id, self.d.decision_id)
        self.assertEqual(lesson.verdict, "成立")
        self.assertIn(self.b1, lesson.evidence_ids)
        self.assertIn(self.outcome.outcome_id, lesson.outcome_ids)
        # 反对面证据不进支撑链
        self.assertNotIn(self.b2, lesson.evidence_ids)

    def test_crystallize_pending_verdict_rejected(self):
        d = self.ledger.create_decision("没依据的事", created_at="2026-05-01T09:00:00")
        self.ledger.mark_chosen(d.decision_id, "随便")  # 无依据 → 结论待定
        with self.assertRaises(ValidationError) as ctx:
            self.ledger.crystallize_lesson(d.decision_id, "t", "c")
        self.assertIn("待定", str(ctx.exception))

    def test_later_decision_can_cite_lesson(self):
        lesson = self.ledger.crystallize_lesson(
            self.d.decision_id, "高确定性涨薪值得去", "……")
        d2 = self.ledger.create_decision("是否接受异地调动",
                                         created_at="2026-04-01T09:00:00")
        self.ledger.cite_lesson(d2.decision_id, lesson.lesson_id)
        self.assertIn(lesson.lesson_id,
                      self.ledger.get_decision(d2.decision_id).cited_lesson_ids)
        self.assertEqual(
            self.ledger.lesson_references(lesson.lesson_id)["cited_by"],
            [d2.decision_id])

    def test_cite_nonexistent_lesson_rejected(self):
        with self.assertRaises(NotFoundError) as ctx:
            self.ledger.cite_lesson(self.d.decision_id, "L-9999")
        self.assertIn("不存在", str(ctx.exception))
        self.assertIn("L-9999", str(ctx.exception))

    def test_duplicate_citation_rejected(self):
        lesson = self.ledger.crystallize_lesson(
            self.d.decision_id, "t", "c")
        self.ledger.cite_lesson(self.d.decision_id, lesson.lesson_id)
        with self.assertRaises(ConflictError):
            self.ledger.cite_lesson(self.d.decision_id, lesson.lesson_id)


# 需求 7：查询接口与稳定顺序 ============================================== #

class Requirement7QueryStabilityTests(unittest.TestCase):

    def test_reasoning_chain_stable_order(self):
        ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00"))
        d, ids = build_chosen_decision(
            ledger,
            bases=(("B源", 1, "supports", "x"),
                   ("A源", 1, "contradicts", "y"),
                   ("C源", 1, "supports", "z")))
        # 两条结果：登记顺序与发生时刻故意错开
        o1, _, _ = ledger.record_outcome(
            d.decision_id, ids[0], "晚发生", "supports", 1, "s",
            "2026-05-01T09:00:00")
        o2, _, _ = ledger.record_outcome(
            d.decision_id, ids[0], "早发生", "contradicts", 1, "s",
            "2026-03-01T09:00:00")
        chain = ledger.reasoning_chain(d.decision_id)
        kinds_order = [(c["kind"], c["evidence_id"]) for c in chain]
        # 依据按标识升序在前；结果按发生时刻升序在后（早发生的 o2 在前）
        self.assertEqual(
            kinds_order,
            [("basis", ids[0]), ("basis", ids[1]), ("basis", ids[2]),
             ("result", o2.evidence_id), ("result", o1.evidence_id)])
        # 贡献分值带符号
        self.assertEqual(chain[0]["contributes_score"], 1.0)
        self.assertEqual(chain[1]["contributes_score"], -1.0)

    def test_trajectory_and_refs_return_stable_sorted(self):
        ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                        "2026-01-06T10:00:00"))
        d, (b1, _) = build_chosen_decision(ledger)
        ledger.record_outcome(d.decision_id, b1, "好结果",
                              "contradicts", 5, "s", "2026-03-01T09:00:00")
        traj = ledger.conclusion_trajectory(d.decision_id)
        self.assertEqual([e.version for e in traj], [0, 1, 2])  # 版本升序
        # 逐版核对触发来源：v0 初始、v1 决策作出时初判、v2 由反对结果触发
        self.assertIsNone(traj[0].triggering_outcome_id)
        self.assertIsNone(traj[1].triggering_outcome_id)
        self.assertEqual(traj[2].triggering_outcome_id,
                         ledger.get_decision(d.decision_id).outcome_list()[0].outcome_id)

        lesson = ledger.crystallize_lesson(d.decision_id, "t", "c")
        # 乱序引用两次
        d2 = ledger.create_decision("二", created_at="2026-05-01T09:00:00")
        d3 = ledger.create_decision("三", created_at="2026-05-02T09:00:00")
        ledger.cite_lesson(d3.decision_id, lesson.lesson_id)
        ledger.cite_lesson(d2.decision_id, lesson.lesson_id)
        refs = ledger.lesson_references(lesson.lesson_id)["cited_by"]
        self.assertEqual(refs, sorted(refs))  # 稳定升序
        self.assertEqual(refs, [d2.decision_id, d3.decision_id])
        # 列表接口也稳定
        self.assertEqual([x.decision_id for x in ledger.list_decisions()],
                         sorted(x.decision_id for x in ledger.list_decisions()))

    def test_historical_chain_snapshot_excludes_later_evidence(self):
        ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                        "2026-01-06T10:00:00"))
        d, (b1, _) = build_chosen_decision(ledger)
        outcome, _, _ = ledger.record_outcome(
            d.decision_id, b1, "反转", "contradicts", 5, "s",
            "2026-03-01T09:00:00")
        chain_v1 = ledger.reasoning_chain(d.decision_id, version=1)
        # v1 快照只有两条依据；晚到的结果证据标记为不在该版本
        for item in chain_v1:
            if item["kind"] == "basis":
                self.assertTrue(item["in_version_snapshot"], item["evidence_id"])
            else:
                self.assertEqual(item["evidence_id"], outcome.evidence_id)
                self.assertFalse(item["in_version_snapshot"])


# 持久化往返 ============================================================= #

class PersistenceTests(unittest.TestCase):

    def test_full_roundtrip(self):
        ledger = Ledger(clock=FakeClock("2026-01-06T10:00:00",
                                        "2026-01-06T10:00:00",
                                        "2026-01-06T10:00:00"))
        d, (b1, b2) = build_chosen_decision(ledger)
        outcome, conflicts, _ = ledger.record_outcome(
            d.decision_id, b1, "延期", "contradicts", 5, "验收单",
            "2026-06-01T09:00:00")
        lesson = ledger.crystallize_lesson(d.decision_id, "承诺要留痕", "……")
        d2 = ledger.create_decision("新决策", created_at="2026-07-01T09:00:00")
        ledger.cite_lesson(d2.decision_id, lesson.lesson_id)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "ledger.json"
            store.save(ledger, path)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw["version"], 1)
            loaded = store.load(path)

        self.assertEqual(loaded.current_conclusion(d.decision_id).verdict,
                         ledger.current_conclusion(d.decision_id).verdict)
        self.assertEqual(len(loaded.list_conflicts()), 1)
        self.assertEqual(loaded.list_conflicts()[0].point, conflicts[0].point)
        self.assertEqual(loaded.get_lesson(lesson.lesson_id).cited_by,
                         [d2.decision_id])
        self.assertEqual(
            loaded.get_decision(d.decision_id).outcomes[outcome.outcome_id].basis_id,
            b1)


# CLI 端到端冒烟 ========================================================= #

class CliSmokeTests(unittest.TestCase):

    def run_cli(self, *argv):
        return cli_main(["--file", str(self.path), *argv])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "cli_ledger.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_cli_full_flow(self):
        self.assertEqual(self.run_cli("add-decision", "--topic", "是否跳槽",
                                      "--at", "2026-01-01T09:00:00"), 0)
        self.assertEqual(self.run_cli(
            "add-basis", "D-0001", "--source", "offer", "--weight", "3",
            "--stance", "supports", "--content", "涨薪"), 0)
        self.assertEqual(self.run_cli(
            "choose", "D-0001", "--option", "跳槽",
            "--at", "2026-01-02T09:00:00"), 0)
        self.assertEqual(self.run_cli(
            "outcome", "D-0001", "--basis", "D-0001.B01",
            "--value", "试用期通过", "--stance", "supports",
            "--weight", "4", "--source", "主管",
            "--at", "2026-04-01T18:00:00"), 0)
        self.assertEqual(self.run_cli(
            "lesson", "D-0001", "--title", "涨薪幅度要超迁移成本",
            "--content", "……"), 0)
        self.assertEqual(self.run_cli("show", "D-0001"), 0)
        self.assertEqual(self.run_cli("chain", "D-0001"), 0)
        self.assertEqual(self.run_cli("trajectory", "D-0001"), 0)
        self.assertEqual(self.run_cli("lessons"), 0)

    def test_cli_illegal_flow_returns_error_and_message(self):
        self.run_cli("add-decision", "--topic", "X")
        rc = self.run_cli("review", "D-0001")
        self.assertEqual(rc, 1)

    def test_cli_cite_missing_lesson_rejected(self):
        self.run_cli("add-decision", "--topic", "X")
        rc = self.run_cli("cite", "D-0001", "--lesson", "L-9999")
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
