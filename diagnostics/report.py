"""诊断报告：故障链完整程度、被覆盖线索影响范围、结论可信度。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .chains import ChainReconstructor, FaultChain
from .store import BoundedClueStore


@dataclass
class DiagnosticReport:
    chains: list[FaultChain]
    evicted_total: int
    evicted_by_chain: dict[str, int]
    unresolved_conflicts: int
    confidence: float
    notes: list[str] = field(default_factory=list)

    def render_text(self) -> str:
        lines = ["===== 设备诊断报告 =====", ""]
        lines.append(f"故障链数量: {len(self.chains)}")
        lines.append(f"被覆盖线索总数: {self.evicted_total}")
        for cid, n in sorted(self.evicted_by_chain.items()):
            lines.append(f"  - 链 {cid}: {n} 条被覆盖")
        lines.append(f"未解决冲突: {self.unresolved_conflicts}")
        lines.append(f"整体可信度: {self.confidence:.0%}")
        lines.append("")
        for chain in self.chains:
            lines.append(f"--- 故障链 {chain.chain_id} ---")
            lines.append(
                f"  完整程度: {chain.completeness:.0%} "
                f"(在场 {chain.present_count} / 可推断 {chain.inferred_count} / 缺失 {chain.missing_count})"
            )
            lines.append(f"  已确认闭环: {'是' if chain.confirmed else '否'}")
            if chain.conflicts:
                lines.append(f"  矛盾环节: {len(chain.conflicts)} 处")
                for c in chain.conflicts:
                    lines.append(
                        f"    * t={c.timestamp} 字段 '{c.field}': {c.values} (线索 {c.clue_ids})"
                    )
            lines.append("  状态变化路径:")
            for ts, src, state in chain.state_path():
                lines.append(f"    t={ts} [{src}] {state}")
            for link in chain.links:
                if link.kind != "present" and link.note:
                    lines.append(f"  [{link.kind}] {link.note}")
            lines.append("")
        if self.notes:
            lines.append("备注:")
            for n in self.notes:
                lines.append(f"  - {n}")
        return "\n".join(lines)


def build_report(store: BoundedClueStore, temporal_window: float = 30.0) -> DiagnosticReport:
    chains = ChainReconstructor(store, temporal_window).reconstruct()

    evicted_by_chain: dict[str, int] = {}
    for tomb in store.tombstones:
        key = tomb.chain_id or "<未归属>"
        evicted_by_chain[key] = evicted_by_chain.get(key, 0) + 1

    unresolved = sum(1 for c in store.conflicts if not c.resolved)

    # 可信度：以各链完整程度的加权平均为基础，
    # 每处未解决冲突与每个完全缺失环节都会折减。
    notes: list[str] = []
    if chains:
        base = sum(c.completeness for c in chains) / len(chains)
    else:
        base = 1.0
        notes.append("存储中没有任何线索，无法形成结论")
    missing_total = sum(c.missing_count for c in chains)
    penalty = 0.1 * unresolved + 0.05 * missing_total
    confidence = max(0.0, min(1.0, base - penalty))
    if unresolved:
        notes.append(f"{unresolved} 处未解决冲突降低了结论可信度")
    if missing_total:
        notes.append(f"{missing_total} 个环节完全缺失（无原文也无覆盖摘要）")
    if store.rejected:
        notes.append(f"{len(store.rejected)} 条新线索因受保护证据占满空间而被拒绝")

    return DiagnosticReport(
        chains=chains,
        evicted_total=len(store.tombstones),
        evicted_by_chain=evicted_by_chain,
        unresolved_conflicts=unresolved,
        confidence=confidence,
        notes=notes,
    )
