"""诊断报告：故障链完整程度、被覆盖线索影响范围、结论可信度。"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, List, Tuple

from .chain import FaultChain, rebuild_chains
from .store import BoundedClueStore

_CONFLICT_PENALTY = 0.05      # 每条未解决冲突扣减的可信度
_CONFLICT_PENALTY_CAP = 0.30  # 冲突扣减上限


@dataclass
class DiagnosticReport:
    generated_at: float
    capacity_bytes: int
    used_bytes: int
    live_clues: int
    overwritten_clues: int
    tombstones: int
    conflicts: int
    chains: Dict[str, FaultChain]
    confidence: float

    @property
    def overwrite_impact(self) -> Dict[str, Tuple[float, float]]:
        """被覆盖线索按故障链分组的影响时间范围。"""
        impact: Dict[str, Tuple[float, float]] = {}
        for chain in self.chains.values():
            ts = [e.timestamp for e in chain.events if e.kind == "tombstone"]
            if ts:
                impact[chain.chain_id] = (min(ts), max(ts))
        return impact


def build_report(store: BoundedClueStore) -> DiagnosticReport:
    chains = rebuild_chains(store)
    if chains:
        base = sum(c.completeness for c in chains.values()) / len(chains)
    else:
        base = 1.0
    penalty = min(_CONFLICT_PENALTY_CAP, _CONFLICT_PENALTY * len(store.conflicts))
    confidence = max(0.0, min(1.0, base - penalty))
    return DiagnosticReport(
        generated_at=time.time(),
        capacity_bytes=store.capacity_bytes,
        used_bytes=store.used_bytes,
        live_clues=len(store),
        overwritten_clues=store.overwritten_count,
        tombstones=len(store.tombstones),
        conflicts=len(store.conflicts),
        chains=chains,
        confidence=round(confidence, 3),
    )


def render_text(report: DiagnosticReport) -> str:
    lines: List[str] = []
    lines.append("=" * 64)
    lines.append("设备诊断报告")
    lines.append("=" * 64)
    lines.append(f"存储占用 : {report.used_bytes}/{report.capacity_bytes} 字节")
    lines.append(
        f"线索统计 : 现存 {report.live_clues} 条, 被覆盖 {report.overwritten_clues} 条"
        f"（留墓碑 {report.tombstones} 条）, 冲突记录 {report.conflicts} 条"
    )
    lines.append(f"结论可信度: {report.confidence:.1%}")
    lines.append("")
    if not report.chains:
        lines.append("未发现故障链。")
    for chain_id, chain in sorted(report.chains.items()):
        status = "已确认" if chain.confirmed else "未确认"
        lines.append(f"故障链 [{chain_id}] 完整度 {chain.completeness:.1%}（{status}）")
        lines.append("  状态变化路径:")
        for e in chain.events:
            tag = "线索" if e.kind == "clue" else "墓碑"
            state = ", ".join(f"{k}={v}" for k, v in e.state.items()) or "-"
            lines.append(
                f"    t={e.timestamp:>8.3f} [{tag}/{e.severity}] {e.source}: "
                f"{e.summary} | 状态: {state}"
            )
        if chain.gaps:
            lines.append("  缺失环节:")
            for g in chain.gaps:
                lines.append(f"    t={g.at_timestamp:>8.3f} [{g.kind}] {g.detail}")
        if chain.conflicts:
            lines.append("  矛盾环节:")
            for c in chain.conflicts:
                sides = " vs ".join(
                    f"{p.source}={p.value}(#{p.clue_id})" for p in c.participants
                )
                lines.append(f"    t={c.timestamp:>8.3f} 状态[{c.state_key}]: {sides}")
        lines.append("")
    impact = report.overwrite_impact
    if impact:
        lines.append("被覆盖线索影响范围:")
        for chain_id, (lo, hi) in sorted(impact.items()):
            lines.append(f"  故障链 [{chain_id}]: t={lo:.3f} ~ t={hi:.3f}")
    return "\n".join(lines)
