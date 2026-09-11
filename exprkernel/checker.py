"""静态类型检查器：AST -> 推断类型 + 未定义变量 + 类型错误 + 告警。

设计要点：
  * 不采用“遇错即停”，而是尽量遍历整棵树，一次性收集全部未定义变量、
    类型不匹配、参数个数错误（未定义变量在结果里去重保留首次位置）。
  * 未定义变量的类型记为 ``None``，其余规则对 ``None`` 容错以继续检查。
  * 除零检查是**告警**而非错误：只有当 ``/`` 或 ``%`` 的右操作数是
    字面量 0 时才产生 ``WARN_DIV_ZERO_LITERAL``，不阻断求值。
  * 变量类型通过注入的 ``type_resolver(name)`` 查询，由注册表实现，
    因而绑定之间的类型传递与求值解耦。
"""

from . import ast_nodes as ast
from .errors import Diagnostic, ErrorCode, WarningCode
from .values import BOOL, NUMBER, STRING

_ARITH_OPS = {"+", "-", "*", "/", "%"}
_ORDER_OPS = {"<", "<=", ">", ">="}
_COMPARE_OPS = _ORDER_OPS | {"==", "!="}


class CheckResult:
    """静态检查结果。

    :param type_: 根表达式推断类型；存在任何错误时为 None
    :param undefined: 未定义变量诊断（去重，按首次出现顺序）
    :param type_errors: 类型不匹配 / 参数个数错误等诊断
    :param warnings: 告警（如字面量除零）
    """

    def __init__(self, type_, undefined, type_errors, warnings):
        self.type = type_
        self.undefined = undefined
        self.type_errors = type_errors
        self.warnings = warnings

    @property
    def errors(self):
        return list(self.undefined) + list(self.type_errors)

    @property
    def ok(self):
        return not self.undefined and not self.type_errors

    def __repr__(self):
        return (
            "CheckResult(type={}, ok={}, undefined={}, type_errors={}, warnings={})".format(
                self.type, self.ok, len(self.undefined),
                len(self.type_errors), len(self.warnings),
            )
        )


class TypeChecker:
    def __init__(self, type_resolver):
        """``type_resolver(name) -> str | None``：返回变量类型，未定义返回 None。"""
        self._resolve = type_resolver
        self.undefined = []
        self.type_errors = []
        self.warnings = []
        self._seen_undefined = {}

    # ---- 诊断收集 ----
    def _undefined_var(self, name, node):
        if name not in self._seen_undefined:
            diag = Diagnostic(
                ErrorCode.STATIC_UNDEFINED_VAR,
                "变量 {!r} 未定义".format(name),
                node.line,
                node.column,
                {"name": name},
            )
            self._seen_undefined[name] = diag
            self.undefined.append(diag)

    def _type_error(self, code, message, node, extra=None):
        self.type_errors.append(
            Diagnostic(code, message, node.line, node.column, extra)
        )

    def _warn(self, code, message, node, extra=None):
        self.warnings.append(
            Diagnostic(code, message, node.line, node.column, extra)
        )

    # ---- 入口 ----
    def check(self, root):
        t = self._infer(root)
        ok = not self.undefined and not self.type_errors
        return CheckResult(
            t if ok else None,
            self.undefined,
            self.type_errors,
            self.warnings,
        )

    # ---- 类型推断 ----
    def _infer(self, node):
        if isinstance(node, ast.NumberLit):
            return NUMBER
        if isinstance(node, ast.StringLit):
            return STRING
        if isinstance(node, ast.BoolLit):
            return BOOL
        if isinstance(node, ast.Var):
            t = self._resolve(node.name)
            if t is None:
                self._undefined_var(node.name, node)
            return t
        if isinstance(node, ast.Unary):
            return self._infer_unary(node)
        if isinstance(node, ast.Binary):
            return self._infer_binary(node)
        if isinstance(node, ast.Logical):
            return self._infer_logical(node)
        if isinstance(node, ast.Call):
            return self._infer_call(node)
        # 属于程序内部错误：正常情况下解析器不会产生别的节点
        self._type_error(
            ErrorCode.EVAL_INTERNAL,
            "检查器遇到未知 AST 节点 {!r}".format(type(node).__name__),
            node,
        )
        return None

    def _expect(self, node, t, expected, what):
        """要求某子表达式类型为 expected；None（未定义传导）不重复报错。"""
        if t is None:
            return False
        if t != expected:
            self._type_error(
                ErrorCode.STATIC_TYPE_MISMATCH,
                "{}要求 {} 类型，实际为 {}".format(what, expected, t),
                node,
                {"expected": expected, "actual": t},
            )
            return False
        return True

    def _infer_unary(self, node):
        t = self._infer(node.operand)
        if node.op == "-":
            self._expect(node.operand, t, NUMBER, "一元负号 '-'")
            return NUMBER if t == NUMBER else None
        # not
        self._expect(node.operand, t, BOOL, "逻辑非 'not'")
        return BOOL if t == BOOL else None

    def _infer_binary(self, node):
        lt = self._infer(node.left)
        rt = self._infer(node.right)
        op = node.op

        if op in _ARITH_OPS:
            # '+' 对 string 表示拼接（两侧都必须是 string）；
            # 其余算术运算以及 number 的 '+' 要求 number。
            if op == "+" and (lt == STRING or rt == STRING):
                if lt is not None and lt != STRING:
                    self._type_error(
                        ErrorCode.STATIC_TYPE_MISMATCH,
                        "字符串拼接 '+' 要求两侧均为 string，左侧为 {}".format(lt),
                        node.left,
                        {"operator": op, "expected": STRING, "actual": lt},
                    )
                if rt is not None and rt != STRING:
                    self._type_error(
                        ErrorCode.STATIC_TYPE_MISMATCH,
                        "字符串拼接 '+' 要求两侧均为 string，右侧为 {}".format(rt),
                        node.right,
                        {"operator": op, "expected": STRING, "actual": rt},
                    )
                return STRING if lt == STRING and rt == STRING else None
            self._expect(node.left, lt, NUMBER, "算术运算左侧")
            self._expect(node.right, rt, NUMBER, "算术运算右侧")
            # 字面量 0 除数：提前告警，不阻断
            if op in ("/", "%") and isinstance(node.right, ast.NumberLit) \
                    and node.right.value == 0:
                self._warn(
                    WarningCode.WARN_DIV_ZERO_LITERAL,
                    "{} 运算的除数是字面量 0，运行时将触发除零错误".format(
                        "取模" if op == "%" else "除法"
                    ),
                    node,
                    {"operator": op},
                )
            return NUMBER if lt == NUMBER and rt == NUMBER else None

        if op in _COMPARE_OPS:
            if lt is not None and rt is not None and lt != rt:
                self._type_error(
                    ErrorCode.STATIC_TYPE_MISMATCH,
                    "比较运算 {!r} 要求两侧同类型，左侧为 {}、右侧为 {}".format(
                        op, lt, rt
                    ),
                    node,
                    {"operator": op, "left_type": lt, "right_type": rt},
                )
                return None
            # 大小比较只支持 number；== / != 任意同类型
            if op in _ORDER_OPS and lt is not None and lt != NUMBER:
                self._type_error(
                    ErrorCode.STATIC_TYPE_MISMATCH,
                    "大小比较 {!r} 只支持 number，实际为 {}".format(op, lt),
                    node,
                    {"operator": op, "actual": lt},
                )
                return None
            return BOOL if lt is not None and rt is not None else None

        # 解析器保证不会走到这里
        self._type_error(
            ErrorCode.EVAL_INTERNAL, "未知二元运算符 {!r}".format(op), node
        )
        return None

    def _infer_logical(self, node):
        lt = self._infer(node.left)
        rt = self._infer(node.right)
        self._expect(node.left, lt, BOOL, "逻辑运算 {!r} 左侧".format(node.op))
        self._expect(node.right, rt, BOOL, "逻辑运算 {!r} 右侧".format(node.op))
        return BOOL if lt == BOOL and rt == BOOL else None

    def _infer_call(self, node):
        arg_types = [self._infer(a) for a in node.args]

        if node.name in ("min", "max"):
            if len(arg_types) != 2:
                self._arity_error(node, "恰好 2 个", len(arg_types))
                return None
            ok = True
            for idx, t in enumerate(arg_types):
                if t is None:
                    ok = False
                    continue
                if t != NUMBER:
                    self._type_error(
                        ErrorCode.STATIC_TYPE_MISMATCH,
                        "{!r} 的第 {} 个参数要求 number，实际为 {}".format(
                            node.name, idx + 1, t
                        ),
                        node.args[idx],
                        {"parameter": idx + 1, "expected": NUMBER, "actual": t},
                    )
                    ok = False
            return NUMBER if ok else None

        if node.name in ("abs", "round"):
            if len(arg_types) != 1:
                self._arity_error(node, "恰好 1 个", len(arg_types))
                return None
            return NUMBER if self._expect(node.args[0], arg_types[0], NUMBER,
                                          "{!r} 参数".format(node.name)) else None

        if node.name == "if":
            if len(arg_types) != 3:
                self._arity_error(node, "恰好 3 个", len(arg_types))
                return None
            cond_t, a_t, b_t = arg_types
            self._expect(node.args[0], cond_t, BOOL, "'if' 的条件参数")
            result_t = a_t if a_t == b_t else None
            if a_t is not None and b_t is not None and a_t != b_t:
                self._type_error(
                    ErrorCode.STATIC_BRANCH_TYPE,
                    "'if' 两个分支类型不一致：{} 与 {}".format(a_t, b_t),
                    node,
                    {"then_type": a_t, "else_type": b_t},
                )
            return result_t

        # 解析器通常已拦截未知函数，这里兜底
        self._type_error(
            ErrorCode.STATIC_NOT_CALLABLE,
            "{!r} 不是可调用函数".format(node.name),
            node,
            {"name": node.name},
        )
        return None

    def _arity_error(self, node, expected_desc, actual_count):
        self._type_error(
            ErrorCode.STATIC_ARITY_MISMATCH,
            "函数 {!r} 需要{}参数，实际提供了 {} 个".format(
                node.name, expected_desc, actual_count
            ),
            node,
            {"function": node.name, "expected": expected_desc, "actual": actual_count},
        )


def check_ast(root, type_resolver):
    return TypeChecker(type_resolver).check(root)
