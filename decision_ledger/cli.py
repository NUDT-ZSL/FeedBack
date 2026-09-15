"""中文命令行界面。

用法示例（台账文件默认 ./ledger.json，用 --file 指定）：

  python -m decision_ledger add-decision --topic "是否跳槽"
  python -m decision_ledger add-basis D-0001 --source "朋友内推" --weight 3 --stance supports --content "岗位匹配度高"
  python -m decision_ledger choose D-0001 --option "接受 offer"
  python -m decision_ledger outcome D-0001 --basis D-0001.B01 --value "试用期通过" --stance supports --weight 4 --source "直属主管" --at 2026-12-01T18:00:00
  python -m decision_ledger show D-0001
  python -m decision_ledger lesson D-0001 --title "内推要核实" --content "……"
  python -m decision_ledger cite D-0002 --lesson L-0001
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

from . import store
from .engine import Ledger
from .errors import LedgerError
from .models import (
    BASIS,
    RESULT,
    SUPPORTS,
    Decision,
)

DEFAULT_FILE = "ledger.json"


# ---------------------------------------------------------------------- #
# 输出辅助
# ---------------------------------------------------------------------- #

def _line(char: str = "─", n: int = 64) -> str:
    return char * n


def _print_decision_row(d: Decision) -> None:
    cur = d.current_conclusion()
    print(f"{d.decision_id:<8} {d.state:<5} 当前结论={cur.verdict:<4} "
          f"依据={len(d.basis_list())} 结果={len(d.outcomes)} "
          f"冲突={len(d.conflict_ids)}  {d.topic}")


def _cmd_list(ledger: Ledger, args) -> None:
    decisions = ledger.list_decisions()
    if not decisions:
        print("（台账为空，先用 add-decision 新建决策）")
        return
    print(f"共 {len(decisions)} 条决策（按标识升序）：")
    print(_line())
    for d in decisions:
        _print_decision_row(d)


def _cmd_show(ledger: Ledger, args) -> None:
    d = ledger.get_decision(args.decision_id)
    cur = d.current_conclusion()
    print(f"决策 {d.decision_id}：{d.topic}")
    print(f"  状态：{d.state}    发生时刻：{d.created_at}")
    if d.chosen_option:
        print(f"  已选择：{d.chosen_option}（{d.chosen_at}）")
    if d.reviewed_at:
        print(f"  已复盘：{d.reviewed_at}")
    print(f"  当前结论：{cur.verdict}（支持分 {cur.score_supports:g} / "
          f"反对分 {cur.score_contradicts:g}，第 {cur.version} 版）")

    print("  依据：")
    if not d.basis_list():
        print("    （无）")
    for e in d.basis_list():
        print(f"    [{e.evidence_id}] 权重={e.weight:g} "
              f"立场={'支持' if e.stance == SUPPORTS else '反对'} "
              f"来源={e.source}  获取于 {e.observed_at}")
        if e.content:
            print(f"        内容：{e.content}")

    print("  实际结果（按标识升序，含迟到回填）：")
    if not d.outcome_list():
        print("    （无）")
    for o in d.outcome_list():
        print(f"    [{o.outcome_id}] 对应依据 {o.basis_id} "
              f"立场={'支持' if o.stance == SUPPORTS else '反对'} "
              f"发生于 {o.occurred_at}  来源={o.source}")
        print(f"        观测值：{o.observed_value}")
        if o.conflicts:
            print(f"        ⚠ 触发冲突：{', '.join(o.conflicts)}")

    print(f"  结论变化轨迹（{len(d.conclusion_history)} 个版本）：")
    for c in d.conclusion_history:
        trigger = c.triggering_outcome_id or "—"
        print(f"    v{c.version} {c.changed_at} 结论={c.verdict:<4} "
              f"触发结果={trigger}  支持分={c.score_supports:g} "
              f"反对分={c.score_contradicts:g}")
        if args.verbose:
            print(f"        {c.note}")

    if d.conflict_ids:
        print(f"  冲突记录：{', '.join(d.conflict_ids)}（用 conflicts 命令查看详情）")
    if d.lesson_ids:
        print(f"  固化经验：{', '.join(d.lesson_ids)}")
    if d.cited_lesson_ids:
        print(f"  引用经验：{', '.join(d.cited_lesson_ids)}")


def _cmd_chain(ledger: Ledger, args) -> None:
    chain = ledger.reasoning_chain(args.decision_id, version=args.version)
    ver = args.version if args.version is not None else "当前"
    print(f"决策 {args.decision_id} 第 {ver} 版结论的推导依据链：")
    print(_line())
    for item in chain:
        kind = "依据" if item["kind"] == BASIS else "结果"
        mark = " " if item["in_version_snapshot"] else "✗"  # 晚于该版本的证据
        print(f" {mark}[{item['evidence_id']}] {kind} {item['stance_cn']} "
              f"权重={item['weight']:g} 贡献={item['contributes_score']:g} "
              f"来源={item['source']} 时刻={item['observed_at']}")
        if item["content"]:
            print(f"      {item['content']}")
        if item["outcome_id"]:
            print(f"      → 结果 {item['outcome_id']}")


def _cmd_trajectory(ledger: Ledger, args) -> None:
    entries = ledger.conclusion_trajectory(args.decision_id)
    print(f"决策 {args.decision_id} 结论变化轨迹：")
    prev = None
    for c in entries:
        if prev is None:
            print(f"  v{c.version} {c.changed_at} {c.verdict}（初始）")
        elif c.triggering_outcome_id:
            print(f"  v{c.version} {c.changed_at} {prev.verdict} → {c.verdict}，"
                  f"由结果 {c.triggering_outcome_id} 触发")
        else:
            print(f"  v{c.version} {c.changed_at} {prev.verdict} → {c.verdict}，"
                  f"决策作出时基于既有依据形成初判")
        prev = c


def _cmd_conflicts(ledger: Ledger, args) -> None:
    records = ledger.list_conflicts(args.decision_id)
    if not records:
        print("（没有冲突记录）")
        return
    for r in records:
        print(f"[{r.conflict_id}] 决策 {r.decision_id} 结果 {r.outcome_id} "
              f"vs 依据 {r.basis_evidence_id}")
        print(f"    结果证据：{r.result_evidence_id}")
        print(f"    分歧点：{r.point}")
        print(f"    记录时刻：{r.created_at}")
        print(_line("·"))


def _cmd_lessons(ledger: Ledger, args) -> None:
    lessons = ledger.list_lessons()
    if not lessons:
        print("（尚无经验）")
        return
    for l in lessons:
        print(f"[{l.lesson_id}] {l.title}（源自 {l.source_decision_id} "
              f"第 {l.conclusion_version} 版结论：{l.verdict}）")
        print(f"    {l.content}")
        print(f"    支撑证据：{', '.join(l.evidence_ids) or '（无）'}")
        print(f"    支撑结果：{', '.join(l.outcome_ids) or '（无）'}")
        print(f"    被引用：{', '.join(l.cited_by) or '（无）'}")


def _cmd_lesson_refs(ledger: Ledger, args) -> None:
    info = ledger.lesson_references(args.lesson_id)
    print(f"经验 {info['lesson_id']}（源自决策 {info['source_decision_id']}）"
          f"被以下决策引用：")
    for did in info["cited_by"]:
        print(f"  - {did}")
    if not info["cited_by"]:
        print("  （暂无决策引用）")


# ---------------------------------------------------------------------- #
# 变更类命令
# ---------------------------------------------------------------------- #

def _cmd_add_decision(ledger: Ledger, args) -> None:
    d = ledger.create_decision(topic=args.topic, created_at=args.at)
    print(f"已新建决策 {d.decision_id}：{d.topic}（状态：{d.state}，"
          f"初始结论 v0=待定）")


def _cmd_choose(ledger: Ledger, args) -> None:
    d = ledger.mark_chosen(args.decision_id, option=args.option, chosen_at=args.at)
    print(f"决策 {d.decision_id} 状态：待定 → 已选择；所选方案：{d.chosen_option}")


def _cmd_review(ledger: Ledger, args) -> None:
    d = ledger.mark_reviewed(args.decision_id, reviewed_at=args.at)
    print(f"决策 {d.decision_id} 状态：已选择 → 已复盘（{d.reviewed_at}）")


def _cmd_add_basis(ledger: Ledger, args) -> None:
    e = ledger.add_basis(
        decision_id=args.decision_id,
        source=args.source,
        weight=args.weight,
        stance=args.stance,
        content=args.content or "",
        evidence_id=args.id,
        observed_at=args.at,
    )
    print(f"已为决策 {args.decision_id} 录入依据 {e.evidence_id}："
          f"{'支持' if e.stance == SUPPORTS else '反对'}，权重 {e.weight:g}，"
          f"来源 {e.source}")


def _cmd_outcome(ledger: Ledger, args) -> None:
    outcome, conflicts, new_entry = ledger.record_outcome(
        decision_id=args.decision_id,
        basis_id=args.basis,
        observed_value=args.value,
        stance=args.stance,
        weight=args.weight,
        source=args.source,
        occurred_at=args.at,
    )
    print(f"已登记结果 {outcome.outcome_id}（结果证据 {outcome.evidence_id}），"
          f"回填到决策 {outcome.decision_id}")
    print(f"  发生时刻：{outcome.occurred_at}    观测值：{outcome.observed_value}")
    if conflicts:
        print(f"  ⚠ 检测到 {len(conflicts)} 条矛盾，已保留双方并记录：")
        for c in conflicts:
            print(f"    - {c.conflict_id}：{c.point}")
    else:
        print("  未检测到与既有依据的矛盾。")
    if new_entry is not None:
        prev = ledger.conclusion_trajectory(args.decision_id)[-2]
        print(f"  结论发生变化：v{prev.version}「{prev.verdict}」"
              f"→ v{new_entry.version}「{new_entry.verdict}」"
              f"（支持分 {new_entry.score_supports:g} / "
              f"反对分 {new_entry.score_contradicts:g}）")
    else:
        cur = ledger.current_conclusion(args.decision_id)
        print(f"  当前结论仍为「{cur.verdict}」，轨迹不变。")


def _cmd_crystallize(ledger: Ledger, args) -> None:
    lesson = ledger.crystallize_lesson(
        decision_id=args.decision_id,
        title=args.title,
        content=args.content,
        version=args.version,
    )
    print(f"已固化经验 {lesson.lesson_id}：{lesson.title}")
    print(f"  源自决策 {lesson.source_decision_id} 第 {lesson.conclusion_version} "
          f"版结论（{lesson.verdict}）")
    print(f"  支撑证据：{', '.join(lesson.evidence_ids) or '（无）'}")
    print(f"  支撑结果：{', '.join(lesson.outcome_ids) or '（无）'}")


def _cmd_cite(ledger: Ledger, args) -> None:
    ledger.cite_lesson(args.decision_id, args.lesson)
    print(f"决策 {args.decision_id} 已引用经验 {args.lesson}")


# ---------------------------------------------------------------------- #
# argparse 装配
# ---------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="decision_ledger",
        description="离线决策台账：决策 / 依据 / 结果 / 结论轨迹 / 冲突 / 经验",
    )
    parser.add_argument("--file", default=DEFAULT_FILE,
                        help=f"台账 JSON 文件路径（默认 {DEFAULT_FILE}）")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("list", help="列出全部决策")
    p.set_defaults(func=_cmd_list, mutates=False)

    p = sub.add_parser("show", help="查看决策全貌")
    p.add_argument("decision_id")
    p.add_argument("-v", "--verbose", action="store_true", help="显示轨迹备注")
    p.set_defaults(func=_cmd_show, mutates=False)

    p = sub.add_parser("add-decision", help="新建决策（状态：待定）")
    p.add_argument("--topic", required=True, help="决策主题")
    p.add_argument("--at", help="发生时刻（ISO，默认现在）")
    p.set_defaults(func=_cmd_add_decision, mutates=True)

    p = sub.add_parser("choose", help="待定 → 已选择")
    p.add_argument("decision_id")
    p.add_argument("--option", required=True, help="所选方案")
    p.add_argument("--at", help="选择时刻（ISO，默认现在）")
    p.set_defaults(func=_cmd_choose, mutates=True)

    p = sub.add_parser("review", help="已选择 → 已复盘")
    p.add_argument("decision_id")
    p.add_argument("--at", help="复盘时刻（ISO，默认现在）")
    p.set_defaults(func=_cmd_review, mutates=True)

    p = sub.add_parser("add-basis", help="在待定阶段录入一条依据")
    p.add_argument("decision_id")
    p.add_argument("--source", required=True, help="来源说明（必填）")
    p.add_argument("--weight", required=True, type=float, help="可信度权重（正数）")
    p.add_argument("--stance", required=True,
                   help="立场：supports(支持) / contradicts(反对)")
    p.add_argument("--content", default="", help="依据内容描述")
    p.add_argument("--id", dest="id", help="自定义依据标识（同决策内唯一）")
    p.add_argument("--at", help="获取时刻（ISO，默认现在）")
    p.set_defaults(func=_cmd_add_basis, mutates=True)

    p = sub.add_parser("outcome", help="登记实际结果（可迟到回填）")
    p.add_argument("decision_id")
    p.add_argument("--basis", required=True, help="结果对应的依据标识")
    p.add_argument("--value", required=True, help="观测值")
    p.add_argument("--stance", required=True, help="supports(支持) / contradicts(反对)")
    p.add_argument("--weight", required=True, type=float, help="结果可信度权重（正数）")
    p.add_argument("--source", required=True, help="观测来源（必填）")
    p.add_argument("--at", required=True, help="结果发生时刻（ISO，必填，可晚于决策）")
    p.set_defaults(func=_cmd_outcome, mutates=True)

    p = sub.add_parser("chain", help="查看推导依据链")
    p.add_argument("decision_id")
    p.add_argument("--version", type=int, help="指定结论版本（默认当前版）")
    p.set_defaults(func=_cmd_chain, mutates=False)

    p = sub.add_parser("trajectory", help="查看结论变化轨迹")
    p.add_argument("decision_id")
    p.set_defaults(func=_cmd_trajectory, mutates=False)

    p = sub.add_parser("conflicts", help="查看冲突记录")
    p.add_argument("decision_id", nargs="?", help="可限定某条决策")
    p.set_defaults(func=_cmd_conflicts, mutates=False)

    p = sub.add_parser("lesson", help="把某次结论固化为经验")
    p.add_argument("decision_id")
    p.add_argument("--title", required=True)
    p.add_argument("--content", required=True)
    p.add_argument("--version", type=int, help="指定固化自第几版结论（默认当前版）")
    p.set_defaults(func=_cmd_crystallize, mutates=True)

    p = sub.add_parser("cite", help="决策引用经验")
    p.add_argument("decision_id")
    p.add_argument("--lesson", required=True, help="被引用的经验标识")
    p.set_defaults(func=_cmd_cite, mutates=True)

    p = sub.add_parser("lessons", help="列出全部经验")
    p.set_defaults(func=_cmd_lessons, mutates=False)

    p = sub.add_parser("lesson-refs", help="查看经验被哪些决策引用")
    p.add_argument("lesson_id")
    p.set_defaults(func=_cmd_lesson_refs, mutates=False)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    path = Path(args.file)
    ledger = store.load_or_create(path)
    try:
        args.func(ledger, args)
    except LedgerError as exc:
        print(f"操作被拒绝：{exc}", file=sys.stderr)
        return 1
    if getattr(args, "mutates", False):
        store.save(ledger, path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
