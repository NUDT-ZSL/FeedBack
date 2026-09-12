"""CDCL 布尔约束求解内核。

两文字监视传播 + 1-UIP 冲突分析 + 非时序回跳 + VSIDS 决策 + 不可满足核。
纯 Python 标准库，面向离线规则校验场景。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

__all__ = ["Solver", "SolverLocked", "UnknownVariable", "NotUnsat"]


class SolverLocked(Exception):
    """solve() 之后再调用 add_clause()。"""


class UnknownVariable(Exception):
    """变量编号超出构造参数 max_var（或小于 1）。携带 var 属性。"""

    def __init__(self, var: int):
        self.var = var
        super().__init__(f"unknown variable: {var}")


class NotUnsat(Exception):
    """最近一次求解结果不是 UNSAT 时调用 explain()。"""


class Solver:
    """CDCL SAT 求解器。

    文字为非零整数：正数表示变量为真，负数表示为假；变量从 1 编号到 max_var。
    """

    def __init__(self, max_var: int):
        if max_var < 0:
            raise ValueError("max_var must be >= 0")
        self.max_var = max_var
        # 工作子句集（含学习子句）；监视方案会交换子句内文字位置
        self.clauses: List[List[int]] = []
        # 规范化后的原始子句快照（不被监视方案改写），explain 的子集针对它
        self._originals: List[List[int]] = []
        # 工作子句下标 -> 对应的 _originals 下标（仅原始子句）
        self._orig_index: List[int] = []
        # 学习子句下标 -> 其父子句列表（归结链 + 层 0 跳过文字的 reason）
        self._parents: Dict[int, List[int]] = {}
        self._num_original = 0
        self._has_empty = False

        self.watches: Dict[int, List[int]] = defaultdict(list)  # 文字 -> 子句下标
        self.assign: List[Optional[bool]] = [None] * (max_var + 1)
        self.level: List[int] = [0] * (max_var + 1)
        self.reason: List[Optional[int]] = [None] * (max_var + 1)
        self.trail: List[int] = []
        self.trail_lim: List[int] = []
        self.qhead = 0

        # VSIDS
        self.activity: List[float] = [0.0] * (max_var + 1)
        self._var_inc = 1.0
        self._var_decay = 0.95

        # 统计
        self.decisions = 0
        self.propagations = 0
        self.conflicts = 0
        self.learned_clauses = 0
        self._watch_checks = 0  # 传播中实际检查的子句数（验证非全量扫描）

        # 诊断信息（测试用）
        self.learned: List[List[int]] = []          # 学习子句（文字列表）
        self.backjumps: List[Tuple[int, int, int]] = []  # (已做决策数, 冲突层, 回跳层)
        self.decision_log: List[int] = []           # 决策文字序列

        self._locked = False
        self._result: Optional[bool] = None
        self._core: Optional[List[List[int]]] = None

    # ------------------------------------------------------------------
    # 子句输入
    # ------------------------------------------------------------------

    def add_clause(self, lits: List[int]) -> None:
        """添加子句。重言式直接丢弃；重复文字去重；空子句使公式立即不可满足。"""
        if self._locked:
            raise SolverLocked("cannot add clauses after solve()")
        seen: Set[int] = set()
        norm: List[int] = []
        for lit in lits:
            if lit == 0:
                raise ValueError("literal 0 is not allowed")
            v = abs(lit)
            if v > self.max_var:
                raise UnknownVariable(v)
            if -lit in seen:
                return  # 同时含 x 和 -x：恒真，丢弃且不计入子句数
            if lit not in seen:
                seen.add(lit)
                norm.append(lit)
        self._originals.append(list(norm))
        if not norm:
            self._has_empty = True
            return
        self._orig_index.append(len(self._originals) - 1)
        self.clauses.append(norm)

    # ------------------------------------------------------------------
    # 求解主循环
    # ------------------------------------------------------------------

    @property
    def decision_level(self) -> int:
        return len(self.trail_lim)

    def solve(self) -> bool:
        """求解。可重复调用，结果与第一次一致。"""
        if self._result is not None:
            return self._result
        self._locked = True
        if self._has_empty:
            self._core = [[]]
            self._result = False
            return False
        self._num_original = len(self.clauses)
        # 为原始子句建立监视（单位子句只监视自身）
        for idx, clause in enumerate(self.clauses):
            self.watches[clause[0]].append(idx)
            if len(clause) > 1:
                self.watches[clause[1]].append(idx)
        # 层 0 单位子句直接入队
        confl: Optional[int] = None
        for idx, clause in enumerate(self.clauses):
            if len(clause) == 1 and not self._enqueue(clause[0], idx):
                confl = idx  # 与已有层 0 赋值矛盾
                break
        if confl is None:
            confl = self._propagate()
        while True:
            while confl is not None:
                self.conflicts += 1
                if self.decision_level == 0:
                    self._compute_core(confl)
                    self._result = False
                    return False
                learnt, backtrack, parents = self._analyze(confl)
                self.backjumps.append((self.decisions, self.decision_level, backtrack))
                self._backtrack(backtrack)
                self._add_learned(learnt, parents)
                confl = self._propagate()
            lit = self._choose_literal()
            if lit is None:
                self._result = True
                return True
            self.decisions += 1
            self.decision_log.append(lit)
            self.trail_lim.append(len(self.trail))
            self._enqueue(lit, None)
            confl = self._propagate()

    def model(self) -> Optional[Dict[int, bool]]:
        """SAT 时返回 变量->布尔 的完整映射；UNSAT 或未求解时返回 None。"""
        if self._result is not True:
            return None
        return {v: self.assign[v] for v in range(1, self.max_var + 1)}

    def stats(self) -> Dict[str, int]:
        return {
            "decisions": self.decisions,
            "propagations": self.propagations,
            "conflicts": self.conflicts,
            "learned_clauses": self.learned_clauses,
        }

    # ------------------------------------------------------------------
    # 传播：两文字监视
    # ------------------------------------------------------------------

    def _lit_value(self, lit: int) -> Optional[bool]:
        val = self.assign[abs(lit)]
        if val is None:
            return None
        return val if lit > 0 else not val

    def _enqueue(self, lit: int, reason: Optional[int]) -> bool:
        v = abs(lit)
        val = self.assign[v]
        if val is not None:
            return val == (lit > 0)
        self.assign[v] = lit > 0
        self.level[v] = self.decision_level
        self.reason[v] = reason
        self.trail.append(lit)
        return True

    def _propagate(self) -> Optional[int]:
        """把 trail 上未处理的赋值传播出去；返回冲突子句下标或 None。

        每个出队文字只检查监视了其否定文字的子句，不做全量扫描。
        """
        while self.qhead < len(self.trail):
            p = self.trail[self.qhead]
            self.qhead += 1
            self.propagations += 1
            ws = self.watches[-p]
            i = j = 0
            while i < len(ws):
                c = ws[i]
                clause = self.clauses[c]
                self._watch_checks += 1
                if len(clause) == 1:
                    # 单位子句的唯一文字已变假：冲突
                    ws[j] = c
                    j += 1
                    i += 1
                    while i < len(ws):
                        ws[j] = ws[i]
                        j += 1
                        i += 1
                    del ws[j:]
                    return c
                # 不变式：变假的文字放在位置 1
                if clause[0] == -p:
                    clause[0], clause[1] = clause[1], clause[0]
                first = clause[0]
                if self._lit_value(first) is True:
                    ws[j] = c  # 子句已满足，保留监视
                    j += 1
                    i += 1
                    continue
                # 在未监视的文字里找一个未变假的顶替
                found = False
                for k in range(2, len(clause)):
                    if self._lit_value(clause[k]) is not False:
                        clause[1], clause[k] = clause[k], clause[1]
                        self.watches[clause[1]].append(c)
                        found = True
                        break
                if found:
                    i += 1  # 从当前监视列表移除（不复制到 j）
                    continue
                ws[j] = c
                j += 1
                i += 1
                if self._lit_value(first) is False:
                    # 全部文字为假：冲突。剩余子句原样保留后返回
                    while i < len(ws):
                        ws[j] = ws[i]
                        j += 1
                        i += 1
                    del ws[j:]
                    return c
                # 单位化：传播 first
                self._enqueue(first, c)
            del ws[j:]
        return None

    # ------------------------------------------------------------------
    # 冲突分析：1-UIP 归结 + 非时序回跳
    # ------------------------------------------------------------------

    def _bump(self, v: int) -> None:
        self.activity[v] += self._var_inc
        if self.activity[v] > 1e100:  # 防溢出重缩放
            for i in range(1, len(self.activity)):
                self.activity[i] *= 1e-100
            self._var_inc *= 1e-100

    def _analyze(self, confl: int) -> Tuple[List[int], int, List[int]]:
        """从冲突子句出发沿蕴含图归结，返回 (学习子句, 回跳层, 父子句列表)。

        学习子句中当前决策层的文字只剩一个（断言文字，在位置 0），
        其余文字都来自更低的决策层；回跳层为它们的最高层。
        父子句 = 参与归结的子句 + 被跳过的层 0 文字的 reason 子句，
        用于 explain() 把学习子句展开回原始子句。
        """
        learnt: List[int] = [0]
        seen: Set[int] = set()
        parents: List[int] = []
        pathC = 0
        p: Optional[int] = None
        clause_idx = confl
        backtrack = 0
        idx = len(self.trail) - 1
        while True:
            clause = self.clauses[clause_idx]
            parents.append(clause_idx)
            for lit in clause:
                if lit == p:
                    continue  # 被归结掉的文字
                v = abs(lit)
                if v in seen:
                    continue
                if self.level[v] == 0:
                    # 层 0 文字不进入学习子句，但支撑该赋值的子句属于推导链
                    r = self.reason[v]
                    if r is not None:
                        parents.append(r)
                    continue
                seen.add(v)
                self._bump(v)
                if self.level[v] == self.decision_level:
                    pathC += 1
                else:
                    learnt.append(lit)
                    if self.level[v] > backtrack:
                        backtrack = self.level[v]
            # 沿 trail 逆序找下一个当前层的已标记文字
            while abs(self.trail[idx]) not in seen:
                idx -= 1
            p = self.trail[idx]
            idx -= 1
            seen.discard(abs(p))
            pathC -= 1
            if pathC == 0:
                break
            clause_idx = self.reason[abs(p)]
        learnt[0] = -p
        self._var_inc /= self._var_decay
        return learnt, backtrack, parents

    def _backtrack(self, level: int) -> None:
        if self.decision_level > level:
            for lit in self.trail[self.trail_lim[level]:]:
                v = abs(lit)
                self.assign[v] = None
                self.reason[v] = None
                self.level[v] = 0
            del self.trail[self.trail_lim[level]:]
            del self.trail_lim[level:]
            self.qhead = min(self.qhead, len(self.trail))

    def _add_learned(self, learnt: List[int], parents: List[int]) -> None:
        # 把次高层的文字换到位置 1 作为第二监视点
        if len(learnt) > 1:
            best = 1
            for i in range(2, len(learnt)):
                if self.level[abs(learnt[i])] > self.level[abs(learnt[best])]:
                    best = i
            learnt[1], learnt[best] = learnt[best], learnt[1]
        c = len(self.clauses)
        self.clauses.append(list(learnt))
        self._parents[c] = parents
        self.watches[learnt[0]].append(c)
        if len(learnt) > 1:
            self.watches[learnt[1]].append(c)
        self.learned.append(list(learnt))
        self.learned_clauses += 1
        self._enqueue(learnt[0], c)  # 回跳后学习子句必然单位化

    # ------------------------------------------------------------------
    # 决策：VSIDS 活跃度，平局取小编号，固定极性（先取真）
    # ------------------------------------------------------------------

    def _choose_literal(self) -> Optional[int]:
        best = 0
        for v in range(1, self.max_var + 1):
            if self.assign[v] is None and (best == 0 or self.activity[v] > self.activity[best]):
                best = v
        return best if best != 0 else None

    # ------------------------------------------------------------------
    # 不可满足核
    # ------------------------------------------------------------------

    def _compute_core(self, confl: int) -> None:
        """从层 0 冲突子句出发遍历蕴含图，收集支撑它的原始子句。

        沿两种边走：冲突/推导链上每条子句文字的 reason 边，
        以及学习子句指向其归结父子句的 parents 边。
        """
        core: Set[int] = set()
        seen_clauses: Set[int] = set()
        stack = [confl]
        while stack:
            c = stack.pop()
            if c in seen_clauses:
                continue
            seen_clauses.add(c)
            if c < self._num_original:
                core.add(self._orig_index[c])
            else:
                stack.extend(self._parents[c])  # 学习子句：展开其归结推导
            for lit in self.clauses[c]:
                r = self.reason[abs(lit)]
                if r is not None and r not in seen_clauses:
                    stack.append(r)
        self._core = [list(self._originals[i]) for i in sorted(core)]

    def explain(self) -> List[List[int]]:
        """最近一次 UNSAT 后返回不可满足核（原始输入子句的子集，本身仍 UNSAT）。"""
        if self._result is not True and self._result is not False:
            raise NotUnsat("solve() has not been called")
        if self._result is not False:
            raise NotUnsat("last result is not UNSAT")
        return [list(c) for c in self._core]
