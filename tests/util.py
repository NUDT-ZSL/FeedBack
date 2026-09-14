"""测试公用工具。"""

from __future__ import annotations

from doctree.persistence import Serde
from doctree.tree import DocumentTree


def structure(tree: DocumentTree) -> dict:
    """返回去掉历史栈的结构字典，用于比较树/引用/策略是否一致。"""
    data = Serde.tree_to_dict(tree)
    return {key: data[key] for key in ("version", "policy", "roots", "nodes")}


def clear_history(tree: DocumentTree) -> DocumentTree:
    """清空撤销/重做栈（仅供需要隔离历史基线的测试使用）。"""
    tree._undo.clear()
    tree._redo.clear()
    return tree


def build_doc_tree() -> DocumentTree:
    r"""构造验收用的多层嵌套树::

            doc
           /    \
         ch1    ch2
        / |      |
      s1  s2    s3
      |        /  \
      n1      n2   n3

    引用：n1->n3、s2->n2、n3->ch1、ch2->s1
    """
    tree = DocumentTree()
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
        tree.add_node(nid, parent)
    for source, target in [
        ("n1", "n3"),
        ("s2", "n2"),
        ("n3", "ch1"),
        ("ch2", "s1"),
    ]:
        tree.add_reference(source, target)
    return tree
