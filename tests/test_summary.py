"""需求 5：双维度汇总、通过率分母、失败/未执行/冲突分节。"""
import unittest

from envcompat import CompatibilityRunner, Matrix, Outcome, CellState


class TestSummary(unittest.TestCase):
    def setUp(self):
        # 2(os) × 2(browser) = 4 个组合；2 条用例 -> 8 个单元格。
        self.matrix = Matrix([("os", ["linux", "windows"]),
                              ("browser", ["chrome", "firefox"])])
        self.r = CompatibilityRunner(
            self.matrix, groups=["g1"], cases=[("c1", "g1"), ("c2", "g1")]
        )

    def test_pass_rate_excludes_not_run_and_pending(self):
        self.r.record("c1", ("linux", "chrome"), "pass", source="a")
        self.r.record("c2", ("linux", "chrome"), "fail", source="a")
        self.r.mark_unavailable(("windows", "firefox"), "离线")
        s = self.r.summary()

        self.assertEqual(s.total_cells, 8)
        self.assertEqual(s.executed, 2)
        self.assertEqual(s.passed, 1)
        self.assertEqual(s.not_run, 2)
        self.assertEqual(s.pending, 4)
        # 分母是“已执行”2，而不是 8。
        self.assertEqual(float(s.rate), 0.5)
        self.assertEqual(s.rate_text, "1/2 = 50.0%")

    def test_rate_is_none_when_nothing_executed(self):
        s = self.r.summary()
        self.assertIsNone(s.rate)
        self.assertIn("N/A", s.rate_text)

    def test_by_case_dimension(self):
        self.r.record("c1", ("linux", "chrome"), "pass", source="a")
        self.r.record("c1", ("linux", "firefox"), "fail", source="a")
        s = self.r.summary()
        c1 = next(x for x in s.by_case if x.case_id == "c1")
        c2 = next(x for x in s.by_case if x.case_id == "c2")
        self.assertEqual((c1.passed, c1.executed, c1.failed), (1, 2, 1))
        self.assertEqual(c1.executed, 2)
        self.assertEqual(c2.executed, 0)
        self.assertEqual(len(c1.failures), 1)
        self.assertEqual(c1.failures[0].outcome, Outcome.FAIL)

    def test_by_combo_dimension(self):
        self.r.record("c1", ("linux", "chrome"), "pass", source="a")
        self.r.record("c2", ("linux", "chrome"), "timeout", source="a", reason="30s")
        s = self.r.summary()
        combo = next(x for x in s.by_combo
                     if x.combination.coords == ("linux", "chrome"))
        self.assertEqual(combo.passed, 1)
        self.assertEqual(combo.timeout, 1)
        self.assertEqual(combo.executed, 2)
        self.assertEqual(combo.failed, 0)  # 超时单列，不计入普通失败
        self.assertIn("timeout", combo.failures[0].outcome.value)

    def test_timeout_counts_as_executed_but_not_pass(self):
        self.r.record("c1", ("linux", "chrome"), "timeout", source="a")
        s = self.r.summary()
        self.assertEqual(s.executed, 1)
        self.assertEqual(s.passed, 0)
        self.assertEqual(s.timeout, 1)

    def test_skipped_counts_as_executed_but_not_pass_or_failure(self):
        self.r.record("c1", ("linux", "chrome"), "skipped", source="a",
                      reason="前置依赖缺失")
        s = self.r.summary()
        self.assertEqual(s.executed, 1)
        self.assertEqual(s.passed, 0)
        self.assertEqual(s.failed, 0)
        self.assertEqual(s.skipped, 1)
        self.assertEqual(s.failures, ())

    def test_failure_details_carry_reason_sources_and_location(self):
        self.r.record("c2", ("windows", "chrome"), "fail", source="ci-7",
                      reason="断言 x != y")
        s = self.r.summary()
        f = s.failures[0]
        self.assertEqual(f.case_id, "c2")
        self.assertEqual(f.combination.coords, ("windows", "chrome"))
        self.assertEqual(f.reason, "断言 x != y")
        self.assertEqual(f.sources, ("ci-7",))

    def test_not_run_listed_separately_with_reason(self):
        self.r.mark_unavailable(("windows", "chrome"), "机房断电")
        s = self.r.summary()
        self.assertEqual(len(s.not_run_details), 2)
        self.assertEqual({d.reason for d in s.not_run_details}, {"机房断电"})
        # 未执行绝不出现在失败明细，也不影响通过率。
        self.assertEqual(s.failures, ())
        self.assertIsNone(s.rate)

    def test_pending_listed_as_possible_missed_runs(self):
        s = self.r.summary()
        # 一条都没上报：8 个单元格全部疑似漏跑。
        self.assertEqual(len(s.pending_details), 8)

    def test_conflicts_listed_separately_and_excluded_from_pass_and_fail(self):
        self.r.record("c1", ("linux", "chrome"), "pass", source="a")
        self.r.record("c1", ("linux", "chrome"), "fail", source="b")
        s = self.r.summary()
        self.assertEqual(s.conflicted, 1)
        self.assertEqual(s.passed, 0)
        self.assertEqual(s.failed, 0)
        self.assertEqual(len(s.conflicts), 1)
        # 冲突单元格仍计入“已执行”，因为确实有执行结论，只是需要人工复核。
        self.assertEqual(s.executed, 1)

    def test_two_dimensions_totals_are_consistent(self):
        # 用例维度与组合维度是独立扫描两遍，总数必须对得上。
        self.r.record("c1", ("linux", "chrome"), "pass", source="a")
        self.r.record("c2", ("linux", "firefox"), "fail", source="a")
        self.r.record("c1", ("windows", "chrome"), "timeout", source="a")
        self.r.mark_unavailable(("windows", "firefox"), "离线")
        s = self.r.summary()
        self.assertEqual(sum(x.passed for x in s.by_case), s.passed)
        self.assertEqual(sum(x.passed for x in s.by_combo), s.passed)
        self.assertEqual(sum(x.executed for x in s.by_case), s.executed)
        self.assertEqual(sum(x.executed for x in s.by_combo), s.executed)
        self.assertEqual(sum(x.not_run for x in s.by_case), s.not_run)
        self.assertEqual(
            s.passed + s.failed + s.timeout + s.skipped + s.conflicted, s.executed
        )

    def test_rendered_report_contains_all_sections(self):
        self.r.record("c1", ("linux", "chrome"), "fail", source="a")
        self.r.record("c1", ("linux", "chrome"), "pass", source="b")
        self.r.mark_unavailable(("windows", "firefox"), "离线")
        text = self.r.summary().render_text()
        for section in ["总览", "按用例", "按环境组合", "失败明细",
                        "未执行清单", "冲突记录", "待上报"]:
            self.assertIn(section, text)


if __name__ == "__main__":
    unittest.main()
