"""端到端演示：同一批素材单元为不同叙事目标组合故事线。

离线运行：python demo.py
"""

from story_composer import (
    Composer,
    MaterialUnit,
    NarrativeGoal,
    Slot,
)
from story_composer.errors import (
    CyclicDependencyError,
    DanglingReferenceError,
    SlotFillError,
)


def line(title):
    print(f"\n=== {title} ===")


def main():
    c = Composer()

    # 1) 素材单元：唯一 id / 类型 / 正文 / 版本 / 前置依赖 / 替代版本组
    c.register_unit(MaterialUnit("cold-open", "scene", "冷开场：雪山醒来"))
    c.register_unit(MaterialUnit(
        "chase-v1", "scene", "追逐：街市（初剪）",
        version=1, prerequisites=frozenset({"cold-open"}), group="chase"))
    c.register_unit(MaterialUnit(
        "chase-v2", "scene", "追逐：屋顶（重剪，更紧凑）",
        version=2, prerequisites=frozenset({"cold-open"}), group="chase"))
    c.register_unit(MaterialUnit(
        "reveal", "scene", "反转：向导就是内鬼",
        prerequisites=frozenset({"chase-v1"})))

    # 悬空引用 / 成环会被拒绝并定位
    line("非法配置被拒绝")
    try:
        c.register_unit(MaterialUnit(
            "bad", "scene", "x", prerequisites=frozenset({"not-exist"})))
    except DanglingReferenceError as e:
        print("悬空引用 ->", e)
    try:
        c.update_unit(MaterialUnit(
            "cold-open", "scene", "冷开场",
            prerequisites=frozenset({"reveal"})))
    except CyclicDependencyError as e:
        print("依赖成环 ->", e)

    # 2) 叙事目标：受众取向 + 有序槽位
    c.register_goal(NarrativeGoal(
        "theatrical", "院线新观众",
        [Slot("act1", "scene"), Slot("act2", "scene"),
         Slot("tag", "scene", required=False)],
    ))
    c.register_goal(NarrativeGoal(
        "streaming", "流媒体老观众",
        [Slot("part1", "scene"), Slot("part2", "scene")],
    ))

    # 3) 填槽：类型匹配 + 前置依赖必须在更早槽位
    line("填入素材（含依赖校验）")
    c.fill_slot("theatrical", "act1", "cold-open", source="editor")
    c.fill_slot("theatrical", "act2", "chase-v1", source="editor")
    # 另一来源给同槽位一个同组新版本 -> 按版本规则确定性地选 v2，不算冲突
    c.fill_slot("theatrical", "act2", "chase-v2", source="reviewer")
    c.fill_slot("theatrical", "tag", "reveal", source="editor")
    try:
        c.fill_slot("streaming", "part2", "reveal", source="editor")
    except SlotFillError as e:
        print("依赖未满足 ->", e)
    c.auto_fill("streaming")

    # 4) 当前素材序列 + 每槽位来源/版本
    for g in ("theatrical", "streaming"):
        seq = c.get_sequence(g)
        print(f"\n故事线 {g}（受众：{seq.audience}）")
        for e in seq.entries:
            print(f"  [{e.position}] {e.slot_id} <- "
                  f"{e.unit_id} v{e.version} 来源={list(e.sources)}")

    # 5) 增量重算：只改一处，只有引用它的目标重算，且与从头结果一致
    line("增量重算")
    c.reset_recompose_log()
    c.update_unit(MaterialUnit(
        "chase-v2", "scene", "追逐：屋顶（终剪，补一个镜头）",
        version=2, prerequisites=frozenset({"cold-open"}), group="chase"))
    c.get_sequence("theatrical")
    c.get_sequence("streaming")
    print("实际重算的目标：", c.recompose_log)

    # 6) 跨来源矛盾 -> 双方保留 + 可读冲突记录，不静默择一
    line("跨来源矛盾")
    c.register_unit(MaterialUnit("alt-ending", "scene", "另一个结局：和解"))
    c.fill_slot("theatrical", "tag", "alt-ending", source="producer")
    for rec in c.conflicts():
        print(rec.render())

    # 7) 反向查询：素材被哪些目标引用
    line("引用关系")
    for uid, goals in c.referenced_units():
        print(f"  {uid} <- {goals}")


if __name__ == "__main__":
    main()
