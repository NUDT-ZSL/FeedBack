"""mapmatching.report —— 把还原结果渲染成可读文本（可追溯报告）。"""

from __future__ import annotations

from typing import List

from .network import RoadNetwork
from .tracker import Reconstruction


def render_reconstruction(
    recon: Reconstruction,
    network: RoadNetwork,
    *,
    title: str = "",
) -> str:
    lines: List[str] = []
    head = title or f"轨迹 {recon.track_id} 还原报告"
    lines.append("=" * 68)
    lines.append(head)
    lines.append("=" * 68)

    for source in sorted(recon.source_builds):
        build = recon.source_builds[source]
        lines.append("")
        lines.append(f"【来源 {source}】")

        if build.fragments:
            lines.append(f"  合法行驶片段 {len(build.fragments)} 段：")
        for index, frag in enumerate(build.fragments, start=1):
            lo, hi = frag.tick_span
            lines.append(
                f"  片段 {index}（tick {lo}~{hi}，"
                f"总代价 {frag.total_cost:.2f}）："
            )
            lines.append(f"    {network.describe_route(frag.steps)}")
            for leg in frag.legs:
                if leg.kind == "filled":
                    lines.append(f"    ↳ 补路 tick {leg.from_tick}->{leg.to_tick}：{leg.reason}")
                elif leg.kind == "direct":
                    lines.append(
                        f"    ↳ 衔接 tick {leg.from_tick}->{leg.to_tick}："
                        f"相邻路段首尾相接"
                    )

        if build.unmatched:
            lines.append(f"  未匹配采样点 {len(build.unmatched)} 个（未强行贴合）：")
            for mr in build.unmatched:
                lines.append(f"    - tick {mr.observation.tick}：{mr.unmatched.describe()}")

        if build.unreachable_legs:
            lines.append(f"  不可达断点 {len(build.unreachable_legs)} 处：")
            for leg in build.unreachable_legs:
                lines.append(
                    f"    - tick {leg.from_tick}->{leg.to_tick}：{leg.reason}"
                )

    if recon.conflicts:
        lines.append("")
        lines.append(f"【多来源冲突 {len(recon.conflicts)} 条（双方均保留，未静默择一）】")
        for conflict in recon.conflicts:
            lines.append(conflict.describe())

    return "\n".join(lines)
