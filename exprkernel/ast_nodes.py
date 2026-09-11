"""AST 节点定义。

每个节点都记录源码行列位置（从 1 开始），静态检查与运行时错误
都靠它定位。AST 只描述结构，不绑定任何求值行为。
"""


class Node:
    __slots__ = ("line", "column")

    def __init__(self, line, column):
        self.line = line
        self.column = column


class NumberLit(Node):
    __slots__ = ("value",)

    def __init__(self, value, line, column):
        super().__init__(line, column)
        self.value = value


class StringLit(Node):
    __slots__ = ("value",)

    def __init__(self, value, line, column):
        super().__init__(line, column)
        self.value = value


class BoolLit(Node):
    __slots__ = ("value",)

    def __init__(self, value, line, column):
        super().__init__(line, column)
        self.value = value


class Var(Node):
    __slots__ = ("name",)

    def __init__(self, name, line, column):
        super().__init__(line, column)
        self.name = name


class Unary(Node):
    """一元运算：``-``（number）或 ``not``（bool）。"""

    __slots__ = ("op", "operand")

    def __init__(self, op, operand, line, column):
        super().__init__(line, column)
        self.op = op
        self.operand = operand


class Binary(Node):
    """二元算术/比较运算：``+ - * / % < <= > >= == !=``。"""

    __slots__ = ("op", "left", "right")

    def __init__(self, op, left, right, line, column):
        super().__init__(line, column)
        self.op = op
        self.left = left
        self.right = right


class Logical(Node):
    """短路逻辑运算：``and`` / ``or``。"""

    __slots__ = ("op", "left", "right")

    def __init__(self, op, left, right, line, column):
        super().__init__(line, column)
        self.op = op
        self.left = left
        self.right = right


class Call(Node):
    """函数调用，如 ``min(a, b)`` / ``if(cond, x, y)``。"""

    __slots__ = ("name", "args")

    def __init__(self, name, args, line, column):
        super().__init__(line, column)
        self.name = name
        self.args = args
