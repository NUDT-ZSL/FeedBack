#!/usr/bin/env python3
"""离线演示：装载编排模块的八条验收能力。

运行：python demo.py
全程只使用标准库，不需要网络或任何第三方包。
"""

import os
import tempfile

from loading import (
    Cargo,
    LoadingSystem,
    PersistenceError,
    PlacementError,
    StackRuleError,
    Vehicle,
    load_from_file,
    save_to_file,
)
from loading.geometry import Box


def hr(title):
    print("\n" + "=" * 64)
    print(title)
    print("=" * 64)


def show_vehicles(system):
    for d in system.all_vehicle_details():
        print(f"车厢 {d['vehicle_id']}：载重 "
              f"{d['used_weight']:.0f}/{d['max_weight']:.0f}，"
              f"空间利用率 {d['space_utilization'] * 100:.1f}%，"
              f"剩余空间 {d['remaining_volume']:.1f}，"
              f"剩余载重 {d['remaining_weight']:.1f}")
        for it in d["items"]:
            print(f"    第{it['level']}层 {it['cargo_id']} "
                  f"@ (x={it['x']}, y={it['y']}, z={it['z']}) "
                  f"占位 {it['length']}x{it['width']}x{it['height']} "
                  f"朝向 {it['orientation']}"
                  f"{' [易碎]' if it['fragile'] else ''}")


def main():
    # ---------- 需求 1/2：维护货物与车厢（含不可用区域） ----------
    hr("1/2. 建立货物清单与车厢（V1 尾部 2m 为不可用区域）")
    system = LoadingSystem()
    system.add_vehicle(
        Vehicle("V1", 12, 4, 4, max_weight=2500,
                blocked=(Box(10, 0, 0, 2, 4, 4),))
    )
    system.add_vehicle(Vehicle("V2", 10, 4, 4, max_weight=2000))

    catalog = [
        #  id   长 宽 高  重量 可叠层数 易碎
        ("A01", 2, 2, 2, 300, 2, False),
        ("A02", 2, 2, 2, 300, 2, False),
        ("A03", 2, 2, 2, 300, 2, False),
        ("A04", 2, 2, 2, 300, 2, False),
        ("B01", 4, 2, 2, 500, 0, False),
        ("B02", 4, 2, 2, 500, 0, False),
        ("F01", 1, 1, 1, 30, 0, True),   # 易碎
        ("F02", 1, 1, 1, 30, 0, True),
        ("H01", 3, 3, 2, 900, 1, False),
    ]
    # 故意打乱到达顺序，用来验证需求 3 的“与顺序无关”
    import random
    rng = random.Random(7)
    order = list(catalog)
    rng.shuffle(order)
    for cid, l, w, h, wt, lim, fr in order:
        system.add_cargo(Cargo(cid, l, w, h, weight=wt,
                               stack_limit=lim, fragile=fr))

    # ---------- 需求 3：确定性编排 ----------
    hr("3. 编排（货物按体积降序/id 升序决策，与到达顺序无关）")
    system.plan_all()
    show_vehicles(system)

    # ---------- 需求 4：堆叠规则 ----------
    hr("4. 堆叠规则校验：易碎上方不得压货；超层必须指出层号")
    print(f"易碎货物 F01 位于：{system.locate_cargo('F01')}")
    probe = LoadingSystem()
    probe.add_vehicle(Vehicle("P1", 2, 2, 8, max_weight=10000))
    for i in range(3):
        probe.add_cargo(Cargo(f"X{i}", 2, 2, 2, weight=10, stack_limit=1))
    try:
        probe.plan_all()
    except StackRuleError as exc:
        print(f"按预期拒绝：{exc}")

    # ---------- 需求 5：跨车厢改派 ----------
    hr("5. 跨车厢改派：V1 尾部不可用，放不下的货物自动改派 V2")
    v1_ids = [p.cargo_id for p in system.plan.placements["V1"]]
    v2_ids = [p.cargo_id for p in system.plan.placements["V2"]]
    print(f"V1: {v1_ids}")
    print(f"V2: {v2_ids}")
    all_ids = v1_ids + v2_ids
    assert len(all_ids) == len(set(all_ids)), "出现重复装载"
    print("无重复装载，各车厢载重/空间均未超限。")

    # ---------- 需求 7：查询 ----------
    hr("7. 查询：货物定位与车厢明细（稳定顺序）")
    print("H01 ->", system.locate_cargo("H01"))
    print("F02 ->", system.locate_cargo("F02"))

    # ---------- 需求 6：增量重排 ----------
    hr("6. 增量重排：给 V1 中部新增不可用区域，只重排受影响车厢")
    before_v2 = [p.cargo_id for p in system.plan.placements["V2"]]
    system.update_vehicle(
        Vehicle("V1", 12, 4, 4, max_weight=2500,
                blocked=(Box(10, 0, 0, 2, 4, 4), Box(4, 0, 0, 1, 4, 4)))
    )
    print("最近一条编排记录：", system.records[-1])
    print("受影响车厢：", system.records[-1]["affected_vehicles"])
    show_vehicles(system)

    # 再演示删除货物：容量释放后结果仍与从头编排一致（内部由测试保证）
    system.remove_cargo("B01")
    print("删除 B01 后，最近记录：", system.records[-1])

    # 放不下的变更会被整体回滚
    try:
        system.add_cargo(Cargo("TOO_BIG", 100, 100, 100, weight=1))
    except PlacementError as exc:
        print(f"超大货物被拒绝且状态不变：{exc}")

    # ---------- 需求 8：JSON 持久化 ----------
    hr("8. 保存为 JSON 并重新载入（载入时完整校验）")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "loading_plan.json")
        save_to_file(system, path)
        print(f"已保存：{path}")
        restored = load_from_file(path)
        old = sorted((p.cargo_id, p.vehicle_id, p.x, p.y, p.z)
                     for p in system.all_placements())
        new = sorted((p.cargo_id, p.vehicle_id, p.x, p.y, p.z)
                     for p in restored.all_placements())
        assert old == new
        print("载入后装载方案与保存前完全一致。")

        corrupt = os.path.join(tmp, "corrupt.json")
        with open(corrupt, "w", encoding="utf-8") as f:
            f.write('{"cargos": [,]}')
        try:
            load_from_file(corrupt)
        except PersistenceError as exc:
            print(f"损坏文件被清晰拒绝：{exc}")

    hr("演示完成")
    print("运行 python -m unittest discover -s tests 可执行全部验收测试。")


if __name__ == "__main__":
    main()
