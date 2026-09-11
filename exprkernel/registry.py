"""变量绑定注册表与依赖图。

绑定分两种：
  * **字面量绑定**：Python 的 int/float/bool/str，类型直接确定；
  * **表达式绑定**：一段表达式文本，可引用其他变量（允许前向引用，
    即引用稍后才注册的变量）。

规则：
  * 名字必须匹配 ``[A-Za-z_][A-Za-z0-9_]*`` 且不能是关键字/内置函数名；
  * 禁止重复绑定，重复时报错并返回冲突名；
  * 依赖图在每次注册时做一次显式栈 DFS：若新边使图成环，注册失败并
    返回环上的变量名序列（首尾同名）。允许前向引用后，典型的
    ``a = b + 1`` / ``b = a + 1`` 会在第二次注册时被检出
    ``b -> a -> b``；
  * 依赖链超过 ``max_depth`` 报 ``BIND_DEPTH_EXCEEDED``；
  * 当表达式引用的变量都已存在时，注册即完成静态检查，类型/参数错误
    使注册失败；若存在尚未注册的前向引用，则先挂起，问题在
    ``check`` / ``evaluate`` 时继续暴露。
"""

import math
import re

from . import ast_nodes as ast
from .checker import TypeChecker
from .errors import Diagnostic, ErrorCode, KernelError
from .parser import parse
from .values import DEFAULT_MAX_DEPTH, infer_type

_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RESERVED_NAMES = {
    "and", "or", "not", "true", "false", "min", "max", "abs", "round", "if",
}


class Binding:
    __slots__ = ("kind", "name", "type", "value", "ast", "deps", "warnings")

    def __init__(self, kind, name, type_, value=None, root=None, deps=None,
                 warnings=None):
        self.kind = kind  # "literal" | "expr"
        self.name = name
        self.type = type_  # 挂起的表达式绑定为 None
        self.value = value
        self.ast = root
        self.deps = deps or []
        self.warnings = warnings or []


class BindResult:
    """bind/bind_expr 的返回值。失败时 ``error`` 携带诊断，绝不抛异常。"""

    __slots__ = ("ok", "name", "type", "warnings", "error", "pending")

    def __init__(self, ok, name, type_=None, warnings=None, error=None,
                 pending=False):
        self.ok = ok
        self.name = name
        self.type = type_
        self.warnings = warnings or []
        self.error = error
        # pending=True：注册成功但含尚未解析的前向引用，类型暂未知
        self.pending = pending

    @property
    def conflict_name(self):
        """重复绑定场景下的冲突变量名。"""
        if self.error is not None and self.error.code == ErrorCode.BIND_DUPLICATE:
            return self.error.extra.get("name")
        return None

    @property
    def cycle(self):
        """成环场景下环上的变量名序列（首尾同名，直观闭合）。"""
        if self.error is not None and self.error.code == ErrorCode.BIND_CYCLE:
            return self.error.extra.get("cycle")
        return None

    def __repr__(self):
        if self.ok:
            return "BindResult(ok, name={!r}, type={}, pending={})".format(
                self.name, self.type, self.pending)
        return "BindResult(error={})".format(self.error)


class Registry:
    def __init__(self, max_depth=DEFAULT_MAX_DEPTH):
        self.max_depth = max_depth
        self._bindings = {}
        self._type_memo = {}

    # ---- 查询 ----
    def __contains__(self, name):
        return name in self._bindings

    def names(self):
        return sorted(self._bindings)

    def get(self, name):
        return self._bindings.get(name)

    def type_of(self, name):
        """供静态检查器使用的变量类型解析（带环/深度守卫）。"""
        return self._resolve_type(name, ())

    def _resolve_type(self, name, stack):
        binding = self._bindings.get(name)
        if binding is None:
            return None
        if name in self._type_memo:
            return self._type_memo[name]
        if name in stack:
            raise KernelError(Diagnostic(
                ErrorCode.BIND_CYCLE,
                "检测到变量循环引用：{}".format(
                    " -> ".join(stack + (name, name))),
                extra={"name": name,
                       "cycle": list(stack[stack.index(name):]) + [name]},
            ))
        if len(stack) >= self.max_depth:
            raise KernelError(Diagnostic(
                ErrorCode.BIND_DEPTH_EXCEEDED,
                "变量 {!r} 的依赖链深度超过上限 {}".format(name, self.max_depth),
                extra={"name": name, "depth": len(stack)},
            ))
        if binding.kind == "literal":
            self._type_memo[name] = binding.type
            return binding.type
        checker = TypeChecker(
            lambda n: self._resolve_type(n, stack + (name,)))
        result = checker.check(binding.ast)
        if not result.ok:
            # 把绑定表达式内部最主要的静态问题冒泡给调用方，错误位置
            # 精确指向绑定表达式内部行列，而不是笼统地报该变量未定义。
            primary = result.errors[0]
            raise KernelError(Diagnostic(
                primary.code,
                "变量 {!r} 的绑定表达式无效：{}".format(name, primary.message),
                primary.line, primary.column,
                {"name": name, **primary.extra},
            ))
        if result.type is not None:
            self._type_memo[name] = result.type
            binding.warnings = list(result.warnings)
        return result.type

    # ---- 注册 ----
    def bind_literal(self, name, value, type_hint=None):
        invalid = self._validate_new_name(name)
        if invalid is not None:
            return BindResult(False, name, error=invalid)
        try:
            if type_hint is not None:
                tv_type, coerced = self._coerce_hint(value, type_hint)
            else:
                tv_type = infer_type(value)
                coerced = float(value) if tv_type == "number" else value
        except (TypeError, ValueError) as exc:
            return BindResult(False, name, error=Diagnostic(
                ErrorCode.BIND_EXPRESSION_ERROR,
                "字面量绑定无效：{}".format(exc),
                extra={"name": name},
            ))
        self._bindings[name] = Binding("literal", name, tv_type, value=coerced)
        self._type_memo[name] = tv_type
        return BindResult(True, name, type_=tv_type)

    def bind_expr(self, name, text):
        invalid = self._validate_new_name(name)
        if invalid is not None:
            return BindResult(False, name, error=invalid)

        # 1) 词法语法
        try:
            root = parse(text, max_depth=self.max_depth)
        except KernelError as exc:
            return BindResult(False, name, error=Diagnostic(
                ErrorCode.BIND_EXPRESSION_ERROR,
                "变量 {!r} 的绑定表达式解析失败：{}".format(
                    name, exc.diagnostic.message),
                exc.diagnostic.line,
                exc.diagnostic.column,
                {"name": name, "cause": exc.diagnostic.to_dict()},
            ))

        # 2) 依赖收集（允许前向引用：未注册的名字先作为悬空边保留）
        deps = collect_vars(root)

        # 3) 环检测：新节点尚未入库，任何新环必然包含它
        try:
            cycle = self._find_cycle(name, deps)
        except KernelError as exc:
            return BindResult(False, name, error=exc.diagnostic)
        if cycle is not None:
            return BindResult(False, name, error=Diagnostic(
                ErrorCode.BIND_CYCLE,
                "检测到变量循环引用：{}".format(" -> ".join(cycle)),
                extra={"name": name, "cycle": cycle},
            ))

        # 4) 依赖全部可解析时，注册即静态检查；否则挂起，待后续检查/求值
        missing = [d for d in deps if d not in self._bindings]
        binding = Binding("expr", name, None, root=root, deps=deps)
        self._bindings[name] = binding
        self._type_memo.clear()  # 新边可能让之前挂起的绑定变得可解析

        if missing:
            return BindResult(True, name, pending=True)

        checker = TypeChecker(self._safe_type_resolver)
        result = checker.check(root)
        if not result.ok:
            # 回滚入库，保持“注册失败即不存在”
            del self._bindings[name]
            self._type_memo.clear()
            primary = result.errors[0]
            return BindResult(False, name, error=Diagnostic(
                ErrorCode.BIND_EXPRESSION_ERROR,
                "变量 {!r} 的绑定表达式静态检查失败：{}".format(
                    name, primary.message),
                primary.line,
                primary.column,
                {"name": name, "cause": primary.to_dict(),
                 "errors": [d.to_dict() for d in result.errors]},
            ))

        binding.type = result.type
        binding.warnings = list(result.warnings)
        self._type_memo[name] = result.type
        return BindResult(True, name, type_=result.type,
                          warnings=list(result.warnings))

    # ---- 内部工具 ----
    def _validate_new_name(self, name):
        if not isinstance(name, str) or not _NAME_RE.match(name):
            return Diagnostic(
                ErrorCode.BIND_INVALID_NAME,
                "变量名 {!r} 非法：需匹配 [A-Za-z_][A-Za-z0-9_]*".format(name),
                extra={"name": name},
            )
        if name in _RESERVED_NAMES:
            return Diagnostic(
                ErrorCode.BIND_INVALID_NAME,
                "变量名 {!r} 是保留字（关键字或内置函数名），禁止使用".format(name),
                extra={"name": name},
            )
        if name in self._bindings:
            return Diagnostic(
                ErrorCode.BIND_DUPLICATE,
                "变量名 {!r} 已被绑定，禁止重复绑定".format(name),
                extra={"name": name,
                       "existing_kind": self._bindings[name].kind},
            )
        return None

    def _safe_type_resolver(self, name):
        return self._resolve_type(name, ())

    @staticmethod
    def _coerce_hint(value, type_hint):
        if type_hint == "number":
            if isinstance(value, bool):
                raise ValueError("bool 不能按 number 绑定")
            f = float(value)
            if not math.isfinite(f):
                raise ValueError("必须是有限浮点数，得到 {!r}".format(value))
            return "number", f
        if type_hint == "bool":
            if not isinstance(value, bool):
                raise ValueError(
                    "type_hint=bool 只接受 bool 值，得到 {!r}".format(value))
            return "bool", value
        if type_hint == "string":
            if not isinstance(value, str):
                raise ValueError(
                    "type_hint=string 只接受 str，得到 {!r}".format(value))
            return "string", value
        raise ValueError(
            "未知 type_hint {!r}（可选 number/string/bool）".format(type_hint))

    def _find_cycle(self, new_name, deps):
        """显式栈 DFS。

        邻接规则：新节点的边是本次 ``deps``；已注册节点的边是其
        ``deps``；未注册的名字是叶子（悬空的前向引用），但当它等于
        ``new_name`` 时说明新节点被旧节点指回，即成环。
        """
        def neighbors(node):
            if node == new_name:
                return deps
            binding = self._bindings.get(node)
            return binding.deps if binding is not None else ()

        stack = [(new_name, 0)]
        on_path = {new_name: 0}
        path = [new_name]
        while stack:
            if len(path) > self.max_depth:
                raise KernelError(Diagnostic(
                    ErrorCode.BIND_DEPTH_EXCEEDED,
                    "变量依赖链深度超过上限 {}（始于 {!r}）".format(
                        self.max_depth, new_name),
                    extra={"name": new_name, "depth": len(path)},
                ))
            node, idx = stack[-1]
            nbrs = neighbors(node)
            if idx < len(nbrs):
                stack[-1] = (node, idx + 1)
                nxt = nbrs[idx]
                if nxt in on_path:
                    start = on_path[nxt]
                    return path[start:] + [nxt]
                on_path[nxt] = len(path)
                path.append(nxt)
                stack.append((nxt, 0))
            else:
                stack.pop()
                gone = path.pop()
                del on_path[gone]
        return None


def collect_vars(root):
    """按首次出现顺序收集 AST 中引用的全部变量名（去重）。"""
    ordered = []
    seen = set()
    stack = [root]
    while stack:
        node = stack.pop()
        if isinstance(node, ast.Var):
            if node.name not in seen:
                seen.add(node.name)
                ordered.append(node.name)
        elif isinstance(node, ast.Unary):
            stack.append(node.operand)
        elif isinstance(node, (ast.Binary, ast.Logical)):
            stack.append(node.right)
            stack.append(node.left)
        elif isinstance(node, ast.Call):
            stack.extend(reversed(node.args))
        # 字面量无子节点
    return ordered
