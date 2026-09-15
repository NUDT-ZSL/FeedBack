"""分支合并：两条选择路径在汇合节点相遇时，按确定性规则合并各自累积的状态变更。

规则（详见 docs/semantics.md）：
1. 合并结论只取决于各分支累积的变更日志与分支名，与路径到达汇合点的
   先后顺序无关：每次到达都对全部已到分支的日志**重新计算**合并结果。
2. 同一变量被多条分支改成不同的最终值时产生冲突：
   - 保留双方来源（分支名、节点、变更标识、值）；
   - 生成可读冲突记录，初始为未解决；
   - 冲突未解决前，该变量的生效值恒为**分支名字典序最小**一方的值，
     后到的一方不得覆盖先生效的一方。
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple


class Conflict:
    """一次变量冲突：保留双方来源与取值，可读、可序列化。"""

    def __init__(self, variable: str,
                 branch_a: str, value_a: Any, sources_a: List[str],
                 branch_b: str, value_b: Any, sources_b: List[str],
                 winner: str):
        self.variable = variable
        self.branch_a = branch_a
        self.value_a = value_a
        self.sources_a = list(sources_a)   # 形如 "节点n1/变更c1"
        self.branch_b = branch_b
        self.value_b = value_b
        self.sources_b = list(sources_b)
        self.winner = winner               # 胜出的分支名（字典序较小者）
        self.resolved = False
        self.resolved_value = None         # 解决时采用的值；未解决时为 None

    @property
    def winning_value(self) -> Any:
        return self.value_a if self.winner == self.branch_a else self.value_b

    @property
    def effective_value(self) -> Any:
        """当前生效值：已解决为解决值，未解决为胜出方值。"""
        return self.resolved_value if self.resolved else self.winning_value

    def key(self) -> Tuple[str, str, str]:
        """用于跨次重算识别同一冲突（保留解决状态）。"""
        return (self.variable, self.branch_a, self.branch_b)

    def readable(self) -> str:
        src_a = ", ".join(self.sources_a)
        src_b = ", ".join(self.sources_b)
        text = (
            f"变量 {self.variable!r} 冲突："
            f"分支 {self.branch_a} = {self.value_a!r}（来源 {src_a}） vs "
            f"分支 {self.branch_b} = {self.value_b!r}（来源 {src_b}）；"
        )
        if self.resolved:
            return text + f"已解决，采用 {self.resolved_value!r}"
        return text + (
            f"未解决，按确定性规则暂采用分支 {self.winner} 的值 "
            f"{self.winning_value!r}"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "variable": self.variable,
            "branch_a": self.branch_a, "value_a": self.value_a, "sources_a": self.sources_a,
            "branch_b": self.branch_b, "value_b": self.value_b, "sources_b": self.sources_b,
            "winner": self.winner, "resolved": self.resolved,
            "resolved_value": self.resolved_value,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Conflict":
        c = Conflict(d["variable"], d["branch_a"], d["value_a"], d["sources_a"],
                     d["branch_b"], d["value_b"], d["sources_b"], d["winner"])
        c.resolved = bool(d.get("resolved", False))
        c.resolved_value = d.get("resolved_value")
        return c


def _final_writes(log: List[Dict[str, Any]]) -> Dict[str, Tuple[Any, List[str]]]:
    """一条变更日志中每个变量的最终值与全部来源（按日志顺序）。"""
    out: Dict[str, Tuple[Any, List[str]]] = {}
    for entry in log:
        var = entry["variable"]
        src = f"节点{entry['node']}/变更{entry['change']}"
        if var in out:
            _, srcs = out[var]
            out[var] = (entry["new"], srcs + [src])
        else:
            out[var] = (entry["new"], [src])
    return out


def merge_logs(log_a: List[Dict[str, Any]], log_b: List[Dict[str, Any]],
               branch_a: str, branch_b: str
               ) -> Tuple[List[Dict[str, Any]], List[Conflict]]:
    """合并两条分支的变更日志，返回 (按序排列的合并变更, 冲突列表)。

    若 branch_a > branch_b（字典序），内部交换以保证规则与传入顺序无关。
    """
    if branch_a > branch_b:
        log_a, log_b = log_b, log_a
        branch_a, branch_b = branch_b, branch_a

    writes_a = _final_writes(log_a)
    writes_b = _final_writes(log_b)

    conflicts: List[Conflict] = []
    for var in sorted(set(writes_a) & set(writes_b)):
        val_a, srcs_a = writes_a[var]
        val_b, srcs_b = writes_b[var]
        if val_a != val_b:
            # 确定性规则：分支名字典序较小者胜出（此处即 branch_a）
            conflicts.append(Conflict(var, branch_a, val_a, srcs_a,
                                      branch_b, val_b, srcs_b, winner=branch_a))

    # 合并序列：先 branch_a 全部变更，再 branch_b 中未冲突变量的变更；
    # 冲突变量只保留胜出方（branch_a）的写入，保证结果与规则一致。
    conflicted = {c.variable for c in conflicts}
    merged: List[Dict[str, Any]] = []
    for entry in log_a:
        merged.append(dict(entry, branch=branch_a))
    for entry in log_b:
        if entry["variable"] not in conflicted:
            merged.append(dict(entry, branch=branch_b))
    return merged, conflicts


def compute_confluence(branches: Dict[str, List[Dict[str, Any]]]
                       ) -> Tuple[Dict[str, Tuple[Any, str]], List[Conflict]]:
    """对汇合点全部已到分支的日志做确定性合并，与到达顺序无关。

    branches: {分支名: 变更日志}
    返回 (values, conflicts)：
    - values: {变量: (生效值, 来源分支)}。无冲突时来源为写入方（多方写入同值时
      取字典序最小者）；有冲突时来源为胜出方（分支名字典序最小者）。
    - conflicts: 每个 (变量, 落败分支) 一条记录，按 (变量, 落败分支) 稳定排序。
    """
    # var -> {branch: (final_value, sources)}
    writers: Dict[str, Dict[str, Tuple[Any, List[str]]]] = {}
    for branch in sorted(branches):
        for var, (val, srcs) in _final_writes(branches[branch]).items():
            writers.setdefault(var, {})[branch] = (val, srcs)

    values: Dict[str, Tuple[Any, str]] = {}
    conflicts: List[Conflict] = []
    for var in sorted(writers):
        w = writers[var]
        winner_branch = sorted(w)[0]
        winner_val, winner_srcs = w[winner_branch]
        values[var] = (winner_val, winner_branch)
        for loser in sorted(w):
            if loser == winner_branch:
                continue
            loser_val, loser_srcs = w[loser]
            if loser_val != winner_val:
                conflicts.append(Conflict(var, winner_branch, winner_val, winner_srcs,
                                          loser, loser_val, loser_srcs,
                                          winner=winner_branch))
    return values, conflicts
