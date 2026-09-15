"""合并内核测试：LCS、确定性、与串行等价、冲突保留双方。"""

import itertools
import random
import unittest

from experience_graph import merge


class SplitJoinTests(unittest.TestCase):
    def test_roundtrip(self):
        for text in ["", "一行", "a\n", "a\n\nb", "首\n次\n"]:
            self.assertEqual(merge.join_paragraphs(merge.split_paragraphs(text)), text)


class EditScriptTests(unittest.TestCase):
    def test_replace_middle(self):
        slots, gaps = merge.diff_edit_script("L0\nL1\nL2", "L0\nA1\nL2")
        self.assertEqual(slots[0], ("K",))
        self.assertEqual(slots[1], ("R", ("A1",)))
        self.assertEqual(slots[2], ("K",))
        self.assertEqual(gaps, {})

    def test_delete_and_insert(self):
        slots, gaps = merge.diff_edit_script("L0\nL1\nL2", "L0\nL2")
        self.assertEqual(slots[1], ("D",))
        slots2, gaps2 = merge.diff_edit_script("L0\nL1", "L0\nX\nL1")
        self.assertEqual(gaps2.get(1), ("X",))

    def test_no_change_is_all_keep(self):
        slots, gaps = merge.diff_edit_script("a\nb", "a\nb")
        self.assertTrue(all(s == ("K",) for s in slots))
        self.assertEqual(gaps, {})


class LineDiffTests(unittest.TestCase):
    def test_actions(self):
        ops = merge.line_diff("a\nb\nc", "a\nB\nc")
        self.assertEqual([o[0] for o in ops], ["eq", "del", "ins", "eq"])

    def test_rendered_is_stable(self):
        d1 = merge.render_diff("a\nb", "a\nB")
        d2 = merge.render_diff("a\nb", "a\nB")
        self.assertEqual(d1, d2)
        self.assertIn("- b", d1)
        self.assertIn("+ B", d1)


class DisjointMergeTests(unittest.TestCase):
    """改动不同段落：自动合并，且等价于任意顺序的串行应用。"""

    base = "P0\nP1\nP2\nP3"
    candidates = [
        ("alice", 0, "X0\nP1\nP2\nP3"),                 # 改段 0
        ("bob", 0, "P0\nP1\nY2\nP3"),                   # 改段 2
        ("carol", 0, "P0\nP1\nP2\nINS\nP3"),            # 在段 3 前插入
    ]

    def test_clean_merge_has_no_conflict(self):
        blocks, conflicts = merge.integrate(self.base, self.candidates)
        self.assertEqual(conflicts, [])
        body = merge.render_blocks(blocks)
        self.assertEqual(body, "X0\nP1\nY2\nINS\nP3")

    def test_equals_serial_for_every_permutation(self):
        blocks, _ = merge.integrate(self.base, self.candidates)
        merged = merge.render_blocks(blocks)
        for order in itertools.permutations(range(len(self.candidates))):
            serial = merge.apply_serially(self.base, self.candidates, list(order))
            self.assertEqual(
                serial, merged,
                msg=f"批量合并与串行顺序 {order} 不一致",
            )

    def test_order_independent(self):
        bodies = set()
        for order in itertools.permutations(self.candidates):
            blocks, _ = merge.integrate(self.base, list(order))
            bodies.add(merge.render_blocks(blocks))
        self.assertEqual(len(bodies), 1)

    def test_delete_disjoint_merges(self):
        cands = [
            ("alice", 0, "X0\nP1\nP2\nP3"),
            ("bob", 0, "P0\nP1\nP2"),                     # 删除段 3
        ]
        blocks, conflicts = merge.integrate(self.base, cands)
        self.assertEqual(conflicts, [])
        self.assertEqual(merge.render_blocks(blocks), "X0\nP1\nP2")


class ConflictTests(unittest.TestCase):
    def test_same_paragraph_different_editions_conflict(self):
        base = "P0\nP1"
        blocks, conflicts = merge.integrate(base, [
            ("alice", 0, "P0\nA1"),
            ("bob", 0, "P0\nB1"),
        ])
        self.assertEqual(len(conflicts), 1)
        conf = conflicts[0]
        self.assertEqual(conf["kind"], "slot")
        self.assertEqual(conf["location"], 1)
        authors = {p["author"] for p in conf["parties"]}
        self.assertEqual(authors, {"alice", "bob"})
        # 双方原文都保留
        rendered = merge.render_blocks(blocks)
        self.assertIn("A1", rendered)
        self.assertIn("B1", rendered)
        self.assertIn("alice", rendered)
        self.assertIn("bob", rendered)

    def test_edit_versus_delete_is_conflict(self):
        base = "P0\nP1"
        blocks, conflicts = merge.integrate(base, [
            ("alice", 0, "P0\nA1"),   # 改段 1
            ("bob", 0, "P0"),         # 删段 1
        ])
        self.assertEqual(len(conflicts), 1)
        actions = {p["action"] for p in conflicts[0]["parties"]}
        self.assertEqual(actions, {"replace", "delete"})
        self.assertIn("A1", merge.render_blocks(blocks))

    def test_identical_editions_merge_clean(self):
        # 双方改成完全相同内容 => 意图一致，自动合并而非冲突
        blocks, conflicts = merge.integrate("P0\nP1", [
            ("alice", 0, "P0\nSAME"),
            ("bob", 0, "P0\nSAME"),
        ])
        self.assertEqual(conflicts, [])
        self.assertEqual(merge.render_blocks(blocks), "P0\nSAME")


class RandomizedDisjointEquivalence(unittest.TestCase):
    """随机生成互不相交的段落改动，验证批量==任意顺序串行（确定性、收敛）。"""

    def test_many_cases(self):
        rng = random.Random(20260916)
        for _ in range(200):
            n = rng.randint(1, 8)
            base_lines = [f"L{i}" for i in range(n)]
            base = "\n".join(base_lines)

            # 每位作者挑一个互不重叠的段落做：改 / 删 / 在其前插入
            authors = [f"u{k}" for k in range(rng.randint(1, min(3, n)))]
            chosen = rng.sample(range(n), len(authors))
            candidates = []
            for author, slot in zip(authors, chosen):
                lines = list(base_lines)
                mode = rng.choice(["replace", "delete", "insert"])
                if mode == "replace":
                    lines[slot] = f"{author}-{slot}"
                elif mode == "delete":
                    del lines[slot]
                else:
                    lines.insert(slot, f"{author}-ins-{slot}")
                candidates.append((author, 0, "\n".join(lines)))

            blocks, conflicts = merge.integrate(base, candidates)
            # 不同段落，绝不冲突
            self.assertEqual(conflicts, [], msg=f"base={base!r} cands={candidates}")
            batch = merge.render_blocks(blocks)
            for order in itertools.permutations(range(len(candidates))):
                serial = merge.apply_serially(base, candidates, list(order))
                self.assertEqual(
                    serial, batch,
                    msg=f"不一致 base={base!r} cands={candidates} order={order}",
                )


if __name__ == "__main__":
    unittest.main()
