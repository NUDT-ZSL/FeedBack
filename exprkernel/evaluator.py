"""字节码求值器：显式操作数栈 + 逐步求值轨迹。

关键约束：
  * 只解释执行 :mod:`exprkernel.compiler` 产出的指令，绝不调用 eval/exec；
  * 所有数值进出都过有限性守卫，inf/NaN 立即变 ``EVAL_NON_FINITE``；
  * 字符串拼接受 ``max_string_len`` 限制；
  * 变量解析（含表达式型绑定的递归展开）受 ``max_depth`` 限制；
  * 每条被执行的指令产生一条 :class:`TraceStep`，含整数逻辑时钟
    tick（可注入起始时间，便于测试）；
  * 任何异常都被收敛为带错误码与行列位置的 :class:`Diagnostic`，
    求值器不向外抛未捕获异常。
"""

import math

from . import compiler as bc
from .errors import Diagnostic, ErrorCode, KernelError
from .values import (
    BOOL,
    DEFAULT_MAX_STRING_LEN,
    NUMBER,
    STRING,
    TypedValue,
)

_ORDER_OPS = {"<", "<=", ">", ">="}
_EQUALITY_OPS = {"==", "!="}


class TraceStep:
    """单步求值轨迹。"""

    __slots__ = ("tick", "pc", "op", "text", "line", "column", "inputs", "output")

    def __init__(self, tick, pc, op, text, line, column, inputs, output):
        self.tick = tick
        self.pc = pc
        self.op = op
        self.text = text
        self.line = line
        self.column = column
        # inputs/output 都是可 JSON 化的普通 dict（{value, type}）
        self.inputs = inputs
        self.output = output

    def to_dict(self):
        return {
            "tick": self.tick,
            "pc": self.pc,
            "op": self.op,
            "text": self.text,
            "line": self.line,
            "column": self.column,
            "inputs": self.inputs,
            "output": self.output,
        }

    def __repr__(self):
        return "TraceStep(#{} {} -> {})".format(self.tick, self.op, self.output)


class EvalResult:
    """求值返回值。失败时 ``value``/``type`` 为 None，error 携带诊断。"""

    __slots__ = ("ok", "value", "type", "trace", "error", "logical_time", "warnings")

    def __init__(self, ok, value=None, type_=None, trace=None, error=None,
                 logical_time=0, warnings=None):
        self.ok = ok
        self.value = value
        self.type = type_
        self.trace = trace or []
        self.error = error
        self.logical_time = logical_time
        self.warnings = warnings or []

    @property
    def typed_value(self):
        if self.ok:
            return TypedValue(self.value, self.type)
        return None

    def to_dict(self):
        return {
            "ok": self.ok,
            "value": self.value,
            "type": self.type,
            "trace": [s.to_dict() for s in self.trace],
            "error": self.error.to_dict() if self.error else None,
            "logical_time": self.logical_time,
            "warnings": [w.to_dict() for w in self.warnings],
        }

    def __repr__(self):
        if self.ok:
            return "EvalResult(ok, value={!r}, type={}, steps={})".format(
                self.value, self.type, len(self.trace))
        return "EvalResult(error={})".format(self.error)


def _tv_dict(tv):
    return tv.to_dict() if tv is not None else None


class Evaluator:
    """对单个 :class:`~exprkernel.compiler.Program` 求值。

    :param resolver: ``resolver(name, ins, visitor) -> TypedValue``，
        负责把变量名解析为值（表达式型绑定在此递归展开）
    :param logical_time: 整数逻辑时钟起始值，每条指令 +1
    :param shared: 跨嵌套求值共享的 ``[clock, trace]``（绑定展开用）；
        为 None 时自建，成为顶层求值
    """

    def __init__(self, program, resolver, max_string_len=DEFAULT_MAX_STRING_LEN,
                 logical_time=0, shared=None):
        self.program = program
        self.resolve = resolver
        self.max_string_len = max_string_len
        if shared is None:
            self.clock = int(logical_time)
            self.trace = []
            self._shared = [self.clock, self.trace]
        else:
            self._shared = shared
            self.clock = shared[0]
            self.trace = shared[1]
        self.stack = []

    # ---- 主循环 ----
    def run(self):
        code = self.program.code
        pc = 0
        stack = self.stack
        n = len(code)
        try:
            while pc < n:
                ins = code[pc]
                next_pc, jumped = self._execute(ins, pc)
                # 记录跳转类指令的轨迹在 _execute 内完成；此处统一推进
                pc = next_pc if next_pc is not None else pc + 1
        except KernelError as exc:
            return None, exc.diagnostic
        except RecursionError:
            return None, Diagnostic(
                ErrorCode.EVAL_DEPTH_EXCEEDED,
                "求值递归深度超过 Python 解释器限制",
            )
        except Exception as exc:  # 兜底：任何意外都不裸抛
            return None, Diagnostic(
                ErrorCode.EVAL_INTERNAL,
                "求值器内部错误：{}: {}".format(type(exc).__name__, exc),
            )

        if len(stack) != 1:
            return None, Diagnostic(
                ErrorCode.EVAL_INTERNAL,
                "求值结束时操作数栈异常（深度 {}，应为 1）".format(len(stack)),
            )
        result = stack[0]
        self._shared[0] = self.clock
        return result, None

    # ---- 指令分派 ----
    def _execute(self, ins, pc):
        """执行一条指令，返回 (下一条 pc, 是否跳转)。"""
        op = ins.op

        if op == bc.LOAD_CONST:
            value, type_ = self.program.constants[ins.arg]
            tv = TypedValue(value, type_)
            self._push_trace(ins, pc, [], tv)
            self.stack.append(tv)
            return None, False

        if op == bc.LOAD_VAR:
            tv = self.resolve(ins.arg, ins, self)
            if not isinstance(tv, TypedValue):
                self._fail(ErrorCode.EVAL_INTERNAL,
                           "变量解析器返回了非 TypedValue", ins)
            self._push_trace(ins, pc, [], tv)
            self.stack.append(tv)
            return None, False

        if op == bc.UNARY:
            a = self.stack.pop()
            r = self._apply_unary(ins.arg, a, ins)
            self._push_trace(ins, pc, [a], r)
            self.stack.append(r)
            return None, False

        if op == bc.BIN_OP:
            b = self.stack.pop()
            a = self.stack.pop()
            r = self._apply_binary(ins.arg, a, b, ins)
            self._push_trace(ins, pc, [a, b], r)
            self.stack.append(r)
            return None, False

        if op == bc.CALL_BUILTIN:
            name, argc = ins.arg
            args = [self.stack.pop() for _ in range(argc)][::-1]
            r = self._apply_call(name, args, ins)
            self._push_trace(ins, pc, args, r)
            self.stack.append(r)
            return None, False

        if op == bc.JUMP:
            return ins.arg, True

        if op == bc.JUMP_IF_FALSE:
            cond = self.stack.pop()
            self._check_type(cond, BOOL, ins, "if 条件")
            take = cond.value is False
            self._push_trace(ins, pc, [cond], None,
                             note="take" if take else "fallthrough")
            return ins.arg if take else None, take

        if op == bc.JUMP_IF_FALSE_POP:  # and
            left = self.stack[-1]  # 先看，不弹
            self._check_type(left, BOOL, ins, "'and' 左侧")
            if left.value is False:
                # 短路：左值留在栈顶作为结果
                self._push_trace(ins, pc, [], left, note="short-circuit")
                return ins.arg, True
            self.stack.pop()  # 为真：丢弃左值，继续算右值
            self._push_trace(ins, pc, [left], None, note="continue")
            return None, False

        if op == bc.JUMP_IF_TRUE_POP:  # or
            left = self.stack[-1]
            self._check_type(left, BOOL, ins, "'or' 左侧")
            if left.value is True:
                self._push_trace(ins, pc, [], left, note="short-circuit")
                return ins.arg, True
            self.stack.pop()
            self._push_trace(ins, pc, [left], None, note="continue")
            return None, False

        self._fail(ErrorCode.EVAL_INTERNAL, "未知字节码 {!r}".format(op), ins)

    # ---- 运算语义 ----
    def _apply_unary(self, op, a, ins):
        if op == "-":
            self._check_type(a, NUMBER, ins, "一元负号")
            return self._number(-a.value, ins)
        # not
        self._check_type(a, BOOL, ins, "'not'")
        return TypedValue(not a.value, BOOL)

    def _apply_binary(self, op, a, b, ins):
        # 比较运算：两侧同类型即可（number 之间比大小，string/bool 仅判等）
        if op in _ORDER_OPS:
            self._check_same_type(a, b, ins)
            if a.type != NUMBER:
                # 静态检查本应拦住，这里是运行时兜底
                self._fail(
                    ErrorCode.EVAL_TYPE,
                    "大小比较 {} 只支持 number，实际为 {}".format(op, a.type),
                    ins,
                    {"operator": op, "actual": a.type},
                )
            return self._compare_order(op, a, b)
        if op in _EQUALITY_OPS:
            self._check_same_type(a, b, ins)
            return TypedValue(
                (a.value == b.value) if op == "==" else (a.value != b.value),
                BOOL,
            )

        # 字符串拼接
        if op == "+" and a.type == STRING:
            self._check_type(b, STRING, ins, "字符串拼接右侧")
            merged = a.value + b.value
            if len(merged) > self.max_string_len:
                self._fail(
                    ErrorCode.EVAL_STRING_TOO_LONG,
                    "字符串拼接结果长度 {} 超过上限 {}".format(
                        len(merged), self.max_string_len),
                    ins,
                    {"length": len(merged), "limit": self.max_string_len},
                )
            return TypedValue(merged, STRING)

        # 算术运算
        self._check_type(a, NUMBER, ins, "算术运算左侧")
        self._check_type(b, NUMBER, ins, "算术运算右侧")
        x, y = a.value, b.value

        if op == "+":
            return self._number(x + y, ins)
        if op == "-":
            return self._number(x - y, ins)
        if op == "*":
            return self._number(x * y, ins)
        if op == "/":
            if y == 0:
                self._fail(ErrorCode.EVAL_DIV_ZERO, "除数为 0", ins,
                           {"operator": "/"})
            return self._number(x / y, ins)
        if op == "%":
            if y == 0:
                self._fail(ErrorCode.EVAL_MOD_ZERO, "取模运算的右操作数为 0", ins,
                           {"operator": "%"})
            return self._number(math.fmod(x, y), ins)
        self._fail(ErrorCode.EVAL_INTERNAL, "未知二元运算符 {!r}".format(op), ins)

    def _compare_order(self, op, a, b):
        x, y = a.value, b.value
        if op == "<":
            return TypedValue(x < y, BOOL)
        if op == "<=":
            return TypedValue(x <= y, BOOL)
        if op == ">":
            return TypedValue(x > y, BOOL)
        return TypedValue(x >= y, BOOL)

    def _apply_call(self, name, args, ins):
        if name == "min":
            return self._number(min(args[0].value, args[1].value), ins)
        if name == "max":
            return self._number(max(args[0].value, args[1].value), ins)
        if name == "abs":
            return self._number(abs(args[0].value), ins)
        if name == "round":
            # 采用 Python 的银行家舍入（半数偶），结果统一为 float
            return self._number(float(round(args[0].value)), ins)
        self._fail(ErrorCode.EVAL_INTERNAL, "未知内置函数 {!r}".format(name), ins)

    # ---- 守卫 ----
    def _number(self, value, ins):
        if not math.isfinite(value):
            self._fail(
                ErrorCode.EVAL_NON_FINITE,
                "数值运算结果不是有限浮点数（{}），已拒绝 inf/NaN 传播".format(value),
                ins,
                {"value": repr(value)},
            )
        return TypedValue(float(value), NUMBER)

    @staticmethod
    def _check_type(tv, expected, ins, what):
        if tv.type != expected:
            raise KernelError(Diagnostic(
                ErrorCode.EVAL_TYPE,
                "{}要求 {} 类型，实际为 {}".format(what, expected, tv.type),
                ins.line, ins.column,
                {"expected": expected, "actual": tv.type},
            ))

    @staticmethod
    def _check_same_type(a, b, ins):
        if a.type != b.type:
            raise KernelError(Diagnostic(
                ErrorCode.EVAL_TYPE,
                "比较运算要求两侧同类型，{} 与 {}".format(a.type, b.type),
                ins.line, ins.column,
                {"left_type": a.type, "right_type": b.type},
            ))

    @staticmethod
    def _fail(code, message, ins, extra=None):
        raise KernelError(Diagnostic(code, message, ins.line, ins.column, extra))

    # ---- trace ----
    def _push_trace(self, ins, pc, inputs, output, note=""):
        self._shared[0] += 1
        self.clock = self._shared[0]
        text = ins.text
        if note:
            text = "{} [{}]".format(text, note)
        self.trace.append(TraceStep(
            tick=self.clock,
            pc=pc,
            op=ins.op,
            text=text,
            line=ins.line,
            column=ins.column,
            inputs=[_tv_dict(v) for v in inputs],
            output=_tv_dict(output),
        ))


def evaluate_program(program, resolver, max_string_len=DEFAULT_MAX_STRING_LEN,
                     logical_time=0, shared=None):
    """便捷封装：返回 :class:`EvalResult`。

    顶层调用不传 ``shared``；绑定表达式递归展开时由解析器传入同一个
    ``[clock, trace]`` 以保证逻辑时钟与轨迹连续。
    """
    ev = Evaluator(program, resolver,
                   max_string_len=max_string_len, logical_time=logical_time,
                   shared=shared)
    tv, diag = ev.run()
    if diag is not None:
        return EvalResult(False, trace=ev.trace, error=diag,
                          logical_time=ev._shared[0])
    return EvalResult(True, value=tv.value, type_=tv.type,
                      trace=ev.trace, logical_time=ev._shared[0])
