"""需求 3/4/6：结果登记的幂等性、只追加不覆盖、冲突保留、环境不可用。"""
import unittest

from envcompat import CompatibilityRunner, Matrix, Outcome, CellState
from envcompat.errors import (
    RegistrationError,
    UnknownCaseError,
    UnknownCombinationError,
)


def build_runner():
    matrix = Matrix([("os", ["linux", "windows"]), ("browser", ["chrome", "firefox"])])
    return CompatibilityRunner(
        matrix, groups=["g1"], cases=[("c1", "g1"), ("c2", "g1")]
    )


class TestRecordIdempotencyAndNoOverwrite(unittest.TestCase):
    def setUp(self):
        self.r = build_runner()
        self.combo = ("linux", "chrome")

    def test_first_record(self):
        self.assertEqual(self.r.record("c1", self.combo, "pass", source="ci-1"),
                         "recorded")
        self.assertIs(self.r.cell_state("c1", self.combo), CellState.EXECUTED)

    def test_same_source_same_outcome_is_idempotent(self):
        self.r.record("c1", self.combo, "pass", source="ci-1", reason="ok")
        again = self.r.record("c1", self.combo, "pass", source="ci-1", reason="different")
        self.assertEqual(again, "idempotent")
        s = self.r.summary()
        self.assertEqual(s.passed, 1)
        # 幂等重复不应留下第二条上报。
        conflict = self.r.conflicts()
        self.assertEqual(conflict, [])

    def test_later_pass_must_not_overwrite_earlier_fail_same_source(self):
        # 用户点名的痛点：先报失败，后报通过，不能把失败盖掉。
        first = self.r.record("c1", self.combo, "fail", source="ci-1", reason="断言失败")
        second = self.r.record("c1", self.combo, "pass", source="ci-1")
        self.assertEqual(first, "recorded")
        self.assertEqual(second, "conflict")
        self.assertIs(self.r.cell_state("c1", self.combo), CellState.CONFLICTED)

        conflicts = self.r.conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual(c.case_id, "c1")
        self.assertEqual(c.combination.coords, ("linux", "chrome"))
        outcomes = c.outcomes_present()
        self.assertCountEqual(outcomes, [Outcome.FAIL, Outcome.PASS])
        # 双方来源都要可读地呈现（此处是同一来源的两次上报，序号不同）。
        text = c.render()
        self.assertIn("ci-1", text)
        self.assertIn("fail", text)
        self.assertIn("pass", text)

        # 冲突单元格绝不能被算成通过。
        s = self.r.summary()
        self.assertEqual(s.passed, 0)
        self.assertEqual(s.conflicted, 1)
        self.assertEqual(s.executed, 1)

    def test_distinct_sources_agree_merge_to_one_conclusion(self):
        self.r.record("c1", self.combo, "pass", source="ci-1")
        result = self.r.record("c1", self.combo, "pass", source="ci-2")
        self.assertEqual(result, "recorded")
        self.assertIs(self.r.cell_state("c1", self.combo), CellState.EXECUTED)
        self.assertEqual(self.r.summary().passed, 1)

    def test_distinct_sources_conflict_keeps_both(self):
        self.r.record("c1", self.combo, "pass", source="ci-1")
        result = self.r.record("c1", self.combo, "fail", source="ci-2", reason="崩溃")
        self.assertEqual(result, "conflict")
        c = self.r.conflicts()[0]
        sources = {r.source for r in c.reports}
        self.assertEqual(sources, {"ci-1", "ci-2"})
        self.assertIn("ci-1", c.render())
        self.assertIn("ci-2", c.render())

    def test_fail_and_timeout_are_also_conflicting(self):
        self.r.record("c1", self.combo, "fail", source="a")
        self.assertEqual(self.r.record("c1", self.combo, "timeout", source="b"),
                         "conflict")

    def test_unknown_case_and_unknown_combination_rejected(self):
        with self.assertRaises(UnknownCaseError):
            self.r.record("nope", self.combo, "pass", source="x")
        with self.assertRaises(UnknownCombinationError):
            self.r.record("c1", ("plan9", "mosaic"), "pass", source="x")

    def test_invalid_outcome_rejected(self):
        with self.assertRaises(ValueError):
            self.r.record("c1", self.combo, "green", source="x")


class TestEnvironmentUnavailable(unittest.TestCase):
    def setUp(self):
        self.r = build_runner()
        self.combo = ("windows", "firefox")

    def test_mark_unavailable_marks_only_unreported_cases(self):
        # c1 在该组合已执行并通过，结论必须保留。
        self.r.record("c1", self.combo, "pass", source="ci-9")
        marked = self.r.mark_unavailable(self.combo, "浏览器节点离线")
        self.assertEqual(marked, ["c2"])  # 仅未上报的 c2
        self.assertIs(self.r.cell_state("c1", self.combo), CellState.EXECUTED)
        self.assertIs(self.r.cell_state("c2", self.combo), CellState.NOT_RUN)

    def test_not_run_is_never_counted_as_pass(self):
        self.r.record("c1", ("linux", "chrome"), "pass", source="ci")
        self.r.mark_unavailable(self.combo, "节点维护")
        s = self.r.summary()
        # 8 个单元格：1 通过，2 未执行（该组合两条），其余待上报。
        self.assertEqual(s.passed, 1)
        self.assertEqual(s.not_run, 2)
        self.assertEqual(
            s.executed, 1, "未执行不得计入已执行/通过率分母"
        )
        not_run_ids = {d.case_id for d in s.not_run_details}
        self.assertEqual(not_run_ids, {"c1", "c2"})
        for d in s.not_run_details:
            self.assertEqual(d.reason, "节点维护")
            self.assertEqual(d.source, "env-monitor")

    def test_report_after_unavailable_is_rejected(self):
        self.r.mark_unavailable(self.combo, "离线")
        with self.assertRaises(RegistrationError):
            self.r.record("c1", self.combo, "pass", source="late-ci")
        # 拒绝补报后仍是未执行，不会被洗成通过。
        self.assertIs(self.r.cell_state("c1", self.combo), CellState.NOT_RUN)

    def test_mark_requires_reason(self):
        with self.assertRaises(RegistrationError):
            self.r.mark_unavailable(self.combo, "   ")

    def test_mark_whole_dimension_value(self):
        result = self.r.mark_value_unavailable("os", "windows", "Windows 机房断电")
        # windows×{chrome,firefox} 两个组合，每个 2 条用例。
        self.assertEqual(len(result), 2)
        for ids in result.values():
            self.assertEqual(set(ids), {"c1", "c2"})
        s = self.r.summary()
        self.assertEqual(s.not_run, 4)
        self.assertEqual(s.executed, 0)

    def test_already_reported_conclusion_survives_value_unavailable(self):
        self.r.record("c1", ("windows", "chrome"), "fail", source="ci")
        self.r.mark_value_unavailable("os", "windows", "断电")
        self.assertIs(self.r.cell_state("c1", ("windows", "chrome")), CellState.EXECUTED)
        self.assertIs(self.r.cell_state("c2", ("windows", "chrome")), CellState.NOT_RUN)

    def test_new_case_registered_after_unavailable_is_not_run(self):
        self.r.add_group("g2")
        self.r.mark_unavailable(self.combo, "离线")
        self.r.add_cases([("c3", "g1")])
        self.assertIs(self.r.cell_state("c3", self.combo), CellState.NOT_RUN)


if __name__ == "__main__":
    unittest.main()
