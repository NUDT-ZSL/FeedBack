#!/usr/bin/env python3
"""端到端剧情演示：用一个真实感的个人决策故事走完全部七条需求。

运行：
    python demo.py

脚本不仅打印过程，还在关键节点用断言自检；任何一步不符合预期都会
以非零退出码失败，可直接当作离线验收的一部分。
结束后台账保存在 demo_ledger.json，可用 CLI 继续翻看，例如：

    python -m decision_ledger --file demo_ledger.json show D-0001
    python -m decision_ledger --file demo_ledger.json conflicts
    python -m decision_ledger --file demo_ledger.json lesson-refs L-0001
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from decision_ledger import Ledger, store  # noqa: E402
from decision_ledger.errors import LedgerError  # noqa: E402

LEDGER_FILE = Path(__file__).resolve().parent / "demo_ledger.json"

# 台账内部的登记时间不参与剧情，固定一个时钟即可；剧情时间全部显式传入。
ledger = Ledger(clock=lambda: "2027-02-01T10:00:00")


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def check(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(f"剧情自检失败：{message}")
    print(f"  ✓ {message}")


def main() -> int:
    # ------------------------------------------------------------------
    section("剧情：2026 年初，是否接下一家创业公司的 offer")
    # ------------------------------------------------------------------
    d = ledger.create_decision("是否加入创业公司甲",
                               created_at="2026-01-20T09:00:00")
    print(f"  建立决策 {d.decision_id}，状态={d.state}，初始结论 v0=待定")

    b1 = ledger.add_basis(
        d.decision_id, source="offer 说明会", weight=4, stance="supports",
        content="CTO 口头承诺可观期权，预计两年内 IPO",
        observed_at="2026-01-18T15:00:00").evidence_id
    b2 = ledger.add_basis(
        d.decision_id, source="朋友 A（在职员工）", weight=2, stance="supports",
        content="团队技术氛围好，能学到东西",
        observed_at="2026-01-19T20:00:00").evidence_id
    b3 = ledger.add_basis(
        d.decision_id, source="家庭沟通", weight=3, stance="contradicts",
        content="伴侣希望稳定；创业公司现金流风险高",
        observed_at="2026-01-19T21:00:00").evidence_id
    print(f"  录入三条依据：{b1}(支持,4)、{b2}(支持,2)、{b3}(反对,3)")

    # 非法输入演示（捕获后继续）
    try:
        ledger.add_basis(d.decision_id, source="  ", weight=2, stance="supports")
    except LedgerError as exc:
        print(f"  系统拒绝缺来源的依据：{exc}")
    try:
        ledger.add_basis(d.decision_id, source="某来源", weight=-1, stance="supports")
    except LedgerError as exc:
        print(f"  系统拒绝负权重依据：{exc}")

    # 非法状态流转：待定不能直接复盘
    try:
        ledger.mark_reviewed(d.decision_id)
    except LedgerError as exc:
        print(f"  系统拒绝越级流转：{exc}")

    # ------------------------------------------------------------------
    section("2026-02-01 作出选择")
    # ------------------------------------------------------------------
    ledger.mark_chosen(d.decision_id, option="加入创业公司甲",
                       chosen_at="2026-02-01T10:00:00")
    cur = ledger.current_conclusion(d.decision_id)
    print(f"  状态=已选择；基于决策前依据形成初判：{cur.verdict} "
          f"（支持分 {cur.score_supports:g} / 反对分 {cur.score_contradicts:g}）")
    check(cur.verdict == "成立", "支持 6 > 反对 3，初判为「成立」")

    # ------------------------------------------------------------------
    section("结果陆续到达（1）：2026-05 试用期通过 —— 同向，不产生新版本")
    # ------------------------------------------------------------------
    o1, conflicts1, flip1 = ledger.record_outcome(
        d.decision_id, basis_id=b2,
        observed_value="试用期通过，薪资正常发放，团队氛围确实好",
        stance="supports", weight=2, source="试用期考评",
        occurred_at="2026-05-10T18:00:00")
    print(f"  结果 {o1.outcome_id} 回填到决策；冲突 {len(conflicts1)} 条；"
          f"结论版本新增：{flip1 is not None}")
    for c in conflicts1:
        print(f"    ⚠ [{c.conflict_id}] {c.point}")
    check(len(conflicts1) == 1 and flip1 is None,
          "正向结果与风险依据 b3 立场对立→记录 1 条冲突；支持 8 仍大于反对 3，结论不翻")

    # ------------------------------------------------------------------
    section("结果陆续到达（2）：2026-09 融资不顺，期权承诺缩水 —— 矛盾出现")
    # ------------------------------------------------------------------
    ledger.mark_reviewed(d.decision_id, reviewed_at="2026-09-30T17:00:00")
    o2, conflicts2, flip2 = ledger.record_outcome(
        d.decision_id, basis_id=b1,
        observed_value="新一轮融资估值砍半，口头承诺的期权缩水 60%",
        stance="contradicts", weight=4, source="公司全员信+工商变更",
        occurred_at="2026-09-20T19:00:00")
    print(f"  决策已复盘；结果 {o2.outcome_id} 仍成功回填")
    check(len(conflicts2) == 2, "缩水结果与两条看好依据分别形成冲突，双方均保留")
    for c in conflicts2:
        print(f"    ⚠ [{c.conflict_id}] {c.point}")
    cur = ledger.current_conclusion(d.decision_id)
    check(cur.verdict == "成立", f"支持 8 仍大于反对 7，结论保持「{cur.verdict}」")

    # ------------------------------------------------------------------
    section("结果陆续到达（3）：2027-01 迟到四个月的坏消息 —— 结论翻转")
    # ------------------------------------------------------------------
    o3, conflicts3, flip3 = ledger.record_outcome(
        d.decision_id, basis_id=b3,
        observed_value="所在产品线被整体砍掉，本人被裁，N+1 赔偿分期支付",
        stance="contradicts", weight=5, source="离职协议+同事佐证",
        occurred_at="2027-01-25T16:00:00")
    print(f"  迟到结果 {o3.outcome_id}（发生于复盘之后）回填成功")
    check(flip3 is not None and flip3.verdict == "不成立",
          "反对分反超，结论翻转为「不成立」并留下新版本")

    section("结论变化轨迹（需求 4：每次变化都记录触发结果与前后结论）")
    prev_verdict = None
    for e in ledger.conclusion_trajectory(d.decision_id):
        if prev_verdict is None:
            print(f"  v{e.version}  {e.changed_at}  {e.verdict}（初始）")
        else:
            trigger = e.triggering_outcome_id or "决策作出时的依据初判"
            print(f"  v{e.version}  {e.changed_at}  {prev_verdict} → {e.verdict}"
                  f"  （触发：{trigger}）")
        prev_verdict = e.verdict
    check([e.verdict for e in ledger.conclusion_trajectory(d.decision_id)]
          == ["待定", "成立", "不成立"], "轨迹为 待定 → 成立 → 不成立")

    # ------------------------------------------------------------------
    section("回看：推导依据链与冲突记录（需求 5、7）")
    # ------------------------------------------------------------------
    print("  当前结论的推导依据链（依据在前按标识、结果在后按发生时刻）：")
    for item in ledger.reasoning_chain(d.decision_id):
        kind = "依据" if item["kind"] == "basis" else "结果"
        ref = f"→{item['outcome_id']}" if item["outcome_id"] else ""
        print(f"    [{item['evidence_id']}] {kind} {item['stance_cn']} "
              f"权重={item['weight']:g} 来源={item['source']} {ref}")
        print(f"        {item['content']}")

    all_conflicts = ledger.list_conflicts(d.decision_id)
    check(len(all_conflicts) == 5,
          f"共保留 {len(all_conflicts)} 条冲突记录（o1×1、o2×2、o3×2），旧依据从未被静默覆盖")
    # 旧依据原样还在
    still = ledger.get_decision(d.decision_id).evidences[b1]
    check("口头承诺" in still.content, "被结果打脸的依据 B01 原文仍在")

    # ------------------------------------------------------------------
    section("固化经验（需求 6）")
    # ------------------------------------------------------------------
    lesson = ledger.crystallize_lesson(
        d.decision_id,
        title="口头期权承诺按零计入决策",
        content="未写入合同的期权承诺不能作为高权重支持依据；现金流与岗位安全"
                "权重要足以抵消期权幻想。家庭稳定偏好的权重不应被低估。")
    print(f"  经验 {lesson.lesson_id} 固化自第 {lesson.conclusion_version} 版"
          f"结论（{lesson.verdict}）")
    print(f"    支撑依据：{', '.join(lesson.evidence_ids)}")
    print(f"    支撑结果：{', '.join(lesson.outcome_ids)}")
    check(lesson.evidence_ids == [b3], "只有获胜侧（反对）依据进入支撑链")
    check(lesson.outcome_ids == [o2.outcome_id, o3.outcome_id],
          "两个负面结果作为支撑结果一并固化")

    # ------------------------------------------------------------------
    section("新决策引用经验（需求 6、7）")
    # ------------------------------------------------------------------
    d2 = ledger.create_decision("是否加入创业公司乙",
                                created_at="2027-03-01T09:00:00")
    ledger.cite_lesson(d2.decision_id, lesson.lesson_id)
    print(f"  新决策 {d2.decision_id} 引用了 {lesson.lesson_id}")
    try:
        ledger.cite_lesson(d2.decision_id, "L-9999")
    except LedgerError as exc:
        print(f"  引用不存在的经验被拒绝：{exc}")

    refs = ledger.lesson_references(lesson.lesson_id)
    print(f"  经验 {lesson.lesson_id} 被引用情况：{refs['cited_by']}")
    check(refs["cited_by"] == [d2.decision_id], "反向引用链稳定、按序返回")

    # ------------------------------------------------------------------
    section("落盘并重新加载，验证离线持久化")
    # ------------------------------------------------------------------
    store.save(ledger, LEDGER_FILE)
    reloaded = store.load(LEDGER_FILE)
    check(reloaded.current_conclusion(d.decision_id).verdict == "不成立",
          "重载后当前结论不变")
    check(len(reloaded.list_conflicts()) == 5, "重载后冲突记录完整")
    check(reloaded.lesson_references(lesson.lesson_id)["cited_by"]
          == [d2.decision_id], "重载后经验引用链完整")
    print(f"\n台账已保存到：{LEDGER_FILE}")
    print("可用以下命令继续翻看：")
    print(f"  python -m decision_ledger --file {LEDGER_FILE.name} show D-0001")
    print(f"  python -m decision_ledger --file {LEDGER_FILE.name} trajectory D-0001")
    print(f"  python -m decision_ledger --file {LEDGER_FILE.name} conflicts")
    print(f"  python -m decision_ledger --file {LEDGER_FILE.name} lesson-refs L-0001")
    print("\n全部剧情自检通过 ✅")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
