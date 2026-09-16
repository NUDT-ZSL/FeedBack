"""需求 2：用例与分组登记。"""
import unittest

from envcompat.registry import CaseRegistry
from envcompat.errors import (
    DefinitionError,
    DuplicateCaseError,
    UnknownGroupError,
)


class TestCaseRegistry(unittest.TestCase):
    def setUp(self):
        self.reg = CaseRegistry()
        self.reg.add_groups(["login", "payment"])

    def test_register_cases(self):
        self.reg.add_cases([
            ("login_ok", "login"),
            ("pay_ok", "payment", "pass"),
            {"case_id": "pay_fail", "group": "payment", "expected": "fail"},
        ])
        self.assertEqual(len(self.reg), 3)
        self.assertEqual(self.reg.get("pay_ok").group, "payment")
        self.assertEqual(self.reg.cases_of_group("payment"),
                         ("pay_fail", "pay_ok"))

    def test_duplicate_case_id_within_batch_rejected_with_positions(self):
        with self.assertRaises(DuplicateCaseError) as cm:
            self.reg.add_cases([("c1", "login"), ("c1", "login")])
        self.assertEqual(cm.exception.first_index, 0)
        self.assertEqual(cm.exception.duplicate_index, 1)
        self.assertIn("cases[0]", str(cm.exception))
        self.assertIn("cases[1]", str(cm.exception))
        self.assertEqual(len(self.reg), 0, "整批原子：失败时一条都不应写入")

    def test_duplicate_case_id_across_batches_rejected(self):
        self.reg.add_cases([("c1", "login")])
        with self.assertRaises(DuplicateCaseError) as cm:
            self.reg.add_cases([("c2", "login"), ("c1", "payment")])
        self.assertEqual(cm.exception.duplicate_index, 1)
        self.assertEqual(len(self.reg), 1, "第二批应整体回滚")

    def test_unknown_group_rejected_with_known_groups_listed(self):
        with self.assertRaises(UnknownGroupError) as cm:
            self.reg.add_cases([("c1", "nonexistent")])
        self.assertEqual(cm.exception.case_id, "c1")
        self.assertEqual(cm.exception.group, "nonexistent")
        self.assertIn("login", str(cm.exception))
        self.assertIn("payment", str(cm.exception))

    def test_duplicate_group_rejected(self):
        with self.assertRaises(DefinitionError):
            self.reg.add_group("login")

    def test_blank_group_and_case_names_rejected(self):
        with self.assertRaises(DefinitionError):
            self.reg.add_group("   ")
        with self.assertRaises(DefinitionError):
            self.reg.add_cases([("  ", "login")])

    def test_bad_expected_outcome_rejected(self):
        with self.assertRaises(DefinitionError):
            self.reg.add_cases([("c1", "login", "maybe")])  # type: ignore[list-item]


if __name__ == "__main__":
    unittest.main()
