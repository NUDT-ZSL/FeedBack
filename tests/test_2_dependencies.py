"""需求 2：前置依赖、悬空引用拒绝、成环拒绝（均须给出链条）。"""

import unittest

from fund_allocator import Project, Registry
from fund_allocator.errors import DependencyError, ValidationError


def make_registry():
    reg = Registry()
    for pid, total, ms in [
        ("A", "100.00", "10.00"),
        ("B", "200.00", "20.00"),
        ("C", "300.00", "30.00"),
        ("D", "400.00", "40.00"),
    ]:
        reg.add_project(Project.create(pid, 1, total, ms, [total]))
    return reg


class TestDependencies(unittest.TestCase):
    def test_add_and_query(self):
        reg = make_registry()
        reg.add_dependency("B", "A")  # B 依赖 A
        reg.add_dependency("C", "A")
        reg.add_dependency("D", "B")
        self.assertEqual(reg.prerequisites("D"), ("B",))
        self.assertEqual(reg.dependents("A"), ["B", "C"])
        self.assertEqual(reg.all_dependents("A"), ["B", "C", "D"])

    def test_missing_prereq_chain(self):
        reg = Registry()
        reg.add_project(Project.create("A", 1, "100.00", "10.00", ["100.00"]))
        with self.assertRaises(DependencyError) as cm:
            reg.add_dependency("A", "GHOST")
        self.assertEqual(cm.exception.chain, ["A", "GHOST"])

    def test_missing_dependent_chain(self):
        reg = make_registry()
        with self.assertRaises(DependencyError) as cm:
            reg.add_dependency("GHOST", "A")
        self.assertEqual(cm.exception.chain, ["GHOST", "A"])

    def test_self_dependency(self):
        reg = make_registry()
        with self.assertRaises(DependencyError) as cm:
            reg.add_dependency("A", "A")
        self.assertEqual(cm.exception.chain, ["A", "A"])

    def test_direct_cycle_chain(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        with self.assertRaises(DependencyError) as cm:
            reg.add_dependency("A", "B")
        chain = cm.exception.chain
        self.assertEqual(chain[0], chain[-1])  # 首尾相同，构成环
        self.assertEqual(set(chain), {"A", "B"})

    def test_long_cycle_chain(self):
        reg = make_registry()
        reg.add_dependency("B", "A")   # B -> A
        reg.add_dependency("C", "B")   # C -> B
        reg.add_dependency("D", "C")   # D -> C
        with self.assertRaises(DependencyError) as cm:
            reg.add_dependency("A", "D")  # 闭环 A -> D -> C -> B -> A
        chain = cm.exception.chain
        self.assertEqual(chain[0], chain[-1])
        self.assertEqual(set(chain), {"A", "B", "C", "D"})

    def test_failed_add_leaves_state_unchanged(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        with self.assertRaises(DependencyError):
            reg.add_dependency("A", "B")
        self.assertEqual(reg.prerequisites("B"), ("A",))
        self.assertEqual(reg.prerequisites("A"), ())
        # 图仍然无环
        self.assertIsNone(reg.find_cycle())

    def test_duplicate_dependency_idempotent(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        reg.add_dependency("B", "A")  # 不报错
        self.assertEqual(reg.prerequisites("B"), ("A",))

    def test_duplicate_project_id_rejected(self):
        reg = make_registry()
        with self.assertRaises(ValidationError) as cm:
            reg.add_project(Project.create("A", 2, "50.00", "10.00", ["50.00"]))
        self.assertIn("重复", cm.exception.message)

    def test_remove_project_with_dependents_rejected(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        with self.assertRaises(DependencyError):
            reg.remove_project("A")
        # 删除依赖方后可以删
        reg.remove_project("B")
        reg.remove_project("A")
        self.assertNotIn("A", reg)

    def test_topological_order_stable(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        reg.add_dependency("C", "A")
        order = reg.topological_order()
        self.assertLess(order.index("A"), order.index("B"))
        self.assertLess(order.index("A"), order.index("C"))
        self.assertEqual(order, ["A", "B", "C", "D"])

    def test_closures(self):
        reg = make_registry()
        reg.add_dependency("B", "A")
        reg.add_dependency("C", "B")
        reg.add_dependency("D", "A")
        self.assertEqual(reg.upstream_closure(["C"]), {"A", "B"})
        self.assertEqual(reg.downstream_closure(["A"]), {"B", "C", "D"})


if __name__ == "__main__":
    unittest.main()
