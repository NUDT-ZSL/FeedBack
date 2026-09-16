"""生成可复核的纯文本报告（需求 5、6）。

报告分节：
  1. 总览（总数 / 已执行 / 通过 / 失败含超时 / 跳过 / 冲突 / 未执行 / 待上报）
  2. 按用例维度的通过率
  3. 按组合维度的通过率
  4. 失败明细（含超时）
  5. 未执行清单（带原因，不计入通过率分母）
  6. 冲突记录（双方来源与各自结果，全部保留）
  7. 待上报（疑似漏跑）清单
"""
from __future__ import annotations

from .runner import Summary


def _section(title: str) -> list[str]:
    return ["", "=" * 72, title, "=" * 72]


def render_summary(summary: Summary) -> str:
    lines: list[str] = []
    lines += ["环境兼容性验证结论（离线汇总）", "#" * 72]
    if summary.total_cells == 0:
        lines.append("矩阵或用例为空，没有可汇总的单元格。")
        return "\n".join(lines)

    # ---- 1. 总览 ----
    lines += _section("1. 总览")
    lines += [
        f"单元格总数（组合数 × 用例数）: {summary.total_cells}",
        f"已执行: {summary.executed}（其中通过 {summary.passed}，失败 {summary.failed}"
        f"，超时 {summary.timeout}，跳过 {summary.skipped}，冲突 {summary.conflicted}）",
        f"未执行: {summary.not_run}（环境临时不可用，单独列出且不计入通过率分母）",
        f"待上报（疑似漏跑）: {summary.pending}",
        "",
        f"总体通过率（未执行/待上报不进分母）: {summary.rate_text}",
    ]

    # ---- 2. 按用例 ----
    lines += _section("2. 通过率 —— 按用例维度")
    header = f"{'用例':<22}{'分组':<12}{'期望':<9}{'通过/已执行':<16}{'通过率':<14}状态分布"
    lines.append(header)
    lines.append("-" * 72)
    for s in summary.by_case:
        dist_parts = []
        if s.failed:
            dist_parts.append(f"失败{s.failed}")
        if s.timeout:
            dist_parts.append(f"超时{s.timeout}")
        if s.skipped:
            dist_parts.append(f"跳过{s.skipped}")
        if s.conflicted:
            dist_parts.append(f"冲突{s.conflicted}")
        if s.not_run:
            dist_parts.append(f"未执行{s.not_run}")
        if s.pending:
            dist_parts.append(f"待上报{s.pending}")
        dist = " ".join(dist_parts) or "全通过"
        rate = s.rate_text
        lines.append(
            f"{s.case_id:<22}{s.group:<12}{s.expected.value:<9}"
            f"{f'{s.passed}/{s.executed}':<16}{rate:<14}{dist}"
        )

    # ---- 3. 按组合 ----
    lines += _section("3. 通过率 —— 按环境组合维度")
    lines.append(f"{'#':<4}{'环境组合':<40}{'通过/已执行':<16}{'通过率':<14}状态分布")
    lines.append("-" * 72)
    for i, s in enumerate(summary.by_combo, 1):
        dist_parts = []
        if s.failed:
            dist_parts.append(f"失败{s.failed}")
        if s.timeout:
            dist_parts.append(f"超时{s.timeout}")
        if s.skipped:
            dist_parts.append(f"跳过{s.skipped}")
        if s.conflicted:
            dist_parts.append(f"冲突{s.conflicted}")
        if s.not_run:
            dist_parts.append(f"未执行{s.not_run}")
        if s.pending:
            dist_parts.append(f"待上报{s.pending}")
        dist = " ".join(dist_parts) or "全通过"
        lines.append(
            f"{i:<4}{s.combo_label:<40}{f'{s.passed}/{s.executed}':<16}"
            f"{s.rate_text:<14}{dist}"
        )

    # ---- 4. 失败明细 ----
    lines += _section("4. 失败明细（含超时，后跑的结果不会覆盖先跑的结论）")
    if not summary.failures:
        lines.append("（无）")
    else:
        for i, f in enumerate(summary.failures, 1):
            lines.append(
                f"[{i}] 用例 {f.case_id!r}（分组 {f.group!r}，期望 {f.expected.value}）"
                f" 在组合 [{f.combo_label}] 上 {f.outcome.value}"
            )
            lines.append(f"    来源: {', '.join(f.sources) or '未知'}")
            if f.reason:
                lines.append(f"    原因: {f.reason}")

    # ---- 5. 未执行 ----
    lines += _section("5. 未执行清单（环境不可用，绝不当作通过）")
    if not summary.not_run_details:
        lines.append("（无）")
    else:
        for i, d in enumerate(summary.not_run_details, 1):
            lines.append(
                f"[{i}] 用例 {d.case_id!r}（分组 {d.group!r}）在组合 "
                f"[{d.combo_label}] 未执行"
            )
            lines.append(f"    原因: {d.reason}")
            if d.source:
                lines.append(f"    标记来源: {d.source}")

    # ---- 6. 冲突 ----
    lines += _section("6. 冲突记录（矛盾双方全部保留，未静默择一）")
    if not summary.conflicts:
        lines.append("（无）")
    else:
        for i, c in enumerate(summary.conflicts, 1):
            lines.append(f"[{i}] {c.render()}")

    # ---- 7. 待上报 ----
    lines += _section("7. 待上报清单（疑似漏跑，同样不计入通过率）")
    if not summary.pending_details:
        lines.append("（无）")
    else:
        for i, d in enumerate(summary.pending_details, 1):
            lines.append(
                f"[{i}] 用例 {d.case_id!r}（分组 {d.group!r}）在组合 "
                f"[{d.combo_label}] 上还没有任何来源上报"
            )

    return "\n".join(lines)
