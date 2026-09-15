"""离线验收演示：一次版本迭代的体验指标归因。

运行：  python examples/acceptance_demo.py
依赖：  仅 Python 3.9+ 标准库，可完全离线运行。

场景
----
某 App 两个分群：
- power  ：老用户（稳定 4 人）
- newbie ：新用户（改版前 2 人；改版当期换成了另一批 2 名新用户）

改版 rev-checkout（t=5）优化了结算链路，观测体验项 "结算耗时(ms)"。
表面上整体均值从 100 降到约 93，但这是改版功劳吗？随后 rev-perf（t=9）
又做了一次性能改版。脚本演示：结构变化与真实变化的拆分、构成被整体
替换的分群如何归因到“用户结构”、被抵消的改版效果、多次改版的来源链，
以及冲突台账、幂等上报和 JSON 快照往返。
"""

import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from attribution import AttributionEngine, LogicalClock, store  # noqa: E402


def line(title=""):
    print("\n" + "=" * 68)
    if title:
        print(title)
        print("-" * 68)


def main():
    clk = LogicalClock(0)
    eng = AttributionEngine(clk, composition_threshold=0.5)

    # ---- t=1：两个分群进入 ----
    clk.advance(1)
    eng.register_segment("power", 1, ["p1", "p2", "p3", "p4"])
    eng.register_segment("newbie", 1, ["n1", "n2"])

    # 同一用户被同时分到两个群（脏数据）→ 确定性裁决并记账
    eng.register_segment("vip-extra", 1, ["p1", "x1"])
    conflicts = eng.assignment_conflicts()

    # ---- t=4：改版前观测 ----
    clk.advance(4)
    eng.observe("power", 4, "结算耗时", 100.0)
    eng.observe("newbie", 4, "结算耗时", 100.0)
    # 重复上报：同值幂等；异值保留首次并记账
    assert eng.observe("power", 4, "结算耗时", 100.0) is None
    dup = eng.observe("power", 4, "结算耗时", 120.0)

    # ---- t=5：第一次改版 ----
    clk.advance(5)
    eng.register_revision("rev-checkout", 5, ["结算耗时"])

    # ---- t=6：新用户分群整体换血（用户结构事件，不是改版） ----
    clk.advance(6)
    eng.replace_composition("newbie", 6, ["n3", "n4"])

    # ---- t=8：改版后观测 ----
    clk.advance(8)
    eng.observe("power", 4, "结算耗时", 100.0)   # 历史补报（幂等）
    eng.observe("power", 8, "结算耗时", 90.0)    # 老用户真实改善 -10
    eng.observe("newbie", 8, "结算耗时", 80.0)   # 新人天然更快

    line("1) 重复归属裁决台账（字典序最小分群获胜，与登记顺序无关）")
    for c in conflicts:
        print(f"  用户 {c.user_id} @t{c.time}: 保留 {c.kept_segment}，"
              f"拒绝 {c.rejected_segment}")
    print(f"  重复观测异值上报：保留 {dup.kept_value}，忽略 "
          f"{dup.rejected_value}（共记录 "
          f"{len(eng.duplicate_observations())} 条）")

    line("2) rev-checkout 归因：总变化 = 结构变化 + 真实变化")
    rep = eng.attribute_revision("rev-checkout")
    it = rep.item("结算耗时")
    print(f"  窗口 t={it.before_time} -> t={it.after_time}")
    print(f"  总变化 {it.total:+.3f} = 结构 {it.structural:+.3f} "
          f"+ 真实 {it.real:+.3f}")
    assert math.isclose(it.structural + it.real, it.total, abs_tol=1e-9)
    for a in it.segment_attributions:
        flag = "→ 归因到用户结构" if a.attributed_to_composition else \
               "→ 归因到改版"
        print(f"  - {a.segment_id:7s} 总 {a.total:+.3f} | 结构 "
              f"{a.structural:+.3f}（mix {a.mix:+.3f}, 构成迁移 "
              f"{a.composition_migration:+.3f}）| 真实 {a.real:+.3f} "
              f"| 成员Jaccard={a.overlap:.2f} {flag}")
    print("  各分群贡献占比：",
          ", ".join(f"{s}={v:.1%}" for s, v in it.segment_shares))
    print("  被判定为用户结构的分群：", list(it.composition_segments))

    line("3) 第二次改版 rev-perf 与来源链（望远镜拆分，段和==总变化）")
    clk.advance(9)
    eng.register_revision("rev-perf", 9, ["结算耗时"])
    clk.advance(12)
    eng.observe("power", 12, "结算耗时", 70.0)
    eng.observe("newbie", 12, "结算耗时", 70.0)

    chain = eng.item_chain("结算耗时")
    print(f"  面板分群：{list(chain.panel_segments)}；"
          f"排除：{list(chain.excluded_segments) or '无'}")
    print(f"  首值 {chain.start_value:.3f} -> 末值 {chain.end_value:.3f}，"
          f"首末总变化 {chain.total_change:+.3f}")
    for s in chain.segments:
        print(f"  - t{s.window_start}->t{s.window_end:2d} 归属 "
              f"{s.revision_id:13s} 贡献 {s.contribution:+.3f} "
              f"(结构 {s.structural:+.3f} / 真实 {s.real:+.3f})")
    seg_sum = sum(s.contribution for s in chain.segments)
    print(f"  段贡献之和 {seg_sum:+.3f} == 首末总变化 "
          f"{chain.total_change:+.3f} ："
          f"{math.isclose(seg_sum, chain.total_change, abs_tol=1e-9)}")

    line("4) 查询：净影响 / 分群贡献 / 被结构抵消部分（顺序稳定可复算）")
    for rid in ("rev-checkout", "rev-perf"):
        net = eng.net_impact(rid)
        canceled = eng.canceled_parts(rid)["结算耗时"]
        print(f"  {rid:14s} 净影响(真实变化)={net['结算耗时']:+.3f}；"
              f"被结构抵消={canceled or '无'}")

    line("5) 缺失明确标注（绝不当作 0）")
    # 让一个刻度上只有 power 报过另一体验项
    eng.observe("power", 8, "崩溃率", 0.0)
    missing = eng.missing_slots("崩溃率")
    print(f"  '崩溃率' 缺失格子：{missing}（newbie 在 t8 未报，不补零）")
    assert eng.value_at("newbie", 8, "崩溃率") is None
    assert eng.value_at("power", 8, "崩溃率") == 0.0  # 真实的 0 保留

    line("6) JSON 快照写入 / 重新载入（校验唯一、合法、自洽、守恒）")
    path = os.path.join(tempfile.gettempdir(), "attribution_demo.json")
    store.save(eng, path)
    eng2 = store.load(path)
    same = store.to_dict(eng2) == store.to_dict(eng)
    print(f"  快照路径：{path}")
    print(f"  载入后重算结果与原引擎完全一致：{same}")
    # 顺序无关性：再载入一次，来源链结果逐位相同
    chain2 = eng2.item_chain("结算耗时")
    identical = chain2.segments == chain.segments
    print(f"  重复计算完全一致：{identical}")

    print("\n验收演示完成：结构变化没有被算成改版效果，链路可追溯、守恒。")


if __name__ == "__main__":
    main()
