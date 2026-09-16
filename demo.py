"""端到端验收演示：覆盖需求 1–8。

运行：``python demo.py``（在 workspace 根目录）。脚本不依赖任何第三方库，
会在 ``./out/`` 下写出快照文件 ``settlement_snapshot.json``。
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

# 允许直接 `python demo.py` 从根目录运行。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from settlement import (  # noqa: E402
    CouponSpec,
    OrderLine,
    SettlementEngine,
    ValidationError,
    dump_snapshot,
    explain,
    load_snapshot,
)
from settlement.persistence import load_into  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"
SNAPSHOT = OUT_DIR / "settlement_snapshot.json"


def hr(title: str) -> None:
    print("\n" + "=" * 20 + f" {title} " + "=" * 20)


def show_invalid(desc: str, fn) -> None:
    try:
        fn()
    except ValidationError as exc:
        print(f"  [拒绝] {desc} -> {exc}")
    else:
        print(f"  [异常] {desc} 竟然没有被拒绝！")


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    eng = SettlementEngine()

    # ---- 需求 1：券维护与非法配置拒绝 -------------------------------
    hr("需求1 券配置校验（非法须拒绝并指出位置）")
    show_invalid("额度为 0", lambda: CouponSpec.build("C-BAD", 100, 0))
    show_invalid("门槛为负", lambda: CouponSpec.build("C-BAD", -1, 10))
    show_invalid("金额三位小数", lambda: CouponSpec.build("C-BAD", "10.001", 5))
    show_invalid("标识含空格", lambda: CouponSpec.build("C BAD", 10, 5))

    for cid, name in (("food", "食品"), ("book", "图书"), ("toy", "玩具")):
        eng.register_category(cid, name)

    # ---- 需求 2：订单行维护与校验 -----------------------------------
    hr("需求2 订单行校验（数量为正、品类已登记）")
    show_invalid(
        "数量为 0",
        lambda: OrderLine.build("L-BAD", "food", 10, 0, known_categories=("food", "book", "toy")),
    )
    show_invalid(
        "品类未登记",
        lambda: OrderLine.build("L-BAD", "ghost", 10, 1, known_categories=("food", "book", "toy")),
    )
    eng.set_order(
        [
            OrderLine.build("L1", "food", 60, 1),    # 60.00
            OrderLine.build("L2", "food", 50, 1),    # 50.00
            OrderLine.build("L3", "book", 40, 1),    # 40.00
            OrderLine.build("L4", "toy", 30, 2),     # 60.00
        ]
    )
    print("  已登记订单行：", [(ln.line_id, ln.category_id, ln.line_total_cents) for ln in eng.lines()])

    # ---- 券面：互斥组、门槛、品类、优先级 ----------------------------
    eng.issue_coupon(
        CouponSpec.build("C1", 50, 20, ["food"], exclusive_group="FOOD", priority=1),
        source="marketing",
        version=1,
    )
    eng.issue_coupon(
        CouponSpec.build("C2", 30, 15, ["food"], exclusive_group="FOOD", priority=2),
        source="marketing",
        version=1,
    )
    eng.issue_coupon(
        CouponSpec.build("C3", 30, 10, ["book"]),
        source="marketing",
        version=1,
    )
    eng.issue_coupon(
        CouponSpec.build("C4", 50, 25, ["toy"]),
        source="marketing",
        version=1,
    )

    # ---- 需求 5：多来源矛盾，双方保留 + 冲突记录 + 冻结 --------------
    hr("需求5 多来源参数矛盾（双方保留、可读冲突、冻结）")
    eng.issue_coupon(
        CouponSpec.build("C5", 40, 18, ["toy"]),
        source="marketing",
        version=1,
    )
    conflict = eng.issue_coupon(
        CouponSpec.build("C5", 20, 8, ["toy"]),
        source="partner",
        version=1,
    )
    print(conflict.render())

    # ---- 需求 3/4：可行约束下总优惠最大 + 字典序平局 ----------------
    hr("需求3/4 最优求解（互斥、门槛、品类、行不重复抵扣）")
    result = eng.solve()
    print("  中选：", result.selected_ids(), " 总优惠(分)：", result.total_discount_cents)
    for app in result.applications:
        print(
            "   ",
            app.coupon_id,
            [(a.line_id, a.amount_cents) for a in app.allocations],
            "合计",
            app.total_discount_cents,
        )
    print("  冻结券：", result.frozen_coupon_ids)
    print("  结果指纹：", result.fingerprint)

    # ---- 需求 6：解释 -----------------------------------------------
    hr("需求6 方案解释（命中行/抵扣额/未选原因）")
    print(explain(eng, result).render())

    # ---- 需求 7：增量重算与一致性 -----------------------------------
    hr("需求7 增量重算（只重算受影响分量，未受影响抵扣不变）")
    before_fp = result.fingerprint
    app_c1 = result.application_for("C1")
    app_c3 = result.application_for("C3")
    report = eng.revoke_coupon("C4")  # 只作用于 toy，与 food/book 分量无关
    print("  复用分量：", report.reused_components)
    print("  重算分量：", report.recomputed_components)
    print("  退役分量：", report.retired_components)
    print("  未变抵扣券：", report.unchanged_application_ids)
    print("  C1/C3 的 Application 对象是否原样复用：",
          eng.last_result.application_for("C1") is app_c1,
          eng.last_result.application_for("C3") is app_c3)
    scratch = SettlementEngine()  # 从头重建一个等价引擎复核
    _rebuild_equivalent(scratch, with_c4=False, with_c5_conflict=True)
    scratch_res = scratch.solve()
    print("  增量结果指纹 == 从头重算指纹：", eng.last_result.fingerprint == scratch_res.fingerprint)
    assert eng.last_result.fingerprint == scratch_res.fingerprint
    assert eng.last_result.fingerprint != before_fp  # C4 撤销后确实变了

    # 撤销冲突券的一个来源 → 冲突解除、券恢复参与求解。
    hr("需求7（续）撤销一个矛盾来源后冲突解除")
    remaining_conflict = eng.revoke_issue("C5", "partner")
    print("  冲突记录：", remaining_conflict)
    res_after = eng.solve()
    print("  C5 是否重新参与：", "C5" in res_after.selected_ids())

    # ---- 需求 8：快照保存 / 损坏载入失败且状态不变 ------------------
    hr("需求8 快照保存与严格载入")
    dump_snapshot(eng, str(SNAPSHOT))
    print("  快照已写入：", SNAPSHOT)
    loaded = load_snapshot(str(SNAPSHOT))
    print("  载入后重算指纹一致：", loaded.solve().fingerprint == eng.solve().fingerprint)

    good_fp = eng.solve().fingerprint
    raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    raw["lines"][0]["unit_price_cents"] = 999999  # 篡改：行总额将自相矛盾
    SNAPSHOT.with_suffix(".broken.json").write_text(json.dumps(raw), encoding="utf-8")
    from settlement.errors import SnapshotFormatError

    try:
        load_into(eng, str(SNAPSHOT.with_suffix(".broken.json")))
    except SnapshotFormatError as exc:
        print("  [拒绝损坏快照] ", exc)
    print("  载入失败后原引擎指纹不变：", eng.solve().fingerprint == good_fp)
    SNAPSHOT.with_suffix(".broken.json").unlink(missing_ok=True)

    print("\n演示完成。")


def _rebuild_equivalent(engine: SettlementEngine, *, with_c4: bool, with_c5_conflict: bool) -> None:
    for cid, name in (("food", "食品"), ("book", "图书"), ("toy", "玩具")):
        engine.register_category(cid, name)
    engine.set_order(
        [
            OrderLine.build("L1", "food", 60, 1),
            OrderLine.build("L2", "food", 50, 1),
            OrderLine.build("L3", "book", 40, 1),
            OrderLine.build("L4", "toy", 30, 2),
        ]
    )
    engine.issue_coupon(CouponSpec.build("C1", 50, 20, ["food"], "FOOD", 1), "marketing", 1)
    engine.issue_coupon(CouponSpec.build("C2", 30, 15, ["food"], "FOOD", 2), "marketing", 1)
    engine.issue_coupon(CouponSpec.build("C3", 30, 10, ["book"]), "marketing", 1)
    if with_c4:
        engine.issue_coupon(CouponSpec.build("C4", 50, 25, ["toy"]), "marketing", 1)
    engine.issue_coupon(CouponSpec.build("C5", 40, 18, ["toy"]), "marketing", 1)
    if with_c5_conflict:
        engine.issue_coupon(CouponSpec.build("C5", 20, 8, ["toy"]), "partner", 1)


if __name__ == "__main__":
    # 让 stdout 在 Windows 控制台也稳定输出 UTF-8 中文。
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
