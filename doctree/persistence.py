"""JSON 持久化：保存/载入文档树、引用、悬空策略与完整的撤销重做历史。

载入流程分两阶段：先把 JSON 完整解析并在一个**临时** :class:`DocumentTree`
上重建与校验，全部通过后才替换调用方的树，因此文件损坏或字段缺失时
原状态保持不变。

文件格式（``version = 1``）::

    {
      "version": 1,
      "policy": "cascade" | "keep_dangling",
      "roots": ["id1", ...],
      "nodes": {
        "id1": {"id": "id1", "parent": null, "children": [...], "references": [...]},
        ...
      },
      "history": {
        "undo": [ <command>, ... ],
        "redo": [ <command>, ... ]
      }
    }
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Dict, List, Union

from .errors import SerializationError
from .history import Command
from .model import CONFIG_VERSION, DanglingPolicy
from .tree import DocumentTree, _Node


class Serde:
    """JSON 字典 <-> :class:`DocumentTree` 的转换工具（内部使用）。"""

    @staticmethod
    def err(message: str) -> SerializationError:
        """构造带统一前缀的序列化异常。"""
        return SerializationError(message)

    # ------------------------------------------------------------------ #
    # 序列化
    # ------------------------------------------------------------------ #

    @staticmethod
    def tree_to_dict(tree: DocumentTree) -> Dict[str, Any]:
        """把完整树（含历史栈）序列化为普通字典。"""
        nodes: Dict[str, Any] = {}
        for nid in tree.all_node_ids():
            view = tree.node(nid)
            nodes[nid] = {
                "id": view.id,
                "parent": view.parent,
                "children": list(view.children),
                "references": list(view.references),
            }
        return {
            "version": CONFIG_VERSION,
            "policy": tree.policy.value,
            "roots": list(tree.roots),
            "nodes": nodes,
            "history": {
                "undo": [cmd.to_dict() for cmd in tree._undo],
                "redo": [cmd.to_dict() for cmd in tree._redo],
            },
        }

    # ------------------------------------------------------------------ #
    # 反序列化
    # ------------------------------------------------------------------ #

    @staticmethod
    def dict_to_tree(data: Any) -> DocumentTree:
        """从已解析的 JSON 对象重建并完整校验一棵树。"""
        if not isinstance(data, dict):
            raise Serde.err("顶层结构必须是 JSON 对象")

        for field_name in ("version", "policy", "roots", "nodes"):
            if field_name not in data:
                raise Serde.err(f"缺少必填字段: {field_name!r}")

        version = data["version"]
        if not isinstance(version, int) or isinstance(version, bool):
            raise Serde.err("字段 'version' 必须是整数")
        if version != CONFIG_VERSION:
            raise Serde.err(f"不支持的文件版本: {version}（支持版本 {CONFIG_VERSION}）")

        policy_raw = data["policy"]
        if not isinstance(policy_raw, str):
            raise Serde.err("字段 'policy' 必须是字符串")
        try:
            policy = DanglingPolicy(policy_raw)
        except ValueError:
            raise Serde.err(
                f"非法悬空引用策略: {policy_raw!r}，"
                f"合法值为 {[p.value for p in DanglingPolicy]}"
            ) from None

        roots_raw = data["roots"]
        if not isinstance(roots_raw, list) or not all(isinstance(x, str) for x in roots_raw):
            raise Serde.err("字段 'roots' 必须是字符串数组")

        nodes_raw = data["nodes"]
        if not isinstance(nodes_raw, dict):
            raise Serde.err("字段 'nodes' 必须是对象")

        tree = DocumentTree(policy=policy)

        # --- 节点主体与层级 -------------------------------------------------
        seen_ids: set = set()
        for key, raw in nodes_raw.items():
            if not isinstance(raw, dict):
                raise Serde.err(f"节点 {key!r} 的定义必须是对象")
            nid = raw.get("id")
            if not isinstance(nid, str) or not nid:
                raise Serde.err(f"节点 {key!r} 缺少合法的字符串字段 'id'")
            if nid != key:
                raise Serde.err(f"节点键 {key!r} 与其 id 字段 {nid!r} 不一致")
            if nid in seen_ids:
                raise Serde.err(f"节点标识重复: {nid!r}")
            seen_ids.add(nid)

            parent = raw.get("parent")
            if parent is not None and not isinstance(parent, str):
                raise Serde.err(f"节点 {nid!r} 的 'parent' 必须是字符串或 null")
            for list_field in ("children", "references"):
                value = raw.get(list_field)
                if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
                    raise Serde.err(f"节点 {nid!r} 的 {list_field!r} 必须是字符串数组")
            if len(set(raw["children"])) != len(raw["children"]):
                raise Serde.err(f"节点 {nid!r} 的 'children' 含重复子节点")
            if len(set(raw["references"])) != len(raw["references"]):
                raise Serde.err(f"节点 {nid!r} 的 'references' 含重复引用")
            if nid in raw["references"]:
                raise Serde.err(f"节点 {nid!r} 自引用")

            # 层级本身始终不允许孤儿：父节点必须存在（悬空只针对“引用”）。
            if parent is not None and parent not in nodes_raw:
                raise Serde.err(f"节点 {nid!r} 的父节点 {parent!r} 不存在（孤儿节点）")
            if parent == nid:
                raise Serde.err(f"节点 {nid!r} 的父节点是自身（成环）")

            # 直接写内部结构，避免逐条 add 造成的顺序问题；最后统一校验。
            tree._nodes[nid] = _Node(
                id=nid,
                parent=parent,
                children=list(raw["children"]),
                references=list(raw["references"]),
            )

        for root in roots_raw:
            if root not in seen_ids:
                raise Serde.err(f"根列表中的节点不存在: {root!r}")
        if len(set(roots_raw)) != len(roots_raw):
            raise Serde.err("'roots' 含重复根节点")
        tree._roots = list(roots_raw)

        # 无父节点的节点必须恰好出现在 roots 中（反之亦然）。
        parentless = {nid for nid, n in tree._nodes.items() if n.parent is None}
        root_set = set(roots_raw)
        if parentless != root_set:
            missing_roots = sorted(parentless - root_set)
            extra_roots = sorted(root_set - parentless)
            detail = []
            if missing_roots:
                detail.append(f"无父节点但未列入 roots: {missing_roots}")
            if extra_roots:
                detail.append(f"列入 roots 但仍有父节点: {extra_roots}")
            raise Serde.err("根列表与父指针不一致：" + "；".join(detail))

        # --- 引用目标 -------------------------------------------------------
        for nid, raw in nodes_raw.items():
            for target in raw["references"]:
                if target not in seen_ids:
                    if policy is DanglingPolicy.CASCADE:
                        raise Serde.err(
                            f"引用目标不存在（级联策略不允许悬空）: {nid!r} -> {target!r}"
                        )
                    # KEEP_DANGLING：允许目标缺失，保留并可在载入后被查出。

        # 统一结构校验（父子双向一致、无环、无孤儿、引用约束等）。
        try:
            tree.check_invariants()
        except SerializationError:
            raise
        except Exception as exc:
            raise Serde.err(f"结构一致性校验失败: {exc}") from None

        # --- 历史 -----------------------------------------------------------
        history_raw = data.get("history", {})
        if history_raw is not None:
            if not isinstance(history_raw, dict):
                raise Serde.err("字段 'history' 必须是对象")
            undo_cmds = Serde._parse_command_list(history_raw.get("undo", []), "undo")
            redo_cmds = Serde._parse_command_list(history_raw.get("redo", []), "redo")
            Serde._verify_history(undo_cmds, redo_cmds, tree)
            tree._undo = undo_cmds
            tree._redo = redo_cmds

        return tree

    @staticmethod
    def _parse_command_list(raw: Any, which: str) -> List[Command]:
        """解析并重建一组历史命令。"""
        if not isinstance(raw, list):
            raise Serde.err(f"history.{which} 必须是数组")
        commands: List[Command] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise Serde.err(f"history.{which}[{index}] 必须是对象")
            try:
                commands.append(Command.from_dict(item))
            except KeyError as exc:
                raise Serde.err(
                    f"history.{which}[{index}] 缺少字段: {exc.args[0]!r}"
                ) from None
            except ValueError as exc:
                raise Serde.err(f"history.{which}[{index}] 取值非法: {exc}") from None
        return commands

    @staticmethod
    def _verify_history(
        undo_cmds: List[Command],
        redo_cmds: List[Command],
        current: DocumentTree,
    ) -> None:
        """回放历史，验证它与文件中记录的当前状态完全自洽。

        栈模型：当前状态 = 自最初状态起依次正向应用 ``undo_cmds`` 的结果；
        ``redo_cmds`` 是当前状态**之后**待重做的命令（此刻尚未应用）。

        1. 从当前状态依次逆向撤销全部 undo 命令，必须能到达最初状态；
        2. 再依次正向应用全部 undo 命令，必须精确回到文件记录的当前状态；
        3. 从当前状态按重做顺序（redo 栈为“最近撤销在前”，实际重做从
           栈尾取，故逆序应用）应用全部 redo 命令，再按相反顺序撤销，
           必须再次精确回到当前状态。

        任一步抛错或汇合状态不一致，都说明文件损坏/被篡改，拒绝载入。
        """
        snapshot = Serde.tree_to_dict(current)

        try:
            for command in reversed(undo_cmds):
                command.revert(current)
            for command in undo_cmds:
                command.apply(current)
            if Serde.tree_to_dict(current) != snapshot:
                raise Serde.err("undo 历史回放后状态与文件记录不一致")

            for command in reversed(redo_cmds):
                command.apply(current)
            for command in redo_cmds:
                command.revert(current)
            if Serde.tree_to_dict(current) != snapshot:
                raise Serde.err("redo 历史回放后状态与文件记录不一致")
        except SerializationError:
            raise
        except Exception as exc:
            raise Serde.err(f"历史记录与文档状态不自洽，回放失败: {exc}") from None

    # ------------------------------------------------------------------ #
    # 文件 I/O
    # ------------------------------------------------------------------ #

    @staticmethod
    def to_json(tree: DocumentTree, indent: int = 2) -> str:
        """序列化为 JSON 字符串。"""
        return json.dumps(
            Serde.tree_to_dict(tree),
            ensure_ascii=False,
            indent=indent,
            sort_keys=False,
        )

    @staticmethod
    def from_json(text: str) -> DocumentTree:
        """从 JSON 字符串载入，失败时抛 :class:`SerializationError`。"""
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise Serde.err(f"JSON 解析失败（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}") from None
        return Serde.dict_to_tree(data)


def save_to_file(
    tree: DocumentTree,
    path: Union[str, "os.PathLike[str]"],
    indent: int = 2,
) -> None:
    """把树原子写入 ``path``。

    先写入同目录临时文件再替换目标，避免写入中途失败产生半截文件。

    :raises SerializationError: 序列化失败。
    :raises OSError: 目录不可写等文件系统错误。
    """
    text = Serde.to_json(tree, indent=indent)
    directory = os.path.dirname(os.path.abspath(os.fspath(path)))
    fd, tmp_path = tempfile.mkstemp(prefix=".doctree-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp_path, os.fspath(path))
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def load_from_file(path: Union[str, os.PathLike]) -> DocumentTree:
    """从 JSON 文件载入一棵完整的树。

    :raises SerializationError: 文件损坏、字段缺失或一致性校验失败。
    """
    try:
        with open(os.fspath(path), "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        raise SerializationError(f"无法读取文件 {os.fspath(path)!r}: {exc}") from None
    return Serde.from_json(text)


def load_into(tree: DocumentTree, path: Union[str, os.PathLike]) -> DocumentTree:
    """从文件载入并**原地替换** ``tree`` 的全部状态。

    先在临时树上完整解析与校验，成功后才覆盖 ``tree`` 的内部字段，
    因此载入失败时 ``tree`` 原状态保持不变。返回同一个 ``tree`` 对象。
    """
    loaded = load_from_file(path)
    tree._nodes = loaded._nodes
    tree._roots = loaded._roots
    tree._policy = loaded._policy
    tree._undo = loaded._undo
    tree._redo = loaded._redo
    return tree


def loads(text: str) -> DocumentTree:
    """从 JSON 字符串载入。"""
    return Serde.from_json(text)


def dumps(tree: DocumentTree, indent: int = 2) -> str:
    """序列化为 JSON 字符串。"""
    return Serde.to_json(tree, indent=indent)
