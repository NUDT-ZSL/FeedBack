#!/usr/bin/env python3
"""树形文档编辑器内核的命令行入口。

从标准输入**逐行读取 JSON 命令**，每条命令向标准输出写**一行 JSON 结果**。
成功结果形如 ``{"ok": true, ...}``；任何错误都返回
``{"error": "描述", "code": "错误码", ...}``，进程不退出，继续处理后续行。

支持的命令（``op`` 字段区分）：

================  ============================================================
add               新增节点 ``{node_id, parent_id, kind, content?, refs?}``
remove            删除子树 ``{node_id}``
move              跨层拖拽 ``{node_id, parent_id, index?}``
update_content    修改内容 ``{node_id, content}``
add_ref           增加引用 ``{owner, target}``
remove_ref        删除引用 ``{owner, target}``
policy            查询/切换悬空策略 ``{policy?}``（不传 policy 为查询）
path              根到节点的路径 ``{node_id}``
subtree           子树前序 ``{node_id, max_depth?}``
find              按 kind 查找 ``{kind}``
resolve           解析引用目标详情 ``{node_id}``
dangling          列出全部悬空引用
history           列出可回放版本号
save              增量保存 ``{path}``
load              加载（替换当前会话状态）``{path}``
diff              版本差异 ``{v1, v2}``
rollback          回滚 ``{version}``
dump              输出完整状态
================  ============================================================

示例::

    echo '{"op":"add","node_id":"r","parent_id":null,"kind":"section"}' | python main.py
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional

from doctree.exceptions import DocumentTreeError
from doctree.persistence import load as persistence_load
from doctree.persistence import save as persistence_save
from doctree.tree import DocumentTree


def _node_brief(tree: DocumentTree, node_id: str) -> Dict[str, Any]:
    return tree.get_node(node_id).to_dict()


class Session:
    """持有当前 :class:`DocumentTree` 的交互式会话（``load`` 会整体替换）。"""

    def __init__(self) -> None:
        self.tree = DocumentTree()

    def handle(self, cmd: Dict[str, Any]) -> Dict[str, Any]:
        """分发一条命令，返回可 JSON 序列化的结果 dict。"""
        op = cmd.get("op")
        method = {
            "add": self.cmd_add,
            "remove": self.cmd_remove,
            "move": self.cmd_move,
            "update_content": self.cmd_update_content,
            "add_ref": self.cmd_add_ref,
            "remove_ref": self.cmd_remove_ref,
            "policy": self.cmd_policy,
            "path": self.cmd_path,
            "subtree": self.cmd_subtree,
            "find": self.cmd_find,
            "resolve": self.cmd_resolve,
            "dangling": self.cmd_dangling,
            "history": self.cmd_history,
            "save": self.cmd_save,
            "load": self.cmd_load,
            "diff": self.cmd_diff,
            "rollback": self.cmd_rollback,
            "dump": self.cmd_dump,
        }.get(op)
        if method is None:
            return {"error": f"unknown op: {op!r}", "code": "unknown_op"}
        return method(cmd)

    # ------------------------------------------------------------ 变更类

    def cmd_add(self, c: Dict[str, Any]) -> Dict[str, Any]:
        if "node_id" not in c or "parent_id" not in c or "kind" not in c:
            return _missing("node_id, parent_id, kind")
        node = self.tree.add(
            node_id=c["node_id"],
            parent_id=c["parent_id"],
            kind=c["kind"],
            content=c.get("content", ""),
            refs=c.get("refs"),
        )
        return {"ok": True, "node": node.to_dict(), "version": self.tree.version}

    def cmd_remove(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        if isinstance(node_id, dict):
            return node_id
        result = self.tree.remove(node_id)
        out = result.to_dict()
        out["ok"] = True
        out["version"] = self.tree.version
        return out

    def cmd_move(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        # 同时接受 parent_id 与内核参数名 new_parent_id。
        parent_id = c.get("parent_id", c.get("new_parent_id"))
        if parent_id is None:
            return _missing("parent_id")
        if isinstance(node_id, dict):
            return node_id
        index: Optional[int] = c.get("index")
        result = self.tree.move(node_id, parent_id, index)
        out = result.to_dict()
        out["ok"] = True
        out["version"] = self.tree.version
        return out

    def cmd_update_content(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        if "content" not in c:
            return _missing("content")
        if isinstance(node_id, dict):
            return node_id
        node = self.tree.update_content(node_id, c["content"])
        return {"ok": True, "node": node.to_dict(), "version": self.tree.version}

    def cmd_add_ref(self, c: Dict[str, Any]) -> Dict[str, Any]:
        owner, target = _require(c, "owner"), _require(c, "target")
        if isinstance(owner, dict) or isinstance(target, dict):
            return owner if isinstance(owner, dict) else target
        self.tree.add_ref(owner, target)
        return {"ok": True, "owner": owner, "target": target, "version": self.tree.version}

    def cmd_remove_ref(self, c: Dict[str, Any]) -> Dict[str, Any]:
        owner, target = _require(c, "owner"), _require(c, "target")
        if isinstance(owner, dict) or isinstance(target, dict):
            return owner if isinstance(owner, dict) else target
        self.tree.remove_ref(owner, target)
        return {"ok": True, "owner": owner, "target": target, "version": self.tree.version}

    def cmd_policy(self, c: Dict[str, Any]) -> Dict[str, Any]:
        policy = c.get("policy")
        if policy is None:
            return {"ok": True, "policy": self.tree.ref_policy}
        cleaned = self.tree.set_ref_policy(policy)
        return {"ok": True, "policy": self.tree.ref_policy, "cleaned": cleaned,
                "version": self.tree.version}

    # ------------------------------------------------------------ 查询类

    def cmd_path(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        if isinstance(node_id, dict):
            return node_id
        return {"ok": True, "path": self.tree.get_path(node_id)}

    def cmd_subtree(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        if isinstance(node_id, dict):
            return node_id
        ids = self.tree.get_subtree(node_id, c.get("max_depth"))
        return {
            "ok": True,
            "ids": ids,
            "nodes": [_node_brief(self.tree, nid) for nid in ids],
        }

    def cmd_find(self, c: Dict[str, Any]) -> Dict[str, Any]:
        kind = _require(c, "kind")
        if isinstance(kind, dict):
            return kind
        nodes = self.tree.find_by_kind(kind)
        return {"ok": True, "kind": kind, "nodes": [n.to_dict() for n in nodes]}

    def cmd_resolve(self, c: Dict[str, Any]) -> Dict[str, Any]:
        node_id = _require(c, "node_id")
        if isinstance(node_id, dict):
            return node_id
        return {"ok": True, "refs": self.tree.resolve_refs(node_id)}

    def cmd_dangling(self, c: Dict[str, Any]) -> Dict[str, Any]:
        return {"ok": True, "dangling": self.tree.get_dangling_refs()}

    def cmd_history(self, c: Dict[str, Any]) -> Dict[str, Any]:
        return {"ok": True, "history": self.tree.history(), "version": self.tree.version}

    # ------------------------------------------------------------ 持久化

    def cmd_save(self, c: Dict[str, Any]) -> Dict[str, Any]:
        path = _require(c, "path")
        if isinstance(path, dict):
            return path
        info = persistence_save(self.tree, path)
        info["ok"] = True
        return info

    def cmd_load(self, c: Dict[str, Any]) -> Dict[str, Any]:
        path = _require(c, "path")
        if isinstance(path, dict):
            return path
        self.tree = persistence_load(path)
        return {
            "ok": True,
            "path": path,
            "version": self.tree.version,
            "size": len(self.tree),
            "root_id": self.tree.root_id,
            "policy": self.tree.ref_policy,
        }

    def cmd_diff(self, c: Dict[str, Any]) -> Dict[str, Any]:
        v1, v2 = _require(c, "v1"), _require(c, "v2")
        if isinstance(v1, dict) or isinstance(v2, dict):
            return v1 if isinstance(v1, dict) else v2
        return {"ok": True, "diff": self.tree.diff_versions(v1, v2).to_dict()}

    def cmd_rollback(self, c: Dict[str, Any]) -> Dict[str, Any]:
        version = _require(c, "version")
        if isinstance(version, dict):
            return version
        self.tree.rollback(version)
        return {"ok": True, "version": self.tree.version, "size": len(self.tree)}

    def cmd_dump(self, c: Dict[str, Any]) -> Dict[str, Any]:
        state = self.tree.dump_state()
        state["ok"] = True
        state["size"] = len(self.tree)
        return state


def _require(cmd: Dict[str, Any], key: str) -> Any:
    """取必填字段；缺失时返回错误 dict（调用方负责识别并透传）。"""
    if key not in cmd:
        return _missing(key)
    return cmd[key]


def _missing(name: str) -> Dict[str, Any]:
    return {"error": f"missing required field(s): {name}", "code": "missing_field"}


def run(instream, outstream) -> int:
    """逐行读 JSON、逐行写 JSON；返回进程退出码（始终 0，错误走 JSON）。"""
    session = Session()
    for line_no, raw in enumerate(instream, start=1):
        text = raw.strip()
        if not text:
            continue
        try:
            cmd = json.loads(text)
        except json.JSONDecodeError as exc:
            result: Dict[str, Any] = {
                "error": f"line {line_no}: invalid JSON: {exc.msg}",
                "code": "invalid_json",
            }
        else:
            if not isinstance(cmd, dict):
                result = {"error": "command must be a JSON object", "code": "invalid_command"}
            else:
                try:
                    result = session.handle(cmd)
                except FileNotFoundError as exc:
                    result = {"error": f"file not found: {exc.filename}", "code": "file_not_found",
                              "path": exc.filename}
                except DocumentTreeError as exc:
                    result = exc.to_dict()
                except Exception as exc:  # 防御：内核未预期错误也不中断会话
                    result = {"error": f"{type(exc).__name__}: {exc}", "code": "internal_error"}
        outstream.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
        outstream.flush()
    return 0


def main() -> int:
    """脚本入口。"""
    return run(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
