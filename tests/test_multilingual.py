"""多语言模糊锚点与健壮性补充测试。"""

import unittest

from subalign import AlignConfig, Entry, SubtitleSystem


class TestMultilingual(unittest.TestCase):
    def test_zh_en_shared_proper_nouns(self):
        zh = [
            "开场介绍 NASA 2024 计划",
            "主持人问好",
            "讲解火星任务 NASA",
            "广告之后回来",
            "嘉宾讨论 2024 预算",
            "结尾鸣谢 NASA 团队",
        ]
        en = [
            "Intro to NASA 2024 program",
            "Host says hello",
            "Explaining the NASA mars mission",
            "Back after the break",
            "Panel on the 2024 budget",
            "Closing thanks to NASA team",
        ]
        ref = [Entry(10000 + i * 15000, 14000 + i * 15000, t) for i, t in enumerate(zh)]
        cand = []
        for i, t in enumerate(en):
            mid = int(round((12000 + i * 15000) * 1000 / 1005))
            cand.append(Entry(mid - 2000, mid + 2000, t))
        s = SubtitleSystem.build(
            ref, {"en": ("vendor", cand)},
            config=AlignConfig(similarity_threshold=0.3, tolerance_ms=50),
        )
        s.align()
        r = s.report("en")
        self.assertEqual(r.status, "aligned")
        # 含共有专有词的 0/2/4/5 句必须被锚定，纯翻译句 1/3 不应进入。
        pairs = {(a.ref_index, a.cand_index) for a in r.anchors}
        self.assertEqual(pairs, {(0, 0), (2, 2), (4, 4), (5, 5)})
        self.assertTrue(all(a.kind == "fuzzy" for a in r.anchors))
        self.assertTrue(all(a.score < 1.0 for a in r.anchors))
        # 漂移速率被正确恢复（1.005），且全部锚点在 50ms 容差内。
        self.assertAlmostEqual(float(r.segments[0].ratio), 1.005, places=4)
        self.assertTrue(r.tolerance.within_tolerance)

    def test_pure_translation_no_false_anchors(self):
        ref = [Entry(i * 10000, i * 10000 + 3000, f"中文句子编号{i}") for i in range(8)]
        cand = [
            Entry(i * 10000, i * 10000 + 3000, f"english sentence number {i}")
            for i in range(8)
        ]
        s = SubtitleSystem.build(ref, {"en": ("v", cand)})
        s.align()
        r = s.report("en")
        self.assertEqual(r.status, "insufficient_anchors")
        # 锚点不足时容差报告不得崩溃，且为空。
        self.assertEqual(r.tolerance.violations, ())


if __name__ == "__main__":
    unittest.main()
