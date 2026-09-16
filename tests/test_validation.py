"""需求 1：基准/轨的唯一标识、单调不减校验、非法配置拒绝并指出位置。"""

import unittest

from subalign import AlignConfig, Entry, Reference, SubtitleTrack, SubtitleSystem, ValidationError
from subalign.timecode import format_millis, to_millis
from fractions import Fraction


class TestModelValidation(unittest.TestCase):
    def test_basic_ok(self):
        ref = Reference([Entry(0, 1000, "a"), Entry(1000, 2000, "b")], source="ref")
        t = SubtitleTrack("t1", "供应商甲", [Entry(0, 900, "a"), Entry(900, 1800, "b")])
        s = SubtitleSystem(ref, [t])
        self.assertEqual(s.track_ids(), ["t1"])

    def test_end_before_start_points_location(self):
        with self.assertRaises(ValidationError) as cm:
            SubtitleTrack("t1", "src", [Entry(0, 1000, "a"), Entry(5000, 4000, "b")])
        self.assertIn("entry[1]", str(cm.exception))
        self.assertEqual(cm.exception.location, ("track", "t1", "entry[1]"))

    def test_non_monotonic_points_location(self):
        entries = [Entry(i * 1000, i * 1000 + 500, f"x{i}") for i in range(4)]
        entries[3] = Entry(1500, 1900, "x3")  # 起点早于第 2 条的 2000
        with self.assertRaises(ValidationError) as cm:
            SubtitleTrack("t1", "src", entries)
        self.assertIn("entry[3]", str(cm.exception))
        self.assertIn("单调不减", str(cm.exception))

    def test_equal_start_allowed(self):
        # 单调“不减”：相等合法。
        t = SubtitleTrack("t", "s", [Entry(100, 200, "a"), Entry(100, 300, "b")])
        self.assertEqual(len(t.entries), 2)

    def test_negative_start_rejected(self):
        with self.assertRaises(ValidationError):
            SubtitleTrack("t", "s", [Entry(-1, 0, "a")])

    def test_reference_nonempty_and_track_nonempty(self):
        with self.assertRaises(ValidationError):
            Reference([], source="ref")
        with self.assertRaises(ValidationError):
            SubtitleTrack("t", "s", [])

    def test_duplicate_track_id(self):
        ref = Reference([Entry(0, 1000, "a")], source="ref")
        t = SubtitleTrack("dup", "s1", [Entry(0, 1000, "a")])
        s = SubtitleSystem(ref, [t])
        with self.assertRaises(ValidationError) as cm:
            s.add_track(SubtitleTrack("dup", "s2", [Entry(0, 1000, "a")]))
        self.assertIn("dup", str(cm.exception))

    def test_blank_id_and_source(self):
        with self.assertRaises(ValidationError):
            SubtitleTrack("  ", "s", [Entry(0, 1, "a")])
        with self.assertRaises(ValidationError):
            SubtitleTrack("t", "  ", [Entry(0, 1, "a")])

    def test_external_mutation_cannot_bypass(self):
        data = [Entry(0, 1000, "a"), Entry(2000, 3000, "b")]
        t = SubtitleTrack("t", "s", data)
        # 构造后再改外部列表不影响内部拷贝。
        data.append(Entry(1, 2, "c"))
        self.assertEqual(len(t.entries), 2)

    def test_config_validation(self):
        with self.assertRaises(ValidationError):
            AlignConfig(min_anchors=1)
        with self.assertRaises(ValidationError):
            AlignConfig(similarity_threshold=0.0)
        with self.assertRaises(ValidationError):
            AlignConfig(tolerance_ms=-1)
        with self.assertRaises(ValidationError):
            AlignConfig(conflict_rate_eps=Fraction(0))


class TestTimecode(unittest.TestCase):
    def test_parse_formats(self):
        self.assertEqual(to_millis("00:00:01.500"), 1500)
        self.assertEqual(to_millis("01:02:03"), 3723000)
        self.assertEqual(to_millis("1:02:03,4"), 3723400)
        self.assertEqual(to_millis(1500), 1500)
        self.assertEqual(to_millis(Fraction(3, 2)), 2)  # 半数远离零
        self.assertEqual(format_millis(3723400), "01:02:03.400")
        self.assertEqual(format_millis(-1500), "-00:00:01.500")

    def test_bad_timecode(self):
        with self.assertRaises(ValidationError):
            to_millis("not-a-time")
        with self.assertRaises(ValidationError):
            to_millis("00:61:00")


if __name__ == "__main__":
    unittest.main()
