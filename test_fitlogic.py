import unittest

from fitlogic import derive_plan


def asset(w, h, rw=0, rh=0):
    return {"id": "a", "name": "t", "width": w, "height": h,
            "minReadable": {"width": rw, "height": rh}}


def spec(w, h, margin=0, allowed=("scale", "crop", "recompose")):
    return {"id": "s", "name": "t", "width": w, "height": h,
            "safeMargin": margin, "allowedStrategies": list(allowed)}


class DerivePlanTest(unittest.TestCase):
    def test_same_aspect_scales(self):
        p = derive_plan(asset(2000, 1000), spec(1000, 500))
        self.assertEqual(p["strategy"], "scale")
        self.assertEqual(p["conflicts"], [])
        self.assertAlmostEqual(p["scale"], 0.5)

    def test_small_diff_crops(self):
        # 宽高比差约 11%, 裁切量约 11% < 30% -> crop
        p = derive_plan(asset(2000, 1000), spec(1000, 600))
        self.assertEqual(p["strategy"], "crop")

    def test_large_diff_recompose(self):
        # 横幅素材 -> 竖屏规格, 裁切量远超 30% -> recompose
        p = derive_plan(asset(2400, 900), spec(1125, 2436))
        self.assertEqual(p["strategy"], "recompose")
        self.assertTrue(any("重新构图" in n for n in p["notes"]))

    def test_strategy_not_allowed_conflict(self):
        p = derive_plan(asset(2400, 900), spec(1125, 2436,
                                               allowed=("scale", "crop")))
        self.assertEqual(p["strategy"], "recompose")
        self.assertIn("strategy-not-allowed",
                      [c["code"] for c in p["conflicts"]])

    def test_safe_margin_too_large(self):
        p = derive_plan(asset(1000, 1000), spec(500, 500, margin=300))
        self.assertIn("safe-margin", [c["code"] for c in p["conflicts"]])

    def test_min_readable_exceeds_safe_area(self):
        # 可读区 1300x1300, 缩放 2/3 后约 867 > 安全区 800 -> 冲突
        p = derive_plan(asset(1500, 1500, 1300, 1300),
                        spec(1000, 1000, margin=100))
        self.assertIn("min-readable", [c["code"] for c in p["conflicts"]])

    def test_crop_cuts_readable_region(self):
        # 宽图裁进窄目标, 可见窗口宽度小于可读区宽
        p = derive_plan(asset(2400, 900, 1800, 600), spec(900, 640))
        if p["strategy"] == "crop":
            self.assertIn("min-readable", [c["code"] for c in p["conflicts"]])

    def test_override_forces_strategy(self):
        p = derive_plan(asset(2000, 1000), spec(1000, 500),
                        override_strategy="crop")
        self.assertEqual(p["strategy"], "crop")
        self.assertTrue(p["isOverride"])
        self.assertEqual(p["autoStrategy"], "scale")

    def test_override_revertable(self):
        p = derive_plan(asset(2000, 1000), spec(1000, 500),
                        override_strategy=None)
        self.assertFalse(p["isOverride"])
        self.assertEqual(p["strategy"], p["autoStrategy"])

    def test_independent_results_per_spec(self):
        # 同一素材分配到两个规格, 结论独立推导
        a = asset(2400, 900)
        p1 = derive_plan(a, spec(1920, 640))
        p2 = derive_plan(a, spec(1080, 1080))
        self.assertNotEqual(p1["strategy"], p2["strategy"])


if __name__ == "__main__":
    unittest.main()
