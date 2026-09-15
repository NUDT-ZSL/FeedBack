import unittest

from narrative import And, Compare, Condition, ConditionError, Not, Or
from tests.helpers import build_schema


class TestConditions(unittest.TestCase):
    def setUp(self):
        self.schema = build_schema()
        self.state = self.schema.initial_state()
        self.state["trust"] = 3

    def test_deterministic_repeated_evaluation(self):
        cond = And([Compare("trust", "ge", 2),
                    Or([Compare("gold", "lt", 5), Not(Compare("gold", "lt", 5))])])
        results = {cond.evaluate(self.state, self.schema) for _ in range(100)}
        self.assertEqual(len(results), 1, "同一状态同一条件重复求值必须相同")

    def test_missing_declared_variable_uses_default(self):
        # gold 已声明但状态中缺失 -> 用缺省值 10
        state = {"trust": 3}
        self.assertTrue(Compare("gold", "eq", 10).evaluate(state, self.schema))
        self.assertFalse(Compare("gold", "lt", 10).evaluate(state, self.schema))

    def test_undeclared_variable_is_false(self):
        # 未声明变量 -> 比较判 False，不抛异常
        self.assertFalse(Compare("ghost", "eq", 1).evaluate(self.state, self.schema))
        self.assertTrue(Not(Compare("ghost", "eq", 1)).evaluate(self.state, self.schema))
        self.assertTrue(Or([Compare("ghost", "eq", 1),
                            Compare("trust", "eq", 3)]).evaluate(self.state, self.schema))

    def test_logic_combinations(self):
        s = self.state
        self.assertTrue(And([Compare("trust", "gt", 1),
                             Compare("gold", "ge", 10)]).evaluate(s, self.schema))
        self.assertFalse(And([Compare("trust", "gt", 1),
                              Compare("gold", "gt", 10)]).evaluate(s, self.schema))
        self.assertTrue(Or([Compare("trust", "eq", 99),
                            Compare("gold", "eq", 10)]).evaluate(s, self.schema))

    def test_incomparable_types_are_false_not_error(self):
        self.assertFalse(Compare("name", "lt", 5).evaluate(self.state, self.schema))

    def test_roundtrip_serialization(self):
        cond = And([Compare("trust", "ge", 2), Not(Compare("met_ally", "eq", True))])
        clone = Condition.from_dict(cond.to_dict())
        self.assertEqual(clone.to_dict(), cond.to_dict())
        self.assertEqual(clone.evaluate(self.state, self.schema),
                         cond.evaluate(self.state, self.schema))

    def test_bad_operator_rejected(self):
        with self.assertRaises(ConditionError):
            Condition.from_dict({"op": "cmp", "var": "x", "cmp": "~~", "value": 1})
        with self.assertRaises(ConditionError):
            Condition.from_dict({"op": "wat"})


if __name__ == "__main__":
    unittest.main()
