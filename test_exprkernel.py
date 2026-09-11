"""exprkernel 的 unittest 套件。

覆盖：词法解析、语法解析、静态类型检查、循环引用/重复绑定、
求值语义、trace 生成与全部要求的边界/错误场景。纯标准库，
直接 ``python -m unittest test_exprkernel -v`` 运行。
"""

import math
import unittest

from exprkernel import Engine, ErrorCode, WarningCode
from exprkernel import lexer
from exprkernel import parser
from exprkernel.ast_nodes import Binary
from exprkernel.errors import KernelError
from exprkernel.registry import collect_vars


def parse_one(text):
    return parser.parse(text)


# ---------------------------------------------------------------------------
# 1. 词法解析
# ---------------------------------------------------------------------------
class LexerTests(unittest.TestCase):
    def test_number_forms_become_float(self):
        toks = lexer.tokenize("1 2.5 .5 1e3 1.2e-2")
        nums = [t for t in toks if t.type == lexer.TokenType.NUMBER]
        self.assertEqual([t.value for t in nums],
                         [1.0, 2.5, 0.5, 1000.0, 0.012])
        self.assertIsInstance(nums[0].value, float)

    def test_string_and_escapes(self):
        toks = lexer.tokenize("'a\\'b' \"x\\ty\\n\"")
        strings = [t for t in toks if t.type == lexer.TokenType.STRING]
        self.assertEqual([t.value for t in strings], ["a'b", "x\ty\n"])

    def test_unterminated_string(self):
        for text in ("'abc", "\"abc", "'ab\nc'"):
            with self.subTest(text=text):
                with self.assertRaises(KernelError) as cm:
                    lexer.tokenize(text)
                self.assertEqual(cm.exception.diagnostic.code,
                                 ErrorCode.LEX_UNTERMINATED_STRING)
                self.assertGreaterEqual(cm.exception.diagnostic.line, 1)
                self.assertGreaterEqual(cm.exception.diagnostic.column, 1)

    def test_invalid_char(self):
        with self.assertRaises(KernelError) as cm:
            lexer.tokenize("1 $ 2")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.LEX_INVALID_CHAR)

    def test_bad_number(self):
        with self.assertRaises(KernelError) as cm:
            lexer.tokenize("1.2.3")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.LEX_INVALID_NUMBER)
        with self.assertRaises(KernelError) as cm:
            lexer.tokenize("1e")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.LEX_INVALID_NUMBER)

    def test_infinite_literal_rejected_at_lex(self):
        for text in ("1e999", "-1e999"):
            with self.subTest(text=text), self.assertRaises(KernelError) as cm:
                lexer.tokenize(text)
            self.assertEqual(cm.exception.diagnostic.code,
                             ErrorCode.LEX_INVALID_NUMBER)

    def test_position_tracking_multiline(self):
        toks = lexer.tokenize("1 +\n  2")
        nums = [t for t in toks if t.type == lexer.TokenType.NUMBER]
        self.assertEqual((nums[0].line, nums[0].column), (1, 1))
        self.assertEqual((nums[1].line, nums[1].column), (2, 3))

    def test_operators_two_and_one_char(self):
        toks = lexer.tokenize("<= >= == != < > + - * / %")
        ops = [t.value for t in toks if t.type == lexer.TokenType.OP]
        self.assertEqual(ops, ["<=", ">=", "==", "!=", "<", ">",
                               "+", "-", "*", "/", "%"])


# ---------------------------------------------------------------------------
# 2. 语法解析
# ---------------------------------------------------------------------------
class ParserTests(unittest.TestCase):
    def test_precedence(self):
        tree = parse_one("1 + 2 * 3")
        self.assertIsInstance(tree, Binary)
        self.assertEqual(tree.op, "+")
        self.assertIsInstance(tree.right, Binary)
        self.assertEqual(tree.right.op, "*")

    def test_parentheses_override(self):
        tree = parse_one("(1 + 2) * 3")
        self.assertEqual(tree.op, "*")
        self.assertEqual(tree.left.op, "+")

    def test_comparison_non_associative_chain(self):
        # 1 < 2 < 3 被解析为左结合链（静态检查不允许跨类型；此处只验证结构）
        tree = parse_one("1 < 2 < 3")
        self.assertEqual(tree.op, "<")
        self.assertEqual(tree.left.op, "<")

    def test_not_and_unary_minus(self):
        tree = parse_one("not -1")
        self.assertEqual(tree.op, "not")
        self.assertEqual(tree.operand.op, "-")

    def test_function_call_ast(self):
        tree = parse_one("if(true, min(1, 2), 3)")
        self.assertEqual(tree.name, "if")
        self.assertEqual(len(tree.args), 3)
        self.assertEqual(tree.args[1].name, "min")

    def test_empty_and_whitespace(self):
        for text in ("", "   ", "\n\t"):
            with self.subTest(text=text), self.assertRaises(KernelError) as cm:
                parse_one(text)
            self.assertEqual(cm.exception.diagnostic.code,
                             ErrorCode.PARSE_EMPTY)

    def test_only_parens(self):
        with self.assertRaises(KernelError) as cm:
            parse_one("()")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_UNEXPECTED_TOKEN)

    def test_unclosed_paren(self):
        with self.assertRaises(KernelError) as cm:
            parse_one("(1 + 2")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_UNCLOSED_PAREN)

    def test_extra_paren_and_trailing(self):
        # 表达式开头的多余右括号属于意外 token
        with self.assertRaises(KernelError) as cm:
            parse_one(")")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_UNEXPECTED_TOKEN)
        # 完整表达式之后的右括号属于尾随 token
        with self.assertRaises(KernelError) as cm:
            parse_one("1)")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_TRAILING_TOKEN)
        with self.assertRaises(KernelError) as cm:
            parse_one("1 2")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_TRAILING_TOKEN)

    def test_illegal_variable_like_tokens(self):
        for text in ("1 + and", "true = 1", "min(1,)"):
            with self.subTest(text=text), self.assertRaises(KernelError):
                parse_one(text)

    def test_unknown_function(self):
        with self.assertRaises(KernelError) as cm:
            parse_one("frobnicate(1)")
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.STATIC_NOT_CALLABLE)

    def test_nesting_depth_guard(self):
        p = parser.Parser(lexer.tokenize("(" * 200 + "1" + ")" * 200),
                          max_depth=64)
        with self.assertRaises(KernelError) as cm:
            p.parse()
        self.assertEqual(cm.exception.diagnostic.code,
                         ErrorCode.PARSE_DEPTH_EXCEEDED)


# ---------------------------------------------------------------------------
# 3. 静态类型检查
# ---------------------------------------------------------------------------
class CheckerTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.engine.bind("n", 3)
        self.engine.bind("s", "hi")
        self.engine.bind("flag", True)

    def check(self, expr):
        return self.engine.check(expr)

    def test_undefined_collected_deduped_with_position(self):
        result = self.check("x + y + x")
        self.assertFalse(result.ok)
        names = [d.extra["name"] for d in result.undefined]
        self.assertEqual(names, ["x", "y"])  # 去重且保持首次出现顺序
        self.assertTrue(all(d.line >= 1 and d.column >= 1
                            for d in result.undefined))

    def test_arith_only_number(self):
        self.assertEqual(self.check("n + 1").type, "number")
        result = self.check("s + 1")
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_TYPE_MISMATCH)

    def test_comparison_same_type(self):
        self.assertEqual(self.check("n >= 1").type, "bool")
        self.assertEqual(self.check("s == 'a'").type, "bool")
        result = self.check("n == s")
        self.assertFalse(result.ok)
        # 大小比较不允许 string/bool
        self.assertFalse(self.check("'a' < 'b'").ok)
        self.assertFalse(self.check("flag < true").ok)

    def test_logical_only_bool(self):
        self.assertEqual(self.check("flag and not false or true").type, "bool")
        result = self.check("flag and n")
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_TYPE_MISMATCH)

    def test_function_arity_and_param_types(self):
        self.assertTrue(self.check("min(n, 1)").ok)
        result = self.check("min(n)")
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_ARITY_MISMATCH)
        result = self.check("abs(s)")
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_TYPE_MISMATCH)
        result = self.check("if(n, 1, 2)")
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_TYPE_MISMATCH)

    def test_if_branch_must_agree(self):
        self.assertTrue(self.check("if(flag, 1, 2)").ok)
        result = self.check("if(flag, 1, 'x')")
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].code,
                         ErrorCode.STATIC_BRANCH_TYPE)

    def test_multiple_errors_accumulated(self):
        # 不“遇错即停”：同时拿到未定义变量和类型错误（bool 不能参与算术）
        result = self.check("bad1 + bad2 + flag + 1")
        undef = {d.extra["name"] for d in result.undefined}
        self.assertEqual(undef, {"bad1", "bad2"})
        self.assertTrue(any(
            d.code == ErrorCode.STATIC_TYPE_MISMATCH
            for d in result.type_errors))

    def test_div_by_literal_zero_warns_but_passes(self):
        result = self.check("1 / 0")
        self.assertTrue(result.ok, "除零字面量是告警不是错误")
        self.assertEqual(len(result.warnings), 1)
        self.assertEqual(result.warnings[0].code,
                         WarningCode.WARN_DIV_ZERO_LITERAL)
        self.assertTrue(result.warnings[0].line >= 1)
        # 变量除数不产生告警
        self.assertEqual(self.check("1 / n").warnings, [])
        # 取模也告警
        self.assertEqual(len(self.check("n % 0").warnings), 1)

    def test_nonzero_literal_divider_no_warning(self):
        self.assertEqual(self.check("4 / 2").warnings, [])


# ---------------------------------------------------------------------------
# 4. 绑定：重复名、非法名、循环引用
# ---------------------------------------------------------------------------
class RegistryTests(unittest.TestCase):
    def test_duplicate_bind_conflict_name(self):
        eng = Engine()
        self.assertTrue(eng.bind("x", 1).ok)
        r = eng.bind("x", 2)
        self.assertFalse(r.ok)
        self.assertEqual(r.conflict_name, "x")
        self.assertEqual(r.error.code, ErrorCode.BIND_DUPLICATE)

    def test_invalid_names(self):
        eng = Engine()
        for bad in ("", "1abc", "a-b", "if", "min", "true", "and"):
            with self.subTest(bad=bad):
                r = eng.bind(bad, 1)
                self.assertFalse(r.ok)
                self.assertEqual(r.error.code, ErrorCode.BIND_INVALID_NAME)

    def test_forward_reference_then_resolve(self):
        eng = Engine()
        r1 = eng.bind_expr("a", "b + 1")
        self.assertTrue(r1.ok)
        self.assertTrue(r1.pending)
        self.assertTrue(eng.bind("b", 10).ok)
        result = eng.evaluate("a")
        self.assertTrue(result.ok)
        self.assertEqual(result.value, 11.0)

    def test_two_node_cycle(self):
        eng = Engine()
        eng.bind_expr("a", "b + 1")
        r = eng.bind_expr("b", "a + 1")
        self.assertFalse(r.ok)
        self.assertEqual(r.error.code, ErrorCode.BIND_CYCLE)
        self.assertEqual(r.cycle[0], r.cycle[-1], "环序列首尾闭合")
        self.assertEqual(set(r.cycle), {"a", "b"})
        # 注册失败的 b 不存在；a 保持挂起可继续使用
        self.assertNotIn("b", eng.registry)

    def test_three_node_cycle_sequence(self):
        eng = Engine()
        eng.bind_expr("a", "b + 1")
        eng.bind_expr("b", "c + 1")
        r = eng.bind_expr("c", "a + 1")
        self.assertFalse(r.ok)
        self.assertEqual(r.cycle, ["c", "a", "b", "c"])

    def test_self_cycle(self):
        eng = Engine()
        r = eng.bind_expr("x", "x + 1")
        self.assertFalse(r.ok)
        self.assertEqual(r.cycle, ["x", "x"])

    def test_no_cycle_in_diamond(self):
        eng = Engine()
        eng.bind("base", 1.0)
        eng.bind_expr("left", "base + 1")
        eng.bind_expr("right", "base + 2")
        r = eng.bind_expr("top", "left + right")
        self.assertTrue(r.ok)
        self.assertEqual(eng.evaluate("top").value, 5.0)

    def test_bind_expr_static_error_rejects_registration(self):
        eng = Engine()
        eng.bind("n", 1)
        r = eng.bind_expr("bad", "n + 'x'")
        self.assertFalse(r.ok)
        self.assertEqual(r.error.code, ErrorCode.BIND_EXPRESSION_ERROR)
        self.assertNotIn("bad", eng.registry)

    def test_depth_exceeded_on_registration(self):
        eng = Engine(max_depth=5)
        eng.bind("v0", 0)
        for i in range(1, 5):
            self.assertTrue(eng.bind_expr("v%d" % i, "v%d + 1" % (i - 1)).ok)
        r = eng.bind_expr("v5", "v4 + 1")
        self.assertFalse(r.ok)
        self.assertEqual(r.error.code, ErrorCode.BIND_DEPTH_EXCEEDED)


# ---------------------------------------------------------------------------
# 5. 求值语义
# ---------------------------------------------------------------------------
class EvaluationSemanticsTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.engine.bind("n", 6)
        self.engine.bind("s", "ab")
        self.engine.bind("flag", True)

    def ev(self, expr, **kw):
        return self.engine.evaluate(expr, **kw)

    def test_literals_and_types(self):
        r = self.ev("1.5")
        self.assertEqual((r.value, r.type), (1.5, "number"))
        r = self.ev("'x'")
        self.assertEqual((r.value, r.type), ("x", "string"))
        r = self.ev("true")
        self.assertEqual((r.value, r.type), (True, "bool"))

    def test_arithmetic_and_modulo(self):
        self.assertEqual(self.ev("7 % 3").value, 1.0)
        self.assertEqual(self.ev("10 / 4").value, 2.5)
        self.assertEqual(self.ev("-5 + 2").value, -3.0)

    def test_unary_not(self):
        self.assertIs(self.ev("not false").value, True)
        self.assertIs(self.ev("not not true").value, True)

    def test_comparison_and_equality(self):
        self.assertIs(self.ev("1 < 2").value, True)
        self.assertIs(self.ev("2 <= 2").value, True)
        self.assertIs(self.ev("'a' == 'a'").value, True)
        self.assertIs(self.ev("'a' != 'b'").value, True)
        self.assertIs(self.ev("true == false").value, False)

    def test_logical_short_circuit_semantics(self):
        self.assertIs(self.ev("false and true").value, False)
        self.assertIs(self.ev("true or false").value, True)
        # 短路时右侧表达式不应被求值：右侧是除零也安全
        self.assertIs(self.ev("false and (1 / 0 == 0)").value, False)
        self.assertIs(self.ev("true or (1 / 0 == 0)").value, True)
        # 不短路时右侧除零仍然炸
        self.assertEqual(self.ev("true and (1 / 0 == 0)").error.code,
                         ErrorCode.EVAL_DIV_ZERO)

    def test_if_selects_only_taken_branch(self):
        self.assertEqual(self.ev("if(flag, 1, 1 / 0)").value, 1.0)
        self.assertEqual(self.ev("if(not flag, 1 / 0, 2)").value, 2.0)

    def test_builtin_functions(self):
        self.assertEqual(self.ev("min(3, 5)").value, 3.0)
        self.assertEqual(self.ev("max(3, 5)").value, 5.0)
        self.assertEqual(self.ev("abs(-7)").value, 7.0)
        self.assertEqual(self.ev("round(2.6)").value, 3.0)
        # round 采用银行家舍入
        self.assertEqual(self.ev("round(2.5)").value, 2.0)

    def test_string_concat(self):
        self.assertEqual(self.ev("s + 'cd'").value, "abcd")

    def test_variable_expression_bindings_chain(self):
        self.assertTrue(self.engine.bind_expr("price", "n * 2").ok)
        self.assertTrue(self.engine.bind_expr("taxed", "price * 1.1").ok)
        r = self.ev("taxed")
        self.assertTrue(r.ok)
        self.assertAlmostEqual(r.value, 13.2)

    def test_results_are_finite_floats(self):
        self.assertIsInstance(self.ev("1 + 2").value, float)
        self.assertTrue(math.isfinite(self.ev("n").value))


# ---------------------------------------------------------------------------
# 6. 运行时错误处理
# ---------------------------------------------------------------------------
class RuntimeErrorTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.engine.bind("zero", 0)

    def ev(self, expr):
        return self.engine.evaluate(expr)

    def assert_code(self, result, code, has_position=False):
        self.assertFalse(result.ok)
        self.assertIsNotNone(result.error)
        self.assertEqual(result.error.code, code)
        if has_position:
            self.assertGreaterEqual(result.error.line, 1)
            self.assertGreaterEqual(result.error.column, 1)

    def test_div_zero_runtime(self):
        self.assert_code(self.ev("1 / zero"), ErrorCode.EVAL_DIV_ZERO, True)
        self.assert_code(self.ev("1 % zero"), ErrorCode.EVAL_MOD_ZERO, True)

    def test_warning_delivered_with_result(self):
        r = self.ev("1 / 0")
        self.assertEqual(r.error.code, ErrorCode.EVAL_DIV_ZERO)
        self.assertTrue(any(w.code == WarningCode.WARN_DIV_ZERO_LITERAL
                            for w in r.warnings))

    def test_overflow_to_inf_rejected(self):
        r = self.ev("1e308 * 1e308")
        self.assert_code(r, ErrorCode.EVAL_NON_FINITE)
        self.assertEqual(r.error.extra["value"], "inf")

    def test_nan_path_rejected(self):
        # fmod 行为稳定：0 % 0 先被除零拦截；用极大差值制造 NaN 路径
        r = self.ev("1e308 * 1e308 - 1e308 * 1e308")
        self.assertFalse(r.ok)
        self.assertIn(r.error.code,
                      (ErrorCode.EVAL_NON_FINITE, ErrorCode.EVAL_DIV_ZERO))

    def test_string_too_long(self):
        eng = Engine(max_string_len=8)
        eng.bind("a", "abcd")
        eng.bind("b", "efghi")
        r = eng.evaluate("a + b")
        self.assert_code(r, ErrorCode.EVAL_STRING_TOO_LONG)
        self.assertEqual(r.error.extra["length"], 9)
        self.assertEqual(r.error.extra["limit"], 8)

    def test_evaluation_depth_exceeded(self):
        # 注册期允许的深链，在求值期把 max_depth 调小（模拟受限部署环境），
        # 绑定展开守卫应返回 EVAL_DEPTH_EXCEEDED 而不是裸异常。
        eng = Engine(max_depth=32)
        eng.bind("d0", 0)
        for i in range(1, 12):
            self.assertTrue(eng.bind_expr("d%d" % i, "d%d + 1" % (i - 1)).ok)
        r = eng.evaluate("d11")
        self.assertTrue(r.ok)
        self.assertEqual(r.value, 11.0)
        eng.max_depth = 3
        r = eng.evaluate("d11")
        self.assert_code(r, ErrorCode.EVAL_DEPTH_EXCEEDED, has_position=True)

    def test_chain_at_depth_boundary_still_works(self):
        # max_depth=5 时 v0..v4 链恰好可注册、可求值
        eng = Engine(max_depth=5)
        eng.bind("v0", 0)
        for i in range(1, 5):
            self.assertTrue(eng.bind_expr("v%d" % i, "v%d + 1" % (i - 1)).ok)
        self.assertEqual(eng.evaluate("v4").value, 4.0)

    def test_static_errors_block_evaluation(self):
        # 未定义变量 / 类型不匹配都不允许进入求值
        self.assertEqual(self.ev("undef + 1").error.code,
                         ErrorCode.STATIC_UNDEFINED_VAR)
        self.assertEqual(self.ev("1 + 'x'").error.code,
                         ErrorCode.STATIC_TYPE_MISMATCH)
        self.assertEqual(self.ev("if(1, 2, 3)").error.code,
                         ErrorCode.STATIC_TYPE_MISMATCH)

    def test_no_bare_exception_ever_escapes(self):
        for text in ("", "()", "(1", "1 $", "'oops", "1 +", "+",
                     "min(", "1..2", "true )", ",,"):
            with self.subTest(text=text):
                r = self.ev(text)
                self.assertFalse(r.ok)
                self.assertIsNotNone(r.error)

    def test_bind_non_finite_literal_rejected(self):
        eng = Engine()
        for bad in (float("inf"), float("nan")):
            r = eng.bind("bad_" + str(bad), bad)
            self.assertFalse(r.ok)
        r = eng.bind("x", 1e999)
        self.assertFalse(r.ok)


# ---------------------------------------------------------------------------
# 7. Trace 生成
# ---------------------------------------------------------------------------
class TraceTests(unittest.TestCase):
    def test_every_step_has_tick_position_io(self):
        eng = Engine()
        eng.bind("a", 2)
        r = eng.evaluate("a + 3 * 2")
        self.assertTrue(r.ok)
        self.assertEqual(len(r.trace), 5)  # a,3,2,*,+
        for step in r.trace:
            self.assertGreaterEqual(step.tick, 1)
            self.assertGreaterEqual(step.line, 1)
            self.assertGreaterEqual(step.column, 1)
            self.assertTrue(step.op)
        # 末步输出即最终结果
        self.assertEqual(r.trace[-1].output,
                         {"value": 8.0, "type": "number"})
        # 二元运算轨迹带两个输入
        add_step = r.trace[-1]
        self.assertEqual(add_step.inputs,
                         [{"value": 2.0, "type": "number"},
                          {"value": 6.0, "type": "number"}])

    def test_logical_clock_injection_and_monotonicity(self):
        eng = Engine()
        r = eng.evaluate("1 + 2", logical_time=1000)
        self.assertEqual([s.tick for s in r.trace], [1001, 1002, 1003])
        self.assertEqual(r.logical_time, 1003)

    def test_trace_covers_nested_binding_expansion(self):
        eng = Engine()
        eng.bind("base", 10)
        eng.bind_expr("a", "base + 1")
        eng.bind_expr("b", "a * 2")
        r = eng.evaluate("b")
        self.assertTrue(r.ok)
        self.assertEqual(r.value, 22.0)
        ticks = [s.tick for s in r.trace]
        self.assertEqual(ticks, sorted(ticks))
        # 展开子表达式也产生 LOAD_VAR/运算轨迹
        ops = [s.op for s in r.trace]
        self.assertIn("LOAD_VAR", ops)
        self.assertIn("BIN_OP", ops)

    def test_short_circuit_trace_skips_right_side(self):
        eng = Engine()
        r = eng.evaluate("false and 1 / 0 == 0")
        self.assertTrue(r.ok)
        texts = [s.text for s in r.trace]
        self.assertTrue(any("short-circuit" in t for t in texts))
        # 右侧除法指令不应出现
        self.assertFalse(any(s.op == "BIN_OP" and "/" in s.text
                             for s in r.trace))

    def test_if_trace_only_taken_branch(self):
        eng = Engine()
        r = eng.evaluate("if(false, 1, 2)")
        consts = [s.output["value"] for s in r.trace
                  if s.op == "LOAD_CONST" and s.output]
        self.assertNotIn(1.0, consts)
        self.assertIn(2.0, consts)

    def test_trace_serializable_to_dict(self):
        eng = Engine()
        r = eng.evaluate("1 < 2 and true")
        payload = r.to_dict()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["type"], "bool")
        self.assertIsInstance(payload["trace"], list)
        self.assertTrue(all(set(step) == {"tick", "pc", "op", "text",
                                          "line", "column", "inputs",
                                          "output"}
                            for step in payload["trace"]))


# ---------------------------------------------------------------------------
# 8. 综合集成场景
# ---------------------------------------------------------------------------
class IntegrationTests(unittest.TestCase):
    def test_rule_configuration_scenario(self):
        """模拟规则配置：阈值绑定 -> 指标表达式 -> 布尔判定。"""
        eng = Engine()
        eng.bind("threshold", 100)
        eng.bind_expr("gmv", "80 + 30")            # 110
        eng.bind_expr("ratio", "(gmv - 80) / 10")  # 3
        chk = eng.check("gmv > threshold and ratio > 1")
        self.assertTrue(chk.ok)
        self.assertEqual(chk.type, "bool")
        r = eng.evaluate("if(gmv > threshold, 'hit', 'miss')")
        self.assertEqual((r.value, r.type), ("hit", "string"))

    def test_collect_vars_order(self):
        tree = parser.parse("a + b * a - c")
        self.assertEqual(collect_vars(tree), ["a", "b", "c"])

    def test_check_returns_type_undefined_warnings(self):
        eng = Engine()
        eng.bind("x", 1)
        result = eng.check("x / 0 + missing")
        self.assertFalse(result.ok)
        self.assertIsNone(result.type)
        self.assertEqual([d.extra["name"] for d in result.undefined],
                         ["missing"])
        self.assertEqual(len(result.warnings), 1)

    def test_bool_bindings(self):
        eng = Engine()
        eng.bind("ok", True)
        r = eng.evaluate("ok and 1 == 1")
        self.assertIs(r.value, True)
        self.assertEqual(r.type, "bool")

    def test_type_hint_coercion(self):
        eng = Engine()
        r = eng.bind("n", 3, type_hint="number")
        self.assertTrue(r.ok)
        self.assertEqual(eng.evaluate("n").value, 3.0)
        self.assertFalse(eng.bind("s", 5, type_hint="string").ok)
        self.assertFalse(eng.bind("b", 1, type_hint="bool").ok)


if __name__ == "__main__":
    unittest.main(verbosity=2)
