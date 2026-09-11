"""可嵌入的文本模式匹配与结构化抽取内核。

仅使用 Python 标准库。匹配引擎为 Thompson 构造的 NFA + Pike VM 模拟：
不使用 re 模块，不使用回溯递归，匹配耗时对文本长度线性，对状态数线性，
不存在灾难性回溯。

核心概念
--------
- 模式语法：字面量、单字符通配 ``?``、命名占位符 ``{name}``、
  贪婪占位符 ``{name:*}``、类型占位符 ``{name:int}`` / ``{name:word}``。
- :class:`PatternSet`：编译、注册、匹配、抽取、解释、统计、持久化。
- :class:`StreamExtractor`：增量流式抽取，结果与一次性 extract 完全一致。

详细的语义约定（歧义优先级、类型策略、流式提交规则、max_buffer 策略）
见 README.md，本模块的 docstring 只描述接口。
"""

from __future__ import annotations

import json
import string
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

__all__ = [
    "PatternKernelError",
    "PatternSyntaxError",
    "PatternConflictError",
    "UnknownPatternError",
    "SnapshotError",
    "BufferLimitExceeded",
    "StreamStateError",
    "Literal",
    "Wildcard",
    "Placeholder",
    "parse_pattern",
    "PatternSet",
    "StreamExtractor",
]

_SNAPSHOT_FORMAT = "pattern-kernel-snapshot"
_SNAPSHOT_VERSION = 1

_WORD_CHARS = frozenset(string.ascii_letters + string.digits + "_")
_NAME_START = frozenset(string.ascii_letters + "_")
_NAME_CHARS = _WORD_CHARS

# 类型标注 -> 内部 kind
_PLACEHOLDER_TYPES = {"*": "greedy", "int": "int", "word": "word"}


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------


class PatternKernelError(Exception):
    """内核所有错误的基类。"""


class PatternSyntaxError(PatternKernelError):
    """模式文本非法（空模式、占位符名为空/重复、类型标注非法、括号未闭合等）。"""


class PatternConflictError(PatternKernelError):
    """pattern_id 重复注册。"""

    def __init__(self, conflict_id: str) -> None:
        self.conflict_id = conflict_id
        super().__init__(f"pattern_id {conflict_id!r} is already compiled")


class UnknownPatternError(PatternKernelError):
    """引用了未编译的 pattern_id。"""


class SnapshotError(PatternKernelError):
    """快照文件损坏、字段缺失或校验失败。"""


class BufferLimitExceeded(PatternKernelError):
    """流式待定缓冲超过 max_buffer。"""


class StreamStateError(PatternKernelError):
    """流式抽取器状态非法（如在 finish 后继续 feed）。"""


# ---------------------------------------------------------------------------
# 模式片段（解析结果）
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Literal:
    """字面量片段（一个或多个字符）。"""

    text: str


@dataclass(frozen=True)
class Wildcard:
    """单字符通配 ``?``：匹配任意一个字符（含空白）。"""


@dataclass(frozen=True)
class Placeholder:
    """命名占位符。kind ∈ {"normal", "greedy", "int", "word"}。"""

    name: str
    kind: str = "normal"


Fragment = Any  # Literal | Wildcard | Placeholder（Union 写法留给阅读器）


def parse_pattern(pattern_text: str) -> List[Fragment]:
    """把模式文本解析为片段序列。

    :param pattern_text: 模式文本，必须非空。
    :returns: 片段列表，保持出现顺序。
    :raises PatternSyntaxError: 空模式、占位符名为空/非法/重复、类型标注未知、
        ``{`` 未闭合、裸 ``}``、末尾孤立反斜杠。
    """
    if not isinstance(pattern_text, str):
        raise PatternSyntaxError("pattern text must be a string")
    if pattern_text == "":
        raise PatternSyntaxError("pattern text must not be empty")

    fragments: List[Fragment] = []
    names: set = set()
    literal_buf: List[str] = []

    def flush_literal() -> None:
        if literal_buf:
            fragments.append(Literal("".join(literal_buf)))
            literal_buf.clear()

    i, n = 0, len(pattern_text)
    while i < n:
        c = pattern_text[i]
        if c == "\\":
            if i + 1 >= n:
                raise PatternSyntaxError("dangling backslash at end of pattern")
            literal_buf.append(pattern_text[i + 1])
            i += 2
        elif c == "?":
            flush_literal()
            fragments.append(Wildcard())
            i += 1
        elif c == "{":
            flush_literal()
            j = pattern_text.find("}", i + 1)
            if j == -1:
                raise PatternSyntaxError(
                    f"unterminated placeholder starting at index {i}"
                )
            inner = pattern_text[i + 1 : j]
            name, sep, annot = inner.partition(":")
            if not name:
                raise PatternSyntaxError(
                    f"placeholder name must not be empty (at index {i})"
                )
            if name[0] not in _NAME_START or any(ch not in _NAME_CHARS for ch in name):
                raise PatternSyntaxError(
                    f"invalid placeholder name {name!r}: must match [A-Za-z_][A-Za-z0-9_]*"
                )
            if name in names:
                raise PatternSyntaxError(f"duplicate placeholder name {name!r}")
            names.add(name)
            if sep:
                if annot not in _PLACEHOLDER_TYPES:
                    raise PatternSyntaxError(
                        f"unknown type annotation {annot!r} for placeholder {name!r}; "
                        f"expected one of {sorted(_PLACEHOLDER_TYPES)}"
                    )
                kind = _PLACEHOLDER_TYPES[annot]
            else:
                kind = "normal"
            fragments.append(Placeholder(name, kind))
            i = j + 1
        elif c == "}":
            raise PatternSyntaxError(
                f"unmatched '}}' at index {i}; escape it as '\\}}'"
            )
        else:
            literal_buf.append(c)
            i += 1
    flush_literal()
    if not fragments:
        raise PatternSyntaxError("pattern text must not be empty")
    return fragments


# ---------------------------------------------------------------------------
# NFA（Thompson 构造）
# ---------------------------------------------------------------------------


class _State:
    """NFA 状态。

    op:
      - ``char``   消费一个指定字符（ch）
      - ``any``    消费任意一个字符
      - ``class``  消费一个满足字符类的字符（cls ∈ notspace/digit/word）
      - ``split``  ε 分叉，out 优先级高于 out2
      - ``save``   ε，把当前位置写入捕获槽 slot
      - ``accept`` 接受态
    """

    __slots__ = ("op", "ch", "cls", "out", "out2", "slot")

    def __init__(self, op: str, ch: str = "", cls: str = "", slot: int = -1) -> None:
        self.op = op
        self.ch = ch
        self.cls = cls
        self.out: Optional["_State"] = None
        self.out2: Optional["_State"] = None
        self.slot = slot


def _class_match(cls: str, ch: str) -> bool:
    """判断字符是否满足字符类。"""
    if cls == "notspace":
        return not ch.isspace()
    if cls == "digit":
        return "0" <= ch <= "9"
    if cls == "word":
        return ch in _WORD_CHARS
    raise AssertionError(f"unknown char class {cls!r}")


def _build_nfa(fragments: List[Fragment], placeholders: List[Placeholder]) -> Tuple[_State, List[_State]]:
    """Thompson 构造：把片段序列编译为 NFA。

    :returns: (入口状态, 全部状态列表)。捕获槽：占位符 i 的起止位置分别
        写入槽 2i 与 2i+1。
    """
    states: List[_State] = []

    def st(op: str, **kw: Any) -> _State:
        s = _State(op, **kw)
        states.append(s)
        return s

    accept = st("accept")
    entry: Optional[_State] = None
    exits: List[Tuple[_State, str]] = []  # 待修补的 (状态, 属性名)

    def emit(frag_entry: _State, frag_exits: List[Tuple[_State, str]]) -> None:
        nonlocal entry, exits
        if entry is None:
            entry = frag_entry
        for s, attr in exits:
            setattr(s, attr, frag_entry)
        exits = list(frag_exits)

    ph_index = {id(ph): i for i, ph in enumerate(placeholders)}

    for frag in fragments:
        if isinstance(frag, Literal):
            for c in frag.text:
                s = st("char", ch=c)
                emit(s, [(s, "out")])
        elif isinstance(frag, Wildcard):
            s = st("any")
            emit(s, [(s, "out")])
        elif isinstance(frag, Placeholder):
            i = ph_index[id(frag)]
            save_s = st("save", slot=2 * i)
            save_e = st("save", slot=2 * i + 1)
            if frag.kind == "greedy":
                # 零次或多次任意字符；split 优先继续消费 => 贪婪
                loop = st("split")
                body = st("any")
                save_s.out = loop
                loop.out = body
                loop.out2 = save_e
                body.out = loop
            elif frag.kind == "int":
                # -?[0-9]+
                sign = st("split")
                minus = st("char", ch="-")
                d1 = st("class", cls="digit")
                loop = st("split")
                save_s.out = sign
                sign.out = minus
                sign.out2 = d1
                minus.out = d1
                d1.out = loop
                loop.out = d1
                loop.out2 = save_e
            else:
                # normal: \S+ ；word: [A-Za-z0-9_]+ ；均贪婪（优先继续）
                cls = "notspace" if frag.kind == "normal" else "word"
                body = st("class", cls=cls)
                loop = st("split")
                save_s.out = body
                body.out = loop
                loop.out = body
                loop.out2 = save_e
            emit(save_s, [(save_e, "out")])
        else:  # pragma: no cover - 防御
            raise AssertionError(f"unknown fragment {frag!r}")

    assert entry is not None
    for s, attr in exits:
        setattr(s, attr, accept)
    return entry, states


# ---------------------------------------------------------------------------
# Pike VM 模拟（优先级有序线程，无回溯）
# ---------------------------------------------------------------------------

_Caps = Tuple[Optional[int], ...]
_Thread = Tuple[_State, _Caps]


def _add_threads(out: List[_Thread], seen: set, state: _State, caps: _Caps, pos: int) -> None:
    """ε 闭包：把 state 及其 ε 可达状态按优先级顺序加入 out。

    用显式栈代替递归；同一状态在同一输入位置只保留最高优先级的线程。
    split 的 out 分支优先于 out2 分支（贪婪语义由此实现）。
    """
    stack: List[_Thread] = [(state, caps)]
    while stack:
        st, cp = stack.pop()
        if id(st) in seen:
            continue
        seen.add(id(st))
        if st.op == "save":
            nc = list(cp)
            nc[st.slot] = pos
            stack.append((st.out, tuple(nc)))  # type: ignore[arg-type]
        elif st.op == "split":
            stack.append((st.out2, cp))  # type: ignore[arg-type]
            stack.append((st.out, cp))  # type: ignore[arg-type]  # 后入先出 => 优先
        else:
            out.append((st, cp))


def _step(clist: List[_Thread], ch: str, npos: int) -> List[_Thread]:
    """消费一个字符，返回下一位置的线程列表（保持优先级顺序）。"""
    out: List[_Thread] = []
    seen: set = set()
    for st, cp in clist:
        if st.op == "char" and st.ch == ch:
            _add_threads(out, seen, st.out, cp, npos)  # type: ignore[arg-type]
        elif st.op == "any":
            _add_threads(out, seen, st.out, cp, npos)  # type: ignore[arg-type]
        elif st.op == "class" and _class_match(st.cls, ch):
            _add_threads(out, seen, st.out, cp, npos)  # type: ignore[arg-type]
    return out


_CLASS_DESCRIPTIONS = {
    "notspace": "a non-whitespace character",
    "digit": "a digit (0-9)",
    "word": "a word character (A-Za-z0-9_)",
}


def _describe(clist: List[_Thread]) -> List[str]:
    """描述当前线程集合下一步期望消费的字符（用于 explain）。"""
    seen: set = set()
    out: List[str] = []
    for st, _ in clist:
        if st.op == "char":
            d = repr(st.ch)
        elif st.op == "any":
            d = "any single character (?)"
        elif st.op == "class":
            d = _CLASS_DESCRIPTIONS[st.cls]
        elif st.op == "accept":
            d = "end of text"
        else:
            continue
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


@dataclass
class _SimResult:
    """一次锚定模拟的结果。"""

    best_pos: int  # 最长接受位置，-1 表示未接受
    best_caps: Optional[_Caps]
    died_at: Optional[int]  # 最后一条线程死亡的位置（无法消费该处字符）
    expected: List[str]  # 死亡位置处期望的字符描述
    alive_at_end: bool  # 到达 stop 时仍有存活线程
    final_clist: List[_Thread]


def _simulate(cp: "_CompiledPattern", text: str, start: int, stop: int) -> _SimResult:
    """从 start 锚定模拟到 stop（不含），返回最长接受及诊断信息。"""
    caps0: _Caps = (None,) * (2 * len(cp.placeholders))
    clist: List[_Thread] = []
    _add_threads(clist, set(), cp.entry, caps0, start)
    best_pos, best_caps = -1, None
    died_at: Optional[int] = None
    expected: List[str] = []
    pos = start
    while clist:
        for st, caps in clist:
            if st.op == "accept":
                if pos > best_pos:  # 同位置保留先见者（优先级更高）
                    best_pos, best_caps = pos, caps
                break
        if pos >= stop:
            break
        expected = _describe(clist)
        nxt = _step(clist, text[pos], pos + 1)
        if not nxt:
            died_at = pos
            break
        clist = nxt
        pos += 1
    return _SimResult(best_pos, best_caps, died_at, expected, bool(clist), clist)


# ---------------------------------------------------------------------------
# 已编译模式
# ---------------------------------------------------------------------------


def _body_pred(kind: str):
    """占位符主体可消费字符的谓词（用于歧义静态分析）。"""
    if kind == "greedy":
        return lambda ch: True
    if kind == "normal":
        return lambda ch: not ch.isspace()
    if kind == "word":
        return lambda ch: ch in _WORD_CHARS
    if kind == "int":
        return lambda ch: ch == "-" or ("0" <= ch <= "9")
    raise AssertionError(kind)


def _first_pred(frag: Fragment):
    """片段首字符谓词（用于歧义静态分析）。"""
    if isinstance(frag, Literal):
        c0 = frag.text[0]
        return lambda ch: ch == c0
    if isinstance(frag, Wildcard):
        return lambda ch: True
    if isinstance(frag, Placeholder):
        return _body_pred(frag.kind)
    raise AssertionError(frag)


# 歧义分析用的候选字符集：覆盖本内核全部字符类的组合特征
_AMBIGUITY_CANDIDATES = [" ", "\t", "\n", "a", "Z", "0", "5", "-", "_", "?", "{", "\\", "|", ":"]


class _CompiledPattern:
    """编译产物：片段、占位符、NFA 与静态报告。"""

    def __init__(self, pattern_id: str, pattern_text: str) -> None:
        self.pattern_id = pattern_id
        self.pattern_text = pattern_text
        self.fragments = parse_pattern(pattern_text)
        self.placeholders: List[Placeholder] = [
            f for f in self.fragments if isinstance(f, Placeholder)
        ]
        self.entry, self.states = _build_nfa(self.fragments, self.placeholders)
        self.ambiguity_reasons = self._analyze_ambiguity()

    @property
    def transition_count(self) -> int:
        """NFA 转移总数（含 ε 转移）。"""
        return sum(
            (1 if s.out is not None else 0) + (1 if s.out2 is not None else 0)
            for s in self.states
        )

    def _analyze_ambiguity(self) -> List[str]:
        """保守的静态歧义分析。

        若某占位符主体可消费的字符与其后继片段的首字符集合相交，则该占位符
        的切分点可能不唯一，报告为可能歧义。这是启发式：报"可能"不代表一定
        出现多种切分，但不报则一定没有。
        """
        reasons: List[str] = []
        candidates = list(_AMBIGUITY_CANDIDATES)
        for f in self.fragments:
            if isinstance(f, Literal):
                candidates.append(f.text[0])
        frags = self.fragments
        for i, frag in enumerate(frags[:-1]):
            if not isinstance(frag, Placeholder):
                continue
            nxt = frags[i + 1]
            body, first = _body_pred(frag.kind), _first_pred(nxt)
            if any(body(c) and first(c) for c in candidates):
                if isinstance(nxt, Placeholder):
                    desc = f"placeholder {nxt.name!r}"
                elif isinstance(nxt, Wildcard):
                    desc = "wildcard '?'"
                else:
                    desc = f"literal {nxt.text[0]!r}"  # type: ignore[union-attr]
                reasons.append(
                    f"placeholder {frag.name!r} (kind={frag.kind}) is followed by {desc} "
                    f"whose first character it could also consume"
                )
        return reasons

    def report(self) -> Dict[str, Any]:
        """编译报告：状态数、转移数、占位符列表、歧义分析。"""
        return {
            "pattern_id": self.pattern_id,
            "pattern_text": self.pattern_text,
            "states": len(self.states),
            "transitions": self.transition_count,
            "placeholders": [{"name": p.name, "type": p.kind} for p in self.placeholders],
            "possibly_ambiguous": bool(self.ambiguity_reasons),
            "ambiguity_reasons": list(self.ambiguity_reasons),
        }


def _fields_from_caps(cp: _CompiledPattern, text: str, caps: _Caps) -> Dict[str, str]:
    """按占位符出现顺序从捕获槽物化字段值。"""
    fields: Dict[str, str] = {}
    for i, ph in enumerate(cp.placeholders):
        s, e = caps[2 * i], caps[2 * i + 1]
        assert s is not None and e is not None
        fields[ph.name] = text[s:e]
    return fields


# ---------------------------------------------------------------------------
# PatternSet
# ---------------------------------------------------------------------------


class PatternSet:
    """模式集合：编译注册、匹配、抽取、解释、统计与持久化。

    语义速览（详见 README）：
      - ``extract``：整串匹配，文本必须被模式完整消费。
      - ``match`` / ``match_all``：最左最长搜索；``match`` 返回能命中的
        pattern_id 最小者，``match_all`` 按 pattern_id 升序返回全部命中。
      - 歧义优先级：总跨度最长优先；并列时占位符靠前者取最长。
    """

    def __init__(self) -> None:
        self._patterns: Dict[str, _CompiledPattern] = {}
        self._texts_processed = 0
        self._hits = 0
        self._misses = 0
        self._total_match_seconds = 0.0
        self._streams: List["StreamExtractor"] = []

    # -- 内部 ---------------------------------------------------------------

    def _get(self, pattern_id: str) -> _CompiledPattern:
        try:
            return self._patterns[pattern_id]
        except KeyError:
            raise UnknownPatternError(f"unknown pattern_id {pattern_id!r}") from None

    def _record(self, t0: float, hit: bool) -> None:
        self._total_match_seconds += time.perf_counter() - t0
        self._texts_processed += 1
        if hit:
            self._hits += 1
        else:
            self._misses += 1

    def _register_stream(self, stream: "StreamExtractor") -> None:
        self._streams.append(stream)

    def _deregister_stream(self, stream: "StreamExtractor") -> None:
        try:
            self._streams.remove(stream)
        except ValueError:
            pass

    @staticmethod
    def _search(cp: _CompiledPattern, text: str) -> Optional[Tuple[int, int, Dict[str, str]]]:
        """最左最长搜索：起点最小者优先，同起点取最长接受。"""
        for start in range(len(text) + 1):
            res = _simulate(cp, text, start, len(text))
            if res.best_pos >= 0 and res.best_caps is not None:
                return (start, res.best_pos, _fields_from_caps(cp, text, res.best_caps))
        return None

    # -- 编译 ---------------------------------------------------------------

    def compile(self, pattern_id: str, pattern_text: str) -> Dict[str, Any]:
        """编译并注册模式，返回编译报告。

        :raises PatternSyntaxError: pattern_id 为空或模式文本非法。
        :raises PatternConflictError: pattern_id 已存在（携带 conflict_id）。
        """
        if not isinstance(pattern_id, str) or not pattern_id:
            raise PatternSyntaxError("pattern_id must be a non-empty string")
        if pattern_id in self._patterns:
            raise PatternConflictError(pattern_id)
        cp = _CompiledPattern(pattern_id, pattern_text)
        self._patterns[pattern_id] = cp
        return cp.report()

    # -- 匹配 ---------------------------------------------------------------

    def match(self, text: str) -> Optional[Dict[str, Any]]:
        """返回第一个命中的模式（pattern_id 升序）及其字段；无命中返回 None。"""
        t0 = time.perf_counter()
        found: Optional[Dict[str, Any]] = None
        for pid in sorted(self._patterns):
            r = self._search(self._patterns[pid], text)
            if r is not None:
                found = {
                    "pattern_id": pid,
                    "start": r[0],
                    "end": r[1],
                    "fields": r[2],
                }
                break
        self._record(t0, found is not None)
        return found

    def match_all(self, text: str) -> List[Dict[str, Any]]:
        """返回所有命中的模式，按 pattern_id 升序。"""
        t0 = time.perf_counter()
        out: List[Dict[str, Any]] = []
        for pid in sorted(self._patterns):
            r = self._search(self._patterns[pid], text)
            if r is not None:
                out.append(
                    {"pattern_id": pid, "start": r[0], "end": r[1], "fields": r[2]}
                )
        self._record(t0, bool(out))
        return out

    def extract(self, text: str, pattern_id: str) -> Optional[Dict[str, str]]:
        """整串匹配抽取：文本必须被模式完整消费。

        :returns: 字段字典（按占位符出现顺序），未命中返回 None。
        """
        cp = self._get(pattern_id)
        t0 = time.perf_counter()
        res = _simulate(cp, text, 0, len(text))
        fields: Optional[Dict[str, str]] = None
        if res.best_pos == len(text) and res.best_caps is not None:
            fields = _fields_from_caps(cp, text, res.best_caps)
        self._record(t0, fields is not None)
        return fields

    def explain(self, text: str, pattern_id: str) -> Dict[str, Any]:
        """解释文本在指定模式上的匹配结果。

        命中时返回 ``{"matched": True, "fields": ...}``；未命中时返回失败
        位置、该位置期望的字符、实际字符与可读原因。
        """
        cp = self._get(pattern_id)
        res = _simulate(cp, text, 0, len(text))
        if res.best_pos == len(text) and res.best_caps is not None:
            return {
                "matched": True,
                "fields": _fields_from_caps(cp, text, res.best_caps),
            }
        if res.best_pos >= 0:
            return {
                "matched": False,
                "position": res.best_pos,
                "found": text[res.best_pos],
                "expected": ["end of text"],
                "reason": (
                    f"pattern matched a prefix ending at index {res.best_pos}, "
                    f"but {len(text) - res.best_pos} trailing character(s) "
                    f"could not be consumed"
                ),
            }
        if res.died_at is not None:
            return {
                "matched": False,
                "position": res.died_at,
                "found": text[res.died_at],
                "expected": res.expected,
                "reason": (
                    f"no viable parse beyond index {res.died_at}: expected "
                    f"{', '.join(res.expected)} but found {text[res.died_at]!r}"
                ),
            }
        return {
            "matched": False,
            "position": len(text),
            "found": None,
            "expected": _describe(res.final_clist),
            "reason": "text ended before the pattern could match in full",
        }

    # -- 统计 ---------------------------------------------------------------

    def stats(self) -> Dict[str, Any]:
        """运行统计：模式数、已处理文本数、命中/未命中、平均耗时、流式待定缓冲字节数。"""
        return {
            "patterns_compiled": len(self._patterns),
            "texts_processed": self._texts_processed,
            "hits": self._hits,
            "misses": self._misses,
            "avg_match_seconds": (
                self._total_match_seconds / self._texts_processed
                if self._texts_processed
                else 0.0
            ),
            "stream_pending_buffer_bytes": sum(len(s._buf) for s in self._streams),
        }

    # -- 持久化 -------------------------------------------------------------

    def save(self, path: str) -> None:
        """把已编译模式的源文本与统计计数写入 JSON 快照。"""
        data = {
            "format": _SNAPSHOT_FORMAT,
            "version": _SNAPSHOT_VERSION,
            "patterns": [
                {"pattern_id": pid, "pattern_text": cp.pattern_text}
                for pid, cp in sorted(self._patterns.items())
            ],
            "stats": {
                "texts_processed": self._texts_processed,
                "hits": self._hits,
                "misses": self._misses,
                "total_match_seconds": self._total_match_seconds,
            },
        }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

    def load(self, path: str) -> None:
        """从 JSON 快照重建状态。

        校验：文件可读且为合法 JSON、格式/版本正确、pattern_id 唯一、
        模式文本非空且能重新编译（含占位符名合法性）、统计计数非负。
        任一校验失败抛出 :class:`SnapshotError`，且当前状态保持不变。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError as exc:
            raise SnapshotError(f"snapshot file not found: {path}") from exc
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"snapshot file {path} is not valid JSON: {exc}") from exc
        except OSError as exc:
            raise SnapshotError(f"cannot read snapshot file {path}: {exc}") from exc

        if not isinstance(data, dict):
            raise SnapshotError("snapshot root must be a JSON object")
        if data.get("format") != _SNAPSHOT_FORMAT:
            raise SnapshotError(
                f"missing or unknown 'format' field (expected {_SNAPSHOT_FORMAT!r})"
            )
        if data.get("version") != _SNAPSHOT_VERSION:
            raise SnapshotError(
                f"unsupported snapshot version {data.get('version')!r} "
                f"(expected {_SNAPSHOT_VERSION})"
            )
        patterns = data.get("patterns")
        if not isinstance(patterns, list):
            raise SnapshotError("snapshot field 'patterns' must be a list")

        new_patterns: Dict[str, _CompiledPattern] = {}
        for idx, item in enumerate(patterns):
            if not isinstance(item, dict):
                raise SnapshotError(f"patterns[{idx}] must be an object")
            pid = item.get("pattern_id")
            ptext = item.get("pattern_text")
            if not isinstance(pid, str) or not pid:
                raise SnapshotError(
                    f"patterns[{idx}]: 'pattern_id' must be a non-empty string"
                )
            if not isinstance(ptext, str) or not ptext:
                raise SnapshotError(
                    f"patterns[{idx}] ({pid!r}): 'pattern_text' must be a non-empty string"
                )
            if pid in new_patterns:
                raise SnapshotError(f"duplicate pattern_id {pid!r} in snapshot")
            try:
                new_patterns[pid] = _CompiledPattern(pid, ptext)
            except PatternSyntaxError as exc:
                raise SnapshotError(f"pattern {pid!r} failed validation: {exc}") from exc

        stats = data.get("stats")
        if not isinstance(stats, dict):
            raise SnapshotError("snapshot field 'stats' must be an object")
        counters: Dict[str, int] = {}
        for key in ("texts_processed", "hits", "misses"):
            v = stats.get(key)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise SnapshotError(f"stats.{key} must be a non-negative integer")
            counters[key] = v
        tms = stats.get("total_match_seconds")
        if not isinstance(tms, (int, float)) or isinstance(tms, bool) or tms < 0:
            raise SnapshotError("stats.total_match_seconds must be a non-negative number")

        # 全部校验通过后才替换状态
        self._patterns = new_patterns
        self._texts_processed = counters["texts_processed"]
        self._hits = counters["hits"]
        self._misses = counters["misses"]
        self._total_match_seconds = float(tms)

    # -- 转储 ---------------------------------------------------------------

    def dump(self) -> Dict[str, Any]:
        """导出全部已编译模式的报告与统计（用于 CLI dump 命令）。"""
        return {
            "patterns": [
                self._patterns[pid].report() for pid in sorted(self._patterns)
            ],
            "stats": self.stats(),
        }


# ---------------------------------------------------------------------------
# 流式抽取
# ---------------------------------------------------------------------------


class StreamExtractor:
    """增量流式抽取器，绑定单个模式，语义与一次性 extract 完全一致。

    用法::

        se = StreamExtractor(pattern_set, "pid", max_buffer=4096)
        for chunk in chunks:
            se.feed(chunk)     # -> {"status": "pending", "committed": {...}, ...}
        se.finish()            # -> {"status": "ok", "fields": {...}, "all_fields": {...}}

    提交规则：某占位符在所有存活 NFA 线程中都已完成且取值一致时，其值
    不再受未来输入影响，可以安全提交（feed 返回的 ``committed``）。
    ``finish()`` 返回权威最终结果；``all_fields`` 与一次性 extract 在完整
    文本上的结果逐字段相等。若 ``finish()`` 报告 ``no_match``，则整次抽取
    无效，此前提交的字段应丢弃。
    """

    def __init__(
        self,
        pattern_set: PatternSet,
        pattern_id: str,
        max_buffer: Optional[int] = None,
    ) -> None:
        """创建流式抽取器。

        :param pattern_set: 所属的模式集合。
        :param pattern_id: 已编译的模式 id。
        :param max_buffer: 待定缓冲字符数上限；``None`` 表示无上限（精确模式）。
        :raises UnknownPatternError: pattern_id 未编译。
        :raises ValueError: max_buffer 为负数。
        """
        if max_buffer is not None and max_buffer < 0:
            raise ValueError("max_buffer must be non-negative or None")
        self._ps = pattern_set
        self._cp = pattern_set._get(pattern_id)
        self._max_buffer = max_buffer
        self._buf = ""  # 保留的待定文本（self._base 起的后缀）
        self._base = 0  # _buf[0] 在完整输入中的绝对下标
        self._pos = 0   # 已消费的绝对位置
        self._clist: List[_Thread] = []
        _add_threads(
            self._clist,
            set(),
            self._cp.entry,
            (None,) * (2 * len(self._cp.placeholders)),
            0,
        )
        self._committed: Dict[str, str] = {}
        self._done = False
        self._failed = False
        self._fail_reason = ""
        self._died_at: Optional[int] = None
        self._found: Optional[str] = None
        self._expected: List[str] = []
        self._last_accept_pos: Optional[int] = None
        self._note_accepts()
        pattern_set._register_stream(self)

    # -- 属性 ---------------------------------------------------------------

    @property
    def done(self) -> bool:
        """是否已 finish。"""
        return self._done

    @property
    def failed(self) -> bool:
        """是否已确定不可能匹配。"""
        return self._failed

    @property
    def buffered(self) -> int:
        """当前待定缓冲的字符数。"""
        return len(self._buf)

    # -- 内部 ---------------------------------------------------------------

    def _note_accepts(self) -> None:
        for st, _ in self._clist:
            if st.op == "accept":
                self._last_accept_pos = self._pos
                break

    def _commit_ready(self) -> Dict[str, str]:
        """提交所有存活线程一致通过的占位符，返回本次新提交的字段。"""
        newly: Dict[str, str] = {}
        phs = self._cp.placeholders
        for i, ph in enumerate(phs):
            if ph.name in self._committed:
                continue
            values = set()
            complete = True
            for _st, caps in self._clist:
                s, e = caps[2 * i], caps[2 * i + 1]
                if s is None or e is None:
                    complete = False
                    break
                values.add((s, e))
            if complete and len(values) == 1:
                (s, e), = values
                v = self._buf[s - self._base : e - self._base]
                self._committed[ph.name] = v
                newly[ph.name] = v
        return newly

    def _trim(self) -> None:
        """丢弃所有存活线程都不再引用的缓冲前缀。

        已提交占位符的捕获槽不再参与计算：其值已物化为字符串，
        线程携带的旧位置不会再被读取。
        """
        phs = self._cp.placeholders
        live_slots = [
            2 * i for i, ph in enumerate(phs) if ph.name not in self._committed
        ]
        positions = [
            caps[k]
            for _st, caps in self._clist
            for i in live_slots
            for k in (i, i + 1)
            if caps[k] is not None
        ]
        cut_to = min(positions) if positions else self._pos
        cut_to = min(cut_to, self._pos)
        if cut_to > self._base:
            self._buf = self._buf[cut_to - self._base :]
            self._base = cut_to

    # -- 接口 ---------------------------------------------------------------

    def feed(self, chunk: str) -> Dict[str, Any]:
        """喂入一段文本，返回当前能确定的结果。

        :returns: ``{"status": "pending", "committed": {...}, "buffered": n}``
            或 ``{"status": "failed", ...}``（此后任何输入都不可能匹配）。
        :raises StreamStateError: 流已结束或已失败。
        :raises BufferLimitExceeded: 待定缓冲超过 max_buffer。
        """
        if self._done:
            raise StreamStateError("stream is already finished")
        if self._failed:
            raise StreamStateError("stream has already failed: " + self._fail_reason)
        if not isinstance(chunk, str):
            raise TypeError("chunk must be a str")

        self._buf += chunk
        end = self._base + len(self._buf)
        while self._pos < end and self._clist:
            ch = self._buf[self._pos - self._base]
            self._expected = _describe(self._clist)
            self._clist = _step(self._clist, ch, self._pos + 1)
            if not self._clist:
                self._died_at = self._pos
                self._found = ch
            self._pos += 1

        if not self._clist:
            self._failed = True
            self._fail_reason = (
                f"no viable parse beyond index {self._died_at}: expected "
                f"{', '.join(self._expected)} but found {self._found!r}"
            )
            self._buf = ""
            self._ps._deregister_stream(self)
            return {
                "status": "failed",
                "reason": self._fail_reason,
                "committed": {},
                "buffered": 0,
            }

        self._note_accepts()
        newly = self._commit_ready()
        self._trim()

        if self._max_buffer is not None and len(self._buf) > self._max_buffer:
            self._failed = True
            self._fail_reason = (
                f"pending buffer exceeded max_buffer={self._max_buffer} "
                f"({len(self._buf)} characters retained); the pattern may cause "
                f"unbounded buffering (e.g. a greedy placeholder whose "
                f"terminating fragment never arrives)"
            )
            self._buf = ""
            self._ps._deregister_stream(self)
            raise BufferLimitExceeded(self._fail_reason)

        return {"status": "pending", "committed": newly, "buffered": len(self._buf)}

    def finish(self) -> Dict[str, Any]:
        """结束输入，返回权威最终结果。

        :returns: 成功 ``{"status": "ok", "fields": <未提交部分>,
            "all_fields": <完整字段>}``；失败 ``{"status": "no_match",
            "reason": ...}``。成功时 ``all_fields`` 与一次性 extract 一致。
        """
        if self._done:
            raise StreamStateError("stream is already finished")
        self._done = True
        self._ps._deregister_stream(self)
        if self._failed:
            return {"status": "no_match", "reason": self._fail_reason}

        caps: Optional[_Caps] = None
        for st, cp_ in self._clist:
            if st.op == "accept":
                caps = cp_
                break
        if caps is None:
            if self._last_accept_pos is not None:
                reason = (
                    f"pattern matched a prefix ending at index "
                    f"{self._last_accept_pos} but trailing text followed"
                )
            elif self._clist:
                reason = (
                    "input ended before the pattern could match in full; expected "
                    + ", ".join(_describe(self._clist))
                )
            else:
                reason = self._fail_reason or "no viable parse"
            return {"status": "no_match", "reason": reason}

        merged = dict(self._committed)
        for i, ph in enumerate(self._cp.placeholders):
            if ph.name not in merged:
                s, e = caps[2 * i], caps[2 * i + 1]
                assert s is not None and e is not None
                merged[ph.name] = self._buf[s - self._base : e - self._base]
        all_fields = {ph.name: merged[ph.name] for ph in self._cp.placeholders}
        remaining = {
            ph.name: all_fields[ph.name]
            for ph in self._cp.placeholders
            if ph.name not in self._committed
        }
        return {"status": "ok", "fields": remaining, "all_fields": all_fields}
