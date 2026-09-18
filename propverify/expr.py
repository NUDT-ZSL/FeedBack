"""安全表达式求值：不变量判定条件与输入约束都用它表达。

只允许 AST 白名单节点（算术 / 比较 / 布尔 / 白名单函数），
不执行任意 Python 代码，因此配置可以安全地来自离线 JSON 文件。
"""

from __future__ import annotations

import ast
import operator
from typing import Any, Mapping

from .errors import SpecError

_FUNCS = {
    "abs": abs,
    "min": min,
    "max": max,
    "len": len,
    "sum": sum,
    "round": round,
    "int": int,
    "float": float,
    "str": str,
    "bool": bool,
    "sorted": sorted,
}

# 允许的字面量别名，方便 JSON 配置书写习惯。
_GLOBALS = {**_FUNCS, "true": True, "false": False, "null": None}

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_CMP_OPS = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
}

_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.And,
    ast.Or,
    ast.Not,
    ast.UAdd,
    ast.USub,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.In,
    ast.NotIn,
    ast.List,
    ast.Tuple,
    ast.Subscript,
    ast.Slice,
    ast.Index,
    ast.IfExp,
)


class Expr:
    """编译后的安全表达式。`names` 是表达式引用到的变量名集合。"""

    def __init__(self, source: str, path: str):
        self.source = source
        self.path = path
        try:
            tree = ast.parse(source, mode="eval")
        except SyntaxError as exc:
            raise SpecError(path, f"表达式语法错误: {exc.msg}") from exc
        for node in ast.walk(tree):
            if not isinstance(node, _ALLOWED_NODES):
                raise SpecError(
                    path,
                    f"表达式含有不允许的语法 {type(node).__name__}，"
                    "仅支持算术/比较/布尔运算与白名单函数",
                )
            if isinstance(node, ast.Call):
                if not (isinstance(node.func, ast.Name) and node.func.id in _FUNCS):
                    raise SpecError(path, "只允许调用白名单函数: " + ", ".join(sorted(_FUNCS)))
        self.names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} - set(_GLOBALS)
        self._code = compile(tree, filename=f"<{path}>", mode="eval")

    def eval(self, env: Mapping[str, Any]) -> Any:
        return eval(self._code, {"__builtins__": {}, **_GLOBALS}, dict(env))

    def check(self, env: Mapping[str, Any]) -> bool:
        return bool(self.eval(env))

    def __repr__(self) -> str:  # pragma: no cover - 调试用
        return f"Expr({self.source!r})"
