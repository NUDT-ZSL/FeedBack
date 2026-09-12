"""rvvm -- 寄存器式字节码虚拟机（纯标准库，可离线验收）。

设计要点
========
* 指令为不可变 dataclass（``frozen=True``），每条指令含 ``op`` 与若干
  类型化操作数字段；反汇编 :func:`disassemble` 可还原为可被
  :func:`assemble` 重新汇编的文本（标签会按规范重命名为 ``L<n>:``）。
* 执行器 :meth:`VM.run` 维护寄存器文件、调用栈（:class:`Frame`）与
  指令指针；每次 CALL 压入*调用者寄存器的快照拷贝*作为新帧（实参经
  低位寄存器传入、无别名），RET 弹栈恢复返回地址，调用者帧除 r0
  （返回值通道）外不受被调方影响。
* 资源配额由 :class:`Limits` 控制：最大执行步数、最大调用深度（帧数
  上限）、最大寄存器数量（每帧寄存器窗口宽度）。
* 所有运行期故障都以 :class:`VMError` 的子类在 :class:`RunResult.error`
  中返回（绝不向调用方抛出未捕获异常），错误对象带出错指令下标
  ``instr_index``。汇编期错误 :class:`AssembleError` 带 ``lineno``。
* 确定性：不读取系统时间、不依赖 dict 遍历序（指令表用元组按枚举顺序
  定义）；整数为 Python 任意精度整数，浮点为 IEEE-754 double，比较
  语义见 :data:`FLOAT_EQ_TOL`（默认严格相等 + 容差比较指令 CMPFE）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Tuple, Union

__all__ = [
    "Op",
    "Opcode",
    "Program",
    "Limits",
    "Frame",
    "VM",
    "RunResult",
    "VMError",
    "AssembleError",
    "UnknownMnemonicError",
    "OperandCountError",
    "BadLabelError",
    "BadOperandError",
    "RuntimeVMError",
    "DivisionByZeroError",
    "JumpOutOfBoundsError",
    "RegisterOutOfBoundsError",
    "StackUnderflowError",
    "UnknownOpcodeError",
    "StepLimitExceededError",
    "DepthLimitExceededError",
    "RegisterLimitExceededError",
    "assemble",
    "disassemble",
    "FLOAT_EQ_TOL",
]

# ---------------------------------------------------------------------------
# 确定性与浮点策略
# ---------------------------------------------------------------------------

#: 浮点容差。默认 VM 对 FEQ/FNE 使用严格位/值相等（``a == b``，
#: NaN 永不相等、+0.0 == -0.0），结果因此跨平台逐位确定。
#: 需要近似比较时使用 CMPFE/CMPFNE 指令，按
#: ``abs(a - b) <= FLOAT_EQ_TOL * max(1.0, abs(a), abs(b))``
#: 判定（相对容差 1e-12）。可在运行前修改模块级常量，取值对同一进程
#: 内的所有运行一致，不读取任何环境信息。
FLOAT_EQ_TOL = 1e-12


# ---------------------------------------------------------------------------
# 操作码
# ---------------------------------------------------------------------------


class Opcode(Enum):
    """全部操作码。``code`` 为稳定的二进制编号（勿重排已有编号）。"""

    HALT = 0
    LOADI = 1      # LOADI rd, imm:int
    LOADF = 2      # LOADF rd, imm:float
    MOV = 3        # MOV rd, rs
    IADD = 4       # IADD rd, rs1, rs2
    ISUB = 5
    IMUL = 6
    IDIV = 7       # 截断向零（与 C 的 / 及 Python int(a/b) 一致）
    IMOD = 8       # 截断向零语义余数（与 IDIV 配套）
    FADD = 9
    FSUB = 10
    FMUL = 11
    FDIV = 12
    IEQ = 13       # 整数比较，rd <- 0/1
    INE = 14
    ILT = 15
    ILE = 16
    IGT = 17
    IGE = 18
    FEQ = 19       # 浮点严格相等
    FNE = 20
    FLT = 21
    FLE = 22
    FGT = 23
    FGE = 24
    CMPFE = 25     # 浮点容差相等
    CMPFNE = 26    # 浮点容差不等
    JMP = 27       # JMP label/index
    JZ = 28        # JZ rs, label/index   （rs == 0 跳转）
    JNZ = 29      # JNZ rs, label/index
    CALL = 30      # CALL label/index
    RET = 31       # RET rs
    LOADARG = 32   # LOADARG rd, slot     （读入口参数，越界槽读 0）


# 操作数形态：
#   "r" 目标/源寄存器；"i" 内联整数立即数；"f" 浮点立即数；
#   "t" 跳转目标（汇编期解析为指令下标）。
_OPERAND_SPEC = {
    Opcode.HALT: (),
    Opcode.LOADI: ("r", "i"),
    Opcode.LOADF: ("r", "f"),
    Opcode.MOV: ("r", "r"),
    Opcode.IADD: ("r", "r", "r"),
    Opcode.ISUB: ("r", "r", "r"),
    Opcode.IMUL: ("r", "r", "r"),
    Opcode.IDIV: ("r", "r", "r"),
    Opcode.IMOD: ("r", "r", "r"),
    Opcode.FADD: ("r", "r", "r"),
    Opcode.FSUB: ("r", "r", "r"),
    Opcode.FMUL: ("r", "r", "r"),
    Opcode.FDIV: ("r", "r", "r"),
    Opcode.IEQ: ("r", "r", "r"),
    Opcode.INE: ("r", "r", "r"),
    Opcode.ILT: ("r", "r", "r"),
    Opcode.ILE: ("r", "r", "r"),
    Opcode.IGT: ("r", "r", "r"),
    Opcode.IGE: ("r", "r", "r"),
    Opcode.FEQ: ("r", "r", "r"),
    Opcode.FNE: ("r", "r", "r"),
    Opcode.FLT: ("r", "r", "r"),
    Opcode.FLE: ("r", "r", "r"),
    Opcode.FGT: ("r", "r", "r"),
    Opcode.FGE: ("r", "r", "r"),
    Opcode.CMPFE: ("r", "r", "r"),
    Opcode.CMPFNE: ("r", "r", "r"),
    Opcode.JMP: ("t",),
    Opcode.JZ: ("r", "t"),
    Opcode.JNZ: ("r", "t"),
    Opcode.CALL: ("t",),
    Opcode.RET: ("r",),
    Opcode.LOADARG: ("r", "i"),
}

#: 算术/比较运算结果值（寄存器里允许的全部类型）。
Value = Union[int, float]


@dataclass(frozen=True)
class Op:
    """不可变指令。``a/b/c`` 按操作数形态分别解释为寄存器号、
    立即数或跳转目标下标；未用槽位为 ``None``。"""

    op: Opcode
    a: Optional[int] = None
    b: Optional[Union[int, float]] = None
    c: Optional[int] = None

    def __post_init__(self) -> None:
        op = self.op
        if isinstance(op, Opcode):
            return
        if isinstance(op, int):
            # 允许原始编号：可识别的映射为枚举，无法识别的编号原样保留，
            # 直到执行期（或反汇编期）才报 UnknownOpcodeError——这样
            # “未知操作码”是一条真实可触发的运行期路径。
            try:
                mapped = Opcode(op)
            except ValueError:
                mapped = op
            object.__setattr__(self, "op", mapped)
            return
        raise VMError("Op.op 必须是 Opcode 或 int 操作码编号")


@dataclass(frozen=True)
class Program:
    """汇编产物：指令序列（不可变）。

    ``reg_width`` 为程序声明的每帧寄存器窗口宽度（= 源程序中出现过的
    最大非负寄存器号 + 1，至少为 1）。VM 据此分配寄存器文件，并在入口
    处与 :attr:`Limits.max_registers` 比对。
    """

    instructions: Tuple[Op, ...] = field(default_factory=tuple)
    reg_width: Optional[int] = None

    def __len__(self) -> int:
        return len(self.instructions)

    @property
    def width(self) -> int:
        if self.reg_width is not None:
            return self.reg_width
        # 手工构造 Program 的兜底：从操作数中按指令形态扫描。
        width = 1
        for op in self.instructions:
            spec = _OPERAND_SPEC.get(op.op, ())
            for kind, val in zip(spec, (op.a, op.b, op.c)):
                if kind == "r" and isinstance(val, int) and val >= 0:
                    width = max(width, val + 1)
        return width


# ---------------------------------------------------------------------------
# 错误体系
# ---------------------------------------------------------------------------


class VMError(Exception):
    """所有 VM 错误（汇编期 + 运行期）的基类。"""


class AssembleError(VMError):
    """汇编期错误基类，``lineno`` 为源文件行号（从 1 起）。"""

    def __init__(self, message: str, lineno: int):
        super().__init__(f"[line {lineno}] {message}")
        self.lineno = lineno


class UnknownMnemonicError(AssembleError):
    def __init__(self, mnemonic: str, lineno: int):
        super().__init__(f"非法助记符: {mnemonic!r}", lineno)
        self.mnemonic = mnemonic


class OperandCountError(AssembleError):
    def __init__(self, mnemonic: str, expected: int, got: int, lineno: int):
        super().__init__(
            f"{mnemonic}: 操作数个数错误，期望 {expected} 个，实际 {got} 个",
            lineno,
        )
        self.expected = expected
        self.got = got


class BadLabelError(AssembleError):
    def __init__(self, label: str, lineno: int):
        super().__init__(f"未定义的标签: {label!r}", lineno)
        self.label = label


class BadOperandError(AssembleError):
    def __init__(self, detail: str, lineno: int):
        super().__init__(f"非法操作数: {detail}", lineno)


class RuntimeVMError(VMError):
    """运行期错误基类，``instr_index`` 为出错指令在 Program 中的下标。"""

    def __init__(self, message: str, instr_index: int):
        super().__init__(f"[instr {instr_index}] {message}")
        self.instr_index = instr_index


class DivisionByZeroError(RuntimeVMError):
    def __init__(self, instr_index: int):
        super().__init__("整数除零", instr_index)


class JumpOutOfBoundsError(RuntimeVMError):
    def __init__(self, target: int, size: int, instr_index: int):
        super().__init__(
            f"跳转目标越界: {target} 不在 [0, {size}) 内", instr_index
        )
        self.target = target
        self.size = size


class RegisterOutOfBoundsError(RuntimeVMError):
    def __init__(self, reg: int, width: int, instr_index: int):
        super().__init__(
            f"寄存器越界: r{reg}，当前帧寄存器窗口宽度为 {width}", instr_index
        )
        self.reg = reg
        self.width = width


class StackUnderflowError(RuntimeVMError):
    def __init__(self, instr_index: int):
        super().__init__("调用栈下溢: 顶层帧执行了 RET", instr_index)


class UnknownOpcodeError(RuntimeVMError):
    def __init__(self, code: object, instr_index: int):
        super().__init__(f"未知操作码: {code!r}", instr_index)
        self.code = code


class StepLimitExceededError(RuntimeVMError):
    def __init__(self, limit: int, instr_index: int):
        super().__init__(f"超过最大执行步数: {limit}", instr_index)
        self.limit = limit


class DepthLimitExceededError(RuntimeVMError):
    def __init__(self, limit: int, instr_index: int):
        super().__init__(f"超过最大调用深度: {limit}", instr_index)
        self.limit = limit


class RegisterLimitExceededError(RuntimeVMError):
    def __init__(self, requested: int, limit: int, instr_index: int):
        super().__init__(
            f"超过最大寄存器数量: 需要 {requested}，上限 {limit}", instr_index
        )
        self.requested = requested
        self.limit = limit


# ---------------------------------------------------------------------------
# 汇编 / 反汇编
# ---------------------------------------------------------------------------

_MNEMONIC_TO_OP = {op.name: op for op in Opcode}


def _parse_int(token: str, lineno: int) -> int:
    try:
        # int(x, 0) 支持 0x/0o/0b 前缀；但它拒绝 "08" 这类前导零
        # 十进制，故无前缀时按十进制再试一次。
        if token[:1] in ("+", "-"):
            body = token[1:]
            sign = -1 if token[0] == "-" else 1
        else:
            body, sign = token, 1
        if body[:2] in ("0x", "0X", "0o", "0O", "0b", "0B"):
            return sign * int(body, 0)
        return sign * int(body, 10)
    except ValueError:
        raise BadOperandError(f"{token!r} 不是合法整数", lineno) from None


def _is_label_name(name: str) -> bool:
    return (
        bool(name)
        and all(("a" <= c <= "z") or ("A" <= c <= "Z") or c == "_" for c in name[0])
        and all(
            ("a" <= c <= "z") or ("A" <= c <= "Z") or ("0" <= c <= "9") or c == "_"
            for c in name
        )
    )


def _parse_float(token: str, lineno: int) -> float:
    try:
        value = float(token)
    except ValueError:
        raise BadOperandError(f"{token!r} 不是合法浮点数", lineno) from None
    if math.isnan(value):
        raise BadOperandError("不允许 NaN 立即数（破坏确定性）", lineno)
    return value


def _format_float(value: float) -> str:
    """稳定的浮点文本：保证 float(_format_float(x)) == x。"""
    if math.isinf(value):
        return "1e999" if value > 0 else "-1e999"
    return repr(value)


def assemble(source: str) -> Program:
    """把汇编文本汇编成 :class:`Program`。

    文法（每行一条）::

        LABEL:                 # 标签定义（标识符，字母/数字/_，非数字开头）
        MNEMONIC op1, op2 ...  # 指令
        # 整行注释 / ; 整行注释；指令后可用 # 或 ; 起行内注释
        （空行忽略）

    寄存器写作 ``r3``；跳转/调用操作数可写标签或指令下标；
    浮点立即数含 ``.``/``e``/``inf``。
    """

    lines = source.splitlines()

    # 第一遍：记录标签 -> 指令下标，同时切出 (lineno, 助记符, 操作数token)。
    raw_items = []  # (lineno, mnemonic_upper, [tokens])
    labels = {}     # label -> instr index
    for lineno, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue
        # 去注释（# 或 ; 起；操作数中不会出现这两个字符）
        for cut in ("#", ";"):
            pos = line.find(cut)
            if pos != -1:
                line = line[:pos]
        line = line.strip()
        if not line:
            continue

        if line.endswith(":"):
            name = line[:-1].strip()
            if not _is_label_name(name):
                raise BadOperandError(f"非法标签名: {name!r}", lineno)
            if name in labels:
                raise BadOperandError(f"标签重复定义: {name!r}", lineno)
            labels[name] = len(raw_items)
            continue

        parts = line.replace(",", " ").split()
        mnemonic = parts[0].upper()
        operands = parts[1:]
        raw_items.append((lineno, mnemonic, operands))

    # 第二遍：生成指令。
    instructions = []
    for index, (lineno, mnemonic, tokens) in enumerate(raw_items):
        opcode = _MNEMONIC_TO_OP.get(mnemonic)
        if opcode is None:
            raise UnknownMnemonicError(mnemonic, lineno)
        spec = _OPERAND_SPEC[opcode]
        if len(tokens) != len(spec):
            raise OperandCountError(mnemonic, len(spec), len(tokens), lineno)

        vals = []
        for token, kind in zip(tokens, spec):
            if kind == "r":
                if token[0] not in "rR" or not token[1:].isdigit():
                    raise BadOperandError(
                        f"{token!r} 不是寄存器（形如 r0，编号非负）", lineno
                    )
                vals.append(int(token[1:], 10))
            elif kind == "i":
                vals.append(_parse_int(token, lineno))
            elif kind == "f":
                vals.append(_parse_float(token, lineno))
            else:  # "t" 跳转目标
                if token.lstrip("-").isdigit():
                    vals.append(int(token, 10))
                else:
                    if token not in labels:
                        raise BadLabelError(token, lineno)
                    vals.append(labels[token])
        instructions.append(Op(opcode, *vals))

    # 寄存器窗口宽度 = 程序使用到的最大寄存器号 + 1（至少 1）。
    reg_width = 1
    for op in instructions:
        spec = _OPERAND_SPEC[op.op]
        for kind, val in zip(spec, (op.a, op.b, op.c)):
            if kind == "r" and isinstance(val, int):
                reg_width = max(reg_width, val + 1)

    return Program(tuple(instructions), reg_width)


def disassemble(program: Program) -> str:
    """反汇编为规范文本。

    所有跳转/调用目标都渲染为 ``L<下标>:`` 标签；输出可被
    :func:`assemble` 无损还原（指令序列逐字节等价）。
    """
    instructions = program.instructions
    targeted = set()
    for op in instructions:
        if op.op in (Opcode.JMP, Opcode.CALL):
            if isinstance(op.a, int):
                targeted.add(op.a)
        elif op.op in (Opcode.JZ, Opcode.JNZ):
            if isinstance(op.b, int):
                targeted.add(op.b)

    out_lines = []
    for index, op in enumerate(instructions):
        if index in targeted:
            out_lines.append(f"L{index}:")
        spec = _OPERAND_SPEC.get(op.op)
        if spec is None:
            # 未知操作码编号（手工构造的 Program）：尽力输出可读文本，
            # 不抛异常；该行无法被 assemble 重新汇编（会报非法助记符）。
            out_lines.append(f"RAW {getattr(op.op, 'value', op.op)}")
            continue
        text = op.op.name
        operands = []
        raw = (op.a, op.b, op.c)
        for kind, val in zip(spec, raw):
            if kind == "r":
                operands.append(f"r{val}")
            elif kind == "i":
                operands.append(str(val))
            elif kind == "f":
                operands.append(_format_float(float(val)))
            else:  # "t"
                operands.append(f"L{val}")
        if operands:
            text += " " + ", ".join(operands)
        out_lines.append(text)
    return "\n".join(out_lines)


# ---------------------------------------------------------------------------
# 执行器
# ---------------------------------------------------------------------------


@dataclass
class Limits:
    """资源配额。None 表示该项不限。

    * ``max_steps``：最多执行的指令条数（执行第 max_steps+1 条前停机）。
    * ``max_depth``：调用栈最大帧数（入口帧算 1，CALL 会使其超过上限时
      在 CALL 处停机）。
    * ``max_registers``：程序寄存器窗口宽度上限。窗口宽度由程序声明
      （汇编时 = 最大寄存器号 + 1），入口处统一检查，超限直接拒绝运行，
      与运行中访问具体寄存器导致的 :class:`RegisterOutOfBoundsError`
      （手工构造窄 Program 时才可能发生）相区分。
    """

    max_steps: Optional[int] = None
    max_depth: Optional[int] = 256
    max_registers: Optional[int] = 256


@dataclass
class Frame:
    """一次调用的活动记录：独立寄存器文件 + 返回地址。"""

    regs: list
    return_ip: Optional[int]  # None 表示入口帧（执行 RET 即栈下溢）
    entry: int                # 帧对应的子程序起始下标（诊断用）


@dataclass(frozen=True)
class RunResult:
    halted: bool                       # 是否执行到 HALT
    return_value: Optional[Value]      # 停机时 r0 的快照 / RET 出参
    steps: int                         # 已执行指令条数
    error: Optional[RuntimeVMError]    # 运行期错误（与 halted 互斥倾向）


class VM:
    """无状态、可复用的虚拟机（配额按每次 run 传入）。"""

    def run(
        self,
        program: Program,
        entry: int = 0,
        args: Optional[Tuple[Value, ...]] = None,
        limits: Optional[Limits] = None,
    ) -> RunResult:
        """从 ``entry`` 开始执行。永不向调用方抛出运行期异常：
        任何故障都进入 ``RunResult.error``。"""
        limits = limits if limits is not None else Limits()
        code = program.instructions
        size = len(code)
        steps = 0

        try:
            # 空程序：直接视为停机，无返回值。
            if size == 0:
                return RunResult(True, None, 0, None)
            if not (0 <= entry < size):
                raise JumpOutOfBoundsError(entry, size, max(0, min(entry, size - 1)))
            width = program.width
            if limits.max_registers is not None and width > limits.max_registers:
                # 入口前的静态检查：程序声明的窗口宽度突破配额。
                raise RegisterLimitExceededError(
                    width, limits.max_registers, entry
                )
        except RuntimeVMError as exc:
            return RunResult(False, None, steps, exc)

        args = tuple(args or ())
        try:
            regs = [0] * width
            frame = Frame(regs=regs, return_ip=None, entry=entry)
            # 入口参数不占用寄存器命名空间；程序用 LOADARG 读取。
            frames = [frame]
            ip = entry

            while True:
                # ---- 配额：步数 ----
                if limits.max_steps is not None and steps >= limits.max_steps:
                    raise StepLimitExceededError(limits.max_steps, ip)

                if not (0 <= ip < size):
                    # 直接走到程序末尾（仅可能由手工构造的 Program、末尾
                    # 未放 HALT 或调用点恰为最后一条指令触发）。
                    raise JumpOutOfBoundsError(ip, size, max(ip - 1, 0))

                instr = code[ip]
                steps += 1
                opcode = instr.op

                # ---- 取值辅助（带寄存器边界检查）----
                def reg_get(which: object) -> Value:
                    r = int(which)  # type: ignore[arg-type]
                    if r < 0 or r >= width:
                        raise RegisterOutOfBoundsError(r, width, ip)
                    return regs[r]

                def reg_set(which: object, value: Value) -> None:
                    r = int(which)  # type: ignore[arg-type]
                    if r < 0 or r >= width:
                        raise RegisterOutOfBoundsError(r, width, ip)
                    if isinstance(value, bool) or not isinstance(value, (int, float)):
                        raise RuntimeVMError(
                            f"非法寄存器值类型: {type(value).__name__}", ip
                        )
                    regs[r] = value

                next_ip = ip + 1

                if opcode is Opcode.HALT:
                    return RunResult(True, regs[0], steps, None)

                elif opcode is Opcode.LOADI:
                    reg_set(instr.a, int(instr.b))  # type: ignore[arg-type]

                elif opcode is Opcode.LOADF:
                    reg_set(instr.a, float(instr.b))  # type: ignore[arg-type]

                elif opcode is Opcode.MOV:
                    reg_set(instr.a, reg_get(instr.b))

                elif opcode in (
                    Opcode.IADD, Opcode.ISUB, Opcode.IMUL,
                    Opcode.IDIV, Opcode.IMOD,
                ):
                    x = reg_get(instr.b)
                    y = reg_get(instr.c)
                    if not isinstance(x, int) or not isinstance(y, int):
                        raise RuntimeVMError(
                            f"{opcode.name} 需要两个整数，得到 "
                            f"{type(x).__name__}/{type(y).__name__}",
                            ip,
                        )
                    if opcode is Opcode.IADD:
                        reg_set(instr.a, x + y)
                    elif opcode is Opcode.ISUB:
                        reg_set(instr.a, x - y)
                    elif opcode is Opcode.IMUL:
                        reg_set(instr.a, x * y)
                    elif opcode is Opcode.IDIV:
                        if y == 0:
                            raise DivisionByZeroError(ip)
                        # 截断向零（Python // 是向下取整，需校正）
                        q = abs(x) // abs(y)
                        reg_set(instr.a, q if (x < 0) == (y < 0) else -q)
                    else:  # IMOD，与截断除法配套：r = x - trunc(x/y)*y
                        if y == 0:
                            raise DivisionByZeroError(ip)
                        q = abs(x) // abs(y)
                        q = q if (x < 0) == (y < 0) else -q
                        reg_set(instr.a, x - q * y)

                elif opcode in (
                    Opcode.FADD, Opcode.FSUB, Opcode.FMUL, Opcode.FDIV,
                ):
                    x = reg_get(instr.b)
                    y = reg_get(instr.c)
                    xf = float(x)
                    yf = float(y)
                    if opcode is Opcode.FADD:
                        reg_set(instr.a, xf + yf)
                    elif opcode is Opcode.FSUB:
                        reg_set(instr.a, xf - yf)
                    elif opcode is Opcode.FMUL:
                        reg_set(instr.a, xf * yf)
                    else:
                        # Python 的 float / 0.0 会抛异常；这里按 IEEE-754
                        # 显式处理（结果确定，不依赖运行时开关）：
                        # 0.0/0.0 -> NaN，x/0.0 -> 带符号 inf。
                        if yf == 0.0:
                            if xf == 0.0:
                                value: Value = math.nan
                            else:
                                value = (
                                    math.inf
                                    if (math.copysign(1.0, xf) == math.copysign(1.0, yf))
                                    else -math.inf
                                )
                            reg_set(instr.a, value)
                        else:
                            reg_set(instr.a, xf / yf)

                elif opcode in (
                    Opcode.IEQ, Opcode.INE, Opcode.ILT,
                    Opcode.ILE, Opcode.IGT, Opcode.IGE,
                ):
                    x = reg_get(instr.b)
                    y = reg_get(instr.c)
                    if not isinstance(x, int) or not isinstance(y, int):
                        raise RuntimeVMError(
                            f"{opcode.name} 需要两个整数，得到 "
                            f"{type(x).__name__}/{type(y).__name__}",
                            ip,
                        )
                    cmp = {
                        Opcode.IEQ: x == y,
                        Opcode.INE: x != y,
                        Opcode.ILT: x < y,
                        Opcode.ILE: x <= y,
                        Opcode.IGT: x > y,
                        Opcode.IGE: x >= y,
                    }[opcode]
                    reg_set(instr.a, 1 if cmp else 0)

                elif opcode in (
                    Opcode.FEQ, Opcode.FNE, Opcode.FLT,
                    Opcode.FLE, Opcode.FGT, Opcode.FGE,
                    Opcode.CMPFE, Opcode.CMPFNE,
                ):
                    x = float(reg_get(instr.b))
                    y = float(reg_get(instr.c))
                    if opcode is Opcode.CMPFE or opcode is Opcode.CMPFNE:
                        scale = max(1.0, abs(x), abs(y))
                        near = (
                            not math.isnan(x)
                            and not math.isnan(y)
                            and abs(x - y) <= FLOAT_EQ_TOL * scale
                        )
                        result = near if opcode is Opcode.CMPFE else not near
                        # 两个 NaN：CMPFNE 按“非近似相等”处理 -> 1
                    else:
                        result = {
                            Opcode.FEQ: x == y,
                            Opcode.FNE: x != y,
                            Opcode.FLT: x < y,
                            Opcode.FLE: x <= y,
                            Opcode.FGT: x > y,
                            Opcode.FGE: x >= y,
                        }[opcode]
                    reg_set(instr.a, 1 if result else 0)

                elif opcode is Opcode.JMP:
                    target = int(instr.a)  # type: ignore[arg-type]
                    if not (0 <= target < size):
                        raise JumpOutOfBoundsError(target, size, ip)
                    next_ip = target

                elif opcode is Opcode.JZ or opcode is Opcode.JNZ:
                    cond = reg_get(instr.a)
                    target = int(instr.b)  # type: ignore[arg-type]
                    if not (0 <= target < size):
                        raise JumpOutOfBoundsError(target, size, ip)
                    take = (cond == 0) if opcode is Opcode.JZ else (cond != 0)
                    if take:
                        next_ip = target

                elif opcode is Opcode.CALL:
                    target = int(instr.a)  # type: ignore[arg-type]
                    if not (0 <= target < size):
                        raise JumpOutOfBoundsError(target, size, ip)
                    if limits.max_depth is not None and len(frames) >= limits.max_depth:
                        raise DepthLimitExceededError(limits.max_depth, ip)
                    # 调用约定：新帧寄存器文件是调用者寄存器的*快照拷贝*。
                    # 实参由调用者放入低位寄存器传入；被调方对拷贝的任何
                    # 写操作都不影响调用者（无别名），RET 返回时调用者帧
                    # 除 r0（返回值通道）外逐位保持调用前状态。
                    new_regs = list(regs)
                    frames.append(
                        Frame(regs=new_regs, return_ip=ip + 1, entry=target)
                    )
                    regs = new_regs
                    next_ip = target

                elif opcode is Opcode.RET:
                    # 先判栈下溢，再读返回值寄存器（顶层帧 RET 是
                    # StackUnderflow，而不是寄存器错误）。
                    if len(frames) == 1:
                        raise StackUnderflowError(ip)
                    value = reg_get(instr.a)
                    # 返回地址存在被调帧里，必须从弹出的帧读取。
                    callee = frames.pop()
                    regs = frames[-1].regs
                    next_ip = callee.return_ip  # type: ignore[assignment]
                    # 返回值放在调用者 r0，形成显式的值通道
                    regs[0] = value

                elif opcode is Opcode.LOADARG:
                    slot = int(instr.b)  # type: ignore[arg-type]
                    if slot < 0:
                        raise RuntimeVMError(f"LOADARG 槽位为负: {slot}", ip)
                    value = args[slot] if slot < len(args) else 0
                    if isinstance(value, bool) or not isinstance(value, (int, float)):
                        raise RuntimeVMError(
                            f"非法入参类型: {type(value).__name__}", ip
                        )
                    reg_set(instr.a, value)

                else:  # pragma: no cover - 枚举已封闭
                    raise UnknownOpcodeError(opcode, ip)

                ip = next_ip

        except RuntimeVMError as exc:
            return RunResult(False, None, steps, exc)
        except (ZeroDivisionError, OverflowError, ValueError, TypeError) as exc:
            # 兜底：算术本身的意外（如手工构造的非法 Program）也不外抛。
            return RunResult(
                False,
                None,
                steps,
                RuntimeVMError(f"未分类运行期故障: {exc}", ip),
            )
