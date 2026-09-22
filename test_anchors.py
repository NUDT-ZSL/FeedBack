"""Unit and fuzz tests for the anchor remapping engine."""

import random
import string
import unittest

from anchors import (
    Edit, DocumentTracker, apply_edits, map_interval,
    RESOLVED, PENDING, INVALID,
)


class MapIntervalTests(unittest.TestCase):
    def test_insert_before_shifts(self):
        ns, ne, touched, destroyed = map_interval(5, 10, Edit("insert", 0, text="ab"))
        self.assertEqual((ns, ne), (7, 12))
        self.assertFalse(touched)
        self.assertFalse(destroyed)

    def test_insert_inside_expands(self):
        ns, ne, touched, _ = map_interval(5, 10, Edit("insert", 7, text="abc"))
        self.assertEqual((ns, ne), (5, 13))
        self.assertFalse(touched)

    def test_insert_at_boundary_stays_outside(self):
        ns, ne, _, _ = map_interval(5, 10, Edit("insert", 5, text="abc"))
        self.assertEqual((ns, ne), (8, 13))
        ns, ne, _, _ = map_interval(5, 10, Edit("insert", 10, text="abc"))
        self.assertEqual((ns, ne), (5, 10))

    def test_delete_before_shifts(self):
        ns, ne, touched, _ = map_interval(5, 10, Edit("delete", 0, length=3))
        self.assertEqual((ns, ne), (2, 7))
        self.assertFalse(touched)

    def test_delete_partial_overlap_pending(self):
        ns, ne, touched, destroyed = map_interval(5, 10, Edit("delete", 7, length=10))
        self.assertEqual((ns, ne), (5, 7))
        self.assertTrue(touched)
        self.assertFalse(destroyed)

    def test_delete_full_overlap_invalid(self):
        _, _, touched, destroyed = map_interval(5, 10, Edit("delete", 0, length=20))
        self.assertTrue(touched)
        self.assertTrue(destroyed)

    def test_replace_inside(self):
        ns, ne, touched, _ = map_interval(5, 10, Edit("replace", 6, length=2, text="XY"))
        self.assertEqual((ns, ne), (5, 10))
        self.assertTrue(touched)


class TrackerTests(unittest.TestCase):
    def setUp(self):
        self.doc = "The quick brown fox jumps over the lazy dog."
        self.comments = [
            {"id": 1, "start": 4, "end": 9, "content": "quick"},     # quick
            {"id": 2, "start": 10, "end": 19, "content": "brown fox"},
            {"id": 3, "start": 35, "end": 43, "content": "lazy dog"},
        ]

    def test_sequential_mapping_matches_final_document(self):
        edits = [
            Edit("replace", 4, length=5, text="swift"),       # quick -> swift
            Edit("delete", 10, length=6),                     # remove "brown "
            Edit("insert", 0, text=">> "),                    # prefix
        ]
        t = DocumentTracker(self.doc, self.comments)
        for e in edits:
            t.add_edit(e)
        final = apply_edits(self.doc, edits)
        self.assertEqual(t.document, final)
        for c in t.comments:
            if c.status != INVALID:
                # anchored interval must be inside the final document
                self.assertTrue(0 <= c.start < c.end <= len(final))

    def test_status_transitions(self):
        t = DocumentTracker(self.doc, self.comments)
        t.add_edit(Edit("replace", 4, length=2, text="sw"))
        self.assertEqual(t.comments[0].status, PENDING)   # partially modified
        self.assertEqual(t.comments[1].status, RESOLVED)  # untouched
        t.add_edit(Edit("delete", 35, length=9))
        self.assertEqual(t.comments[2].status, INVALID)   # fully deleted

    def test_full_replace_of_anchor_is_invalid(self):
        t = DocumentTracker(self.doc, self.comments)
        t.add_edit(Edit("replace", 4, length=5, text="swift"))
        self.assertEqual(t.comments[0].status, INVALID)

    def test_keep_and_delete(self):
        t = DocumentTracker(self.doc, self.comments)
        t.add_edit(Edit("replace", 4, length=2, text="sw"))
        t.keep_comment(1)
        self.assertEqual(t.comments[0].status, RESOLVED)
        t.delete_comment(2)
        self.assertEqual([c.id for c in t.comments], [1, 3])
        with self.assertRaises(ValueError):
            t.keep_comment(1)  # already resolved


class FuzzTests(unittest.TestCase):
    """Requirement 6: sequential interval mapping must agree with the result
    of applying all edits to the initial document.

    Verification strategy: tag every initial character with a unique id and
    replay the same edits on the (char, id) list. For each surviving comment,
    the mapped interval in the final document must span exactly the surviving
    original characters of that comment's initial anchor.
    """

    def test_random_edit_sequences(self):
        rng = random.Random(20260922)
        for trial in range(300):
            self._run_trial(rng, trial)

    def _run_trial(self, rng, trial):
        doc = "".join(rng.choice(string.ascii_lowercase) for _ in range(rng.randint(20, 120)))
        n_comments = rng.randint(1, 6)
        comments = []
        for i in range(n_comments):
            s = rng.randrange(0, len(doc) - 1)
            e = rng.randrange(s + 1, len(doc) + 1)
            comments.append({"id": i + 1, "start": s, "end": e, "content": f"c{i}"})

        # tagged replay model: list of (char, id); ids are initial positions
        tagged = [(ch, i) for i, ch in enumerate(doc)]
        edits = []
        cur = doc
        for _ in range(rng.randint(1, 25)):
            kind = rng.choice(["insert", "delete", "replace"])
            if kind == "insert" or not cur:
                pos = rng.randrange(0, len(cur) + 1)
                text = "".join(rng.choice(string.ascii_lowercase)
                               for _ in range(rng.randint(1, 6)))
                edit = Edit("insert", pos, text=text)
                tagged[pos:pos] = [(ch, None) for ch in text]
            else:
                pos = rng.randrange(0, len(cur))
                length = rng.randint(1, len(cur) - pos)
                if kind == "delete":
                    edit = Edit("delete", pos, length=length)
                    del tagged[pos:pos + length]
                else:
                    text = "".join(rng.choice(string.ascii_lowercase)
                                   for _ in range(rng.randint(0, 5)))
                    edit = Edit("replace", pos, length=length, text=text)
                    tagged[pos:pos + length] = [(ch, None) for ch in text]
            cur = apply_edits(cur, [edit])
            self.assertEqual(len(cur), len(tagged))
            edits.append(edit)

        tracker = DocumentTracker(doc, comments)
        for e in edits:
            tracker.add_edit(e)

        final_text = "".join(ch for ch, _ in tagged)
        self.assertEqual(tracker.document, final_text,
                         f"trial {trial}: document divergence")

        for c, spec in zip(tracker.comments, comments):
            surviving = [i for i, (_, cid) in enumerate(tagged)
                         if cid is not None and spec["start"] <= cid < spec["end"]]
            if not surviving:
                self.assertEqual(c.status, INVALID,
                                 f"trial {trial} comment {c.id} should be invalid")
            else:
                self.assertNotEqual(c.status, INVALID,
                                    f"trial {trial} comment {c.id} wrongly invalid")
                self.assertEqual(c.start, surviving[0],
                                 f"trial {trial} comment {c.id} start mismatch")
                self.assertEqual(c.end, surviving[-1] + 1,
                                 f"trial {trial} comment {c.id} end mismatch")


if __name__ == "__main__":
    unittest.main(verbosity=2)
