import math
import unittest

from spatial_review.model import Scene, Transform, ValidationError


def make_chain():
    scene = Scene()
    scene.add_object("root", None, Transform(translation=(0, 0, 0)), (1, 1, 1))
    scene.add_object("child", "root", Transform(translation=(2, 0, 0)), (1, 2, 3))
    scene.add_annotation("A", "child", (0.5, 0.5, 0.5), "child note", "s1")
    scene.add_annotation("B", "root", (0, 0, 0), "root note", "s1")
    scene.add_annotation("C", "root", (1, 1, 1), "other", "s2")
    return scene


class ModelTests(unittest.TestCase):
    def test_rejects_duplicate_object_id_and_non_positive_size_with_location(self):
        scene = Scene()
        scene.add_object("dup", None, Transform(), (1, 1, 1))
        with self.assertRaises(ValidationError) as caught:
            scene.add_object("dup", None, Transform(), (1, 0, -2))
        locations = {issue["location"] for issue in caught.exception.issues}
        self.assertIn("object[dup].id", locations)
        self.assertIn("object[dup].size.y", locations)
        self.assertIn("object[dup].size.z", locations)
        self.assertEqual(scene.object_order, ["dup"])

    def test_rejects_missing_parent(self):
        scene = Scene()
        with self.assertRaises(ValidationError) as caught:
            scene.add_object("x", "missing", Transform(), (1, 1, 1))
        self.assertEqual(caught.exception.issues[0]["location"], "object[x].parent_id")

    def test_annotation_transforms_with_parent_and_unaffected_remains_fixed(self):
        scene = make_chain()
        before_child = scene.current_world_anchor("A", "s1")
        before_other = scene.current_world_anchor("B", "s1")
        scene.set_object_transform(
            "child",
            Transform(translation=(2, 3, 0), rotation_xyz=(0, 0, math.pi / 2))
        )
        after_child = scene.current_world_anchor("A", "s1")
        after_other = scene.current_world_anchor("B", "s1")
        self.assertAlmostEqual(after_child[0], 1.5)
        self.assertAlmostEqual(after_child[1], 3.5)
        self.assertAlmostEqual(after_child[2], 0.5)
        self.assertEqual(before_child, (2.5, 0.5, 0.5))
        self.assertEqual(before_other, after_other)

    def test_rejects_non_positive_scale_with_exact_field(self):
        scene = make_chain()
        with self.assertRaises(ValidationError) as caught:
            scene.set_object_transform("root", Transform(scale=(1, 0, 2)))
        self.assertEqual(caught.exception.issues[0]["location"], "object[root].scale.y")

    def test_delete_keeps_evidence_and_does_not_attach_annotation_elsewhere(self):
        scene = make_chain()
        original = scene.current_world_anchor("A", "s1")
        scene.delete_object("child")
        state = scene.annotations[("A", "s1")]
        self.assertFalse(state.valid)
        self.assertEqual(state.evidence.world_anchor, original)
        self.assertEqual(state.evidence.local_anchor, (0.5, 0.5, 0.5))
        self.assertIn("child", state.evidence.object_path)
        self.assertEqual(scene.current_world_anchor("A", "s1"), original)
        self.assertNotIn("child", scene.objects)

    def test_reparent_freezes_direct_annotation_but_keeps_descendant_live(self):
        scene = Scene()
        scene.add_object("a", None)
        scene.add_object("b", "a", Transform(translation=(1, 0, 0)))
        scene.add_object("c", "b", Transform(translation=(0, 2, 0)))
        scene.add_annotation("on_b", "b", (0, 0, 0), "x")
        scene.add_annotation("on_c", "c", (0, 0, 0), "y")
        scene.reparent_object("b", None)
        self.assertFalse(scene.annotations[("on_b", "default")].valid)
        self.assertTrue(scene.annotations[("on_c", "default")].valid)
        self.assertEqual(scene.current_world_anchor("on_b", "default"), (1, 0, 0))
        self.assertEqual(scene.current_world_anchor("on_c", "default"), (1, 2, 0))

    def test_rejects_reparent_cycle(self):
        scene = Scene()
        scene.add_object("a", None)
        scene.add_object("b", "a")
        with self.assertRaises(ValidationError) as caught:
            scene.reparent_object("a", "b")
        self.assertEqual(caught.exception.issues[0]["chain"], ["a", "b", "a"])

    def test_conflicting_same_id_keeps_both_sources_and_records_details(self):
        scene = make_chain()
        with self.assertRaises(ValidationError):
            scene.add_annotation("A", "child", (1, 1, 1), "same source duplicate", "s1")
        scene.add_annotation("A", "child", (1, 0, 0), "different body", "s2")
        conflict = scene.conflict_for("A")
        self.assertIsNotNone(conflict)
        self.assertEqual(conflict.sources, ["s1", "s2"])
        self.assertIn("A", conflict.message)
        self.assertEqual(len(scene.states_for_annotation("A")), 2)
        self.assertEqual(scene.annotations[("A", "s1")].annotation.body, "child note")

    def test_identical_cross_source_copy_does_not_conflict(self):
        scene = make_chain()
        scene.add_annotation("B", "root", (0, 0, 0), "root note", "s2")
        self.assertIsNone(scene.conflict_for("B"))

    def test_relations_reject_missing_target_with_chain(self):
        scene = make_chain()
        with self.assertRaises(ValidationError) as caught:
            scene.add_relation("A", "missing")
        issue = caught.exception.issues[0]
        self.assertEqual(issue["location"], "relation.to_annotation")
        self.assertEqual(issue["chain"], ["A@s1", "missing@unspecified-source", "<不存在>"])

    def test_relations_reject_cycle_and_keep_existing_graph(self):
        scene = make_chain()
        scene.add_relation("A", "B")
        scene.add_relation("B", "C")
        with self.assertRaises(ValidationError) as caught:
            scene.add_relation("C", "A")
        self.assertEqual(caught.exception.issues[0]["chain"],
                         ["C@s2", "A@s1", "B@s1", "C@s2"])
        self.assertEqual(len(scene.relations), 2)


if __name__ == "__main__":
    unittest.main()
