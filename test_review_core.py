import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from review_core import (
    ReviewStore,
    build_schedule,
    import_rows,
    item_from_dict,
    manually_update_item,
    record_answer,
)


NOW = datetime(2026, 9, 24, 9, 0)


def make_item(title="x", mastery=50, importance=3, last=None, due=None, **kwargs):
    return item_from_dict(
        {
            "title": title,
            "mastery": mastery,
            "importance": importance,
            "last_reviewed": last,
            "next_review": due,
            **kwargs,
        }
    )


class ReviewLogicTests(unittest.TestCase):
    def test_due_low_retention_and_high_importance_are_ranked_first(self):
        weak_important = make_item(
            "weak", mastery=20, importance=5,
            last="2026-09-10 09:00", due="2026-09-20 09:00",
        )
        strong = make_item(
            "strong", mastery=90, importance=2,
            last="2026-09-23 08:00", due="2026-09-24 08:30",
        )
        schedule = build_schedule([strong, weak_important], NOW)
        self.assertEqual(schedule[0].item.title, "weak")
        self.assertGreater(schedule[0].priority, schedule[1].priority)

    def test_correct_answer_increases_mastery_stability_and_interval(self):
        item = make_item(mastery=50, importance=3, last="2026-09-20 09:00")
        record_answer(item, True, NOW)
        self.assertEqual(item.mastery, 58)
        self.assertGreater(item.stability_days, 3.25)
        self.assertEqual(item.correct_streak, 1)
        first_due = datetime.fromisoformat(item.next_review)

        record_answer(item, True, NOW + timedelta(days=1))
        self.assertEqual(item.mastery, 67)
        second_due = datetime.fromisoformat(item.next_review)
        self.assertGreater(second_due - (NOW + timedelta(days=1)), first_due - NOW)

    def test_repeated_wrong_answers_shorten_strength_and_interval(self):
        item = make_item(mastery=60, importance=4, last="2026-09-22 09:00")
        record_answer(item, False, NOW)
        first_strength = item.stability_days
        first_due = datetime.fromisoformat(item.next_review)
        record_answer(item, False, NOW + timedelta(hours=4))
        self.assertLess(item.stability_days, first_strength)
        self.assertEqual(item.wrong_streak, 2)
        second_gap = datetime.fromisoformat(item.next_review) - (NOW + timedelta(hours=4))
        self.assertLess(second_gap, first_due - NOW)

    def test_manual_edit_only_changes_affected_item(self):
        changed = make_item("changed", mastery=20, importance=3, last="2026-09-22 09:00")
        unchanged = make_item("unchanged", mastery=70, importance=4, last="2026-09-23 09:00")
        changed.next_review = "2026-09-24 09:00"
        before_next = unchanged.next_review
        before_strength = unchanged.stability_days

        manually_update_item(changed, {"mastery": 95}, NOW)
        self.assertNotEqual(changed.stability_days, make_item(mastery=20).stability_days)
        self.assertIsNotNone(changed.next_review)
        self.assertEqual(unchanged.next_review, before_next)
        self.assertEqual(unchanged.stability_days, before_strength)

    def test_explicit_manual_next_review_is_preserved(self):
        item = make_item(mastery=40, importance=3, last="2026-09-22 09:00")
        manually_update_item(item, {"next_review": "2026-10-01 18:00"}, NOW)
        self.assertTrue(item.manual_next)
        manually_update_item(item, {"importance": 5}, NOW)
        self.assertEqual(item.next_review, "2026-10-01 18:00")

    def test_editing_text_without_scheduling_fields_keeps_due_time(self):
        item = make_item(mastery=40, importance=3, last="2026-09-22 09:00")
        due = item.next_review
        strength = item.stability_days
        manually_update_item(
            item,
            {"title": "new title", "content": "new text", "mastery": 40,
             "importance": 3, "last_reviewed": "2026-09-22 09:00"},
            NOW,
        )
        self.assertEqual(item.next_review, due)
        self.assertEqual(item.stability_days, strength)
        self.assertFalse(item.manual_next)

    def test_chinese_csv_import_and_store_merge(self):
        content = (
            "标题,掌握程度,重要度,上次复习时间\n"
            "中文条目,44,4,2026-09-20 10:00\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "items.csv"
            data_path = Path(directory) / "data.json"
            csv_path.write_text(content, encoding="utf-8-sig")
            rows = import_rows(csv_path)
            store = ReviewStore(data_path)
            count, total = store.upsert_rows(rows)
            self.assertEqual((count, total), (1, 1))
            reloaded = ReviewStore(data_path)
            self.assertEqual(reloaded.list_items()[0].title, "中文条目")

    def test_missing_next_review_is_derived_from_last_review(self):
        unseen = make_item("unseen", mastery=60)
        self.assertIsNotNone(unseen.next_review)
        reviewed = make_item(
            "reviewed", mastery=90, importance=2, last="2026-09-23 08:00"
        )
        due = datetime.fromisoformat(reviewed.next_review)
        self.assertGreater(due, datetime(2026, 9, 23, 8, 0))
        self.assertGreater(due, NOW)


if __name__ == "__main__":
    unittest.main()
