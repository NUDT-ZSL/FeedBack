"""影响评估内核单元测试（纯标准库 unittest，可离线运行）。

运行：python -m unittest discover -s tests -v
"""

import unittest

from impact_kernel import (
    Clause,
    Condition,
    DiffKind,
    Effect,
    ExplainStatus,
    FlipType,
    ImpactKernel,
    Policy,
    Rule,
    ValidationError,
    evaluate,
    explain_flip,
)

SCHEMA = {"user": "str", "age": "int", "vip": "bool", "score": "float"}


def make_kernel():
    return ImpactKernel(SCHEMA)


def rule(rid, priority, effect, clauses=(), enabled=True):
    return Rule(
        rule_id=rid,
        priority=priority,
        condition=Condition(tuple(clauses)),
        effect=effect,
        enabled=enabled,
    )


def eq(attr, value):
    return Clause(attr, "eq", value)


# ----------------------------------------------------------------------
# 需求 1：请求维护与校验
# ----------------------------------------------------------------------
class TestRequestValidation(unittest.TestCase):
    def test_add_request_ok(self):
        k = make_kernel()
        req = k.add_request("r1", {"user": "a", "age": 1, "vip": False, "score": 1.5})
        self.assertEqual(req.request_id, "r1")
        self.assertEqual(k.request_ids(), ("r1",))

    def test_missing_attribute_rejected_with_location(self):
        k = make_kernel()
        with self.assertRaises(ValidationError) as ctx:
            k.add_request("r1", {"user": "a", "age": 1, "vip": True})
        msg = str(ctx.exception)
        self.assertIn("r1", msg)          # 指出请求位置
        self.assertIn("score", msg)       # 指出缺失的属性

    def test_wrong_type_rejected_with_location(self):
        k = make_kernel()
        with self.assertRaises(ValidationError) as ctx:
            k.add_request("r1", {"user": "a", "age": "三十", "vip": True, "score": 1.0})
        msg = str(ctx.exception)
        self.assertIn("r1", msg)
        self.assertIn("age", msg)
        self.assertIn("int", msg)

    def test_bool_is_not_accepted_as_int(self):
        k = make_kernel()
        with self.assertRaises(ValidationError):
            k.add_request("r1", {"user": "a", "age": True, "vip": True, "score": 1.0})

    def test_unknown_attribute_rejected(self):
        k = make_kernel()
        with self.assertRaises(ValidationError) as ctx:
            k.add_request(
                "r1",
                {"user": "a", "age": 1, "vip": True, "score": 1.0, "ghost": 1},
            )
        self.assertIn("ghost", str(ctx.exception))

    def test_duplicate_request_id_rejected(self):
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 1, "vip": True, "score": 1.0})
        with self.assertRaises(ValidationError) as ctx:
            k.add_request("r1", {"user": "b", "age": 2, "vip": False, "score": 2.0})
        self.assertIn("r1", str(ctx.exception))


# ----------------------------------------------------------------------
# 需求 2：策略与规则校验
# ----------------------------------------------------------------------
class TestPolicyValidation(unittest.TestCase):
    def test_condition_referencing_unknown_attribute_rejected(self):
        k = make_kernel()
        with self.assertRaises(ValidationError) as ctx:
            k.load_policy("old", [rule("R1", 1, Effect.DENY, [eq("ghost", "x")])])
        msg = str(ctx.exception)
        self.assertIn("R1", msg)
        self.assertIn("ghost", msg)

    def test_duplicate_rule_id_rejected(self):
        k = make_kernel()
        with self.assertRaises(ValidationError) as ctx:
            k.load_policy("old", [rule("R1", 1, Effect.DENY), rule("R1", 2, Effect.ALLOW)])
        self.assertIn("R1", str(ctx.exception))

    def test_clause_value_type_mismatch_rejected(self):
        k = make_kernel()
        with self.assertRaises(ValidationError):
            k.load_policy("old", [rule("R1", 1, Effect.DENY, [eq("age", "abc")])])

    def test_ordering_comparison_on_bool_rejected(self):
        k = make_kernel()
        with self.assertRaises(ValidationError):
            k.load_policy(
                "old", [rule("R1", 1, Effect.DENY, [Clause("vip", "gt", False)])]
            )

    def test_in_operator_validates_element_types(self):
        k = make_kernel()
        with self.assertRaises(ValidationError):
            k.load_policy(
                "old", [rule("R1", 1, Effect.DENY, [Clause("user", "in", ["a", 1])])]
            )
        # 合法 in 条件可以通过
        k.load_policy("ok", [rule("R1", 1, Effect.DENY, [Clause("user", "in", ["a"])])])


# ----------------------------------------------------------------------
# 需求 3：生效规则选取与默认效果
# ----------------------------------------------------------------------
class TestEvaluation(unittest.TestCase):
    def setUp(self):
        self.k = make_kernel()
        self.k.add_request("r1", {"user": "a", "age": 20, "vip": True, "score": 9.0})

    def test_highest_priority_wins(self):
        self.k.load_policy("new", [
            rule("R-low", 1, Effect.ALLOW),
            rule("R-high", 10, Effect.DENY),
        ])
        trace = self.k.decision_basis("r1", "new")
        self.assertEqual(trace.decision.effective_rule_id, "R-high")
        self.assertEqual(trace.decision.effect, Effect.DENY)

    def test_tie_broken_by_lexicographic_rule_id(self):
        self.k.load_policy("new", [
            rule("R-b", 5, Effect.DENY),
            rule("R-a", 5, Effect.ALLOW),
        ])
        trace = self.k.decision_basis("r1", "new")
        self.assertEqual(trace.decision.effective_rule_id, "R-a")

    def test_disabled_rule_never_matches(self):
        self.k.load_policy("new", [
            rule("R-off", 99, Effect.DENY, enabled=False),
            rule("R-on", 1, Effect.ALLOW),
        ])
        trace = self.k.decision_basis("r1", "new")
        self.assertEqual(trace.decision.effective_rule_id, "R-on")

    def test_default_effect_when_no_match(self):
        self.k.load_policy("new", [rule("R1", 1, Effect.ALLOW, [eq("user", "nobody")])])
        trace = self.k.decision_basis("r1", "new")
        self.assertTrue(trace.decision.used_default)
        self.assertIsNone(trace.decision.effective_rule_id)
        self.assertEqual(trace.decision.effect, Effect.DENY)  # 文档默认：拒绝

    def test_default_effect_configurable(self):
        k = ImpactKernel(SCHEMA, default_effect=Effect.ALLOW)
        k.add_request("r1", {"user": "a", "age": 1, "vip": False, "score": 1.0})
        k.load_policy("new", [])
        self.assertEqual(k.decision_basis("r1", "new").decision.effect, Effect.ALLOW)


# ----------------------------------------------------------------------
# 需求 4：批量重放与逐条独立判定一致
# ----------------------------------------------------------------------
class TestReplay(unittest.TestCase):
    def setUp(self):
        self.k = make_kernel()
        # 故意乱序插入，验证输出顺序稳定
        for rid, user, age in [("r3", "c", 40), ("r1", "a", 20), ("r2", "b", 15)]:
            self.k.add_request(rid, {"user": user, "age": age, "vip": False, "score": 1.0})
        self.k.load_policy("old", [rule("R-adult", 10, Effect.ALLOW, [Clause("age", "ge", 18)])])
        self.k.load_policy("new", [
            rule("R-adult", 10, Effect.ALLOW, [Clause("age", "ge", 21)]),
            rule("R-vip", 5, Effect.ALLOW, [eq("vip", True)]),
        ])

    def test_replay_matches_independent_evaluation(self):
        result = self.k.replay()
        for comp in result.comparisons:
            old_trace = self.k.decision_basis(comp.request_id, "old")
            new_trace = self.k.decision_basis(comp.request_id, "new")
            self.assertEqual(comp.old_decision, old_trace.decision)
            self.assertEqual(comp.new_decision, new_trace.decision)
            self.assertEqual(comp.flipped, old_trace.decision != new_trace.decision)

    def test_replay_output_sorted_by_request_id(self):
        result = self.k.replay()
        ids = [c.request_id for c in result.comparisons]
        self.assertEqual(ids, sorted(ids))

    def test_flip_detection(self):
        result = self.k.replay()
        by_id = {c.request_id: c for c in result.comparisons}
        # r1: age=20，旧 ge 18 命中 ALLOW，新 ge 21 不命中 → 默认 DENY，翻转
        self.assertTrue(by_id["r1"].flipped)
        self.assertEqual(by_id["r1"].flip_type, FlipType.NEW_DENY)
        # r2: age=15，新旧都不命中 → 默认 DENY，未翻转
        self.assertFalse(by_id["r2"].flipped)
        # r3: age=40，新旧都命中 → 未翻转
        self.assertFalse(by_id["r3"].flipped)


# ----------------------------------------------------------------------
# 需求 5：最小规则差异集合归因
# ----------------------------------------------------------------------
class TestExplain(unittest.TestCase):
    def test_removed_rule_is_minimal_explanation(self):
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [
            rule("R-allow", 10, Effect.ALLOW),
            rule("R-noise", 1, Effect.AUDIT, [eq("user", "nobody")]),
        ])
        k.load_policy("new", [rule("R-noise", 1, Effect.AUDIT, [eq("user", "nobody")])])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
        self.assertTrue(exp.unique)
        self.assertEqual(len(exp.minimal_diffs), 1)
        self.assertEqual(exp.minimal_diffs[0].rule_id, "R-allow")
        self.assertIn("R-allow", exp.reason)

    def test_two_diffs_both_necessary(self):
        """优先级下调 + 新规则上位：单独任一差异都不足以翻转，最小集合大小为 2。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [rule("R-allow", 10, Effect.ALLOW)])
        k.load_policy("new", [
            rule("R-allow", 1, Effect.ALLOW),       # 差异1：优先级 10 → 1
            rule("R-deny", 5, Effect.DENY),          # 差异2：新增拒绝规则
        ])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
        self.assertEqual(len(exp.minimal_diffs), 2)
        self.assertEqual(
            {d.rule_id for d in exp.minimal_diffs}, {"R-allow", "R-deny"}
        )

    def test_not_flipped_request(self):
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [rule("R1", 1, Effect.ALLOW)])
        k.load_policy("new", [rule("R1", 1, Effect.ALLOW), rule("R2", 2, Effect.DENY, [eq("user", "x")])])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.NOT_FLIPPED)


# ----------------------------------------------------------------------
# 需求 6：优先级互换 / 条件重叠 → 生效规则替换与翻转分类
# ----------------------------------------------------------------------
class TestFlipClassification(unittest.TestCase):
    def setUp(self):
        self.k = make_kernel()
        self.k.add_request("r1", {"user": "a", "age": 20, "vip": True, "score": 1.0})

    def test_priority_swap_detects_effective_rule_replacement(self):
        """两条同效果规则优先级互换：放行结论不变，生效规则被替换 → 仅审计变化。"""
        self.k.load_policy("old", [
            rule("R-audit", 10, Effect.AUDIT),
            rule("R-allow", 5, Effect.ALLOW),
        ])
        self.k.load_policy("new", [
            rule("R-audit", 5, Effect.AUDIT),
            rule("R-allow", 10, Effect.ALLOW),
        ])
        comp = self.k.replay().comparisons[0]
        self.assertTrue(comp.flipped)
        self.assertTrue(comp.effective_rule_changed)
        self.assertEqual(comp.flip_type, FlipType.AUDIT_ONLY)
        self.assertEqual(comp.old_decision.effective_rule_id, "R-audit")
        self.assertEqual(comp.new_decision.effective_rule_id, "R-allow")

    def test_overlapping_conditions_new_deny(self):
        """条件重叠：新增高优先级拒绝规则覆盖原有放行 → 新增拒绝。"""
        self.k.load_policy("old", [rule("R-allow", 5, Effect.ALLOW)])
        self.k.load_policy("new", [
            rule("R-allow", 5, Effect.ALLOW),
            rule("R-deny-vip", 8, Effect.DENY, [eq("vip", True)]),
        ])
        comp = self.k.replay().comparisons[0]
        self.assertEqual(comp.flip_type, FlipType.NEW_DENY)

    def test_new_allow(self):
        self.k.load_policy("old", [rule("R-deny", 5, Effect.DENY)])
        self.k.load_policy("new", [rule("R-deny", 5, Effect.DENY, [eq("user", "x")])])
        comp = self.k.replay().comparisons[0]
        # 旧 DENY（规则命中）→ 新 DENY（默认效果）：结论未变但生效依据变了 → 仅审计变化
        self.assertTrue(comp.flipped)
        self.assertEqual(comp.flip_type, FlipType.AUDIT_ONLY)
        self.assertTrue(comp.effective_rule_changed)
        # 调整默认效果为 ALLOW 再验证新增放行
        k2 = ImpactKernel(SCHEMA, default_effect=Effect.ALLOW)
        k2.add_request("r1", {"user": "a", "age": 20, "vip": True, "score": 1.0})
        k2.load_policy("old", [rule("R-deny", 5, Effect.DENY)])
        k2.load_policy("new", [rule("R-deny", 5, Effect.DENY, [eq("user", "x")])])
        comp2 = k2.replay().comparisons[0]
        self.assertEqual(comp2.flip_type, FlipType.NEW_ALLOW)


# ----------------------------------------------------------------------
# 默认效果变化的归因（独立用例）
# ----------------------------------------------------------------------
class TestDefaultEffectAttribution(unittest.TestCase):
    """两侧都无规则命中、仅默认效果不同时，翻转必须归因到默认效果差异。"""

    def setUp(self):
        self.k = ImpactKernel(SCHEMA, default_effect=Effect.ALLOW)
        self.k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        self.k.add_request("r2", {"user": "b", "age": 30, "vip": True, "score": 2.0})
        # 两套策略规则完全相同且都不命中任何请求，仅默认效果 ALLOW → DENY
        rules = [rule("R-nomatch", 1, Effect.DENY, [eq("user", "nobody")])]
        self.k.load_policy("old", rules)
        self.k.load_policy("new", rules, default_effect=Effect.DENY)

    def test_flip_attributed_to_default_change(self):
        for rid in ("r1", "r2"):
            exp = self.k.explain_flip(rid)
            self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
            self.assertTrue(exp.unique)
            self.assertEqual(len(exp.minimal_diffs), 1)
            diff = exp.minimal_diffs[0]
            self.assertEqual(diff.kind, DiffKind.DEFAULT_CHANGED)
            self.assertIsNone(diff.rule_id)
            self.assertIn("默认效果", exp.reason)
            # 不能报无法归因或歧义
            self.assertNotEqual(exp.status, ExplainStatus.UNATTRIBUTABLE)
            self.assertNotEqual(exp.status, ExplainStatus.AMBIGUOUS)

    def test_reason_does_not_claim_phantom_rule(self):
        exp = self.k.explain_flip("r1")
        self.assertNotIn("None", exp.reason)  # 生效规则不能显示为 'None'
        self.assertIn("无规则命中", exp.reason)

    def test_replay_consistent_with_default_change(self):
        result = self.k.replay()
        self.assertEqual(result.stats.flipped, 2)
        self.assertEqual(result.stats.new_deny, 2)
        for comp in result.comparisons:
            self.assertTrue(comp.old_decision.used_default)
            self.assertTrue(comp.new_decision.used_default)
            self.assertEqual(comp.old_decision.effect, Effect.ALLOW)
            self.assertEqual(comp.new_decision.effect, Effect.DENY)


# ----------------------------------------------------------------------
# 规则停用 / 启用导致的翻转归因（独立用例）
# ----------------------------------------------------------------------
class TestEnableDisableAttribution(unittest.TestCase):
    def test_disable_rule_falls_back_to_default(self):
        """停用唯一命中的规则 → 请求改走默认效果，归因到该规则的启用状态差异。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [rule("R-allow", 10, Effect.ALLOW)])
        k.load_policy("new", [rule("R-allow", 10, Effect.ALLOW, enabled=False)])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
        self.assertTrue(exp.unique)
        self.assertEqual(len(exp.minimal_diffs), 1)
        diff = exp.minimal_diffs[0]
        self.assertEqual(diff.kind, DiffKind.MODIFIED)
        self.assertEqual(diff.rule_id, "R-allow")
        self.assertTrue(diff.before.enabled)
        self.assertFalse(diff.after.enabled)
        self.assertIn("停用", exp.reason)
        self.assertIn("默认效果", exp.reason)  # 说明替换后的去向
        comp = k.replay().comparisons[0]
        self.assertEqual(comp.flip_type, FlipType.NEW_DENY)

    def test_disable_rule_falls_back_to_other_rule(self):
        """停用高优先级规则 → 请求改走另一条规则，说明替换后的生效规则。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [
            rule("R-deny", 10, Effect.DENY),
            rule("R-audit", 5, Effect.AUDIT),
        ])
        k.load_policy("new", [
            rule("R-deny", 10, Effect.DENY, enabled=False),
            rule("R-audit", 5, Effect.AUDIT),
        ])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
        self.assertEqual(len(exp.minimal_diffs), 1)
        self.assertEqual(exp.minimal_diffs[0].rule_id, "R-deny")
        self.assertIn("停用", exp.reason)
        self.assertIn("R-audit", exp.reason)  # 替换后的生效规则
        comp = k.replay().comparisons[0]
        self.assertEqual(comp.flip_type, FlipType.NEW_ALLOW)
        self.assertEqual(comp.new_decision.effective_rule_id, "R-audit")

    def test_enable_rule_takes_over(self):
        """启用原本停用的规则 → 请求从默认效果改由该规则命中。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [rule("R-allow", 10, Effect.ALLOW, enabled=False)])
        k.load_policy("new", [rule("R-allow", 10, Effect.ALLOW, enabled=True)])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.ATTRIBUTED)
        self.assertEqual(len(exp.minimal_diffs), 1)
        diff = exp.minimal_diffs[0]
        self.assertEqual(diff.rule_id, "R-allow")
        self.assertFalse(diff.before.enabled)
        self.assertTrue(diff.after.enabled)
        self.assertIn("启用", exp.reason)
        self.assertIn("R-allow", exp.reason)
        comp = k.replay().comparisons[0]
        self.assertEqual(comp.flip_type, FlipType.NEW_ALLOW)

    def test_enable_disable_does_not_change_unaffected_requests(self):
        """启停不命中的规则不影响其他请求的重放与查询结果。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.add_request("r2", {"user": "b", "age": 30, "vip": True, "score": 1.0})
        k.load_policy("old", [
            rule("R-vip", 10, Effect.AUDIT, [eq("vip", True)]),
            rule("R-all", 1, Effect.ALLOW),
        ])
        k.load_policy("new", [
            rule("R-vip", 10, Effect.AUDIT, [eq("vip", True)], enabled=False),
            rule("R-all", 1, Effect.ALLOW),
        ])
        result = k.replay()
        by_id = {c.request_id: c for c in result.comparisons}
        # r1 不被 R-vip 命中，决策不变
        self.assertFalse(by_id["r1"].flipped)
        self.assertEqual(by_id["r1"].old_decision, by_id["r1"].new_decision)
        # r2 从 AUDIT 变为 ALLOW → 仅审计变化
        self.assertEqual(by_id["r2"].flip_type, FlipType.AUDIT_ONLY)
        # 规则命中查询不受另一套策略影响
        hits_old = k.rule_hits("R-vip", "old")
        self.assertEqual([h.request_id for h in hits_old], ["r2"])
        self.assertEqual(k.rule_hits("R-vip", "new"), ())


# ----------------------------------------------------------------------
# 需求 7：无法归因与归因歧义
# ----------------------------------------------------------------------
class TestAttributionEdgeCases(unittest.TestCase):
    def test_empty_diff_unattributable(self):
        """差异集合为空但决策翻转 → 明确报告无法归因，不随便挑规则。"""
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [rule("R1", 1, Effect.ALLOW)])
        k.load_policy("new", [rule("R1", 1, Effect.DENY)])
        # 显式传入空差异集合，模拟"决策不一致但无差异可归"的异常场景
        exp = explain_flip(
            k._policies["old"], k._policies["new"], k._requests["r1"], diffs=(),
        )
        self.assertEqual(exp.status, ExplainStatus.UNATTRIBUTABLE)
        self.assertFalse(exp.unique)
        self.assertEqual(exp.minimal_diffs, ())
        self.assertIn("无法归因", exp.reason)

    def test_identical_policies_not_flipped(self):
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        rules = [rule("R1", 1, Effect.ALLOW)]
        k.load_policy("old", rules)
        k.load_policy("new", rules)
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.NOT_FLIPPED)

    def test_ambiguous_attribution_reported(self):
        """两个差异各自都足以复现同一新决策 → 报告歧义而非随便挑一条。

        旧：R-allow(10, ALLOW) 生效，R-deny(5, DENY) 被压制。
        新：R-allow 被删除，R-deny 优先级抬到 20。
        只应用"删除 R-allow"或只应用"抬高 R-deny"，都得到 R-deny 生效的 DENY，
        两组最小解释互斥，无法唯一归因。
        """
        k = make_kernel()
        k.add_request("r1", {"user": "a", "age": 20, "vip": False, "score": 1.0})
        k.load_policy("old", [
            rule("R-allow", 10, Effect.ALLOW),
            rule("R-deny", 5, Effect.DENY),
        ])
        k.load_policy("new", [rule("R-deny", 20, Effect.DENY)])
        exp = k.explain_flip("r1")
        self.assertEqual(exp.status, ExplainStatus.AMBIGUOUS)
        self.assertFalse(exp.unique)
        self.assertEqual(exp.minimal_diffs, ())  # 不随便挑一条
        self.assertIn("无法唯一归因", exp.reason)
        # 候选集合内容断言：恰为两个互斥的单元素集合
        self.assertEqual(len(exp.candidates), 2)
        for candidate in exp.candidates:
            self.assertEqual(len(candidate), 1)
        by_rule = {c[0].rule_id: c[0] for c in exp.candidates}
        self.assertEqual(set(by_rule), {"R-allow", "R-deny"})
        # 候选一：删除 R-allow（旧优先级 10 的放行规则）
        self.assertEqual(by_rule["R-allow"].kind, DiffKind.REMOVED)
        self.assertEqual(by_rule["R-allow"].before.priority, 10)
        self.assertIsNone(by_rule["R-allow"].after)
        # 候选二：抬高 R-deny 优先级 5 → 20
        self.assertEqual(by_rule["R-deny"].kind, DiffKind.MODIFIED)
        self.assertEqual(by_rule["R-deny"].before.priority, 5)
        self.assertEqual(by_rule["R-deny"].after.priority, 20)
        # 每个候选都必须能独立复现新决策（最小性由枚举保证，此处验证语义）
        for candidate in exp.candidates:
            self.assertIn(candidate[0].describe(), exp.reason)


# ----------------------------------------------------------------------
# 需求 8：查询接口与稳定顺序
# ----------------------------------------------------------------------
class TestQueries(unittest.TestCase):
    def setUp(self):
        self.k = make_kernel()
        for rid, user in [("r2", "b"), ("r1", "a"), ("r3", "c")]:
            self.k.add_request(rid, {"user": user, "age": 20, "vip": False, "score": 1.0})
        self.k.load_policy("old", [rule("R-all", 5, Effect.ALLOW)])
        self.k.load_policy("new", [
            rule("R-all", 5, Effect.ALLOW),
            rule("R-deny-b", 10, Effect.DENY, [eq("user", "b")]),
        ])

    def test_decision_basis(self):
        trace = self.k.decision_basis("r2", "new")
        self.assertEqual(trace.decision.effective_rule_id, "R-deny-b")
        self.assertEqual(trace.matched_rule_ids, ("R-deny-b", "R-all"))

    def test_rule_hits_sorted_and_effective_flag(self):
        hits = self.k.rule_hits("R-all", "new")
        self.assertEqual([h.request_id for h in hits], ["r1", "r2", "r3"])
        by_id = {h.request_id: h for h in hits}
        self.assertFalse(by_id["r2"].is_effective)  # 被 R-deny-b 压过
        self.assertTrue(by_id["r1"].is_effective)

    def test_rule_hits_unknown_rule_rejected(self):
        with self.assertRaises(ValidationError):
            self.k.rule_hits("R-ghost", "new")

    def test_flip_stats(self):
        stats = self.k.flip_stats()
        self.assertEqual(stats.total, 3)
        self.assertEqual(stats.flipped, 1)
        self.assertEqual(stats.new_deny, 1)
        self.assertEqual(stats.new_deny_requests, ("r2",))
        self.assertEqual(stats.new_allow_requests, ())
        self.assertEqual(stats.audit_only_requests, ())

    def test_unknown_ids_raise_with_location(self):
        with self.assertRaises(ValidationError):
            self.k.decision_basis("ghost", "new")
        with self.assertRaises(ValidationError):
            self.k.decision_basis("r1", "ghost-version")


if __name__ == "__main__":
    unittest.main()
