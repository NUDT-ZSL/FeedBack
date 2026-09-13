"""离线分支剧情内核 StoryEngine。

只依赖 Python 标准库；事件只进不出，不依赖时钟与随机数。

script 结构::

    {
        "version": int,
        "nodes": {
            node_id: {
                "on_enter": [effect, ...],
                "transitions": [
                    {"when": cond, "choice": str, "to": node_id}, ...
                ],
            }
        },
        "migrations": {from_version: [effect, ...], ...},   # 可选
    }

effect::  {"op": "set"|"inc"|"unset", "var": str, "value": int}

cond::    {"var": str, "cmp": "eq"|"gt"|"gte"|"lt"|"lte", "value": int}
        | {"all": [cond, ...]} | {"any": [cond, ...]} | {"not": cond}

event::   {"seq": int, "choice": str}
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

__all__ = ["StoryEngine", "StoryError"]

_CMPS = ("eq", "gt", "gte", "lt", "lte")
_OPS = ("set", "inc", "unset")
_COND_KEYS = ("var", "all", "any", "not")


class StoryError(Exception):
    """脚本非法或存档不兼容；message 中带 node_id 或 seq 上下文。"""


class StoryEngine:
    """带旗标的分支剧情状态机。

    构造参数
        script: 剧情脚本 dict。
        start_version: 存档版本号，仅用于 ``migrate`` 无版本信息的旧存档；
            正常快照自带版本，restore 时以快照为准。
        start_node: 起始节点 id，缺省取脚本 nodes 的第一个节点。
    """

    def __init__(
        self,
        script: Dict[str, Any],
        start_version: int = 0,
        start_node: Optional[str] = None,
    ) -> None:
        self._script = copy.deepcopy(script)
        self._save_version = int(start_version)
        try:
            self._validate_script(self._script)
        except StoryError:
            raise
        except (TypeError, ValueError) as exc:
            raise StoryError("invalid script: %s" % exc)

        self._nodes: Dict[str, Any] = self._script["nodes"]
        self._migrations: Dict[int, List[Dict[str, Any]]] = (
            self._script.get("migrations") or {}
        )
        self._start_node = start_node or next(iter(self._nodes))

        self._node: str = self._start_node
        self._flags: Dict[str, int] = {}
        self._last_seq: Optional[int] = None
        # 已处理过的 seq 集合：与 _last_seq 水位线配合，
        # 水位线之上被跳号后重投的 seq 也能识别为重复。
        self._seen: set = set()

    # ------------------------------------------------------------------ #
    # 校验
    # ------------------------------------------------------------------ #
    def _validate_script(self, script: Any) -> None:
        if not isinstance(script, dict):
            raise StoryError("invalid script: root must be an object")
        version = script.get("version")
        if not isinstance(version, int) or isinstance(version, bool):
            raise StoryError("invalid script: 'version' must be an int")
        nodes = script.get("nodes")
        if not isinstance(nodes, dict) or not nodes:
            raise StoryError("invalid script: 'nodes' must be a non-empty object")

        for node_id, node in nodes.items():
            if not isinstance(node, dict):
                raise StoryError(
                    "invalid script: node %r must be an object" % node_id
                )
            on_enter = node.get("on_enter", [])
            if not isinstance(on_enter, list):
                raise StoryError(
                    "invalid script: node %r 'on_enter' must be a list" % node_id
                )
            for eff in on_enter:
                self._validate_effect(eff, node_id)

            transitions = node.get("transitions", [])
            if not isinstance(transitions, list):
                raise StoryError(
                    "invalid script: node %r 'transitions' must be a list" % node_id
                )
            for tr in transitions:
                if not isinstance(tr, dict):
                    raise StoryError(
                        "invalid script: transition in node %r must be an object"
                        % node_id
                    )
                choice = tr.get("choice")
                if not isinstance(choice, str):
                    raise StoryError(
                        "invalid script: transition in node %r needs string 'choice'"
                        % node_id
                    )
                to = tr.get("to")
                if not isinstance(to, str) or to not in nodes:
                    raise StoryError(
                        "invalid script: node %r transition choice=%r targets "
                        "missing node %r" % (node_id, choice, to)
                    )
                self._validate_cond(tr.get("when"), node_id)

        migrations = script.get("migrations")
        if migrations is not None:
            if not isinstance(migrations, dict):
                raise StoryError("invalid script: 'migrations' must be an object")
            for from_ver, effects in migrations.items():
                if not isinstance(from_ver, int) or isinstance(from_ver, bool):
                    raise StoryError(
                        "invalid script: migration key %r must be an int" % (from_ver,)
                    )
                if not isinstance(effects, list):
                    raise StoryError(
                        "invalid script: migration %d must be a list of effects"
                        % from_ver
                    )
                for eff in effects:
                    # 迁移 effect 不属于任何节点，node_id 用迁移版本号标注。
                    self._validate_effect(eff, "migration:%d" % from_ver)

    @staticmethod
    def _validate_effect(eff: Any, node_id: Any) -> None:
        if not isinstance(eff, dict):
            raise StoryError(
                "invalid script: effect in %r must be an object" % node_id
            )
        op = eff.get("op")
        if op not in _OPS:
            raise StoryError(
                "invalid script: effect in %r has bad op %r" % (node_id, op)
            )
        var = eff.get("var")
        if not isinstance(var, str) or not var:
            raise StoryError(
                "invalid script: effect in %r has bad var %r" % (node_id, var)
            )
        value = eff.get("value")
        if not isinstance(value, int) or isinstance(value, bool):
            raise StoryError(
                "invalid script: effect in %r var=%r needs int 'value'"
                % (node_id, var)
            )

    def _validate_cond(self, cond: Any, node_id: Any) -> None:
        """结构校验；叶子条件延迟到求值时按旗标状态计算。"""
        if not isinstance(cond, dict):
            raise StoryError(
                "invalid script: condition in node %r must be an object" % node_id
            )
        keys = [k for k in cond if k in _COND_KEYS]
        if len(keys) != 1:
            raise StoryError(
                "invalid script: condition in node %r must have exactly one of "
                "var/all/any/not, got %r" % (node_id, sorted(cond.keys()))
            )
        key = keys[0]
        if key == "var":
            var = cond.get("var")
            cmp = cond.get("cmp")
            value = cond.get("value")
            if not isinstance(var, str) or not var:
                raise StoryError(
                    "invalid script: leaf condition in node %r has bad var %r"
                    % (node_id, var)
                )
            if cmp not in _CMPS:
                raise StoryError(
                    "invalid script: leaf condition in node %r var=%r has bad "
                    "cmp %r" % (node_id, var, cmp)
                )
            if not isinstance(value, int) or isinstance(value, bool):
                raise StoryError(
                    "invalid script: leaf condition in node %r var=%r needs int "
                    "'value'" % (node_id, var)
                )
        elif key in ("all", "any"):
            subs = cond[key]
            if not isinstance(subs, list) or not subs:
                raise StoryError(
                    "invalid script: '%s' in node %r must be a non-empty list"
                    % (key, node_id)
                )
            for sub in subs:
                self._validate_cond(sub, node_id)
        else:  # not
            self._validate_cond(cond["not"], node_id)

    # ------------------------------------------------------------------ #
    # 条件与效果
    # ------------------------------------------------------------------ #
    def _eval_cond(self, cond: Dict[str, Any], flags: Dict[str, int]) -> bool:
        if "var" in cond:
            current = flags.get(cond["var"], 0)
            value = cond["value"]
            cmp = cond["cmp"]
            if cmp == "eq":
                return current == value
            if cmp == "gt":
                return current > value
            if cmp == "gte":
                return current >= value
            if cmp == "lt":
                return current < value
            return current <= value  # lte
        if "all" in cond:
            return all(self._eval_cond(c, flags) for c in cond["all"])
        if "any" in cond:
            return any(self._eval_cond(c, flags) for c in cond["any"])
        return not self._eval_cond(cond["not"], flags)

    @staticmethod
    def _apply_effect(eff: Dict[str, Any], flags: Dict[str, int]) -> None:
        op = eff["op"]
        var = eff["var"]
        if op == "set":
            flags[var] = eff["value"]
        elif op == "inc":
            flags[var] = flags.get(var, 0) + eff["value"]
        else:  # unset
            flags.pop(var, None)

    # ------------------------------------------------------------------ #
    # 对外 API
    # ------------------------------------------------------------------ #
    def apply(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """投递一个玩家选择事件。返回新状态；拒绝时状态零变更。"""
        seq = event.get("seq")
        if not isinstance(seq, int) or isinstance(seq, bool):
            raise StoryError("invalid event: seq must be an int, got %r" % (seq,))
        choice = event.get("choice")
        if not isinstance(choice, str):
            raise StoryError(
                "invalid event seq=%r: choice must be a string" % (seq,)
            )

        # 幂等：重复 seq，或 seq 低于已处理水位线的迟到事件。
        if seq in self._seen or (
            self._last_seq is not None and seq < self._last_seq
        ):
            return {"rejected": "duplicate", "seq": seq}

        node = self._nodes[self._node]
        match = None
        for tr in node["transitions"]:
            if tr["choice"] == choice and self._eval_cond(tr["when"], self._flags):
                match = tr
                break
        if match is None:
            return {"rejected": "no_transition", "seq": seq}

        # 命中后先在草稿上结算，保证任何意外都不产生半更新。
        target = match["to"]
        new_flags = copy.deepcopy(self._flags)
        applied: List[Dict[str, Any]] = []
        for eff in self._nodes[target].get("on_enter", []):
            self._apply_effect(eff, new_flags)
            applied.append(copy.deepcopy(eff))

        self._flags = new_flags
        self._node = target
        self._last_seq = seq if self._last_seq is None else max(self._last_seq, seq)
        self._seen.add(seq)
        return {
            "node": self._node,
            "applied": applied,
            "flags": copy.deepcopy(self._flags),
            "rejected": None,
        }

    def snapshot(self) -> Dict[str, Any]:
        """生成可 JSON 序列化的存档快照（深拷贝，外部改不到内部状态）。"""
        return {
            "version": self._script["version"],
            "node": self._node,
            "flags": copy.deepcopy(self._flags),
            "last_seq": self._last_seq,
            "seen": sorted(self._seen),
        }

    def restore(self, snap: Dict[str, Any]) -> None:
        """从快照恢复；版本旧于当前 script 时自动按 migrations 补齐。"""
        snap = copy.deepcopy(snap)
        if not isinstance(snap, dict):
            raise StoryError("invalid snapshot: must be an object")

        ver = snap.get("version")
        if not isinstance(ver, int) or isinstance(ver, bool):
            raise StoryError("invalid snapshot: 'version' must be an int")
        if ver > self._script["version"]:
            raise StoryError(
                "snapshot version %d is newer than script version %d"
                % (ver, self._script["version"])
            )

        node = snap.get("node")
        if not isinstance(node, str) or node not in self._nodes:
            raise StoryError(
                "invalid snapshot: node %r does not exist in script" % (node,)
            )
        flags = snap.get("flags", {})
        if not isinstance(flags, dict) or any(
            (not isinstance(k, str))
            or (not isinstance(v, int))
            or isinstance(v, bool)
            for k, v in flags.items()
        ):
            raise StoryError("invalid snapshot: 'flags' must be {str: int}")

        last_seq = snap.get("last_seq")
        if last_seq is not None and (
            not isinstance(last_seq, int) or isinstance(last_seq, bool)
        ):
            raise StoryError("invalid snapshot: 'last_seq' must be an int or null")
        seen = snap.get("seen", [])
        if not isinstance(seen, list) or any(
            (not isinstance(s, int)) or isinstance(s, bool) for s in seen
        ):
            raise StoryError("invalid snapshot: 'seen' must be a list of int")

        # 先在草稿上迁移，全部成功才提交 —— 失败不留半更新。
        draft = {
            "version": ver,
            "node": node,
            "flags": copy.deepcopy(flags),
            "last_seq": last_seq,
            "seen": seen,
        }
        draft = self.migrate(draft, self._script["version"])

        self._flags = draft["flags"]
        self._node = node
        self._last_seq = last_seq
        self._seen = set(seen)
        self._save_version = self._script["version"]

    def migrate(self, snap: Dict[str, Any], target_version: int) -> Dict[str, Any]:
        """把快照迁移到 target_version 并返回新快照（不改变引擎当前状态）。"""
        if not isinstance(target_version, int) or isinstance(target_version, bool):
            raise StoryError("migrate: target_version must be an int")
        out = copy.deepcopy(snap)
        if not isinstance(out, dict) or not isinstance(
            out.get("version"), int
        ) or isinstance(out.get("version"), bool):
            raise StoryError("migrate: snapshot needs an int 'version'")
        if target_version < out["version"]:
            raise StoryError(
                "migrate: cannot downgrade snapshot %d -> %d"
                % (out["version"], target_version)
            )
        if target_version > self._script["version"]:
            raise StoryError(
                "migrate: target version %d is newer than script version %d"
                % (target_version, self._script["version"])
            )
        flags = out.setdefault("flags", {})
        if not isinstance(flags, dict) or any(
            (not isinstance(k, str))
            or (not isinstance(v, int))
            or isinstance(v, bool)
            for k, v in flags.items()
        ):
            raise StoryError("migrate: snapshot 'flags' must be {str: int}")
        cur = out["version"]
        while cur < target_version:
            effects = self._migrations.get(cur)
            if effects is None:
                raise StoryError(
                    "missing migration from version %d to %d (node=%r)"
                    % (cur, cur + 1, out.get("node"))
                )
            for eff in effects:
                self._apply_effect(eff, flags)
            cur += 1
        out["version"] = target_version
        return out
