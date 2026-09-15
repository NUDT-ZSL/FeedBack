"""条件系统：变量比较与逻辑组合。

语义约定（详见 docs/semantics.md）：
- 求值是纯函数：同一世界状态、同一条件，重复求值结果必然相同。
- 缺变量策略：变量已在 Schema 中声明但状态中无值时，使用其声明的缺省值；
  变量未在 Schema 中声明时，该比较子句一律判 False（不抛异常），
  逻辑组合按通常布尔规则继续求值。
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping

CMP_OPS = ("eq", "ne", "lt", "le", "gt", "ge")


class ConditionError(Exception):
    """条件结构非法（如未知操作符、字段缺失）。"""


class Condition:
    """条件 AST 基类。所有子类须实现 evaluate / to_dict。"""

    def evaluate(self, state: Mapping[str, Any], schema) -> bool:
        raise NotImplementedError

    def to_dict(self) -> Dict[str, Any]:
        raise NotImplementedError

    def variables(self) -> List[str]:
        """返回条件中引用的全部变量名（稳定顺序，去重）。"""
        raise NotImplementedError

    # ---- 反序列化 ----
    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "Condition":
        if not isinstance(data, dict) or "op" not in data:
            raise ConditionError(f"条件必须是含 'op' 字段的对象: {data!r}")
        op = data["op"]
        if op == "const":
            return Const(bool(data["value"]))
        if op == "cmp":
            cmp_op = data.get("cmp")
            if cmp_op not in CMP_OPS:
                raise ConditionError(f"未知比较操作符: {cmp_op!r}（位于 {data!r}）")
            if "var" not in data:
                raise ConditionError(f"比较条件缺少 'var' 字段: {data!r}")
            return Compare(data["var"], cmp_op, data.get("value"))
        if op == "and":
            return And([Condition.from_dict(c) for c in data.get("args", [])])
        if op == "or":
            return Or([Condition.from_dict(c) for c in data.get("args", [])])
        if op == "not":
            return Not(Condition.from_dict(data["arg"]))
        raise ConditionError(f"未知条件操作符: {op!r}")


class Const(Condition):
    def __init__(self, value: bool):
        self.value = bool(value)

    def evaluate(self, state, schema) -> bool:
        return self.value

    def to_dict(self):
        return {"op": "const", "value": self.value}

    def variables(self):
        return []

    def __repr__(self):
        return f"Const({self.value})"


class Compare(Condition):
    """单变量与字面量比较。缺失变量按模块 docstring 中的策略处理。"""

    def __init__(self, var: str, cmp_op: str, value: Any):
        if cmp_op not in CMP_OPS:
            raise ConditionError(f"未知比较操作符: {cmp_op!r}")
        self.var = var
        self.cmp_op = cmp_op
        self.value = value

    def _resolve(self, state: Mapping[str, Any], schema):
        """返回 (found, value)。未声明变量 -> (False, None)。"""
        if self.var in state:
            return True, state[self.var]
        if schema is not None and schema.has(self.var):
            return True, schema.default_of(self.var)
        return False, None

    def evaluate(self, state: Mapping[str, Any], schema) -> bool:
        found, current = self._resolve(state, schema)
        if not found:
            return False  # 未声明变量：判 False（见 docs/semantics.md）
        left, right = current, self.value
        try:
            if self.cmp_op == "eq":
                return left == right
            if self.cmp_op == "ne":
                return left != right
            # 大小比较要求两边可比较；类型不可比较时判 False 而非抛错，保证求值总确定
            if self.cmp_op == "lt":
                return bool(left < right)
            if self.cmp_op == "le":
                return bool(left <= right)
            if self.cmp_op == "gt":
                return bool(left > right)
            if self.cmp_op == "ge":
                return bool(left >= right)
        except TypeError:
            return False
        raise ConditionError(f"未知比较操作符: {self.cmp_op!r}")  # pragma: no cover

    def to_dict(self):
        return {"op": "cmp", "var": self.var, "cmp": self.cmp_op, "value": self.value}

    def variables(self):
        return [self.var]

    def __repr__(self):
        return f"Compare({self.var} {self.cmp_op} {self.value!r})"


class _Combinator(Condition):
    op_name = ""

    def __init__(self, args: List[Condition]):
        self.args = list(args)

    def to_dict(self):
        return {"op": self.op_name, "args": [a.to_dict() for a in self.args]}

    def variables(self):
        seen: List[str] = []
        for a in self.args:
            for v in a.variables():
                if v not in seen:
                    seen.append(v)
        return sorted(seen)


class And(_Combinator):
    op_name = "and"

    def evaluate(self, state, schema) -> bool:
        return all(a.evaluate(state, schema) for a in self.args)


class Or(_Combinator):
    op_name = "or"

    def evaluate(self, state, schema) -> bool:
        return any(a.evaluate(state, schema) for a in self.args)


class Not(Condition):
    def __init__(self, arg: Condition):
        self.arg = arg

    def evaluate(self, state, schema) -> bool:
        return not self.arg.evaluate(state, schema)

    def to_dict(self):
        return {"op": "not", "arg": self.arg.to_dict()}

    def variables(self):
        return self.arg.variables()


TRUE = Const(True)
FALSE = Const(False)
