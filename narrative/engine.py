"""运行时引擎：进入节点、应用变更、快照回退、存档读写、查询接口。"""
from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from .conditions import Condition
from .merge import Conflict, merge_logs
from .model import ChangeError, Graph, Schema, StateChange, ValidationError

SAVE_FORMAT_VERSION = 2  # 存档格式版本，迁移链以此对齐


class EntryError(Exception):
    """进入节点被拒绝（节点不存在或进入条件不满足）。"""


class _Snapshot:
    """进入某节点前的完整状态快照。"""

    def __init__(self, engine: "Engine", entering: str):
        self.entering = entering
        self.state = copy.deepcopy(engine.state)
        self.progress = engine.progress
        self.unlocked = sorted(engine.unlocked)
        self.branch_trail = [list(t) for t in engine.branch_trail]
        self.change_log_len = len(engine.change_log)
        self.conflicts_len = len(engine.conflicts)
        self.current_node = engine.current_node

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entering": self.entering,
            "state": self.state,
            "progress": self.progress,
            "unlocked": self.unlocked,
            "branch_trail": self.branch_trail,
            "change_log_len": self.change_log_len,
            "conflicts_len": self.conflicts_len,
            "current_node": self.current_node,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "_Snapshot":
        snap = object.__new__(_Snapshot)
        snap.entering = d["entering"]
        snap.state = d["state"]
        snap.progress = d["progress"]
        snap.unlocked = d["unlocked"]
        snap.branch_trail = d["branch_trail"]
        snap.change_log_len = d["change_log_len"]
        snap.conflicts_len = d["conflicts_len"]
        snap.current_node = d["current_node"]
        return snap


class Engine:
    def __init__(self, schema: Schema, graph: Graph, content_version: str = "1.0.0"):
        problems = graph.validate_against(schema)
        if problems:
            raise ValidationError("图与变量声明不一致：\n" + "\n".join(problems))
        self.schema = schema
        self.graph = graph
        self.content_version = content_version

        self.state: Dict[str, Any] = schema.initial_state()
        self.progress: int = 0                 # 已成功进入的节点数
        self.unlocked: set = set()             # 已解锁（进入过）的节点标识
        self.branch_trail: List[List[str]] = []  # [[分叉节点, 边标签], ...]
        self.change_log: List[Dict[str, Any]] = []
        self.conflicts: List[Conflict] = []
        self.current_node: Optional[str] = None
        self.history: List[_Snapshot] = []
        self.unavailable_nodes: List[str] = []  # 迁移后在新版本中不存在的节点
        self.migration_notes: List[str] = []

    # ---- 进入节点 ----
    def can_enter(self, node_id: str) -> bool:
        node = self.graph.node(node_id)
        return node.entry_condition.evaluate(self.state, self.schema)

    def enter(self, node_id: str, edge_label: Optional[str] = None) -> None:
        """进入节点：校验进入条件 -> 快照 -> 按序应用变更 -> 更新进度/解锁/分支。

        任一变更校验失败时整体回滚到进入前状态，并抛出带定位信息的 ChangeError。
        """
        node = self.graph.node(node_id)  # 不存在时抛 ValidationError
        if not node.entry_condition.evaluate(self.state, self.schema):
            raise EntryError(
                f"节点 {node_id!r} 进入条件不满足，拒绝进入（当前在第 {node.chapter!r} 章之外不影响判定）"
            )

        # 分支归属：经带标签的边进入时记录 (分叉节点, 边标签)
        if edge_label is None and self.current_node is not None:
            edge = self.graph.edge_between(self.current_node, node_id)
            edge_label = edge.label if edge else None

        snap = _Snapshot(self, entering=node_id)
        try:
            for change in node.changes:
                self._apply_change(node_id, change)
        except ChangeError:
            self._restore(snap)  # 拒绝并恢复，不留半应用状态
            raise
        self.history.append(snap)

        self.progress += 1
        self.unlocked.add(node_id)
        if edge_label is not None and self.current_node is not None:
            self.branch_trail.append([self.current_node, edge_label])
        self.current_node = node_id

    def _apply_change(self, node_id: str, change: StateChange) -> None:
        loc = f"节点 {node_id!r} 变更 {change.id!r}"
        if not self.schema.has(change.variable):
            raise ChangeError(f"{loc} 引用未声明变量 {change.variable!r}")
        vdef = self.schema.get(change.variable)
        old = self.state[change.variable]
        try:
            if change.op == "set":
                new = vdef.check_value(change.value)
            else:
                if vdef.var_type not in ("int", "float"):
                    raise ChangeError(
                        f"{loc} 对非数值变量 {change.variable!r}（{vdef.var_type}）使用 {change.op}"
                    )
                operand = change.value
                if isinstance(operand, bool) or not isinstance(operand, (int, float)):
                    raise ChangeError(f"{loc} 操作数类型不符: {operand!r}")
                if change.op == "add":
                    new = old + operand
                elif change.op == "sub":
                    new = old - operand
                else:
                    new = old * operand
                new = vdef.check_value(new)
        except ChangeError as e:
            if str(e).startswith(loc):
                raise
            raise ChangeError(f"{loc} {e}") from None
        self.state[change.variable] = new
        self.change_log.append({
            "node": node_id, "change": change.id, "variable": change.variable,
            "op": change.op, "old": old, "new": new,
            "branch": self.branch_attribution(),
        })

    # ---- 回退 ----
    def _restore(self, snap: _Snapshot) -> None:
        self.state = copy.deepcopy(snap.state)
        self.progress = snap.progress
        self.unlocked = set(snap.unlocked)
        self.branch_trail = [list(t) for t in snap.branch_trail]
        del self.change_log[snap.change_log_len:]
        del self.conflicts[snap.conflicts_len:]
        self.current_node = snap.current_node

    def rollback_to(self, node_id: str) -> None:
        """回退到某节点进入前的快照，其后的全部痕迹一并清除。"""
        for i in range(len(self.history) - 1, -1, -1):
            if self.history[i].entering == node_id:
                self._restore(self.history[i])
                del self.history[i:]
                return
        raise ValidationError(f"没有进入节点 {node_id!r} 前的快照，无法回退")

    def rollback_steps(self, n: int = 1) -> None:
        """撤销最近 n 次进入。"""
        if n < 1 or n > len(self.history):
            raise ValidationError(f"回退步数非法: {n}（历史深度 {len(self.history)}）")
        snap = self.history[-n]
        self._restore(snap)
        del self.history[-n:]

    # ---- 分支合并 ----
    def apply_merge(self, log_a: List[Dict[str, Any]], log_b: List[Dict[str, Any]],
                    branch_a: str, branch_b: str) -> List[Conflict]:
        """在当前状态上按确定性规则合并两条分支累积的变更，返回新产生的冲突。"""
        merged, conflicts = merge_logs(log_a, log_b, branch_a, branch_b)
        for entry in merged:
            var = entry["variable"]
            if not self.schema.has(var):
                raise ChangeError(f"合并变更引用未声明变量 {var!r}（分支 {entry['branch']}）")
            vdef = self.schema.get(var)
            old = self.state[var]
            new = vdef.check_value(entry["new"])
            self.state[var] = new
            self.change_log.append({
                "node": entry["node"], "change": entry["change"], "variable": var,
                "op": "set", "old": old, "new": new,
                "branch": f"merge({entry['branch']})",
            })
        self.conflicts.extend(conflicts)
        return conflicts

    def resolve_conflict(self, variable: str, use_branch: str) -> None:
        """解决冲突：采用指定分支的值，标记为已解决。"""
        for c in self.conflicts:
            if c.variable == variable and not c.resolved:
                if use_branch == c.branch_a:
                    chosen = c.value_a
                elif use_branch == c.branch_b:
                    chosen = c.value_b
                else:
                    raise ValidationError(
                        f"冲突双方为 {c.branch_a!r} 与 {c.branch_b!r}，无分支 {use_branch!r}"
                    )
                self.state[variable] = self.schema.get(variable).check_value(chosen)
                c.resolved = True
                return
        raise ValidationError(f"变量 {variable!r} 没有未解决的冲突")

    # ---- 查询接口（结果均按稳定顺序返回）----
    def entry_condition(self, node_id: str) -> Dict[str, Any]:
        """任意节点的进入条件（字典形式，字段顺序固定）。"""
        return self.graph.node(node_id).entry_condition.to_dict()

    def reachable_from(self, node_id: str,
                       state: Optional[Dict[str, Any]] = None) -> List[str]:
        """某状态下从该节点可达的后续节点（边条件与目标进入条件均满足），按标识排序。"""
        state = self.state if state is None else state
        out = []
        for edge in self.graph.out_edges(node_id):
            if not edge.condition.evaluate(state, self.schema):
                continue
            target = self.graph.node(edge.dst)
            if target.entry_condition.evaluate(state, self.schema):
                out.append(edge.dst)
        return sorted(out)

    def provenance(self, variable: str) -> List[Dict[str, Any]]:
        """某变量的来源变更链，按发生顺序（即日志顺序，稳定）。"""
        return [dict(e) for e in self.change_log if e["variable"] == variable]

    def branch_attribution(self) -> str:
        """当前分支归属，如 'n1:help>n3:spare'；无分叉记录时为 'main'。"""
        if not self.branch_trail:
            return "main"
        return ">".join(f"{node}:{label}" for node, label in self.branch_trail)

    def unresolved_conflicts(self) -> List[Dict[str, Any]]:
        """全部未解决冲突，按变量名稳定排序，含可读描述。"""
        out = []
        for c in sorted((c for c in self.conflicts if not c.resolved),
                        key=lambda c: c.variable):
            d = c.to_dict()
            d["readable"] = c.readable()
            out.append(d)
        return out

    # ---- 存档 ----
    def save(self) -> Dict[str, Any]:
        """导出完整存档（JSON 可序列化），含快照历史以支持读档后继续回退。"""
        return {
            "format_version": SAVE_FORMAT_VERSION,
            "content_version": self.content_version,
            "state": self.state,
            "progress": self.progress,
            "unlocked": sorted(self.unlocked),
            "branch_trail": self.branch_trail,
            "change_log": self.change_log,
            "conflicts": [c.to_dict() for c in self.conflicts],
            "current_node": self.current_node,
            "history": [s.to_dict() for s in self.history],
            "unavailable_nodes": self.unavailable_nodes,
            "migration_notes": self.migration_notes,
        }

    @classmethod
    def load(cls, data: Dict[str, Any], schema: Schema, graph: Graph,
             content_version: Optional[str] = None) -> "Engine":
        """从存档恢复。存档格式过旧时须先经 migration.migrate_save 迁移。

        恢复时按当前 Schema/Graph 做演进对齐：
        - 存档缺少新变量 -> 补声明缺省值（记录迁移说明）；
        - 存档引用新版本中不存在的节点 -> 标记为不可用，进度与分支归属保持不变。
        """
        if data.get("format_version") != SAVE_FORMAT_VERSION:
            raise ValidationError(
                f"存档格式版本 {data.get('format_version')!r} 与当前 {SAVE_FORMAT_VERSION} 不符，"
                "请先调用 migration.migrate_save"
            )
        engine = cls.__new__(cls)
        engine.schema = schema
        engine.graph = graph
        engine.content_version = content_version or data.get("content_version", "1.0.0")

        state = schema.initial_state()
        notes: List[str] = []
        for name, value in data["state"].items():
            if schema.has(name):
                state[name] = schema.get(name).check_value(value)
            else:
                notes.append(f"变量 {name!r} 在新版本中已移除，丢弃其值 {value!r}")
        for name in schema.names():
            if name not in data["state"]:
                notes.append(f"变量 {name!r} 为新版引入，按迁移规则补缺省值 {state[name]!r}")
        engine.state = state

        # 节点演进：存档中引用但新图不存在的节点标记不可用，进度/分支保持原样
        unavailable = sorted({
            nid for nid in list(data["unlocked"]) + [t[0] for t in data["branch_trail"]]
            if not graph.has_node(nid)
        } | {e["node"] for e in data["change_log"] if not graph.has_node(e["node"])})
        for nid in unavailable:
            notes.append(f"节点 {nid!r} 在新版本中不存在，标记为不可用")

        engine.progress = data["progress"]
        engine.unlocked = set(data["unlocked"])
        engine.branch_trail = [list(t) for t in data["branch_trail"]]
        engine.change_log = [dict(e) for e in data["change_log"]]
        engine.conflicts = [Conflict.from_dict(c) for c in data["conflicts"]]
        engine.current_node = data["current_node"]
        engine.history = [_Snapshot.from_dict(s) for s in data["history"]]
        engine.unavailable_nodes = unavailable
        engine.migration_notes = list(data.get("migration_notes", [])) + notes
        return engine
