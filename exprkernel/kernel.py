"""Engine 门面：词法 -> 语法 -> 静态检查 -> 编译 -> 显式栈求值。

调用方只需要面对这一个类::

    engine = Engine()
    engine.bind("rate", 0.1)
    r = engine.bind_expr("price", "100 * (1 + rate)")
    chk = engine.check("price > 100")
    result = engine.evaluate("if(price > 100, 'high', 'low')")

绑定允许前向引用（先 ``bind_expr('a', 'b + 1')`` 再定义 b），环在
闭合的那次注册报错；挂起绑定的类型在 check/evaluate 时惰性解析。
各阶段错误统一转换为结果对象，Engine 的公开方法不抛未捕获异常。
"""

from .checker import TypeChecker
from .compiler import compile_ast
from .errors import Diagnostic, ErrorCode, KernelError
from .evaluator import EvalResult, Evaluator
from .parser import parse
from .registry import BindResult, Registry, collect_vars
from .values import DEFAULT_MAX_DEPTH, DEFAULT_MAX_STRING_LEN, TypedValue

__all__ = ["Engine", "CheckResult", "EvalResult", "BindResult"]


class CheckResult:
    """``check`` 的返回值。

    :param type_: 推断类型（number/string/bool）；有任何错误时为 None
    :param undefined: 未定义变量诊断列表（去重，首次出现顺序）
    :param warnings: 告警诊断列表（如字面量 0 作除数）
    :param errors: 全部静态错误（语法 + 未定义变量 + 类型/参数/依赖链错误）
    """

    __slots__ = ("ok", "type", "undefined", "type_errors", "warnings", "errors")

    def __init__(self, type_=None, undefined=None, type_errors=None,
                 warnings=None, errors=None):
        self.type = type_
        self.undefined = undefined or []
        self.type_errors = type_errors or []
        self.warnings = warnings or []
        self.errors = errors or []
        self.ok = not self.errors

    def __repr__(self):
        return ("CheckResult(ok={}, type={}, undefined={}, type_errors={}, "
                "warnings={})").format(
            self.ok, self.type, len(self.undefined), len(self.type_errors),
            len(self.warnings),
        )


class Engine:
    def __init__(self, max_depth=DEFAULT_MAX_DEPTH,
                 max_string_len=DEFAULT_MAX_STRING_LEN):
        self.max_depth = max_depth
        self.max_string_len = max_string_len
        self.registry = Registry(max_depth=max_depth)
        # 表达式绑定的编译产物缓存：name -> Program
        self._programs = {}

    # ------------------------------------------------------------------
    # 绑定
    # ------------------------------------------------------------------
    def bind(self, name, value, type_hint=None):
        """绑定字面量（int/float/bool/str）。重复绑定返回冲突名错误。"""
        return self.registry.bind_literal(name, value, type_hint=type_hint)

    def bind_expr(self, name, expression):
        """绑定表达式；注册时做环检测与（依赖齐备时的）静态检查。

        含前向引用时返回 ``pending=True``，待依赖注册后在
        ``check`` / ``evaluate`` 时完成类型解析与编译。
        """
        return self.registry.bind_expr(name, expression)

    # ------------------------------------------------------------------
    # 静态检查
    # ------------------------------------------------------------------
    def check(self, expression):
        """对一段表达式做静态检查，返回 :class:`CheckResult`。"""
        try:
            root = parse(expression, max_depth=self.max_depth)
            checker = TypeChecker(self.registry.type_of)
            inner = checker.check(root)
        except KernelError as exc:
            return CheckResult(errors=[exc.diagnostic])
        return CheckResult(
            type_=inner.type,
            undefined=list(inner.undefined),
            type_errors=list(inner.type_errors),
            warnings=list(inner.warnings),
            errors=list(inner.errors),
        )

    # ------------------------------------------------------------------
    # 求值
    # ------------------------------------------------------------------
    def evaluate(self, expression, logical_time=0):
        """先静态检查再编译求值，返回 :class:`EvalResult`。

        静态错误阻断求值；字面量除零等告警不阻断，随结果一并返回。
        ``logical_time`` 是可注入的整数逻辑时钟起点，每条执行指令 +1。
        """
        # 1) 词法/语法
        try:
            root = parse(expression, max_depth=self.max_depth)
        except KernelError as exc:
            return EvalResult(False, error=exc.diagnostic,
                              logical_time=int(logical_time))

        # 2) 静态检查（依赖链上挂起绑定的类型错误也在此抛出/收集）
        try:
            checker = TypeChecker(self.registry.type_of)
            static = checker.check(root)
        except KernelError as exc:
            return EvalResult(False, error=exc.diagnostic,
                              logical_time=int(logical_time))
        if not static.ok:
            return EvalResult(
                False,
                error=static.errors[0],
                warnings=list(static.warnings),
                logical_time=int(logical_time),
            )

        # 3) 编译顶层表达式
        program = compile_ast(root)

        # 4) 变量解析器：字面量直接取值；表达式绑定惰性编译并嵌套解释执行
        var_stack = []

        def resolver(name, ins, visitor):
            if len(var_stack) >= self.max_depth:
                raise KernelError(Diagnostic(
                    ErrorCode.EVAL_DEPTH_EXCEEDED,
                    "变量 {!r} 的绑定展开深度超过上限 {}".format(
                        name, self.max_depth),
                    ins.line, ins.column,
                    {"name": name, "depth": len(var_stack)},
                ))
            binding = self.registry.get(name)
            if binding is None:
                # 静态检查已拦，运行时兜底
                raise KernelError(Diagnostic(
                    ErrorCode.EVAL_UNDEFINED_VAR,
                    "变量 {!r} 未定义".format(name),
                    ins.line, ins.column, {"name": name},
                ))
            if binding.kind == "literal":
                return TypedValue(binding.value, binding.type)

            if name not in self._programs:
                # 惰性解析类型：挂起绑定的依赖可能此时才齐备；
                # 依赖缺失/成环/超深会在此抛出带诊断的 KernelError。
                resolved_type = self.registry.type_of(name)
                if resolved_type is None:
                    raise KernelError(Diagnostic(
                        ErrorCode.EVAL_UNDEFINED_VAR,
                        "变量 {!r} 的表达式绑定仍有未解析的依赖".format(name),
                        ins.line, ins.column, {"name": name},
                    ))
                binding.type = resolved_type
                self._programs[name] = compile_ast(binding.ast)

            var_stack.append(name)
            try:
                sub = Evaluator(
                    self._programs[name],
                    resolver,
                    max_string_len=self.max_string_len,
                    shared=visitor._shared,
                )
                tv, diag = sub.run()
                if diag is not None:
                    raise KernelError(diag)
                return tv
            finally:
                var_stack.pop()

        # 5) 执行
        ev = Evaluator(
            program, resolver,
            max_string_len=self.max_string_len,
            logical_time=logical_time,
        )
        tv, diag = ev.run()

        # 顶层表达式自身告警 + 传递依赖的表达式绑定告警
        warnings = list(static.warnings)
        with self._suppress_dependency_errors():
            warnings.extend(self._collect_warnings(root))
        if diag is not None:
            return EvalResult(False, trace=ev.trace, error=diag,
                              logical_time=ev._shared[0], warnings=warnings)
        return EvalResult(
            True, value=tv.value, type_=tv.type, trace=ev.trace,
            logical_time=ev._shared[0], warnings=warnings,
        )

    def _collect_warnings(self, root):
        result = []
        seen = set()
        stack = list(reversed(collect_vars(root)))
        while stack:
            name = stack.pop()
            if name in seen:
                continue
            seen.add(name)
            binding = self.registry.get(name)
            if binding is None:
                continue
            if binding.kind == "expr":
                # 触发一次类型解析以填充 binding.warnings（已 memo 则廉价）
                self.registry.type_of(name)
                result.extend(binding.warnings)
                stack.extend(reversed(binding.deps))
        return result

    @staticmethod
    def _suppress_dependency_errors():
        import contextlib
        return contextlib.suppress(KernelError)
