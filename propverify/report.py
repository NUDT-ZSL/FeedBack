"""验收报告：汇总结论、失败反例（含收缩轨迹）、跳过原因与冲突记录。"""

from __future__ import annotations

from typing import List

from .runner import Runner
from .verdicts import FAIL, SKIP


def build_report(runner: Runner) -> dict:
    conclusion = runner.conclusion()
    invariants = {}
    for inv_id in sorted(conclusion):
        c = conclusion[inv_id]
        failures = []
        for key in c["failures"]:
            detail = runner.failures.get(key)
            if detail is None:
                continue
            failures.append(
                {
                    "input": {"target": key[1], "index": key[2]},
                    "values": detail.values,
                    "reason": detail.reason,
                    "shrunk": detail.shrink.shrunk if detail.shrink else None,
                    "shrink_trace": detail.shrink.trace() if detail.shrink else [],
                    "shrink_verified": detail.shrink.verified if detail.shrink else None,
                }
            )
        invariants[inv_id] = {
            "pass": c["pass"],
            "fail": c["fail"],
            "skip": c["skip"],
            "conflict": c["conflict"],
            "failures": failures,
        }
    return {
        "seed": runner.config.seed,
        "input_count": runner.config.input_count,
        "invariants": invariants,
        "conflicts": [c.describe() for c in runner.store.conflicts],
    }


def render_text(report: dict) -> str:
    lines: List[str] = []
    lines.append(f"属性验证报告（seed={report['seed']}, 每对象输入数={report['input_count']}）")
    lines.append("=" * 60)
    for inv_id, inv in report["invariants"].items():
        lines.append(
            f"[{inv_id}] 通过 {inv['pass']} / 违反 {inv['fail']} / "
            f"跳过 {inv['skip']} / 冲突 {inv['conflict']}"
        )
        for f in inv["failures"]:
            loc = f["input"]
            lines.append(f"  反例 {loc['target']}[{loc['index']}]: {f['values']!r} —— {f['reason']}")
            for t in f["shrink_trace"]:
                lines.append(f"    {t}")
    if report["conflicts"]:
        lines.append("-" * 60)
        lines.append("冲突记录（双方结论均已保留，需人工裁决）:")
        for c in report["conflicts"]:
            lines.append(c)
    total_fail = sum(i["fail"] for i in report["invariants"].values())
    total_conflict = sum(i["conflict"] for i in report["invariants"].values())
    lines.append("=" * 60)
    verdict = "通过" if total_fail == 0 and total_conflict == 0 else "未通过"
    lines.append(f"总体结论: {verdict}（违反 {total_fail}，冲突 {total_conflict}）")
    return "\n".join(lines)
