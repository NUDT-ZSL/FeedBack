import unittest

from spatial_review.camera import Camera, project_annotations
from spatial_review.model import Scene, Transform


class CameraTests(unittest.TestCase):
    def setUp(self):
        self.scene = Scene()
        # Camera starts at +Z looking toward origin.
        self.camera = Camera(target=(0, 0, 0), distance=10, yaw=0, pitch=0)
        self.scene.add_object("target", None, Transform(translation=(0, 0, -2)), (1, 1, 1))
        self.scene.add_object(
            "blocker", None,
            Transform(translation=(0.0, 0.0, 5.0)),
            (2.0, 2.0, 0.1)
        )
        self.scene.add_object("side", None, Transform(translation=(20, 0, -2)), (1, 1, 1))
        self.scene.add_object("behind", None, Transform(translation=(0, 0, 15)), (1, 1, 1))
        self.scene.add_annotation("visible", "target", (-0.4, 0.5, 0.5), "v")
        self.scene.add_annotation("blocked", "target", (1.0, 0.5, 0.0), "b")
        self.scene.add_annotation("away", "side", (0.5, 0.5, 0.5), "o")
        self.scene.add_annotation("back", "behind", (0.5, 0.5, 0.5), "r")

    def states(self, width=800, height=600):
        return {(p.ann_id, p.visibility): p
                for p in project_annotations(self.scene, self.camera, width, height)}

    def test_classifies_visible_occluded_offscreen_and_behind_without_hiding(self):
        states = self.states()
        self.assertIn(("visible", "visible"), states)
        occluded = states[("blocked", "occluded")]
        self.assertEqual(occluded.blocker, "blocker")
        self.assertIn("blocker", occluded.reason)
        offscreen = states[("away", "offscreen")]
        self.assertIsNotNone(offscreen.edge_marker)
        self.assertIsNone(offscreen.screen) if offscreen.screen[0] < 0 else None
        behind = states[("back", "behind")]
        self.assertIsNone(behind.screen)
        self.assertIsNotNone(behind.edge_marker)

    def test_camera_and_viewport_changes_update_screen_positions(self):
        first = next(p for p in project_annotations(self.scene, self.camera, 800, 600)
                     if p.ann_id == "visible").screen
        resized = next(p for p in project_annotations(self.scene, self.camera, 1000, 700)
                       if p.ann_id == "visible").screen
        self.camera.orbit(0.25, 0)
        rotated = next(p for p in project_annotations(self.scene, self.camera, 800, 600)
                       if p.ann_id == "visible").screen
        self.assertNotEqual(first, resized)
        self.assertNotEqual(first, rotated)


if __name__ == "__main__":
    unittest.main()
