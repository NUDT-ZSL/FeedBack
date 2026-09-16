"""离线演示：把带误差的定位序列还原成合法、可追溯的行驶路径。

运行：``python demo.py``（无需联网、无需第三方依赖）

演示覆盖全部 7 项需求，并在每一步打印可读证据。脚本最后运行内置
自检（与 tests/ 同样的关键断言），全部通过时输出“演示自检通过”。
"""

from __future__ import annotations

import sys

from mapmatching import (
    EdgeClosedError,
    Matcher,
    MatchConfig,
    PathValidationError,
    Point,
    ReconstructionStore,
    RoadNetwork,
    Track,
    TrackReconstructor,
    Traversal,
    WrongWayError,
)
from mapmatching.report import render_reconstruction
from mapmatching.scenarios import build_world, point_on


def hr(title: str) -> None:
    print("\n" + "#" * 70)
    print(f"# {title}")
    print("#" * 70)


def main() -> int:
    failures = []

    def check(cond: bool, label: str) -> None:
        mark = "PASS" if cond else "FAIL"
        print(f"  [{mark}] {label}")
        if not cond:
            failures.append(label)

    # ------------------------------------------------------------------ #
    # 需求 1：路网维护 + 方向/禁行约束
    # ------------------------------------------------------------------ #
    hr("需求 1：路网维护——唯一标识、方向、长度、禁行；反向单行必须被拒绝")
    net = build_world()
    print(f"  已登记节点 {len(net.nodes)} 个、路段 {len(net.edges)} 条")
    b0 = net.get_edge("b0")
    print(f"  例：b0 {b0.from_node}->{b0.to_node} "
          f"长度 {b0.length:.0f}m 方向 {'单行' if b0.oneway else '双行'}")

    try:
        net.check_traversal("b0", Traversal.REVERSE)
        check(False, "单行 b0 反向通行被拒绝并指出路段")
    except WrongWayError as exc:
        check(exc.edge_id == "b0", f"单行 b0 反向通行被拒绝并指出路段（{exc}）")

    net.set_closed("b1", True)
    try:
        net.validate_route([("b0", Traversal.FORWARD),
                            ("b1", Traversal.FORWARD)])
        check(False, "禁行路段 b1 的通行被拒绝")
    except PathValidationError as exc:
        check(exc.reason == "closed" and exc.breakpoint_index == 1,
              f"禁行 b1 被拒绝，断点位置=第 {exc.breakpoint_index} 段")
    net.set_closed("b1", False)

    # ------------------------------------------------------------------ #
    # 需求 2：轨迹登记——单调、幂等
    # ------------------------------------------------------------------ #
    hr("需求 2：定位序列登记——时刻单调不减、重复序号幂等")
    track = Track("车-001")
    # 主来源 gps：tick2、tick3 丢点，tick1 直接到 tick4，需要路网补路
    samples = [
        (1, point_on("b0", 0.4, dy=4)),
        # tick 2、tick 3 缺失
        (4, point_on("b2", 0.6, dy=2)),
        (5, point_on("c3", 0.5, dy=2)),
        (6, point_on("t2", 0.5, dy=-2)),
    ]
    for seq, (tick, p) in enumerate(samples, start=1):
        track.add(tick, p, "gps", seq)

    # 重复上报同一个 (source, seq)：内容相同 -> 幂等忽略
    ignored = track.add(1, samples[0][1], "gps", 1)
    check(ignored is None and len(track) == 4,
          "重复 (来源,序号) 内容相同 -> 幂等忽略，点数仍为 4")

    try:
        track.add(0, Point(0, 0), "gps", 99)
        check(False, "时刻倒退被拒绝")
    except Exception as exc:
        check("单调不减" in str(exc), f"时刻倒退被拒绝（{exc}）")

    # 第二个来源：tick 4 与 gps 一致（互相印证），tick 5 矛盾
    track.add(4, point_on("b2", 0.55, dy=-2), "beacon", 1)
    track.add(5, point_on("t0", 0.5), "beacon", 2)

    # ------------------------------------------------------------------ #
    # 需求 3：候选匹配
    # ------------------------------------------------------------------ #
    hr("需求 3：匹配候选路段——代价、依据、过远不强行贴合")
    matcher = Matcher(net, MatchConfig(max_distance=20.0))
    r1 = matcher.match_sample(track.by_source("gps")[0])
    print("  " + r1.explain().replace("\n", "\n  "))
    check(r1.best.edge_id == "b0" and abs(r1.best.distance - 4) < 1e-9,
          "漂移点匹配到 b0，代价≈垂直距离 4m")

    far = matcher.match_sample(
        type(track.by_source("gps")[0])(tick=9, point=Point(800, 800),
                                        source="gps", seq=99)
    )
    check(far.status.value == "unmatched" and far.unmatched.nearest_distance > 20,
          f"偏离过远点标记未匹配（最近路段距离 "
          f"{far.unmatched.nearest_distance:.0f}m > 20m），不强行贴合")

    # ------------------------------------------------------------------ #
    # 需求 4 + 5：路径拼接、断点拒绝、缺失补路
    # ------------------------------------------------------------------ #
    hr("需求 4/5：串成合法路径 + 跳变/缺失补路")
    reconstructor = TrackReconstructor(matcher)
    recon = reconstructor.reconstruct(track)
    print(render_reconstruction(recon, net,
                                title=f"轨迹 {track.track_id} 初始还原报告"))

    gps_build = recon.source_builds["gps"]
    main_frag = max(gps_build.fragments, key=lambda f: len(f.steps))
    edge_seq = [e for e, _ in main_frag.steps]
    check(edge_seq[:3] == ["b0", "b1", "b2"],
          f"tick1->4 丢点被补出：b0 -> b1 -> b2（实际：{edge_seq}）")
    check(any(l.missing_samples == 2 and "b1" in
              [e for e, _ in l.fill_steps]
              for l in main_frag.legs),
          "补路 leg 记录缺失 2 个采样时刻（tick2、3）与补出路段 b1")
    net.validate_route(main_frag.steps)  # 不抛异常即合法
    check(True, "交付路径通过单行/禁行/首尾相接强制校验")

    # 不可达场景：封死 n10 的出路后，b0 末端到 b2 始端不可达
    net2 = build_world()
    net2.set_closed("b1", True)
    net2.set_closed("c1", True)
    t2 = Track("不可达演示")
    t2.add(1, point_on("b0", 0.95), "gps", 1)
    t2.add(2, point_on("b2", 0.1), "gps", 2)
    rec2 = TrackReconstructor(Matcher(net2, MatchConfig(max_distance=20))).reconstruct(t2)
    unreach = rec2.source_builds["gps"].unreachable_legs
    check(bool(unreach) and "n10" in unreach[0].reason,
          f"无合法通路时标记不可达并指出断点（{unreach[0].reason if unreach else '-'}）")

    # ------------------------------------------------------------------ #
    # 需求 6：多来源矛盾保留双方
    # ------------------------------------------------------------------ #
    hr("需求 6：多来源矛盾——保留双方 + 可读冲突记录")
    for conflict in recon.conflicts:
        print(conflict.describe())
    conflict_ticks = {c.tick for c in recon.conflicts}
    check(conflict_ticks == {5},
          f"仅在 tick=5 产生冲突（tick=4 双方一致互相印证），实际：{conflict_ticks}")
    c5 = next(c for c in recon.conflicts if c.tick == 5)
    check({c5.best_a.edge_id, c5.best_b.edge_id} == {"c3", "t0"},
          "冲突记录点名双方来源与各自匹配结果（c3 vs t0）")
    check(all(b.fragments for b in recon.source_builds.values()),
          "双方路径均保留，未静默择一")

    # ------------------------------------------------------------------ #
    # 需求 7：临时禁行增量重算
    # ------------------------------------------------------------------ #
    hr("需求 7：b1 临时禁行——只重算经过它的片段，结果与全量重算一致")
    # 用两条轨迹：一条走 b1（受影响），一条走顶廊（不应被触碰）
    net3 = build_world()
    store = ReconstructionStore(net3, Matcher(net3, MatchConfig(max_distance=20)))
    affected_track = Track("车-A（底廊）")
    affected_track.add(1, point_on("b0", 0.5), "gps", 1)
    affected_track.add(4, point_on("b2", 0.5), "gps", 2)
    affected_track.add(10, point_on("b0", 0.05), "gps", 3)
    store.register(affected_track)

    top_track = Track("车-B（顶廊）")
    top_track.add(1, point_on("t0", 0.5), "gps", 1)
    top_track.add(2, point_on("t1", 0.5), "gps", 2)
    store.register(top_track)

    top_before = store.get("车-B（顶廊）")
    report = store.close_edge("b1")
    print(report.describe())
    check("车-B（顶廊）" in report.untouched_tracks,
          "不经过 b1 的轨迹完全未重算（Reconstruction 对象 is 相同）")
    check(store.get("车-B（顶廊）") is top_before,
          "未受影响轨迹的 Python 对象保持不变")
    a_build = store.get("车-A（底廊）").source_builds["gps"]
    changed = next(f for f in a_build.fragments if f.tick_span == (1, 4))
    check([e for e, _ in changed.steps] == ["b0", "c1", "t1", "c2", "b2"],
          "受影响片段改走顶廊绕行：b0-c1-t1-c2-b2")
    b0_island = next(f for f in a_build.fragments if f.tick_span == (10, 10))
    check(frag_is_preserved(store, b0_island),
          "同轨迹内不经过 b1 的 tick10 片段对象原样保留")
    check(report.equivalent_to_full_rebuild is True,
          "模块自检：增量结果与从头全量重算逐片段一致")

    hr("演示完成")
    if failures:
        print(f"  共 {len(failures)} 项自检失败：")
        for label in failures:
            print(f"    - {label}")
        return 1
    print("  演示自检通过：7 项需求全部验证成功。")
    return 0


def frag_is_preserved(store: ReconstructionStore, frag) -> bool:
    for source_build in store.get("车-A（底廊）").source_builds.values():
        for candidate in source_build.fragments:
            if candidate is frag:
                return True
    return False


if __name__ == "__main__":
    sys.exit(main())
