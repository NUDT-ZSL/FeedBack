"""expr 模块的 unittest 测试集。"""

import unittest

from expr import Diagnostic, Node, check, evaluate, fold, parse


class TestParseEvaluate(unittest.TestCase):
    """parse/evaluate 签名与行为基线。"""

    def test_arithmetic_precedence(self):
        self.assertEqual(evaluate(parse("1+2*3")), 7.0)
        self.assertEqual(evaluate(parse("(1+2)*3")), 9.0)
        self.assertEqual(evaluate(parse("10/4")), 2.5)
        self.assertEqual(evaluate(parse("-3+1")), -2.0)
        self.assertEqual(evaluate(parse("2*-3")), -6.0)

    def test_variables_from_env(self):
        node = parse("x*2 + y")
        self.assertEqual(evaluate(node, {"x": 3, "y": 1}), 7.0)

    def test_missing_var_raises(self):
        with self.assertRaises(NameError):
            evaluate(parse("x + 1"))
        with self.assertRaises(NameError):
            evaluate(parse("x + 1"), {})

    def test_empty_expression_raises(self):
        with self.assertRaises(ValueError):
            parse("")
        with self.assertRaises(ValueError):
            parse("   ")

    def test_single_number(self):
        node = parse("42")
        self.assertEqual(node.kind, "num")
        self.assertEqual(evaluate(node), 42.0)


class TestFold(unittest.TestCase):
    def test_folds_constant_binop(self):
        node = fold(parse("1+2*3"))
        self.assertEqual(node.kind, "num")
        self.assertEqual(node.value, 7.0)
        self.assertEqual(node.children, [])

    def test_folds_unary(self):
        node = fold(parse("-(2+3)"))
        self.assertEqual(node.kind, "num")
        self.assertEqual(node.value, -5.0)

    def test_keeps_variable_branches(self):
        node = fold(parse("x + 1*2"))
        self.assertEqual(node.kind, "binop")
        self.assertEqual(node.value, "+")
        self.assertEqual(node.children[0].kind, "var")
        self.assertEqual(node.children[0].value, "x")
        # 常量子树仍然被折叠（1*2 -> 2）
        self.assertEqual(node.children[1].kind, "num")
        self.assertEqual(node.children[1].value, 2.0)

    def test_does_not_mutate_input(self):
        original = parse("1+2*3")
        snapshot = (original.kind, original.value,
                    [c.kind for c in original.children])
        fold(original)
        self.assertEqual(
            (original.kind, original.value, [c.kind for c in original.children]),
            snapshot,
        )
        self.assertEqual(original.children[1].kind, "binop")  # 2*3 未被就地替换

    def test_division_by_zero_keeps_structure(self):
        node = fold(parse("1/0"))
        self.assertEqual(node.kind, "binop")
        self.assertEqual(node.value, "/")
        self.assertEqual(node.error, "division_by_zero")
        self.assertEqual([c.kind for c in node.children], ["num", "num"])
        self.assertEqual([c.value for c in node.children], [1.0, 0.0])

    def test_division_by_zero_nested(self):
        # 除零子树不折叠，但整体结构保留，其余常量分支照常折叠
        node = fold(parse("1/0 + 2*3"))
        self.assertEqual(node.kind, "binop")
        self.assertEqual(node.children[0].error, "division_by_zero")
        self.assertEqual(node.children[1].kind, "num")
        self.assertEqual(node.children[1].value, 6.0)

    def test_overflow_not_folded(self):
        node = fold(parse("1e308*10"))
        self.assertEqual(node.kind, "binop")
        self.assertEqual(node.error, "overflow")

    def test_deep_nesting_ten_levels(self):
        node = fold(parse("(" * 10 + "1+2" + ")" * 10))
        self.assertEqual(node.kind, "num")
        self.assertEqual(node.value, 3.0)
        # 程序化构造的十层一元嵌套
        deep = Node("num", 5.0, [])
        for _ in range(10):
            deep = Node("unary", "-", [deep])
        folded = fold(deep)
        self.assertEqual(folded.kind, "num")
        self.assertEqual(folded.value, 5.0)  # 偶数次取负

    def test_refold_is_idempotent(self):
        once = fold(parse("1/0 + x"))
        twice = fold(once)
        self.assertEqual(once, twice)


class TestCheck(unittest.TestCase):
    def test_undefined_var_defined_none(self):
        # defined=None：所有变量都未定义
        diags = check(parse("x + y"), defined=None)
        self.assertEqual([d.code for d in diags],
                         ["undefined_var", "undefined_var"])
        self.assertEqual([d.path for d in diags], [(0,), (1,)])

    def test_undefined_var_empty_set(self):
        diags = check(parse("x + 1"), defined=set())
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0].code, "undefined_var")
        self.assertEqual(diags[0].path, (0,))

    def test_defined_var_passes(self):
        self.assertEqual(check(parse("x + 1"), defined={"x"}), [])
        self.assertEqual(check(parse("1 + 2"), defined=None), [])

    def test_division_by_zero(self):
        diags = check(parse("1/0"))
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0].code, "division_by_zero")
        self.assertEqual(diags[0].path, ())

    def test_division_by_nonzero_ok(self):
        self.assertEqual(check(parse("1/2")), [])
        # 右子树非常量（含变量）时不判定
        self.assertEqual(check(parse("1/x"), defined={"x"}), [])

    def test_overflow(self):
        diags = check(parse("1e308*10"))
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0].code, "overflow")
        self.assertEqual(diags[0].path, ())
        # 恰好 1e308 不算溢出
        self.assertEqual(check(parse("1e308")), [])
        self.assertEqual(check(parse("1e308+0")), [])

    def test_overflow_nested_path(self):
        diags = check(parse("1 + 1e308*10"))
        self.assertEqual([d.code for d in diags], ["overflow"])
        self.assertEqual(diags[0].path, (1,))

    def test_path_lexicographic_order(self):
        # (a+1)/(b-2)：a 在 (0,0)，b 在 (1,0)
        diags = check(parse("(a+1)/(b-2)"), defined=set())
        self.assertEqual([d.path for d in diags], [(0, 0), (1, 0)])
        self.assertTrue(all(d.code == "undefined_var" for d in diags))

    def test_mixed_problems_sorted(self):
        diags = check(parse("x + 1/0"), defined={"x"})
        self.assertEqual([(d.code, d.path) for d in diags],
                         [("division_by_zero", (1,))])

    def test_one_diagnostic_per_node(self):
        diags = check(parse("1/0"))
        self.assertEqual(len(diags), 1)

    def test_unknown_kind_raises(self):
        bad = Node("triple", None, [])
        with self.assertRaises(ValueError) as ctx:
            check(bad)
        self.assertIn("triple", str(ctx.exception))

    def test_deep_nesting_and_single_number(self):
        self.assertEqual(check(parse("(" * 10 + "1" + ")" * 10)), [])
        self.assertEqual(check(parse("7")), [])


class TestFoldCheckConsistency(unittest.TestCase):
    def test_fold_then_check_no_duplicate_division_by_zero(self):
        folded = fold(parse("1/0"))
        diags = check(folded)
        self.assertEqual(len(diags), 1)
        self.assertEqual(diags[0].code, "division_by_zero")
        self.assertEqual(diags[0].path, ())

    def test_fold_then_check_matches_check_alone(self):
        src = "x + 1/0"
        before = check(parse(src), defined=set())
        after = check(fold(parse(src)), defined=set())
        self.assertEqual(
            [(d.code, d.path) for d in before],
            [(d.code, d.path) for d in after],
        )
        self.assertEqual([d.code for d in after],
                         ["undefined_var", "division_by_zero"])

    def test_fold_then_check_overflow_consistent(self):
        src = "1e308*10 + y"
        before = check(parse(src), defined=set())
        after = check(fold(parse(src)), defined=set())
        self.assertEqual(
            [(d.code, d.path) for d in before],
            [(d.code, d.path) for d in after],
        )
        self.assertEqual([d.code for d in after],
                         ["overflow", "undefined_var"])

    def test_folded_constant_evaluates_same(self):
        src = "2*(3+4) - 10/5"
        self.assertEqual(
            evaluate(parse(src)), evaluate(fold(parse(src)))
        )


if __name__ == "__main__":
    unittest.main()
