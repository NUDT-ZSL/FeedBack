"""离线依赖求解内核。

纯 Python 标准库实现，不联网、不读真实 registry。输入输出均为普通数据结构，
可直接在单测中构造与断言。

公开接口
--------
- ``Solver()``：无参构造；核心方法 ``solve(root, packages)``。
- ``SolveResult``：结果对象，字段为
  ``resolved``（{包名: 版本字符串}）、``conflicts``（冲突列表）、``ok``。
- ``Conflict`` / ``ConstraintOrigin``：冲突解释，含包名、每条约束的父包与原文。
- ``ConstraintSyntaxError``：约束串语法非法时抛出，``fragment`` 携带出错片段。
- ``RecursionLimitError``：依赖链递归深度超过上限（64）时抛出。
- ``compare_versions(a, b)``：按本模块规则比较两个版本字符串，返回 -1/0/1。

版本号比较规则（自测覆盖）
--------------------------
1. 版本号由点分数字段加可选预发布后缀组成，例如 ``1.2.3``、``1.2.3.4``、
   ``1.0.0-rc1``。
2. 点分字段全部按非负整数比较；不同长度时缺失段按 0 补齐，因此
   ``1.2 == 1.2.0``，``1.2.3.4 > 1.2.3``（末段 4 > 0）。
3. 预发布后缀形如 ``-alpha`` / ``-beta`` / ``-rc``，可再跟一个非负整数序号
   （``-alpha2``、``-rc1``）。同一基础版本下后缀按
   alpha < beta < rc < 正式版 排序，即所有预发布都排在正式版之前：
   ``1.0.0-alpha < 1.0.0-alpha2 < 1.0.0-beta1 < 1.0.0-rc1 < 1.0.0``。
4. 先比点分数字段（补 0 对齐），完全相同时再比预发布后缀与序号。

约束语法
--------
- 操作符：``>=``、``<=``、``>``、``<``、``==``、``!=``。
- 多个约束用英文逗号分隔，表示合取（AND），如 ``">=1.2,<2,!=1.5.0"``。
- 空串/纯空白表示"不约束"；但逗号分隔出空片段（如 ``">=1.0,"``）属于语法
  错误。任何非法片段都抛 :class:`ConstraintSyntaxError` 且 ``fragment`` 为
  出错的那一段原文，绝不静默忽略。

求解语义
--------
- 同一个包被不同父包以不同约束要求时，全部约束取交集；选出版本必须同时满足。
- 候选版本按版本号从高到低尝试（预发布序见上），选第一个可行解；遍历顺序
  固定，结果确定可复现。
- 支持循环依赖：已在当前分支中选定的包不会被重复展开，环上的版本只需满足
  环上出现的全部约束。
- 依赖链递归深度上限为 64（root 为第 0 层，其直接依赖为第 1 层）；超过抛
  :class:`RecursionLimitError`。环不会累计深度。
- 无解时 ``resolved`` 为空、``ok`` 为 False，``conflicts`` 逐条给出包名、
  冲突原因、以及每条参与冲突的约束（父包 + 原文 spec）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

__all__ = [
    "Solver",
    "SolveResult",
    "Conflict",
    "ConstraintOrigin",
    "ConstraintSyntaxError",
    "RecursionLimitError",
    "compare_versions",
    "parse_version",
    "parse_constraint",
]

#: 依赖链允许的最大递归深度（root 处于第 0 层，其直接依赖处于第 1 层）。
MAX_DEPTH = 64

# 预发布后缀排序权重；正式版（无后缀）权重最高。
_PRE_ORDER = {"alpha": 0, "beta": 1, "rc": 2}
_RELEASE_RANK = 3


class ConstraintSyntaxError(ValueError):
    """约束字符串语法错误。

    ``fragment`` 为解析失败的原始片段（逗号分隔后的那一段，或整个入参）。
    """

    def __init__(self, message: str, fragment: str):
        self.fragment = fragment
        super().__init__("%s（出错片段: %r）" % (message, fragment))


class RecursionLimitError(RuntimeError):
    """依赖链递归深度超过 :data:`MAX_DEPTH`。"""


@dataclass(frozen=True)
class _Version:
    """解析后的版本号；比较一律通过 :func:`_version_key` 进行。"""

    raw: str
    release: Tuple[int, ...]
    pre_kind: Optional[str]  # alpha / beta / rc；正式版为 None
    pre_num: int  # 预发布序号，如 rc2 的 2；无序号为 0

    @staticmethod
    def _rank_tie(v: "_Version") -> Tuple[int, int]:
        rank = _RELEASE_RANK if v.pre_kind is None else _PRE_ORDER[v.pre_kind]
        tie = 0 if v.pre_kind is None else v.pre_num
        return rank, tie

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, _Version):
            return NotImplemented
        length = max(len(self.release), len(other.release))
        pad = lambda r: r + (0,) * (length - len(r))
        s_rank, s_tie = self._rank_tie(self)
        o_rank, o_tie = self._rank_tie(other)
        return (pad(self.release), s_rank, s_tie) == (pad(other.release), o_rank, o_tie)

    def __hash__(self) -> int:
        # 去掉末尾补 0 段，保证 1.2 与 1.2.0.0 哈希一致，配合上面的语义等值。
        rank, tie = self._rank_tie(self)
        return hash((_canonical_release(self), rank, tie))


def _canonical_release(v: _Version) -> Tuple[int, ...]:
    """去掉末尾补 0 段，使 1.2 与 1.2.0.0 的排序键相同。"""
    release = list(v.release)
    while len(release) > 1 and release[-1] == 0:
        release.pop()
    return tuple(release)


def _version_key(v: _Version) -> Tuple[Tuple[int, ...], int, int]:
    rank = _RELEASE_RANK if v.pre_kind is None else _PRE_ORDER[v.pre_kind]
    tie = 0 if v.pre_kind is None else v.pre_num
    return (_canonical_release(v), rank, tie)


def parse_version(text: str) -> _Version:
    """把版本字符串解析为内部结构。

    合法形式：点分非负整数（至少一段），可选 ``-alpha``/``-beta``/``-rc``
    后缀，后缀后可再跟非负整数序号。
    """
    if not isinstance(text, str):
        raise ConstraintSyntaxError("版本号必须是字符串", str(text))
    raw = text.strip()
    if not raw:
        raise ConstraintSyntaxError("版本号不能为空", text)

    pre_kind: Optional[str] = None
    pre_num = 0
    body = raw
    if "-" in raw:
        body, suffix = raw.split("-", 1)
        if not body or not suffix:
            raise ConstraintSyntaxError("预发布后缀格式错误", text)
        lowered = suffix.lower()
        for kind in ("alpha", "beta", "rc"):
            if lowered == kind:
                pre_kind, pre_num = kind, 0
                break
            if lowered.startswith(kind):
                rest = lowered[len(kind):]
                if rest.isdigit():
                    pre_kind, pre_num = kind, int(rest)
                    break
        else:
            raise ConstraintSyntaxError("无法识别的预发布后缀", text)
        if pre_kind is None:
            raise ConstraintSyntaxError("无法识别的预发布后缀", text)

    parts = body.split(".")
    if not parts or any(part == "" for part in parts):
        raise ConstraintSyntaxError("版本号必须是非空点分数字段", text)
    try:
        release = tuple(int(part) for part in parts)
    except ValueError:
        raise ConstraintSyntaxError("版本号字段必须全部是数字", text)
    return _Version(raw=text, release=release, pre_kind=pre_kind, pre_num=pre_num)


def compare_versions(a: str, b: str) -> int:
    """按模块规则比较两个版本字符串：a<b 返回 -1，相等 0，a>b 返回 1。"""
    va, vb = parse_version(a), parse_version(b)
    length = max(len(va.release), len(vb.release))
    ka = (va.release + (0,) * (length - len(va.release)),) + _version_key(va)[1:]
    kb = (vb.release + (0,) * (length - len(vb.release)),) + _version_key(vb)[1:]
    if ka < kb:
        return -1
    if ka > kb:
        return 1
    return 0


# (操作符, 解析后版本)。
Constraint = Tuple[str, _Version]

# 两字符操作符在前，避免 ">=1.0" 被切成 ">" + "=1.0"。
_OPERATORS = (">=", "<=", "==", "!=", ">", "<")


def parse_constraint(spec: str) -> List[Constraint]:
    """解析逗号分隔的约束串。

    空白串返回空列表（视为不约束）；任何非法片段抛
    :class:`ConstraintSyntaxError`，``fragment`` 为该片段原文。
    """
    if not isinstance(spec, str):
        raise ConstraintSyntaxError("约束必须是字符串", str(spec))
    if spec.strip() == "":
        return []
    parsed: List[Constraint] = []
    for fragment in spec.split(","):
        piece = fragment.strip()
        if piece == "":
            raise ConstraintSyntaxError("约束中存在空片段", fragment)
        op = next((c for c in _OPERATORS if piece.startswith(c)), None)
        if op is None:
            raise ConstraintSyntaxError("约束必须以比较操作符开头", fragment)
        version_text = piece[len(op):].strip()
        if not version_text:
            raise ConstraintSyntaxError("操作符后缺少版本号", fragment)
        try:
            version = parse_version(version_text)
        except ConstraintSyntaxError:
            raise ConstraintSyntaxError("约束中的版本号非法", fragment)
        parsed.append((op, version))
    return parsed


def _satisfies(version: _Version, constraints: List[Constraint]) -> bool:
    """版本是否同时满足全部约束（合取）。"""
    for op, target in constraints:
        cmp = compare_versions(version.raw, target.raw)
        if op == ">=" and cmp < 0:
            return False
        if op == "<=" and cmp > 0:
            return False
        if op == ">" and cmp <= 0:
            return False
        if op == "<" and cmp >= 0:
            return False
        if op == "==" and cmp != 0:
            return False
        if op == "!=" and cmp == 0:
            return False
    return True


@dataclass(frozen=True)
class ConstraintOrigin:
    """一条约束的出处与原文。"""

    parent: str  # 提出该约束的父包名（root 的依赖记 root 自己的 name）
    raw: str  # 依赖声明中的原始 spec 文本


@dataclass(frozen=True)
class Conflict:
    """一个包上的求解冲突说明。"""

    package: str
    reason: str  # missing（包不存在）/ empty（版本列表为空）/ no_match（无版本满足交集）
    origins: List[ConstraintOrigin] = field(default_factory=list)
    detail: str = ""

    def __str__(self) -> str:
        lines = ["包 %r 冲突（%s）%s" % (self.package, self.reason, self.detail)]
        for origin in self.origins:
            lines.append("  <- %s 要求 %r" % (origin.parent, origin.raw))
        return "\n".join(lines)


@dataclass
class SolveResult:
    """求解结果。

    - ``resolved``：成功时为 {包名: 版本字符串}；无解时为空 dict（不返回
      半成品状态）。
    - ``conflicts``：:class:`Conflict` 列表，顺序按包名/原因稳定排序。
    - ``ok``：全部依赖解出且无冲突时为 True。
    """

    resolved: Dict[str, str] = field(default_factory=dict)
    conflicts: List[Conflict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.conflicts


# registry 中单个版本条目的内部形态：(解析版本, 原始版本串, 该版本的 deps)。
_Entry = Tuple[_Version, str, list]


class _Search:
    """回溯求解状态。

    单条选择链的 DFS：每帧按"约束发现顺序"挑出第一个尚未定案的包，候选版本
    固定从高到低尝试，选定后合并该版本的 deps，再进入下一帧。深层失败会逐层
    回到上层帧换下一个候选——因此"b 的选择反过来收紧 a"这种跨包约束也能通过
    给 a 改选版本来解除。一次尝试合并的全部约束在回溯时逐条撤销，不会有换版本
    后旧依赖残留。
    """

    def __init__(self, index: Dict[str, List[_Entry]]):
        self._index = index
        self.chosen: Dict[str, str] = {}
        self._chosen_version: Dict[str, _Version] = {}
        self.origins: Dict[str, List[ConstraintOrigin]] = {}
        self.accumulated: Dict[str, List[Constraint]] = {}

    # ---- 约束合并/撤销 ------------------------------------------------ #

    def _merge(self, deps: list, parent: str) -> List[Tuple[str, int]]:
        """把某父包选定版本的 deps 合并进约束表，返回用于撤销的令牌。"""
        token: List[Tuple[str, int]] = []
        for dep in deps:
            name = dep["name"]
            raw = dep.get("spec", "")
            parsed = parse_constraint(raw)  # 语法错误直接抛 ConstraintSyntaxError
            self.origins.setdefault(name, []).append(ConstraintOrigin(parent, raw))
            self.accumulated.setdefault(name, []).extend(parsed)
            token.append((name, len(parsed)))
        return token

    def _undo(self, token: List[Tuple[str, int]]) -> None:
        for name, count in reversed(token):
            for _ in range(count):
                self.accumulated[name].pop()
            self.origins[name].pop()
            if not self.accumulated[name]:
                del self.accumulated[name]
                del self.origins[name]

    # ---- 回溯搜索 ------------------------------------------------------ #

    def run(self, root: dict) -> bool:
        root_name = root.get("name", "<root>")
        token = self._merge(root.get("deps") or [], root_name)
        try:
            return self._solve_next(1)
        finally:
            # root 约束不属于任何候选版本，退出时撤销，保持状态干净。
            self._undo(token)

    def _solve_next(self, depth: int) -> bool:
        name = next((n for n in self.accumulated if n not in self.chosen), None)
        if name is None:
            return True  # 约束表中的包全部定案。
        if depth > MAX_DEPTH:
            raise RecursionLimitError(
                "解析包 %r 时依赖链深度超过上限 %d（当前深度 %d）"
                % (name, MAX_DEPTH, depth)
            )
        if name not in self._index or not self._index[name]:
            return False  # 包不存在 / 版本列表为空，具体原因留给诊断阶段。

        feasible = [
            entry
            for entry in self._index[name]
            if _satisfies(entry[0], self.accumulated.get(name, []))
        ]
        # 稳定地按版本从高到低尝试。
        feasible.sort(key=lambda entry: _version_key(entry[0]), reverse=True)

        for version, raw_version, deps in feasible:
            self.chosen[name] = raw_version
            self._chosen_version[name] = version
            token = self._merge(deps, name)
            # 新合并的约束可能让此前已选定的其他包失效（环或跨包收紧）。
            consistent = all(
                _satisfies(self._chosen_version[n], self.accumulated[n])
                for n in self.chosen
            )
            if consistent and self._solve_next(depth + 1):
                return True
            self._undo(token)
            del self.chosen[name]
            del self._chosen_version[name]
        return False


class _Diagnosis:
    """无解时的贪心走查：始终选最高可行版本，沿途记录所有撞上的冲突。

    产出与搜索第一选择分支一致的、单一连贯的"大家都想最高时卡在哪"的解释。
    """

    def __init__(self, index: Dict[str, List[_Entry]]):
        self._index = index
        self.origins: Dict[str, List[ConstraintOrigin]] = {}
        self.accumulated: Dict[str, List[Constraint]] = {}
        self.chosen: Dict[str, _Version] = {}
        self._decided: set = set()
        self._conflicted: set = set()
        self.conflicts: List[Conflict] = []

    def run(self, root: dict) -> List[Conflict]:
        root_name = root.get("name", "<root>")
        self._integrate(root.get("deps") or [], root_name, 0)
        return sorted(self.conflicts, key=lambda c: (c.package, c.reason))

    def _integrate(self, deps: list, parent: str, depth: int) -> None:
        new_names: List[str] = []
        for dep in deps:
            name = dep["name"]
            raw = dep.get("spec", "")
            self.origins.setdefault(name, []).append(ConstraintOrigin(parent, raw))
            self.accumulated.setdefault(name, []).extend(parse_constraint(raw))
            if name in self._decided and name not in self._conflicted:
                # 新约束让此前已选定的版本失效：这就是跨父包打架的现场。
                if not _satisfies(self.chosen[name], self.accumulated[name]):
                    self._record(name, "no_match", "：没有任何版本同时满足全部约束")
            elif name not in self._decided and name not in new_names:
                new_names.append(name)
        # LIFO 压入，保持 deps 声明顺序的走查次序。
        for name in reversed(new_names):
            self._decide(name, depth + 1)

    def _decide(self, name: str, depth: int) -> None:
        if name in self._decided:
            return
        self._decided.add(name)
        if depth > MAX_DEPTH:
            raise RecursionLimitError(
                "解析包 %r 时依赖链深度超过上限 %d（当前深度 %d）"
                % (name, MAX_DEPTH, depth)
            )

        origins = list(self.origins.get(name, ()))
        if name not in self._index:
            self._record(name, "missing", "：registry 中不存在该包", origins)
            return
        entries = self._index[name]
        if not entries:
            self._record(name, "empty", "：该包的可用版本列表为空", origins)
            return
        feasible = [e for e in entries if _satisfies(e[0], self.accumulated.get(name, []))]
        if not feasible:
            self._record(name, "no_match", "：没有任何版本同时满足全部约束", origins)
            return
        feasible.sort(key=lambda e: _version_key(e[0]), reverse=True)
        version, _raw, deps = feasible[0]
        self.chosen[name] = version
        self._integrate(deps, name, depth)

    def _record(self, name: str, reason: str, detail: str, origins=None) -> None:
        self._conflicted.add(name)
        self.conflicts.append(
            Conflict(
                package=name,
                reason=reason,
                origins=origins if origins is not None else list(self.origins.get(name, ())),
                detail=detail,
            )
        )


class Solver:
    """离线依赖求解器。

    用法::

        result = Solver().solve(root, packages)
        if result.ok:
            install = result.resolved
        else:
            for conflict in result.conflicts:
                print(conflict)
    """

    def solve(self, root: dict, packages: Dict[str, List[dict]]) -> SolveResult:
        """求解 root 的依赖闭包。

        ``root`` 形如
        ``{"name": "app", "version": "1.0", "deps": [{"name": "lib", "spec": ">=1.2,<2"}]}``；
        ``packages`` 为 包名 -> 版本声明列表，版本声明形如
        ``{"version": "1.4.2", "deps": [...]}``。

        可能抛出：
        - :class:`ConstraintSyntaxError`：任何依赖声明（含未被选中的版本）中的
          spec 语法非法，预检阶段即抛出，不依赖求解选择；
        - :class:`RecursionLimitError`：依赖链深度超过 64。
        """
        index = self._build_index(packages)
        for dep in root.get("deps") or []:
            parse_constraint(dep.get("spec", ""))
        search = _Search(index)
        if search.run(root):
            return SolveResult(resolved=dict(search.chosen), conflicts=[])
        diagnosis = _Diagnosis(index)
        conflicts = diagnosis.run(root)
        return SolveResult(resolved={}, conflicts=conflicts)

    @staticmethod
    def _build_index(packages: Dict[str, List[dict]]) -> Dict[str, List[_Entry]]:
        index: Dict[str, List[_Entry]] = {}
        for name, versions in packages.items():
            entries: List[_Entry] = []
            for item in versions or []:
                raw_version = item["version"]
                version = parse_version(raw_version)  # 数据非法：明确抛出，不静默
                deps = item.get("deps") or []
                # 预检所有版本的 spec，保证非法约束无论该版本是否被选中都会报错。
                for dep in deps:
                    parse_constraint(dep.get("spec", ""))
                entries.append((version, raw_version, deps))
            index[name] = entries
        return index
