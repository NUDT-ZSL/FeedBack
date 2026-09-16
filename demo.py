"""离线演示：用代码走查需求 1-7 的全部能力。

运行：python demo.py
不依赖任何第三方库、不访问网络。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from decimal import Decimal

# Windows 控制台默认 GBK，统一切到 UTF-8，保证中文与符号可显示
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

from fund_allocator import (
    Engine,
    Project,
    Registry,
    persistence,
)
from fund_allocator.errors import DependencyError, PersistenceError, ValidationError

D = Decimal
LINE = "=" * 64


def show(title: str) -> None:
    print(f"\n{LINE}\n{title}\n{LINE}")


def main() -> None:
    # ---------- 需求 1：维护候选项目（含阶段守恒校验） ----------
    show("需求 1：项目维护与非法配置拒绝")
    reg = Registry()
    reg.add_project(Project.create(
        "CORE", 1, total_need="300.00", min_start="120.00",
        phases=["120.00", "100.00", "80.00"], benefit="600"))
    reg.add_project(Project.create(
        "APP", 2, "400.00", "150.00", ["150.00", "250.00"], benefit="800"))
    reg.add_project(Project.create(
        "DATA", 2, "250.00", "100.00", ["100.00", "150.00"], benefit="750"))
    reg.add_project(Project.create(
        "PORTAL", 3, "200.00", "80.00", ["80.00", "120.00"], benefit="200"))
    print(f"已登记 {len(reg)} 个项目: {reg.project_ids()}")

    try:
        Project.create("BAD", 1, "100.00", "40.00", ["30.00", "60.00"])
    except ValidationError as exc:
        print(f"非法配置被拒绝 -> {exc}")

    # ---------- 需求 2：依赖、悬空与环检测 ----------
    show("需求 2：前置依赖（悬空引用 / 成环都带链条拒绝）")
    reg.add_dependency("APP", "CORE")      # APP 依赖 CORE
    reg.add_dependency("PORTAL", "APP")    # PORTAL 依赖 APP
    reg.add_dependency("PORTAL", "DATA")   # PORTAL 依赖 DATA
    print("PORTAL 的直接前置:", reg.prerequisites("PORTAL"))
    print("CORE 的全部下游:", reg.all_dependents("CORE"))

    try:
        reg.add_dependency("CORE", "PORTAL")  # 将形成 CORE->PORTAL->...->CORE
    except DependencyError as exc:
        print(f"环被拒绝 -> {exc}")
    try:
        reg.add_dependency("APP", "GHOST")
    except DependencyError as exc:
        print(f"悬空引用被拒绝 -> {exc}")

    # ---------- 需求 3 + 4：资金上限下求解 ----------
    show("需求 3+4：预算 900 下的可复现分配方案")
    eng = Engine(reg)
    plan = eng.solve("900.00")
    summary = eng.query_plan()
    print(f"总额 {summary['total_allocated']} / 上限 {summary['budget']}，"
          f"剩余 {summary['remaining']}")
    print("已启动:", summary["started"])
    for row in summary["funded"]:
        p = reg.get(row["id"])
        print(f"  {row['id']:7s} 已批 {row['amount']:>7} / 总需求 {p.total_need:>7}"
              f"  (优先级 {p.priority}, ROI {p.benefit / p.total_need})")
    print("各阶段占用:", [(r["phase"], str(r["amount"])) for r in summary["phase_usage"]])
    print("未满足项:", [(r["id"], str(r["gap"]), f"启动={r['started']}")
                        for r in summary["unmet"]])

    # 可复现：同输入再跑一次必须逐项目相同
    again = Engine(reg.clone()).solve("900.00")
    assert dict(again.allocations) == dict(plan.allocations)
    print("可复现性校验: 同一输入重复求解结果完全一致 ✓")

    # ---------- 需求 5：削减 CORE，只重算下游 ----------
    show("需求 5：CORE 被取消，只重算其下游（APP/PORTAL），无关项目不动")
    before = dict(plan.allocations)
    new_plan, affected = eng.reduce("CORE", "0", _check_equivalence=True)
    print("受影响区域:", affected)
    for pid in reg.project_ids():
        old, new = before.get(pid, D("0")), new_plan.amount_for(pid)
        tag = "  <-- 重算" if pid in affected else "  (未受影响，保持不变)"
        print(f"  {pid:7s} {old:>7} -> {new:>7}{tag}")
    print("内置一致性校验: 增量结果 == 同约束从头全量求解 ✓")

    # ---------- 需求 6：查询 ----------
    show("需求 6：单项目与方案查询（稳定顺序）")
    # 重新解一份用于查询展示
    eng = Engine(reg.clone())
    eng.solve("900.00")
    rep = eng.query_project("CORE")
    print(f"CORE: 已批 {rep['funded']}, 缺口 {rep['gap']}, "
          f"启动={rep['started']}, 被 {rep['dependents']} 依赖")
    s = eng.query_plan()
    print(f"方案总额 {s['total_allocated']}；未满足项按字典序: "
          f"{[r['id'] for r in s['unmet']]}")

    # ---------- 需求 7：保存 / 载入 / 损坏报错 / 状态不变 ----------
    show("需求 7：文件保存与重新载入（原子写、全量校验、失败状态不变）")
    tmpdir = tempfile.mkdtemp(prefix="fundplan-demo-")
    path = os.path.join(tmpdir, "annual_plan.json")
    persistence.save_to(path, eng)
    print(f"已保存: {path}")

    loaded = persistence.load_new(path)
    assert dict(loaded.plan.allocations) == dict(eng.plan.allocations)
    print("重新载入后方案逐项目一致 ✓")

    # 损坏文件：篡改阶段之和
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["projects"][0]["phases"] = ["1.00", "1.00"]
    bad_path = os.path.join(tmpdir, "corrupt.json")
    with open(bad_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    try:
        persistence.load_new(bad_path)
    except PersistenceError as exc:
        print(f"损坏文件被拒绝 -> {exc}")

    # 失败后状态不变：载入损坏文件不影响现有 engine
    before_alloc = dict(eng.plan.allocations)
    try:
        persistence.load_into(bad_path, eng)
    except PersistenceError:
        pass
    assert dict(eng.plan.allocations) == before_alloc
    print("载入失败后引擎原有方案保持不变 ✓")

    show("全部演示完成")


if __name__ == "__main__":
    main()
