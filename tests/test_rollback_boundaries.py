"""回滚与继续编辑交错的边界测试。

重点复查（需求第二轮）：

1. 回滚点恰好落在某次 save 边界；
2. 回滚后先只做不产生变更的查询，再编辑；
3. 跨回滚点 ``diff_versions`` 的增删 / 移动 / 引用变化自洽，
   回滚本身不被当成一次普通变更（不占版本号、不出现在 history 里两次）；
4. 连续回滚、回滚到当前版本、回滚到 v0 后保存与重建；
5. 回滚后 save 再 load，旧分支版本仍可完整重放。
"""

from __future__ import annotations

import os
import tempfile
import unittest

from doctree import DocumentTree
from doctree.persistence import load, save


class RollbackAtSaveBoundaryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "rb.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _build(self) -> DocumentTree:
        t = DocumentTree()
        t.add("r", None, "section")  # 1
        t.add("a", "r", "note", content="v2")  # 2
        t.add("b", "r", "note", content="v3")  # 3
        t.add_ref("b", "a")  # 4
        return t

    def test_rollback_exactly_at_saved_version_then_edit_save_load(self) -> None:
        t = self._build()
        save(t, self.path)          # 文件 v4 —— 回滚目标恰好是 save 边界
        self.assertEqual(t.version, 4)
        t.update_content("a", "later-a")  # 5
        t.add("c", "r", "note")          # 6
        save(t, self.path)               # v6 落盘

        t.rollback(4)                    # 精确回到 save 边界
        self.assertEqual(t.version, 4)
        self.assertEqual(t.get_node("a").content, "v2")
        self.assertNotIn("c", t)
        self.assertEqual(t.get_node("r").children, ["a", "b"])
        t.validate()

        # 回滚本身不是变更：history 里 4 只出现一次，不新增版本。
        self.assertEqual(t.history().count(4), 1)

        save(t, self.path)               # 回滚点 == 已落盘版本：仅追加 checkpoint
        u = load(self.path)
        self.assertEqual(u.version, 4)
        self.assertEqual(u.preorder_ids(), ["r", "a", "b"])
        u.validate()
        # 旧分支 v5/v6 仍可从文件重放。
        self.assertEqual(u.state_at_version(6).get_node("a").content, "later-a")
        self.assertIn("c", u.state_at_version(6))

    def test_queries_between_rollback_and_edit_create_no_changes(self) -> None:
        t = self._build()
        save(t, self.path)
        t.update_content("a", "temp")   # 5
        t.rollback(4)

        # 一串只读操作，不得改变版本/历史/分段状态。
        queries = [
            lambda: t.get_path("b"),
            lambda: t.get_subtree("r"),
            lambda: t.get_subtree("r", max_depth=1),
            lambda: t.find_by_kind("note"),
            lambda: t.resolve_refs("b"),
            lambda: t.get_dangling_refs(),
            lambda: t.history(),
            lambda: t.diff_versions(2, 4),
            lambda: t.dump_state(),
            lambda: t.state_at_version(2),
        ]
        for q in queries:
            q()
        self.assertEqual(t.version, 4)
        segments_after_queries = len(t._segments)
        self.assertEqual(t.history().count(4), 1)

        t.update_content("a", "new-branch")  # 编辑 -> 全局单调，得到 v6
        self.assertEqual(t.version, 6)       # 不复用被回滚分支的 5
        self.assertEqual(len(t._segments), segments_after_queries)
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(u.version, 6)
        self.assertEqual(u.get_node("a").content, "new-branch")
        self.assertNotIn("temp", [u.get_node(n).content for n in u.preorder_ids()])

    def test_rollback_to_current_version_is_noop(self) -> None:
        t = self._build()
        before_segments = len(t._segments)
        t.rollback(t.version)
        self.assertEqual(len(t._segments), before_segments)
        self.assertEqual(t.version, 4)

    def test_consecutive_rollbacks(self) -> None:
        t = self._build()           # v4
        t.update_content("a", "x5")  # 5
        t.update_content("a", "x6")  # 6
        t.rollback(5)
        self.assertEqual(t.get_node("a").content, "x5")
        t.rollback(4)
        self.assertEqual(t.get_node("a").content, "v2")
        t.update_content("a", "x7")
        self.assertEqual(t.version, 7)  # 5、6 不复用
        self.assertEqual(t.get_node("a").content, "x7")

    def test_rollback_to_zero_empty_then_rebuild_and_save(self) -> None:
        t = self._build()
        save(t, self.path)
        t.rollback(0)
        self.assertEqual(len(t), 0)
        self.assertIsNone(t.root_id)
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(len(u), 0)
        self.assertEqual(u.version, 0)
        u.validate()
        # 旧版本仍在文件里可回放。
        self.assertEqual(u.state_at_version(4).preorder_ids(), ["r", "a", "b"])
        # 空树上重新建树，版本号继续单调。
        u.add("newroot", None, "section")
        self.assertEqual(u.version, 5)
        save(u, self.path)
        w = load(self.path)
        self.assertEqual(w.preorder_ids(), ["newroot"])
        self.assertEqual(w.version, 5)


class CrossRollbackDiffTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "diff.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_diff_across_rollback_point_nodes_and_content(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")      # 1
        t.add("a", "r", "note", content="A")  # 2
        save(t, self.path)                # save 边界 v2
        t.add("b", "r", "note")           # 3
        t.update_content("a", "A-later")  # 4
        save(t, self.path)
        t.rollback(2)
        # 回滚后只查询。
        _ = t.get_subtree("r")
        t.update_content("a", "A-branch")  # 新分支 v5
        save(t, self.path)
        u = load(self.path)

        # 旧分支 v4：b 存在、a=A-later；新分支 v5：b 不存在、a=A-branch。
        d = u.diff_versions(4, 5).to_dict()
        self.assertEqual(d["removed"], ["b"])
        self.assertEqual(d["added"], [])
        self.assertEqual(
            d["content_changed"],
            [{"node_id": "a", "old": "A-later", "new": "A-branch"}],
        )
        # 反向 diff 对称。
        drev = u.diff_versions(5, 4).to_dict()
        self.assertEqual(drev["added"], ["b"])
        self.assertEqual(
            drev["content_changed"],
            [{"node_id": "a", "old": "A-branch", "new": "A-later"}],
        )
        # 回滚点 v2 -> 新分支 v5：没有节点增删，只有内容变化。
        d25 = u.diff_versions(2, 5).to_dict()
        self.assertEqual(d25["added"], [])
        self.assertEqual(d25["removed"], [])
        self.assertEqual(
            d25["content_changed"],
            [{"node_id": "a", "old": "A", "new": "A-branch"}],
        )

    def test_diff_across_rollback_point_refs(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")   # 1
        t.add("a", "r", "note")       # 2
        t.add("b", "r", "note")       # 3
        t.add_ref("b", "a")           # 4
        save(t, self.path)             # save 边界 v4
        t.add("c", "r", "note")       # 5
        t.add_ref("c", "a")           # 6
        t.remove_ref("b", "a")        # 7
        save(t, self.path)
        t.rollback(4)
        # 查询交错。
        self.assertEqual(t.get_dangling_refs(), [])
        self.assertEqual([r["target"] for r in t.resolve_refs("b")], ["a"])
        t.add_ref("a", "b")           # 新分支 v8：加一条反向引用
        save(t, self.path)
        u = load(self.path)

        d78 = u.diff_versions(7, 8).to_dict()
        self.assertEqual(d78["removed"], ["c"])
        self.assertIn({"owner": "c", "target": "a"}, d78["refs_removed"])
        # v7 删了 b->a，v8（源自 v4）里它仍在 -> 体现为“新增”。
        self.assertIn({"owner": "b", "target": "a"}, d78["refs_added"])
        self.assertIn({"owner": "a", "target": "b"}, d78["refs_added"])

        # 回滚点 v4 -> 新分支 v8：只有新分支真正新增的 a->b。
        d48 = u.diff_versions(4, 8).to_dict()
        self.assertEqual(d48["refs_added"], [{"owner": "a", "target": "b"}])
        self.assertEqual(d48["refs_removed"], [])
        self.assertEqual(d48["added"], [])
        self.assertEqual(d48["removed"], [])

    def test_diff_across_rollback_point_moves(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")    # 1
        t.add("a", "r", "section")     # 2
        t.add("x", "a", "note")        # 3
        t.add("y", "a", "note")        # 4
        save(t, self.path)              # v4
        t.move("x", "r", 0)            # 5：x 提升到根下首位
        save(t, self.path)
        t.rollback(4)
        # 查询交错后在新分支上做另一次移动：y 提升。
        _ = t.get_path("x")
        t.move("y", "r", 0)            # v6（不复用 5）
        save(t, self.path)
        u = load(self.path)

        # v5: x 在 r 下；v6: x 在 a 下、y 在 r 下。
        d = u.diff_versions(5, 6).to_dict()
        moved = {m["node_id"]: m for m in d["moved"]}
        self.assertIn("x", moved)
        self.assertIn("y", moved)
        self.assertEqual(moved["x"]["old_parent_id"], "r")
        self.assertEqual(moved["x"]["new_parent_id"], "a")
        self.assertEqual(moved["y"]["old_parent_id"], "a")
        self.assertEqual(moved["y"]["new_parent_id"], "r")
        # 路径也必须反映各自版本。
        self.assertEqual(moved["x"]["new_path"], ["r", "a", "x"])
        self.assertEqual(moved["y"]["new_path"], ["r", "y"])

    def test_rollback_is_not_a_change_in_diff_or_history(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")  # 1
        t.add("a", "r", "note")      # 2
        t.rollback(1)
        # 回滚不产生新版本：紧接着的 diff(1, 当前版本) 应无任何差异。
        d = t.diff_versions(1, t.version).to_dict()
        self.assertEqual(d["added"], [])
        self.assertEqual(d["removed"], [])
        self.assertEqual(d["moved"], [])
        self.assertEqual(d["content_changed"], [])
        self.assertEqual(d["refs_added"], [])
        self.assertEqual(d["refs_removed"], [])
        # 被回滚掉的 v2 仍可通过历史重放（旧分支只读保留）。
        self.assertIn("a", t.state_at_version(2))


if __name__ == "__main__":
    unittest.main()
