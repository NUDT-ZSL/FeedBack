"""策略差异：把"调整前 → 调整后"表示为一组可独立应用的原子差异。

差异种类：
- ADDED            新增规则
- REMOVED          删除规则
- MODIFIED         同标识规则的字段发生变化（优先级/条件/效果/启用状态）
- DEFAULT_CHANGED  策略默认效果变化（before/after 为 Effect 而非 Rule）

diff_policies 返回的元组按 (rule_id, kind) 排序，保证稳定顺序。
apply_diffs 可把任意差异子集应用到旧策略上，用于归因分析。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional, Tuple

from .models import Effect, Policy, Rule


class DiffKind(Enum):
    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    DEFAULT_CHANGED = "default_changed"


@dataclass(frozen=True)
class RuleDiff:
    """一条原子差异。DEFAULT_CHANGED 时 rule_id 为 None，before/after 为 Effect。"""

    kind: DiffKind
    rule_id: Optional[str]
    before: Any  # Rule | Effect | None
    after: Any   # Rule | Effect | None

    def describe(self) -> str:
        if self.kind is DiffKind.ADDED:
            return f"新增 {self.after.describe()}"
        if self.kind is DiffKind.REMOVED:
            return f"删除 {self.before.describe()}"
        if self.kind is DiffKind.DEFAULT_CHANGED:
            return (
                f"策略默认效果由 {self.before.value} 调整为 {self.after.value}"
            )
        # MODIFIED：逐字段说明
        changes = []
        b: Rule = self.before
        a: Rule = self.after
        if b.priority != a.priority:
            changes.append(f"优先级 {b.priority} → {a.priority}")
        if b.condition != a.condition:
            changes.append(
                f"条件由 [{b.condition.describe()}] 改为 [{a.condition.describe()}]"
            )
        if b.effect != a.effect:
            changes.append(f"效果 {b.effect.value} → {a.effect.value}")
        if b.enabled != a.enabled:
            changes.append("由启用改为停用" if b.enabled else "由停用改为启用")
        body = "；".join(changes) if changes else "（无实质字段变化）"
        return f"修改规则 '{self.rule_id}': {body}"


def diff_policies(old: Policy, new: Policy) -> Tuple[RuleDiff, ...]:
    """计算两套策略的规则级差异，按稳定顺序返回。"""
    diffs = []
    old_ids = set(old.rule_ids())
    new_ids = set(new.rule_ids())
    for rid in sorted(new_ids - old_ids):
        diffs.append(RuleDiff(DiffKind.ADDED, rid, None, new.get(rid)))
    for rid in sorted(old_ids - new_ids):
        diffs.append(RuleDiff(DiffKind.REMOVED, rid, old.get(rid), None))
    for rid in sorted(old_ids & new_ids):
        before, after = old.get(rid), new.get(rid)
        if before != after:
            diffs.append(RuleDiff(DiffKind.MODIFIED, rid, before, after))
    if old.default_effect != new.default_effect:
        diffs.append(
            RuleDiff(
                DiffKind.DEFAULT_CHANGED, None, old.default_effect, new.default_effect
            )
        )
    diffs.sort(key=lambda d: (d.rule_id or "", d.kind.value))
    return tuple(diffs)


def apply_diffs(policy: Policy, diffs) -> Policy:
    """把一组差异应用到策略上，返回新策略（原策略不变）。"""
    rules = {r.rule_id: r for r in policy.rules}
    default = policy.default_effect
    for d in diffs:
        if d.kind is DiffKind.ADDED:
            rules[d.after.rule_id] = d.after
        elif d.kind is DiffKind.REMOVED:
            rules.pop(d.rule_id, None)
        elif d.kind is DiffKind.MODIFIED:
            rules[d.after.rule_id] = d.after
        elif d.kind is DiffKind.DEFAULT_CHANGED:
            default = d.after
    return Policy(
        list(rules.values()),
        schema=policy.schema,
        default_effect=default,
        name=f"{policy.name}+diff",
    )
