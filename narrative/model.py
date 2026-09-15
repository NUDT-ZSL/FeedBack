"""核心模型：变量模式（Schema）、状态变更、叙事节点与有向图。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .conditions import Condition, ConditionError, TRUE

VAR_TYPES = ("int", "float", "bool", "str")

# 状态变更操作
CHANGE_OPS = ("set", "add", "sub", "mul")


class SchemaError(Exception):
    """变量声明非法。"""


class ValidationError(Exception):
    """图结构或节点定义非法。"""


class ChangeError(Exception):
    """应用状态变更失败。message 中携带定位信息（节点/变更/变量）。"""


class VariableDef:
    def __init__(self, name: str, var_type: str, default: Any):
        if var_type not in VAR_TYPES:
            raise SchemaError(f"变量 {name!r} 类型非法: {var_type!r}，允许 {VAR_TYPES}")
        self.name = name
        self.var_type = var_type
        self.default = self._check(default, what="缺省值")

    def _check(self, value: Any, what: str) -> Any:
        """类型校验，返回规范化后的值。bool 是 int 子类，须先判 bool。"""
        t = self.var_type
        if t == "bool":
            ok = isinstance(value, bool)
        elif t == "int":
            ok = isinstance(value, int) and not isinstance(value, bool)
        elif t == "float":
            ok = (isinstance(value, (int, float)) and not isinstance(value, bool))
            if ok:
                value = float(value)
        else:  # str
            ok = isinstance(value, str)
        if not ok:
            raise SchemaError(
                f"变量 {self.name!r}（类型 {t}）的{what}类型不符: {value!r}"
            )
        return value

    def check_value(self, value: Any) -> Any:
        try:
            return self._check(value, what="值")
        except SchemaError as e:
            raise ChangeError(str(e)) from None

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "type": self.var_type, "default": self.default}

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "VariableDef":
        return VariableDef(d["name"], d["type"], d["default"])


class Schema:
    """世界状态中全部变量的声明。变量须先声明后使用。"""

    def __init__(self, variables: List[VariableDef]):
        self._vars: Dict[str, VariableDef] = {}
        for v in variables:
            if v.name in self._vars:
                raise SchemaError(f"变量重复声明: {v.name!r}")
            self._vars[v.name] = v

    def has(self, name: str) -> bool:
        return name in self._vars

    def get(self, name: str) -> VariableDef:
        return self._vars[name]

    def default_of(self, name: str) -> Any:
        return self._vars[name].default

    def initial_state(self) -> Dict[str, Any]:
        return {name: v.default for name, v in self._vars.items()}

    def names(self) -> List[str]:
        return sorted(self._vars)

    def to_dict(self) -> Dict[str, Any]:
        return {"variables": [self._vars[n].to_dict() for n in self.names()]}

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Schema":
        return Schema([VariableDef.from_dict(v) for v in d["variables"]])


class StateChange:
    """一条带标识的状态变更。op: set / add / sub / mul（后三者仅限数值变量）。"""

    def __init__(self, change_id: str, variable: str, op: str, value: Any):
        if op not in CHANGE_OPS:
            raise ValidationError(
                f"变更 {change_id!r} 操作非法: {op!r}，允许 {CHANGE_OPS}"
            )
        self.id = change_id
        self.variable = variable
        self.op = op
        self.value = value

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "var": self.variable, "op": self.op, "value": self.value}

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "StateChange":
        return StateChange(d["id"], d["var"], d["op"], d.get("value"))


class Node:
    """叙事节点：唯一标识、所属章节、进入条件、一组带标识的状态变更。"""

    def __init__(
        self,
        node_id: str,
        chapter: str,
        entry_condition: Optional[Condition] = None,
        changes: Optional[List[StateChange]] = None,
    ):
        self.id = node_id
        self.chapter = chapter
        self.entry_condition = entry_condition if entry_condition is not None else TRUE
        self.changes = list(changes) if changes else []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "chapter": self.chapter,
            "entry_condition": self.entry_condition.to_dict(),
            "changes": [c.to_dict() for c in self.changes],
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Node":
        return Node(
            d["id"],
            d["chapter"],
            Condition.from_dict(d.get("entry_condition", {"op": "const", "value": True})),
            [StateChange.from_dict(c) for c in d.get("changes", [])],
        )


class Edge:
    """条件边：src -> dst，条件为真时可通行。label 用于分支归属记录。"""

    def __init__(self, src: str, dst: str, condition: Optional[Condition] = None,
                 label: Optional[str] = None):
        self.src = src
        self.dst = dst
        self.condition = condition if condition is not None else TRUE
        self.label = label

    def to_dict(self) -> Dict[str, Any]:
        return {
            "src": self.src,
            "dst": self.dst,
            "condition": self.condition.to_dict(),
            "label": self.label,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Edge":
        return Edge(
            d["src"], d["dst"],
            Condition.from_dict(d.get("condition", {"op": "const", "value": True})),
            d.get("label"),
        )


class Graph:
    """节点与条件边构成的有向图。构造时做完整性校验。"""

    def __init__(self, nodes: List[Node], edges: List[Edge]):
        self.nodes: Dict[str, Node] = {}
        for n in nodes:
            if n.id in self.nodes:
                raise ValidationError(f"节点标识重复: {n.id!r}")
            self.nodes[n.id] = n
        self.edges: List[Edge] = list(edges)
        for e in self.edges:
            for endpoint, where in ((e.src, "起点"), (e.dst, "终点")):
                if endpoint not in self.nodes:
                    raise ValidationError(
                        f"边 {e.src!r}->{e.dst!r} 的{where} {endpoint!r} 不存在"
                    )
        # 同一节点内变更标识必须唯一
        for n in nodes:
            seen = set()
            for c in n.changes:
                if c.id in seen:
                    raise ValidationError(
                        f"节点 {n.id!r} 内变更标识重复: {c.id!r}"
                    )
                seen.add(c.id)

    def node(self, node_id: str) -> Node:
        if node_id not in self.nodes:
            raise ValidationError(f"节点不存在: {node_id!r}")
        return self.nodes[node_id]

    def has_node(self, node_id: str) -> bool:
        return node_id in self.nodes

    def out_edges(self, node_id: str) -> List[Edge]:
        """从某节点出发的边，按 (dst, label) 稳定排序。"""
        outs = [e for e in self.edges if e.src == node_id]
        return sorted(outs, key=lambda e: (e.dst, e.label or ""))

    def edge_between(self, src: str, dst: str) -> Optional[Edge]:
        for e in self.out_edges(src):
            if e.dst == dst:
                return e
        return None

    def node_ids(self) -> List[str]:
        return sorted(self.nodes)

    def validate_against(self, schema: Schema) -> List[str]:
        """对照变量声明做静态检查，返回问题列表（空列表表示通过）。

        检查：变更与条件引用的变量均已声明；数值操作只用于数值变量；
        set 的值与变量声明类型一致。
        """
        problems: List[str] = []
        for nid in self.node_ids():
            node = self.nodes[nid]
            for var in node.entry_condition.variables():
                if not schema.has(var):
                    problems.append(f"节点 {nid!r} 进入条件引用未声明变量 {var!r}")
            for c in node.changes:
                loc = f"节点 {nid!r} 变更 {c.id!r}"
                if not schema.has(c.variable):
                    problems.append(f"{loc} 引用未声明变量 {c.variable!r}")
                    continue
                vdef = schema.get(c.variable)
                if c.op in ("add", "sub", "mul") and vdef.var_type not in ("int", "float"):
                    problems.append(
                        f"{loc} 对非数值变量 {c.variable!r}（{vdef.var_type}）使用 {c.op}"
                    )
                if c.op == "set":
                    try:
                        vdef.check_value(c.value)
                    except ChangeError as e:
                        problems.append(f"{loc} {e}")
            for e in self.out_edges(nid):
                for var in e.condition.variables():
                    if not schema.has(var):
                        problems.append(
                            f"边 {e.src!r}->{e.dst!r} 条件引用未声明变量 {var!r}"
                        )
        return problems

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodes": [self.nodes[n].to_dict() for n in self.node_ids()],
            "edges": [e.to_dict() for e in
                      sorted(self.edges, key=lambda x: (x.src, x.dst, x.label or ""))],
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Graph":
        return Graph(
            [Node.from_dict(n) for n in d["nodes"]],
            [Edge.from_dict(e) for e in d["edges"]],
        )
