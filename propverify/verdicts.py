"""判定结果存档与冲突记录。

每个 (不变量, 对象, 输入序号) 的判定按来源分别保存：
- 本地运行是一个来源，外部复核 / 另一套实现可以是其他来源；
- 不同来源结论一致 → 正常生效；
- 结论互相矛盾 → 双方（及更多方）全部保留，生成可读的冲突记录，
  绝不静默择一；该键的对外结论标记为 CONFLICT。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

PASS = "pass"
FAIL = "fail"
SKIP = "skip"
CONFLICT = "conflict"

# (inv_id, target, index)
VerdictKey = Tuple[str, str, int]


@dataclass(frozen=True)
class Verdict:
    status: str  # pass / fail / skip
    reason: str = ""

    def __post_init__(self):
        if self.status not in (PASS, FAIL, SKIP, CONFLICT):
            raise ValueError(f"非法判定状态: {self.status!r}")


@dataclass
class ConflictSide:
    source: str
    verdict: Verdict


@dataclass
class ConflictRecord:
    """同一键上多个来源的矛盾判定，全部保留。"""

    key: VerdictKey
    sides: List[ConflictSide] = field(default_factory=list)

    def describe(self) -> str:
        inv_id, target, index = self.key
        lines = [f"冲突: 不变量 {inv_id!r} 在 {target}[{index}] 上存在 {len(self.sides)} 种互相矛盾的判定:"]
        for s in self.sides:
            v = s.verdict
            suffix = f"（{v.reason}）" if v.reason else ""
            lines.append(f"  - 来源 {s.source!r}: {v.status}{suffix}")
        return "\n".join(lines)


class VerdictStore:
    def __init__(self) -> None:
        self._by_key: Dict[VerdictKey, Dict[str, Verdict]] = {}
        self.conflicts: List[ConflictRecord] = []
        self._conflicted: set = set()

    # ------------------------------------------------------------ 写入
    def submit(self, source: str, key: VerdictKey, verdict: Verdict) -> Optional[ConflictRecord]:
        """登记一个来源的判定；若与既有来源矛盾，生成冲突记录并返回之。"""
        bucket = self._by_key.setdefault(key, {})
        bucket[source] = verdict
        distinct = {v.status for v in bucket.values()}
        if len(distinct) > 1 and key not in self._conflicted:
            self._conflicted.add(key)
            record = ConflictRecord(
                key=key,
                sides=[ConflictSide(source=s, verdict=bucket[s]) for s in sorted(bucket)],
            )
            self.conflicts.append(record)
            return record
        if key in self._conflicted:
            # 已冲突的键上更新某一来源：刷新冲突记录，保持双方信息最新。
            for rec in self.conflicts:
                if rec.key == key:
                    rec.sides = [ConflictSide(source=s, verdict=bucket[s]) for s in sorted(bucket)]
                    return rec
        return None

    # ------------------------------------------------------------ 读取
    def sources(self, key: VerdictKey) -> Dict[str, Verdict]:
        return dict(self._by_key.get(key, {}))

    def effective(self, key: VerdictKey) -> Optional[Verdict]:
        """对外生效的结论：矛盾时为 CONFLICT，单来源或一致时为该结论。"""
        bucket = self._by_key.get(key)
        if not bucket:
            return None
        distinct = {v.status for v in bucket.values()}
        if len(distinct) > 1:
            return Verdict(CONFLICT, "多个来源判定矛盾，详见冲突记录")
        return next(iter(bucket.values()))

    def keys(self) -> List[VerdictKey]:
        return sorted(self._by_key)

    def conflicts_for(self, inv_id: str) -> List[ConflictRecord]:
        return [c for c in self.conflicts if c.key[0] == inv_id]
