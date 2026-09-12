"""rvvm 的离线验收测试（纯 unittest，无网络、无外部账号、无第三方依赖）。

运行：
    python -m unittest test_rvvm.py -v
"""

import math
import unittest

import rvvm
from rvvm import (
    AssembleError,
    BadLabelError,
    BadOperandError,
    DepthLimitExceededError,
    DivisionByZeroError,
    JumpOutOfBoundsError,
    Limits,
    Op,
    Opcode,
    OperandCountError,
    Program,
    RegisterLimitExceededError,
    RegisterOutOfBoundsError,
    StackUnderflowError,
    StepLimitExceededError,
    UnknownMnemonicError,
    UnknownOpcodeError,
    VM,
    assemble,
    disassemble,
)


def run_src(source, entry=0, args=None, **limits_kwargs):
    return VM().run(
        assemble(source),
        entry=entry,
        args=args,
        limits=Limits(**limits_kwargs),
    )


class ArithmeticTests(unittest.TestCase):
    def test_integer_arith(self):
        # ((((6 + 7) * 3) - 9) // 3) == 10
        src = """
        LOADI r0, 6
        LOADI r1, 7
        IADD r0, r0, r1
        LOADI r2, 3
        IMUL r0, r0, r2
        LOADI r3, 9
        ISUB r0, r0, r3
        IDIV r0, r0, r2
        HALT
        """
        r = run_src(src)
        self.assertTrue(r.halted)
        self.assertIsNone(r.error)
        self.assertEqual(r.return_value, 10)
        self.assertEqual(r.steps, 9)  # 8 条运算/加载 + HALT

    def test_float_arith(self):
        # (((1.5 + 2.5) * 8.0) / 4.0) == 8.0
        src = """
        LOADF r0, 1.5
        LOADF r1, 2.5
        FADD r0, r0, r1
        LOADF r2, 8.0
        FMUL r0, r0, r2
        LOADF r3, 4.0
        FDIV r0, r0, r3
        HALT
        """
        r = run_src(src)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 8.0)
        self.assertIsInstance(r.return_value, float)
        self.assertEqual(r.steps, 8)

    def test_truncated_division_and_modulo(self):
        # 整数除法向零截断（区别于 Python 的向下取整）。
        cases = [(-7, 2, -3, -1), (-7, -2, 3, -1), (7, -2, -3, 1)]
        for x, y, q, m in cases:
            src = f"""
            LOADI r0, {x}
            LOADI r1, {y}
            IDIV r2, r0, r1
            IMOD r3, r0, r1
            MOV r0, r2
            HALT
            """
            self.assertEqual(run_src(src).return_value, q)
            src_mod = src.replace("MOV r0, r2", "MOV r0, r3")
            self.assertEqual(run_src(src_mod).return_value, m)

    def test_float_division_by_zero_is_ieee754(self):
        # 浮点除零不是错误：1.0/0.0 -> +inf，0.0/0.0 -> NaN。
        r = run_src("LOADF r0, 1.0\nLOADF r1, 0.0\nFDIV r0, r0, r1\nHALT\n")
        self.assertTrue(r.halted)
        self.assertTrue(math.isinf(r.return_value))
        self.assertGreater(r.return_value, 0)
        self.assertEqual(r.steps, 4)

        r = run_src(
            "LOADF r0, -1.0\nLOADF r1, 0.0\nFDIV r0, r0, r1\nHALT\n"
        )
        self.assertTrue(math.isinf(r.return_value))
        self.assertLess(r.return_value, 0)

        src = (
            "LOADF r0, 0.0\nLOADF r1, 0.0\nFDIV r0, r0, r1\n"
            "FEQ r0, r0, r0\nHALT\n"
        )
        r = run_src(src)
        self.assertEqual(r.return_value, 0)  # NaN 不等于自身

    def test_hex_immediate(self):
        r = run_src("LOADI r0, 0x10\nHALT\n")
        self.assertEqual(r.return_value, 16)


class CompareAndBranchTests(unittest.TestCase):
    SRC = """
    main:
        LOADI r1, {a}
        LOADI r2, 5
        ILT r3, r1, r2
        JZ r3, else
        LOADI r0, 100
        JMP end
    else:
        LOADI r0, 200
    end:
        HALT
    """

    def test_branch_taken(self):
        r = run_src(self.SRC.format(a=3))
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 100)
        self.assertEqual(r.steps, 7)

    def test_branch_not_taken(self):
        r = run_src(self.SRC.format(a=7))
        self.assertEqual(r.return_value, 200)
        self.assertEqual(r.steps, 6)

    def test_counted_loop(self):
        # 从 1 开始累加偶数 2+4+6+8+10 = 55
        src = """
        LOADI r1, 0
        LOADI r2, 1
        LOADI r3, 10
        LOADI r4, 1
        loop:
        IADD r1, r1, r2
        IADD r2, r2, r4
        ILE r5, r2, r3
        JNZ r5, loop
        MOV r0, r1
        HALT
        """
        r = run_src(src)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 55)
        self.assertEqual(r.steps, 46)

    def test_float_strict_vs_tolerant_compare(self):
        # 0.1 + 0.2 在 IEEE-754 下不严格等于 0.3。
        strict = (
            "LOADF r0, 0.1\nLOADF r1, 0.2\nFADD r0, r0, r1\n"
            "LOADF r2, 0.3\nFEQ r0, r0, r2\nHALT\n"
        )
        self.assertEqual(run_src(strict).return_value, 0)

        tolerant = strict.replace("FEQ", "CMPFE")
        self.assertEqual(run_src(tolerant).return_value, 1)


FACTORIAL = """
main:
    LOADI r2, 1
    LOADI r1, {n}
    CALL fact
    HALT
fact:
    ILT r3, r1, r2
    JNZ r3, base
    IEQ r3, r1, r2
    JNZ r3, base
    MOV r4, r1
    ISUB r1, r1, r2
    CALL fact
    IMUL r0, r4, r0
    RET r0
base:
    LOADI r0, 1
    RET r0
"""

FIBONACCI = """
main:
    LOADI r2, 1
    LOADI r6, 2
    LOADI r1, {n}
    CALL fib
    HALT
fib:
    ILE r3, r1, r2
    JZ r3, notbase
    MOV r0, r1
    RET r0
notbase:
    MOV r4, r1
    ISUB r1, r4, r2
    CALL fib
    MOV r5, r0
    ISUB r1, r4, r6
    CALL fib
    IADD r0, r5, r0
    RET r0
"""


class CallTests(unittest.TestCase):
    def test_factorial_recursion(self):
        r = run_src(FACTORIAL.format(n=6), max_steps=100_000)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 720)
        self.assertEqual(r.steps, 55)

    def test_factorial_base_case(self):
        r = run_src(FACTORIAL.format(n=0), max_steps=100_000)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 1)
        self.assertEqual(r.steps, 8)

    def test_fibonacci_tree_recursion(self):
        r = run_src(FIBONACCI.format(n=10), max_steps=1_000_000)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 55)
        self.assertEqual(r.steps, 1241)

    def test_callee_cannot_mutate_caller_registers(self):
        # 被调方把 r1/r2 改成 999/888；返回后调用者视图必须仍是 7/8。
        src = """
        main:
            LOADI r1, 7
            LOADI r2, 8
            CALL callee
            IADD r3, r1, r2
            MOV r0, r3
            HALT
        callee:
            LOADI r1, 999
            LOADI r2, 888
            LOADI r0, 42
            RET r0
        """
        r = run_src(src)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 15)  # 7 + 8，不是 999 + 888
        self.assertEqual(r.steps, 10)

    def test_nested_calls_restore_return_addresses(self):
        # a -> b -> c，逐层返回，验证每层返回地址不串。
        src = """
        main:
            CALL a
            HALT
        a:
            LOADI r1, 1
            CALL b
            IADD r0, r1, r0
            RET r0
        b:
            LOADI r2, 2
            CALL c
            IADD r0, r2, r0
            RET r0
        c:
            LOADI r0, 4
            RET r0
        """
        r = run_src(src)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 7)  # 4 + 2 + 1

    def test_loadarg_entry_arguments(self):
        src = """
        LOADARG r0, 0
        LOADARG r1, 1
        IADD r0, r0, r1
        LOADARG r2, 5
        HALT
        """
        r = run_src(src, args=(20, 22))
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 42)
        self.assertEqual(r.steps, 5)


class AssemblerTests(unittest.TestCase):
    def test_unknown_mnemonic_reports_line(self):
        with self.assertRaises(UnknownMnemonicError) as ctx:
            assemble("# comment\n\nFOO r0\nHALT\n")
        self.assertEqual(ctx.exception.lineno, 3)
        self.assertEqual(ctx.exception.mnemonic, "FOO")
        self.assertIsInstance(ctx.exception, AssembleError)

    def test_operand_count_reports_line(self):
        with self.assertRaises(OperandCountError) as ctx:
            assemble("LOADI r0\nHALT\n")
        self.assertEqual(ctx.exception.lineno, 1)
        self.assertEqual((ctx.exception.expected, ctx.exception.got), (2, 1))

    def test_bad_label_reports_line(self):
        with self.assertRaises(BadLabelError) as ctx:
            assemble("JMP nowhere\nHALT\n")
        self.assertEqual(ctx.exception.lineno, 1)
        self.assertEqual(ctx.exception.label, "nowhere")

    def test_bad_operand(self):
        with self.assertRaises(BadOperandError) as ctx:
            assemble("LOADI r0, abc\n")
        self.assertEqual(ctx.exception.lineno, 1)

    def test_comments_blank_lines_and_case_insensitive(self):
        r = run_src(
            "; semicolon comment\n\n"
            "loadi r0, 2   # inline comment\n"
            "LoadI r1, 3\n"
            "iadd R0, r0, r1\n"
            "halt\n"
        )
        self.assertEqual(r.return_value, 5)

    def test_disassemble_roundtrip(self):
        src = """
        main:
            LOADI r1, 3
            JMP skip
            LOADI r0, 99
        skip:
            LOADI r2, 1
            IADD r0, r1, r2
            CALL main
            HALT
        """
        p1 = assemble(src)
        text = disassemble(p1)
        p2 = assemble(text)
        self.assertEqual(p1.instructions, p2.instructions)
        # 反汇编文本自身确定。
        self.assertEqual(text, disassemble(p2))
        # 标签按目标指令下标规范化为 L<n>:。
        self.assertIn("L0:", text)       # main（CALL 的目标）
        self.assertIn("CALL L0", text)
        self.assertIn("JMP L3", text)


class RuntimeErrorTests(unittest.TestCase):
    def test_division_by_zero(self):
        r = run_src("LOADI r1, 0\nIDIV r0, r0, r1\nHALT\n")
        self.assertFalse(r.halted)
        self.assertIsInstance(r.error, DivisionByZeroError)
        self.assertEqual(r.error.instr_index, 1)
        self.assertEqual(r.steps, 2)  # LOADI 执行成功，IDIV 计入步数后失败

    def test_integer_modulo_by_zero(self):
        r = run_src("LOADI r1, 0\nIMOD r0, r0, r1\nHALT\n")
        self.assertIsInstance(r.error, DivisionByZeroError)
        self.assertEqual(r.error.instr_index, 1)

    def test_jump_out_of_bounds(self):
        r = run_src("JMP 9\nHALT\n")
        self.assertIsInstance(r.error, JumpOutOfBoundsError)
        self.assertEqual(r.error.instr_index, 0)
        self.assertEqual(r.error.target, 9)

    def test_call_out_of_bounds(self):
        r = run_src("CALL 5\nHALT\n")
        self.assertIsInstance(r.error, JumpOutOfBoundsError)
        self.assertEqual(r.error.target, 5)

    def test_falling_off_program_end(self):
        r = run_src("LOADI r0, 1\n")
        self.assertIsInstance(r.error, JumpOutOfBoundsError)
        self.assertEqual(r.error.target, 1)
        self.assertEqual(r.steps, 1)

    def test_register_out_of_bounds_hand_built(self):
        # 汇编器保证宽度足够；窄程序只能手工构造。
        prog = Program((Op(Opcode.MOV, 0, 5),), reg_width=2)
        r = VM().run(prog)
        self.assertIsInstance(r.error, RegisterOutOfBoundsError)
        self.assertEqual(r.error.reg, 5)
        self.assertEqual(r.error.width, 2)
        self.assertEqual(r.error.instr_index, 0)

    def test_register_limit_exceeded(self):
        # 使用 r9 -> 窗口宽度 10，配额只给 8，入口前直接拒绝。
        r = run_src("LOADI r9, 1\nHALT\n", max_registers=8)
        self.assertIsInstance(r.error, RegisterLimitExceededError)
        self.assertEqual(r.error.requested, 10)
        self.assertEqual(r.error.limit, 8)
        self.assertEqual(r.steps, 0)

    def test_stack_underflow(self):
        r = run_src("RET r0\n")
        self.assertIsInstance(r.error, StackUnderflowError)
        self.assertEqual(r.error.instr_index, 0)

    def test_unknown_opcode(self):
        prog = Program((Op(99),))
        r = VM().run(prog)
        self.assertIsInstance(r.error, UnknownOpcodeError)
        self.assertEqual(r.error.code, 99)
        self.assertEqual(r.error.instr_index, 0)
        self.assertEqual(r.steps, 1)
        # 反汇编不崩溃，输出尽力可读。
        self.assertIn("RAW 99", disassemble(prog))

    def test_entry_out_of_bounds(self):
        r = run_src("HALT\n", entry=7)
        self.assertIsInstance(r.error, JumpOutOfBoundsError)


class LimitsTests(unittest.TestCase):
    def test_step_limit_infinite_loop(self):
        r = run_src(
            "loop:\nJMP loop\n",
            max_steps=1000,
            max_depth=4,
            max_registers=8,
        )
        self.assertIsInstance(r.error, StepLimitExceededError)
        self.assertEqual(r.error.limit, 1000)
        self.assertEqual(r.steps, 1000)
        self.assertEqual(r.error.instr_index, 0)

    def test_step_limit_mid_program(self):
        r = run_src("LOADI r0, 1\nLOADI r1, 2\nHALT\n", max_steps=2)
        self.assertIsInstance(r.error, StepLimitExceededError)
        self.assertEqual(r.steps, 2)
        self.assertFalse(r.halted)

    def test_step_limit_boundary_allowed(self):
        # 程序恰好 3 步，给 3 步必须成功跑完，不能误杀。
        r = run_src("LOADI r0, 1\nLOADI r1, 2\nHALT\n", max_steps=3)
        self.assertTrue(r.halted)
        self.assertEqual(r.steps, 3)
        self.assertIsNone(r.error)

    def test_depth_limit(self):
        r = run_src(
            "f:\nCALL f\n",
            max_steps=100_000,
            max_depth=3,
            max_registers=8,
        )
        self.assertIsInstance(r.error, DepthLimitExceededError)
        self.assertEqual(r.error.limit, 3)
        # 入口帧 + 2 次成功 CALL；第 3 次 CALL 被拒。
        self.assertEqual(r.steps, 3)
        self.assertEqual(r.error.instr_index, 0)

    def test_depth_limit_boundary_allowed(self):
        # main -> fact(1) 深度 2；给 2 必须成功。
        r = run_src(FACTORIAL.format(n=1), max_depth=2, max_steps=10_000)
        self.assertTrue(r.halted)
        self.assertEqual(r.return_value, 1)

    def test_empty_program_halts(self):
        r = VM().run(assemble("# nothing but a comment\n"))
        self.assertTrue(r.halted)
        self.assertEqual(r.steps, 0)
        self.assertIsNone(r.error)

    def test_runtime_never_raises(self):
        # 一批必坏的输入，run 必须全部返回 RunResult 而不是抛出。
        bad_sources = [
            "JMP 9\n",
            "LOADI r1, 0\nIDIV r0, r0, r1\n",
            "RET r0\n",
            "f:\nCALL f\n",
            "loop:\nJMP loop\n",
        ]
        for src in bad_sources:
            r = run_src(src, max_steps=50, max_depth=3, max_registers=8)
            self.assertFalse(r.halted)
            self.assertIsNotNone(r.error)
            self.assertIsInstance(r.error, rvvm.RuntimeVMError)


class DeterminismTests(unittest.TestCase):
    def test_repeated_runs_identical(self):
        p = assemble(FACTORIAL.format(n=6))
        vm = VM()
        results = [
            vm.run(p, limits=Limits(max_steps=100_000)) for _ in range(20)
        ]
        first = results[0]
        for r in results[1:]:
            self.assertEqual(r.return_value, first.return_value)
            self.assertEqual(r.steps, first.steps)
            self.assertEqual(r.error, first.error)
            self.assertEqual(r.halted, first.halted)

    def test_repeated_errors_identical(self):
        p = assemble("f:\nCALL f\n")
        kinds = set()
        details = set()
        for _ in range(20):
            r = VM().run(p, limits=Limits(max_steps=100_000, max_depth=5))
            kinds.add(type(r.error))
            details.add((r.steps, r.error.instr_index, r.error.limit))
        self.assertEqual(kinds, {DepthLimitExceededError})
        self.assertEqual(len(details), 1)

    def test_vm_instance_is_stateless(self):
        # 同一 VM 连续跑互不干扰。
        vm = VM()
        a = vm.run(assemble("LOADI r0, 11\nHALT\n"))
        b = vm.run(assemble("LOADI r0, 22\nHALT\n"))
        self.assertEqual(a.return_value, 11)
        self.assertEqual(b.return_value, 22)


if __name__ == "__main__":
    unittest.main(verbosity=2)
