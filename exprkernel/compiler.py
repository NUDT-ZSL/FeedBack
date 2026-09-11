"""字节码编译器：AST -> 线性指令序列。

编译后的程序由 :class:`Instr` 列表组成，求值器用显式的操作数栈执行，
全程不存在 eval/exec。``and`` / ``or`` / ``if`` 都编译为**跳转指令**，
天然实现短路/分支选择；每条值生产指令都带着源码位置，trace 与
运行时错误都能指回行列。

栈效果（右为栈顶）::

    LOAD_CONST idx          -> ... value
    LOAD_VAR name           -> ... value
    UNARY op                -> ... v          => ... r
    BIN_OP op               -> ... a b        => ... r
    CALL_BUILTIN (name, n)  -> ... a1 .. an   => ... r
    JUMP target
    JUMP_IF_FALSE target    弹栈条件值，假则跳
    JUMP_IF_FALSE_POP       and 短路：值为假时带着该值跳过右侧
    JUMP_IF_TRUE_POP        or  短路：值为真时带着该值跳过右侧
"""

from . import ast_nodes as ast
from .values import BOOL, NUMBER, STRING

# ---- 操作码 ----
LOAD_CONST = "LOAD_CONST"
LOAD_VAR = "LOAD_VAR"
UNARY = "UNARY"
BIN_OP = "BIN_OP"
CALL_BUILTIN = "CALL_BUILTIN"
JUMP = "JUMP"
JUMP_IF_FALSE = "JUMP_IF_FALSE"
JUMP_IF_TRUE_POP = "JUMP_IF_TRUE_POP"
JUMP_IF_FALSE_POP = "JUMP_IF_FALSE_POP"


class Instr:
    __slots__ = ("op", "arg", "line", "column", "text")

    def __init__(self, op, arg=None, line=0, column=0, text=""):
        self.op = op
        self.arg = arg
        self.line = line
        self.column = column
        self.text = text  # 可读描述，供 trace 使用

    def __repr__(self):
        return "Instr({} {!r} @{}:{})".format(self.op, self.arg, self.line, self.column)


class Program:
    def __init__(self, instructions, constants):
        self.code = instructions
        self.constants = constants  # list[(value, type)]

    def dump(self):
        lines = []
        for idx, ins in enumerate(self.code):
            lines.append("{:>4}  {:<20} {}".format(idx, ins.op, ins.arg))
        return "\n".join(lines)


class Compiler:
    def __init__(self):
        self.code = []
        self.constants = []

    # ---- 发射工具 ----
    def _emit(self, op, arg=None, node=None, text=""):
        line = column = 0
        if node is not None:
            line, column = node.line, node.column
        self.code.append(Instr(op, arg, line, column, text))
        return len(self.code) - 1

    def _const_index(self, value, type_):
        self.constants.append((value, type_))
        return len(self.constants) - 1

    # ---- 入口 ----
    def compile(self, root):
        self._gen(root)
        return Program(self.code, self.constants)

    # ---- 代码生成 ----
    def _gen(self, node):
        if isinstance(node, ast.NumberLit):
            idx = self._const_index(node.value, NUMBER)
            self._emit(LOAD_CONST, idx, node, repr(node.value))
        elif isinstance(node, ast.StringLit):
            idx = self._const_index(node.value, STRING)
            self._emit(LOAD_CONST, idx, node, "\"{}\"".format(node.value))
        elif isinstance(node, ast.BoolLit):
            idx = self._const_index(node.value, BOOL)
            self._emit(LOAD_CONST, idx, node, "true" if node.value else "false")
        elif isinstance(node, ast.Var):
            self._emit(LOAD_VAR, node.name, node, node.name)
        elif isinstance(node, ast.Unary):
            self._gen(node.operand)
            self._emit(UNARY, node.op, node, node.op)
        elif isinstance(node, ast.Binary):
            self._gen(node.left)
            self._gen(node.right)
            self._emit(BIN_OP, node.op, node, node.op)
        elif isinstance(node, ast.Logical):
            self._gen_logical(node)
        elif isinstance(node, ast.Call):
            if node.name == "if":
                self._gen_if(node)
            else:
                self._gen_call(node)
        else:
            # 解析器保证不会发生
            raise TypeError("编译器遇到未知节点：{!r}".format(node))

    def _gen_logical(self, node):
        # 左值先留在栈上：短路时它就是整体结果；不短路时由
        # *_POP 指令弹掉，再以右值作为结果。
        self._gen(node.left)
        if node.op == "and":
            jump = self._emit(JUMP_IF_FALSE_POP, None, node, "and->")
        else:
            jump = self._emit(JUMP_IF_TRUE_POP, None, node, "or->")
        # 不短路路径
        self._gen(node.right)
        end = self._emit(JUMP, None, node, "end")
        self.code[jump].arg = end + 1  # 短路目标：左值仍在栈顶

    def _gen_call(self, node):
        for arg in node.args:
            self._gen(arg)
        self._emit(CALL_BUILTIN, (node.name, len(node.args)), node,
                   "{}/{}".format(node.name, len(node.args)))

    def _gen_if(self, node):
        cond, then_node, else_node = node.args
        self._gen(cond)
        jump_else = self._emit(JUMP_IF_FALSE, None, node, "if->")
        self._gen(then_node)
        jump_end = self._emit(JUMP, None, node, "end")
        else_target = len(self.code)
        self._gen(else_node)
        end_target = len(self.code)
        self.code[jump_else].arg = else_target
        self.code[jump_end].arg = end_target


def compile_ast(root):
    return Compiler().compile(root)
