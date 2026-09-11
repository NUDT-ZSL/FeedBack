# -*- coding: utf-8 -*-
"""可嵌入的文本模式匹配与结构化抽取内核。

仅使用 Python 标准库；不使用 re 模块，不使用回溯递归。
模式经 Thompson 构造编译为 NFA 指令程序，匹配时用 Pike-VM 风格的
多线程模拟执行，时间复杂度 O(状态数 × 文本长度)，长文本安全。

模式语法：
    字面量          普通字符原样匹配；反斜杠可转义任意字符为字面量（\\? \\{ \\\\ 等）
    ?               单字符通配，匹配任意一个字符
    {name}          命名占位符：匹配非空且不含空白的连续片段
    {name:*}        贪婪占位符：尽量长地匹配任意字符（可含空白、可为空），
                    以“剩余模式仍能匹配”为约束
    {name:int}      整数占位符：可选符号位（+/-）后跟至少一位 ASCII 数字
    {name:word}     词占位符：[A-Za-z0-9_] 的非空序列

匹配语义：整串匹配（full match）——模式必须覆盖整段文本。
"""

from __future__ import annotations

import json

__all__ = [
    "PatternError",
    "PatternSyntaxError",
    "PatternConflictError",
    "UnknownPatternError",
    "SnapshotError",
    "PatternSet",
    "StreamExtractor",
    "DEFAULT_MAX_BUFFER",
]

_SNAPSHOT_FORMAT = "patternset-snapshot"
_SNAPSHOT_VERSION = 1

DEFAULT_MAX_BUFFER = 1024 * 1024  # StreamExtractor 默认行缓冲上限（字符数）

_PLACEHOLDER_TYPES = ("token", "greedy", "int", "word")


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------

class PatternError(Exception):
    """内核所有可预期错误的基类。"""


class PatternSyntaxError(PatternError):
    """模式文本语法错误。position 为模式串中的出错偏移（可为 None）。"""

    def __init__(self, message, position=None):
        self.position = position
        if position is not None:
            message = "%s (at pattern offset %d)" % (message, position)
        super().__init__(message)


class PatternConflictError(PatternError):
    """compile 时 pattern_id 重复。冲突的 id 保存在 .pattern_id 上。"""

    def __init__(self, pattern_id):
        self.pattern_id = pattern_id
        super().__init__("duplicate pattern_id: %r" % (pattern_id,))


class UnknownPatternError(PatternError):
    """引用了未编译的 pattern_id。"""

    def __init__(self, pattern_id):
        self.pattern_id = pattern_id
        super().__init__("unknown pattern_id: %r" % (pattern_id,))


class SnapshotError(PatternError):
    """快照文件损坏、格式不符或统计校验失败。"""


# ---------------------------------------------------------------------------
# 字符类别（谓词用函数实现，避免任何正则依赖）
# ---------------------------------------------------------------------------

_WHITESPACE = frozenset(" \t\r\n\v\f")


def _is_non_space(ch):
    return ch not in _WHITESPACE


def _is_digit(ch):
    return "0" <= ch <= "9"


def _is_sign(ch):
    return ch == "+" or ch == "-"


def _is_word_char(ch):
    return (
        "a" <= ch <= "z"
        or "A" <= ch <= "Z"
        or "0" <= ch <= "9"
        or ch == "_"
    )


_CLASS_PREDICATES = {
    "nonspace": _is_non_space,
    "digit": _is_digit,
    "sign": _is_sign,
    "word": _is_word_char,
}

_CLASS_DESCRIPTIONS = {
    "nonspace": "non-whitespace character",
    "digit": "digit (0-9)",
    "sign": "'+' or '-'",
    "word": "word character (A-Z, a-z, 0-9, _)",
}


# ---------------------------------------------------------------------------
# 模式解析：pattern_text -> token 序列
# token: ("lit", ch) | ("any",) | ("ph", name, kind)
# ---------------------------------------------------------------------------

def _valid_placeholder_name(name):
    if not name:
        return False
    first = name[0]
    if not (first.isalpha() or first == "_"):
        return False
    return all(c.isalnum() or c == "_" for c in name)


def _parse_placeholder_body(body, offset):
    if ":" in body:
        name, kind = body.split(":", 1)
    else:
        name, kind = body, "token"
    if kind == "*":
        kind = "greedy"
    if not _valid_placeholder_name(name):
        raise PatternSyntaxError(
            "invalid placeholder name %r (must be [A-Za-z_][A-Za-z0-9_]*)" % name,
            offset,
        )
    if kind not in _PLACEHOLDER_TYPES:
        raise PatternSyntaxError(
            "unknown placeholder type %r (valid: token, *, int, word)" % kind,
            offset,
        )
    return name, kind


def _parse(pattern_text):
    tokens = []
    i, n = 0, len(pattern_text)
    while i < n:
        ch = pattern_text[i]
        if ch == "\\":
            if i + 1 >= n:
                raise PatternSyntaxError("dangling escape at end of pattern", i)
            tokens.append(("lit", pattern_text[i + 1]))
            i += 2
        elif ch == "?":
            tokens.append(("any",))
            i += 1
        elif ch == "{":
            j = pattern_text.find("}", i + 1)
            if j == -1:
                raise PatternSyntaxError("unterminated placeholder '{'", i)
            name, kind = _parse_placeholder_body(pattern_text[i + 1 : j], i)
            tokens.append(("ph", name, kind))
            i = j + 1
        elif ch == "}":
            raise PatternSyntaxError("unmatched '}'", i)
        else:
            tokens.append(("lit", ch))
            i += 1
    return tokens


# ---------------------------------------------------------------------------
# Thompson 构造：token 序列 -> NFA 指令程序
# 指令为三元列表 [op, a, b]：
#   ("char", ch, _)    消费指定字符
#   ("any",  _,  _)    消费任意一个字符
#   ("class", name, _) 消费满足字符类别谓词的一个字符
#   ("save", slot, _)  记录当前输入位置到捕获槽（epsilon）
#   ("jmp",  dst, _)   无条件跳转（epsilon）
#   ("split", x, y)    分裂为两个线程，x 优先级高于 y（epsilon）
#   ("match", _,  _)   接受态
# ---------------------------------------------------------------------------

def _compile_tokens(tokens):
    prog = []
    placeholders = []

    def emit(op, a=None, b=None):
        prog.append([op, a, b])
        return len(prog) - 1

    for tok in tokens:
        if tok[0] == "lit":
            emit("char", tok[1])
        elif tok[0] == "any":
            emit("any")
        else:
            _, name, kind = tok
            slot = 2 * len(placeholders)
            placeholders.append({"name": name, "type": kind})
            if kind in ("token", "word"):
                cls = "nonspace" if kind == "token" else "word"
                emit("save", slot)
                loop = emit("class", cls)
                emit("split", loop, len(prog) + 1)  # 贪婪：优先回到 loop
                emit("save", slot + 1)
            elif kind == "greedy":
                emit("save", slot)
                sp = emit("split")            # 占位，稍后回填
                body = emit("any")
                emit("jmp", sp)
                end = emit("save", slot + 1)
                prog[sp][1] = body            # 优先进入循环体 -> 贪婪
                prog[sp][2] = end
            elif kind == "int":
                emit("save", slot)
                sp = emit("split")            # 可选符号位
                sign = emit("class", "sign")
                digit = emit("class", "digit")
                prog[sp][1] = sign
                prog[sp][2] = digit
                emit("split", digit, len(prog) + 1)  # 贪婪：尽量多吃数字
                emit("save", slot + 1)
    emit("match")
    return prog, placeholders


def _count_transitions(prog):
    total = 0
    for inst in prog:
        op = inst[0]
        if op == "split":
            total += 2
        elif op == "match":
            total += 0
        else:
            total += 1
    return total


def _describe_inst(inst):
    op = inst[0]
    if op == "char":
        return "literal %r" % inst[1]
    if op == "any":
        return "any character"
    if op == "class":
        return _CLASS_DESCRIPTIONS[inst[1]]
    return op


# ---------------------------------------------------------------------------
# Pike-VM 模拟：整串匹配，线程按优先级有序，无回溯无递归
# ---------------------------------------------------------------------------

def _epsilon_closure(prog, pc, saves, pos, out_list, seen):
    """以显式栈做 epsilon 闭包，保持优先级顺序（高优先级先入 out_list）。"""
    stack = [(pc, saves)]
    while stack:
        pc, saves = stack.pop()
        if pc in seen:
            continue
        seen.add(pc)
        inst = prog[pc]
        op = inst[0]
        if op == "jmp":
            stack.append((inst[1], saves))
        elif op == "split":
            stack.append((inst[2], saves))  # 低优先级后弹出
            stack.append((inst[1], saves))
        elif op == "save":
            new_saves = list(saves)
            new_saves[inst[1]] = pos
            stack.append((pc + 1, new_saves))
        else:
            out_list.append((pc, saves))


def _step_inst_matches(inst, ch):
    op = inst[0]
    if op == "char":
        return inst[1] == ch
    if op == "any":
        return True
    if op == "class":
        return _CLASS_PREDICATES[inst[1]](ch)
    return False


def _simulate(prog, nslots, text):
    """对 text 做整串匹配。

    返回 (saves, failure)。匹配成功时 saves 为捕获槽列表、failure 为 None；
    失败时 saves 为 None，failure 为 dict(position, expected, found, trailing)。
    """
    clist = []
    _epsilon_closure(prog, 0, [-1] * nslots, 0, clist, set())

    for i, ch in enumerate(text):
        nlist = []
        seen = set()
        for pc, saves in clist:
            inst = prog[pc]
            if _step_inst_matches(inst, ch):
                _epsilon_closure(prog, pc + 1, saves, i + 1, nlist, seen)
        if not nlist:
            expected = [
                _describe_inst(prog[pc])
                for pc, _ in clist
                if prog[pc][0] in ("char", "any", "class")
            ]
            has_match = any(prog[pc][0] == "match" for pc, _ in clist)
            if has_match and not expected:
                # 模式已走完但文本还有剩余
                return None, {
                    "position": i,
                    "expected": ["<end of text>"],
                    "found": ch,
                    "trailing": True,
                }
            return None, {
                "position": i,
                "expected": expected,
                "found": ch,
                "trailing": False,
            }
        clist = nlist

    for pc, saves in clist:
        if prog[pc][0] == "match":
            return saves, None
    expected = [
        _describe_inst(prog[pc])
        for pc, _ in clist
        if prog[pc][0] in ("char", "any", "class")
    ]
    return None, {
        "position": len(text),
        "expected": expected,
        "found": None,
        "trailing": False,
    }


def _typed_value(raw, kind):
    if kind == "int":
        return int(raw)
    return raw


# ---------------------------------------------------------------------------
# 已编译模式
# ---------------------------------------------------------------------------

class _CompiledPattern:
    __slots__ = (
        "pattern_id",
        "pattern_text",
        "prog",
        "placeholders",
        "state_count",
        "transition_count",
    )

    def __init__(self, pattern_id, pattern_text, prog, placeholders):
        self.pattern_id = pattern_id
        self.pattern_text = pattern_text
        self.prog = prog
        self.placeholders = placeholders
        self.state_count = len(prog)
        self.transition_count = _count_transitions(prog)

    def run(self, text):
        """整串匹配，成功返回 (fields, values)，失败返回 None。"""
        saves, _ = _simulate(self.prog, 2 * len(self.placeholders), text)
        if saves is None:
            return None
        fields = {}
        values = []
        for k, ph in enumerate(self.placeholders):
            raw = text[saves[2 * k] : saves[2 * k + 1]]
            val = _typed_value(raw, ph["type"])
            fields[ph["name"]] = val
            values.append(val)
        return fields, values

    def explain(self, text):
        _, failure = _simulate(self.prog, 2 * len(self.placeholders), text)
        if failure is None:
            return {
                "pattern_id": self.pattern_id,
                "matched": True,
                "position": None,
                "expected": [],
                "found": None,
                "reason": None,
            }
        pos = failure["position"]
        found = failure["found"]
        if failure["trailing"]:
            reason = (
                "position %d: pattern already matched; unexpected %r "
                "(expected end of text)" % (pos, found)
            )
        else:
            expected_text = ", ".join(failure["expected"]) or "<nothing>"
            if found is None:
                reason = "position %d: expected %s; found end of text" % (
                    pos,
                    expected_text,
                )
            else:
                reason = "position %d: expected %s; found %r" % (
                    pos,
                    expected_text,
                    found,
                )
        return {
            "pattern_id": self.pattern_id,
            "matched": False,
            "position": pos,
            "expected": failure["expected"],
            "found": found,
            "reason": reason,
        }


# ---------------------------------------------------------------------------
# PatternSet
# ---------------------------------------------------------------------------

class PatternSet:
    """一组已编译模式。匹配按 pattern_id 升序确定优先级。"""

    def __init__(self):
        self._patterns = {}

    def __len__(self):
        return len(self._patterns)

    def __contains__(self, pattern_id):
        return pattern_id in self._patterns

    @property
    def pattern_ids(self):
        """升序排列的全部 pattern_id。"""
        return sorted(self._patterns)

    # -- 编译 ------------------------------------------------------------

    def compile(self, pattern_id, pattern_text):
        """编译并注册一个模式，返回编译报告 dict。

        报告字段：pattern_id, state_count, transition_count, placeholders
        （placeholders 按出现顺序，元素为 {"name", "type"}）。
        pattern_id 重复时抛出 PatternConflictError（冲突 id 在 .pattern_id）。
        """
        if not isinstance(pattern_id, str) or not pattern_id:
            raise PatternError("pattern_id must be a non-empty string")
        if not isinstance(pattern_text, str):
            raise PatternError("pattern_text must be a string")
        if pattern_id in self._patterns:
            raise PatternConflictError(pattern_id)

        tokens = _parse(pattern_text)
        prog, placeholders = _compile_tokens(tokens)

        names = [ph["name"] for ph in placeholders]
        if len(set(names)) != len(names):
            for name in names:
                if names.count(name) > 1:
                    raise PatternSyntaxError(
                        "duplicate placeholder name %r" % name
                    )

        cp = _CompiledPattern(pattern_id, pattern_text, prog, placeholders)
        self._patterns[pattern_id] = cp
        return {
            "pattern_id": pattern_id,
            "state_count": cp.state_count,
            "transition_count": cp.transition_count,
            "placeholders": [dict(ph) for ph in cp.placeholders],
        }

    # -- 匹配 ------------------------------------------------------------

    def _get(self, pattern_id):
        try:
            return self._patterns[pattern_id]
        except KeyError:
            raise UnknownPatternError(pattern_id) from None

    def match(self, text):
        """返回第一个（pattern_id 升序）命中的 {"pattern_id", "fields"}，无命中返回 None。"""
        for pid in sorted(self._patterns):
            result = self._patterns[pid].run(text)
            if result is not None:
                return {"pattern_id": pid, "fields": result[0]}
        return None

    def match_all(self, text):
        """返回全部命中，按 pattern_id 升序。"""
        hits = []
        for pid in sorted(self._patterns):
            result = self._patterns[pid].run(text)
            if result is not None:
                hits.append({"pattern_id": pid, "fields": result[0]})
        return hits

    def extract(self, text, pattern_id):
        """按占位符出现顺序返回字段值列表；模式不匹配返回 None。"""
        result = self._get(pattern_id).run(text)
        if result is None:
            return None
        return result[1]

    def explain(self, text, pattern_id):
        """返回匹配诊断 dict：matched / position / expected / found / reason。"""
        return self._get(pattern_id).explain(text)

    # -- 统计与快照 --------------------------------------------------------

    def stats(self):
        patterns = {}
        total_states = 0
        total_transitions = 0
        for pid in sorted(self._patterns):
            cp = self._patterns[pid]
            patterns[pid] = {
                "state_count": cp.state_count,
                "transition_count": cp.transition_count,
                "placeholder_count": len(cp.placeholders),
            }
            total_states += cp.state_count
            total_transitions += cp.transition_count
        return {
            "pattern_count": len(self._patterns),
            "total_states": total_states,
            "total_transitions": total_transitions,
            "patterns": patterns,
        }

    def save(self, path):
        """把模式集合与统计快照写入 JSON 文件。"""
        snapshot = {
            "format": _SNAPSHOT_FORMAT,
            "version": _SNAPSHOT_VERSION,
            "patterns": [
                {"id": pid, "pattern": self._patterns[pid].pattern_text}
                for pid in sorted(self._patterns)
            ],
            "stats": self.stats(),
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(snapshot, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

    @classmethod
    def load(cls, path):
        """从快照文件恢复。文件损坏/格式不符/统计不一致时抛 SnapshotError。"""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except FileNotFoundError:
            raise
        except OSError as exc:
            raise SnapshotError("cannot read snapshot %r: %s" % (path, exc)) from exc

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SnapshotError(
                "invalid snapshot %r: not valid JSON (%s)" % (path, exc)
            ) from exc

        if not isinstance(data, dict):
            raise SnapshotError("invalid snapshot %r: top level must be an object" % path)
        if data.get("format") != _SNAPSHOT_FORMAT:
            raise SnapshotError(
                "invalid snapshot %r: bad or missing 'format' (expected %r)"
                % (path, _SNAPSHOT_FORMAT)
            )
        if data.get("version") != _SNAPSHOT_VERSION:
            raise SnapshotError(
                "unsupported snapshot version %r in %r (expected %r)"
                % (data.get("version"), path, _SNAPSHOT_VERSION)
            )
        patterns = data.get("patterns")
        stats = data.get("stats")
        if not isinstance(patterns, list) or not isinstance(stats, dict):
            raise SnapshotError(
                "invalid snapshot %r: missing 'patterns' list or 'stats' object" % path
            )

        ps = cls()
        for entry in patterns:
            if (
                not isinstance(entry, dict)
                or not isinstance(entry.get("id"), str)
                or not isinstance(entry.get("pattern"), str)
            ):
                raise SnapshotError(
                    "invalid snapshot %r: each pattern entry needs string "
                    "'id' and 'pattern'" % path
                )
            try:
                ps.compile(entry["id"], entry["pattern"])
            except PatternError as exc:
                raise SnapshotError(
                    "invalid snapshot %r: cannot recompile pattern %r: %s"
                    % (path, entry.get("id"), exc)
                ) from exc

        if ps.stats() != stats:
            raise SnapshotError(
                "invalid snapshot %r: recorded stats do not match recompiled "
                "patterns (file may be corrupted or tampered with)" % path
            )
        return ps


# ---------------------------------------------------------------------------
# StreamExtractor：分块喂入的流式抽取
# ---------------------------------------------------------------------------

class StreamExtractor:
    """按行流式抽取。

    feed(chunk) 返回本块到来后已能确定的抽取结果列表；finish() 冲刷缓冲，
    返回剩余结果。记录按 \n 切分；行尾单个 \r 会被去掉（兼容 CRLF）。
    文本末尾没有换行的最后一行在 finish() 时作为一条记录处理。

    每条结果：{"line_no", "pattern_id", "fields"}；未命中任何模式时
    pattern_id 为 None、fields 为 {}。

    max_buffer 策略：未终结（未遇到 \n）的缓冲超过 max_buffer 字符时，
    丢弃该缓冲并产出一条 {"error": "buffer_overflow", ...} 记录，
    后续数据继续正常处理。
    """

    def __init__(self, pattern_set, max_buffer=DEFAULT_MAX_BUFFER):
        if not isinstance(pattern_set, PatternSet):
            raise PatternError("pattern_set must be a PatternSet")
        if not isinstance(max_buffer, int) or max_buffer <= 0:
            raise PatternError("max_buffer must be a positive integer")
        self._ps = pattern_set
        self._max_buffer = max_buffer
        self._buf = ""
        self._line_no = 0
        self._finished = False

    def feed(self, chunk):
        """喂入一块文本，返回本块之后能确定的抽取结果列表。"""
        if self._finished:
            raise PatternError("cannot feed() after finish()")
        if not isinstance(chunk, str):
            raise TypeError("chunk must be str, got %s" % type(chunk).__name__)

        results = []
        self._buf += chunk
        while True:
            idx = self._buf.find("\n")
            if idx == -1:
                break
            line = self._buf[:idx]
            self._buf = self._buf[idx + 1 :]
            results.append(self._emit_line(line))
        if len(self._buf) > self._max_buffer:
            results.append(self._emit_overflow())
            self._buf = ""
        return results

    def finish(self):
        """冲刷缓冲，返回剩余结果。之后不能再 feed。"""
        results = []
        if self._buf:
            results.append(self._emit_line(self._buf))
            self._buf = ""
        self._finished = True
        return results

    # -- 内部 ------------------------------------------------------------

    def _emit_line(self, line):
        self._line_no += 1
        if line.endswith("\r"):
            line = line[:-1]
        hit = self._ps.match(line)
        record = {"line_no": self._line_no, "pattern_id": None, "fields": {}}
        if hit is not None:
            record["pattern_id"] = hit["pattern_id"]
            record["fields"] = hit["fields"]
        return record

    def _emit_overflow(self):
        self._line_no += 1
        return {
            "line_no": self._line_no,
            "pattern_id": None,
            "fields": {},
            "error": "buffer_overflow",
            "detail": "unterminated line exceeded max_buffer=%d; "
            "buffer discarded" % self._max_buffer,
        }
