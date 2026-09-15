"""分支合并：两条选择路径在汇合节点相遇时，按确定性规则合并各自累积的状态变更。

规则（详见 docs/semantics.md）：
1. 双方变更按 (分支名字典序, 分支内序号) 全序排列后依次应用 —— 完全确定。
2. 同一变量被两条分支改成不同的最终值时产生冲突：
   - 保留双方来源（分支名、节点、变更标识、值）；
   - 生成可读冲突记录，初始为未解决；
   - 合并取值按确定性规则：分支名字典序较小的一方胜出。
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
        self.winner = winner               # 胜出的分支名
        self.resolved = False

    @property
    def winning_value(self) -> Any:
        return self.value_a if self.winner == self.branch_a else self.value_b

    def readable(self) -> str:
        src_a = ", ".join(self.sources_a)
        src_b = ", ".join(self.sources_b)
        return (
            f"变量 {self.variable!r} 冲突："
            f"分支 {self.branch_a} = {self.value_a!r}（来源 {src_a}） vs "
            f"分支 {self.branch_b} = {self.value_b!r}（来源 {src_b}）；"
            f"按确定性规则采用分支 {self.winner} 的值 {self.winning_value!r}"
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "variable": self.variable,
            "branch_a": self.branch_a, "value_a": self.value_a, "sources_a": self.sources_a,
            "branch_b": self.branch_b, "value_b": self.value_b, "sources_b": self.sources_b,
            "winner": self.winner, "resolved": self.resolved,
        }

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Conflict":
        c = Conflict(d["variable"], d["branch_a"], d["value_a"], d["sources_a"],
                     d["branch_b"], d["value_b"], d["sources_b"], d["winner"])
        c.resolved = bool(d.get("resolved", False))
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
