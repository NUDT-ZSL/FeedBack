"""基于参考模型的随机差分测试。

对固定种子生成的随机操作序列（跨层拖拽、同父重排、删除、引用增删、
策略切换、撤销、重做、JSON 往返），每一步都与一个独立维护的参考状态
比对：完整结构、每个节点路径（独立沿 parent 链推导）以及移动报告中的
受影响引用集合。失败操作必须不改变任何状态。
"""

from __future__ import annotations

import random
import unittest

from doctree import DocumentTree
from doctree.model import DanglingPolicy
from doctree.persistence import dumps, loads
from tests.util import structure


def reference_paths(state: dict) -> dict:
    """沿 parent 链独立推导每个节点的路径（含自身）。"""
    nodes = state["nodes"]
    paths: dict = {}
    for nid in nodes:
        parts = []
        cur = nid
        seen = set()
        while cur is not None:
            if cur in seen:
                raise AssertionError("参考模型检测到环")
            seen.add(cur)
            parts.append(cur)
            cur = nodes[cur]["parent"]
        parts.reverse()
        paths[nid] = tuple(parts)
    return paths


def subtree_set(state: dict, root: str) -> set:
    """在参考状态中求以 root 为根的子树节点集合。"""
    result = {root}
    stack = [root]
    while stack:
        current = stack.pop()
        for child in state["nodes"][current]["children"]:
            result.add(child)
            stack.append(child)
    return result


class RandomizedModelTests(unittest.TestCase):
    def _run_seed(self, seed: int, operations: int) -> None:
        rng = random.Random(seed)
        tree = DocumentTree()

        # 参考历史：states[k] 为第 k 个已应用变更之后的结构；pointer 指向当前。
        # 连初始随机构造的 add_node 也逐步记录（它们同样可撤销）。
        states = [structure(tree)]
        pointer = 0

        # 先建一棵随机多层树。
        tree.add_node("n0")
        states.append(structure(tree))
        pointer += 1
        for i in range(1, 24):
            parent = f"n{rng.randrange(i)}"
            tree.add_node(f"n{i}", parent)
            states.append(structure(tree))
            pointer += 1

        def assert_matches(expected: dict) -> None:
            self.assertEqual(structure(tree), expected)
            paths = reference_paths(expected)
            for nid, path in paths.items():
                self.assertEqual(tree.path_of(nid), path)

        def commit() -> None:
            """把当前结构作为新的撤销点记录（并截断被放弃的重做分支）。"""
            nonlocal pointer, states
            states = states[: pointer + 1]
            states.append(structure(tree))
            pointer += 1

        for step in range(operations):
            ids = tree.all_node_ids()
            choice = rng.randrange(10)

            if choice == 0 and ids:  # 移动
                node_id = ids[rng.randrange(len(ids))]
                new_parent = None if rng.random() < 0.2 else ids[rng.randrange(len(ids))]
                pre = structure(tree)
                target_len = (
                    len(tree.roots)
                    if new_parent is None
                    else len(tree.node(new_parent).children)
                )
                if tree.node(node_id).parent == new_parent:
                    target_len -= 1
                index = rng.randint(-1, target_len + 1)
                try:
                    result = tree.move(node_id, new_parent, index)
                except Exception:
                    self.assertEqual(structure(tree), pre)  # 失败零修改
                else:
                    post = structure(tree)
                    # 受影响引用集合独立推导
                    moved = subtree_set(pre, node_id)
                    expected_affected = {
                        (s, t)
                        for s, nd in pre["nodes"].items()
                        for t in nd["references"]
                        if s in moved or t in moved
                    }
                    self.assertEqual(
                        {(a.source, a.target) for a in result.affected_references},
                        expected_affected,
                    )
                    self.assertEqual(set(result.moved_nodes), moved)
                    commit()

            elif choice == 1 and ids:  # 删除
                node_id = ids[rng.randrange(len(ids))]
                pre = structure(tree)
                result = tree.delete(node_id)
                # 被删集合与子树一致
                self.assertEqual(set(result.deleted_nodes), subtree_set(pre, node_id))
                commit()

            elif choice == 2:  # 增加引用
                if len(ids) >= 2:
                    s, t = rng.sample(list(ids), 2)
                    pre = structure(tree)
                    try:
                        tree.add_reference(s, t)
                    except Exception:
                        self.assertEqual(structure(tree), pre)
                    else:
                        commit()

            elif choice == 3:  # 删除引用
                pre = structure(tree)
                existing = [
                    (s, t)
                    for s, nd in pre["nodes"].items()
                    for t in nd["references"]
                ]
                if existing:
                    s, t = existing[rng.randrange(len(existing))]
                    tree.remove_reference(s, t)
                    commit()

            elif choice == 4:  # 切换策略
                new_policy = rng.choice(list(DanglingPolicy))
                if new_policy is not tree.policy:
                    tree.set_dangling_policy(new_policy)
                    commit()
                else:
                    tree.set_dangling_policy(new_policy)  # 空操作
                    self.assertEqual(tree.undo_depth, pointer)

            elif choice == 5 and tree.can_undo:  # 撤销
                tree.undo()
                pointer -= 1
                assert_matches(states[pointer])
                continue

            elif choice == 6 and tree.can_redo:  # 重做
                tree.redo()
                pointer += 1
                assert_matches(states[pointer])
                continue

            elif choice == 7:  # 新增节点（可撤销，并清空重做分支）
                if ids:
                    parent = ids[rng.randrange(len(ids))]
                    name = f"x{step}"
                    if name not in tree:
                        tree.add_node(name, parent)
                        commit()

            elif choice == 8 and step % 25 == 0:  # JSON 往返后继续工作
                restored = loads(dumps(tree))
                self.assertEqual(structure(restored), states[pointer])
                self.assertEqual(restored.undo_depth, tree.undo_depth)
                self.assertEqual(restored.redo_depth, tree.redo_depth)
                tree = restored

            # 常规断言：当前结构必须等于参考当前点
            assert_matches(states[pointer])

        # 序列结束后：一路撤销到底，再重做回顶，全部必须精确吻合
        while tree.can_undo:
            tree.undo()
            pointer -= 1
            assert_matches(states[pointer])
        while tree.can_redo:
            tree.redo()
            pointer += 1
            assert_matches(states[pointer])

    def test_seeds(self) -> None:
        for seed in range(1, 13):
            with self.subTest(seed=seed):
                self._run_seed(seed, 220)


if __name__ == "__main__":
    unittest.main()
