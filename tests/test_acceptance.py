"""验收场景：多层嵌套树上反复跨层拖拽、删除、撤销重做。

所有期望状态均手工逐步推导，用缩进结构字符串精确比对层级、顺序、路径
与引用（悬空引用以 ``!`` 标注）。
"""

from __future__ import annotations

import unittest

from doctree import DocumentTree
from doctree.model import DanglingPolicy


def render(tree: DocumentTree) -> str:
    """按展示顺序渲染树，引用以 ``[-> x,-> y]`` 行内标注，悬空加 ``!``。"""
    lines: list[str] = []

    def walk(nid: str, depth: int) -> None:
        node = tree.node(nid)
        refs = ""
        if node.references:
            marks = [
                f"->{t}{'!' if t not in tree else ''}" for t in node.references
            ]
            refs = " [" + ", ".join(marks) + "]"
        lines.append("  " * depth + nid + refs)
        for child in node.children:
            walk(child, depth + 1)

    for root in tree.roots:
        walk(root, 0)
    return "\n".join(lines)


class DragAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        r"""初始结构::

            doc
            ├─ ch1
            │  ├─ s1
            │  │  └─ n1
            │  └─ s2
            └─ ch2
               └─ s3
                  ├─ n2
                  └─ n3
        """
        self.tree = DocumentTree()
        for nid, parent in [
            ("doc", None),
            ("ch1", "doc"),
            ("ch2", "doc"),
            ("s1", "ch1"),
            ("s2", "ch1"),
            ("s3", "ch2"),
            ("n1", "s1"),
            ("n2", "s3"),
            ("n3", "s3"),
        ]:
            self.tree.add_node(nid, parent)
        # n1 引用 n3（跨层），s2 引用 ch2，n3 引用 s1，ch2 引用 n2
        self.tree.add_reference("n1", "n3")
        self.tree.add_reference("s2", "ch2")
        self.tree.add_reference("n3", "s1")
        self.tree.add_reference("ch2", "n2")

    def test_initial_structure(self) -> None:
        expected = (
            "doc\n"
            "  ch1\n"
            "    s1\n"
            "      n1 [->n3]\n"
            "    s2 [->ch2]\n"
            "  ch2 [->n2]\n"
            "    s3\n"
            "      n2\n"
            "      n3 [->s1]"
        )
        self.assertEqual(render(self.tree), expected)
        self.assertEqual(self.tree.path_of("n3"), ("doc", "ch2", "s3", "n3"))

    def test_cross_level_drag_script(self) -> None:
        tree = self.tree

        # 1) 把 s3 拖到 ch1 下、位置 1（ch1 孩子摘下视角：s1, s2 -> s1, s3, s2）
        r1 = tree.move("s3", "ch1", 1)
        self.assertEqual(r1.moved_nodes, ("s3", "n2", "n3"))
        self.assertEqual(r1.old_paths["n3"], ("doc", "ch2", "s3", "n3"))
        self.assertEqual(r1.new_paths["n3"], ("doc", "ch1", "s3", "n3"))
        self.assertEqual(
            render(tree),
            "doc\n"
            "  ch1\n"
            "    s1\n"
            "      n1 [->n3]\n"
            "    s3\n"
            "      n2\n"
            "      n3 [->s1]\n"
            "    s2 [->ch2]\n"
            "  ch2 [->n2]",
        )
        # 移动不产生悬空引用，四条引用全部仍可达
        self.assertEqual(tree.dangling_references(), ())
        # 受影响引用：n1->n3、ch2->n2（目标进子树）、n3->s1（来源进子树）
        affected = sorted((a.source, a.target) for a in r1.affected_references)
        self.assertEqual(affected, [("ch2", "n2"), ("n1", "n3"), ("n3", "s1")])

        # 2) 把 n1 拖到 s3 下末尾（s3: n2, n3 -> n2, n3, n1）
        tree.move("n1", "s3", 2)
        self.assertEqual(
            tree.path_of("n1"), ("doc", "ch1", "s3", "n1")
        )
        self.assertEqual(tree.node("s1").children, ())

        # 3) 同父重排：把 n1 从 s3 末尾移到位置 0
        tree.move("n1", "s3", 0)
        self.assertEqual(tree.node("s3").children, ("n1", "n2", "n3"))

        # 4) 试图把 s3 移进自己的后代 n1 —— 必须拒绝且无变化
        before = render(tree)
        with self.assertRaisesRegex(Exception, "子树"):
            tree.move("s3", "n1", 0)
        self.assertEqual(render(tree), before)

        # 5) 越界位置拒绝（s3 有 3 个孩子，移动 n1 先摘下，合法 0..2）
        with self.assertRaisesRegex(Exception, "越界"):
            tree.move("n1", "s3", 3)
        self.assertEqual(render(tree), before)

        # 6) 撤销三步移动，严格回到初始结构与路径
        tree.undo()  # 撤销步骤 3
        self.assertEqual(tree.node("s3").children, ("n2", "n3", "n1"))
        tree.undo()  # 撤销步骤 2
        self.assertEqual(tree.node("s1").children, ("n1",))
        tree.undo()  # 撤销步骤 1
        self.assertEqual(
            tree.path_of("n3"), ("doc", "ch2", "s3", "n3")
        )
        self.assertEqual(tree.node("ch1").children, ("s1", "s2"))
        self.assertEqual(tree.node("ch2").children, ("s3",))

        # 7) 重做第一步并与首次结果一致
        tree.redo()
        self.assertEqual(tree.node("ch1").children, ("s1", "s3", "s2"))
        self.assertEqual(tree.path_of("n3"), ("doc", "ch1", "s3", "n3"))

    def test_delete_with_references_and_undo_script(self) -> None:
        tree = self.tree

        # 级联策略下删除 s1（含 n1）：n3->s1 被清理，n1->n3 随来源消失
        result = tree.delete("s1")
        self.assertEqual(result.deleted_nodes, ("s1", "n1"))
        self.assertEqual(result.removed_references, (("n3", "s1"),))
        self.assertEqual(tree.outgoing_references("n3"), ())
        # 其余引用不受影响
        self.assertEqual(tree.outgoing_references("s2"), ("ch2",))
        self.assertEqual(tree.outgoing_references("ch2"), ("n2",))

        # 撤销：s1、n1 以及 n3->s1 精确恢复，子顺序恢复
        tree.undo()
        self.assertEqual(tree.node("ch1").children, ("s1", "s2"))
        self.assertEqual(tree.path_of("n1"), ("doc", "ch1", "s1", "n1"))
        self.assertEqual(tree.outgoing_references("n3"), ("s1",))
        self.assertEqual(tree.outgoing_references("n1"), ("n3",))

        # 重做结果与首次删除一致
        redo_cmd = tree.redo()
        self.assertEqual(redo_cmd.kind, "delete")
        self.assertEqual(redo_cmd.root_id, "s1")
        self.assertNotIn("s1", tree)
        self.assertNotIn("n1", tree)
        self.assertEqual(tree.outgoing_references("n3"), ())

    def test_keep_dangling_switch_and_undo_script(self) -> None:
        tree = self.tree
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)

        # 删除 s3（n2、n3）：n1->n3 悬空；ch2->n2 悬空；n3->s1 随来源消失
        tree.delete("s3")
        dangling = sorted((v.source, v.target) for v in tree.dangling_references())
        self.assertEqual(dangling, [("ch2", "n2"), ("n1", "n3")])
        self.assertTrue(tree.references_of("n1")[0].dangling)

        # 撤销删除：悬空全部消失
        tree.undo()
        self.assertEqual(tree.dangling_references(), ())

        # 重做后再切回级联：悬空被清理，且可分两步撤销
        tree.redo()
        tree.set_dangling_policy(DanglingPolicy.CASCADE)
        self.assertEqual(tree.outgoing_references("n1"), ())
        self.assertEqual(tree.outgoing_references("ch2"), ())
        tree.undo()  # 撤销策略切换
        self.assertEqual(tree.outgoing_references("n1"), ("n3",))
        tree.undo()  # 撤销删除
        self.assertIn("s3", tree)
        self.assertEqual(tree.node("ch2").children, ("s3",))
        self.assertEqual(tree.outgoing_references("n3"), ("s1",))


if __name__ == "__main__":
    unittest.main()
