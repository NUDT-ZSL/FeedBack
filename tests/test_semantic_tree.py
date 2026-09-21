import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from semantic_tree import ConflictError, SemanticTree  # noqa: E402


def sample_tree():
    t = SemanticTree()
    t.add_element("main", "App", element_id="app")
    t.add_element("navigation", "Nav", parent_id="app", element_id="nav")
    t.add_element("link", "Home", parent_id="nav", element_id="home")
    t.add_element("link", "Docs", parent_id="nav", element_id="docs")
    t.add_element("button", "OK", parent_id="app", element_id="ok")
    return t


class TestBuild(unittest.TestCase):
    def test_reading_order_is_preorder(self):
        t = sample_tree()
        announced, skipped = t.reading_order()
        self.assertEqual([e["id"] for e in announced],
                         ["app", "nav", "home", "docs", "ok"])
        self.assertEqual(skipped, [])

    def test_orphan_parent_rejected(self):
        t = sample_tree()
        with self.assertRaises(ConflictError) as ctx:
            t.add_element("button", "X", parent_id="ghost")
        self.assertEqual(ctx.exception.relation, "parent")

    def test_name_required_role_rejected_when_empty(self):
        t = sample_tree()
        with self.assertRaises(ConflictError) as ctx:
            t.add_element("button", "")
        self.assertEqual(ctx.exception.relation, "name")

    def test_presentation_role_skipped_but_children_read(self):
        t = sample_tree()
        t.add_element("presentation", "", parent_id="app", element_id="deco")
        t.add_element("heading", "Title", parent_id="deco", element_id="h")
        announced, skipped = t.reading_order()
        self.assertIn("h", [e["id"] for e in announced])
        self.assertEqual([e["id"] for e in skipped], ["deco"])


class TestAdjustments(unittest.TestCase):
    def test_reparent_changes_order(self):
        t = sample_tree()
        t.reparent("ok", "nav", index=0)
        announced, _ = t.reading_order()
        self.assertEqual([e["id"] for e in announced],
                         ["app", "nav", "ok", "home", "docs"])

    def test_cycle_rejected_and_tree_unchanged(self):
        t = sample_tree()
        before = t.snapshot()
        with self.assertRaises(ConflictError) as ctx:
            t.reparent("app", "nav")  # nav is inside app
        self.assertEqual(ctx.exception.relation, "parent")
        self.assertEqual(t.snapshot(), before)

    def test_self_parent_rejected(self):
        t = sample_tree()
        with self.assertRaises(ConflictError):
            t.reparent("app", "app")

    def test_reorder(self):
        t = sample_tree()
        t.reorder("docs", 0)
        announced, _ = t.reading_order()
        self.assertEqual([e["id"] for e in announced],
                         ["app", "nav", "docs", "home", "ok"])

    def test_role_change_to_name_required_blocked(self):
        t = sample_tree()
        t.add_element("generic", "", parent_id="app", element_id="g")
        with self.assertRaises(ConflictError) as ctx:
            t.set_role("g", "button")
        self.assertEqual(ctx.exception.element_id, "g")
        self.assertEqual(t.elements["g"].role, "generic")

    def test_clearing_name_of_button_blocked(self):
        t = sample_tree()
        with self.assertRaises(ConflictError):
            t.set_name("ok", "")
        self.assertEqual(t.elements["ok"].name, "OK")

    def test_integrity_check_clean(self):
        t = sample_tree()
        self.assertEqual(t.to_dict()["integrity_errors"], [])


class TestSnapshots(unittest.TestCase):
    def test_snapshot_roundtrip_restores_reading_order(self):
        t = sample_tree()
        snap = t.snapshot()
        t.reparent("ok", "nav")
        t.set_name("home", "Start")
        restored = SemanticTree.from_snapshot(snap)
        self.assertEqual(restored.reading_order(), sample_tree().reading_order())


if __name__ == "__main__":
    unittest.main()
