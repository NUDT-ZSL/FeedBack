#!/usr/bin/env python3
"""离线验收脚本（对应需求 8）。

构造一份基准和 4 条候选轨，分别覆盖：

* SHIFT-A   整体偏移（候选 = 基准 + 2000ms）
* RATE-B    帧率漂移（候选时钟 1000 单位 = 基准 1001 单位，ratio=1001/1000）
* GAP-C     中段缺失（基准第 5、6 两条在候选轨整段消失）
* CONFLICT-D 与 SHIFT-A 对同一区间给出互相矛盾的平移（+5000ms）

脚本先给出**人工逐步推导**的期望值，再运行系统逐项比对，最后验证
导出 → 导入 → 再导出的字节级一致与查询一致。

用法：
    python demo_acceptance.py            # 控制台输出推导过程
    python demo_acceptance.py out.json   # 同时写工程文件
"""

from __future__ import annotations

import io
import sys
from fractions import Fraction

from subalign import (
    AlignConfig,
    Entry,
    SubtitleSystem,
    from_json_text,
    to_json,
)
from subalign.report import render_conflict, render_query, render_system
from subalign.timecode import format_millis

N = 12
STEP_REF = 10010          # 基准条目间距（1001 的倍数，方便帧率轨整除）
DUR = 3000


def build_system() -> SubtitleSystem:
    ref = [Entry(i * STEP_REF, i * STEP_REF + DUR, f"第{i:02d}句 ANCHOR{i:02d}")
           for i in range(N)]

    # SHIFT-A：整体晚 2000ms。
    shift_a = [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref]

    # RATE-B：候选时钟 1000ms == 基准 1001ms（24 vs 24/1000*1001 类帧率差）。
    rate_b = [Entry(i * 10000, i * 10000 + DUR, e.text) for i, e in enumerate(ref)]

    # GAP-C：基准第 5、6 条整段缺失；左侧恒等，右侧候选连续、基准差 2 个步长。
    kept = [i for i in range(N) if i not in (5, 6)]
    gap_c = [
        Entry(k * STEP_REF, k * STEP_REF + DUR, f"第{i:02d}句 ANCHOR{i:02d}")
        for k, i in enumerate(kept)
    ]

    # CONFLICT-D：整体晚 5000ms，与 A 的说法相差 3000ms。
    conflict_d = [Entry(e.start + 5000, e.end + 5000, e.text) for e in ref]

    s = SubtitleSystem.build(
        ref,
        {
            "SHIFT-A": ("供应商甲：整体延迟版本", shift_a),
            "RATE-B": ("供应商乙：24fps 帧率版本", rate_b),
            "GAP-C": ("供应商丙：删减版（中段剪掉两条）", gap_c),
            "CONFLICT-D": ("供应商丁：对同一区间给出不同平移", conflict_d),
        },
        config=AlignConfig(
            tolerance_ms=250,
            conflict_shift_eps_ms=400,
            conflict_rate_eps=Fraction(2, 1000),
        ),
    )
    s.align()
    return s


def expect_and_check(out: io.StringIO, s: SubtitleSystem) -> int:
    failures = 0

    def check(name, actual, expected):
        nonlocal failures
        ok = actual == expected
        if not ok:
            failures += 1
        out.write(
            f"  [{'PASS' if ok else 'FAIL'}] {name}: 实际={actual!r}"
            + ("" if ok else f"，期望={expected!r}")
            + "\n"
        )

    out.write("=" * 78 + "\n")
    out.write("第一步 · 人工逐步推导的期望值\n")
    out.write("-" * 78 + "\n")
    out.write(
        "锚点取条目中点。SHIFT-A: r = c - 2000；\n"
        "RATE-B: 基准中点 10010i+1500，候选中点 10000i+1500，"
        "故 r = (1001/1000)c - 3/2；\n"
        "GAP-C: 左段 r = c；右段锚点 (cand=k·10010+1500, ref=i·10010+1500, k=i-2)\n"
        "       故右段 r = c + 2·10010 = c + 20020；缺失的是基准第 5、6 条；\n"
        "CONFLICT-D: r = c - 5000，与 SHIFT-A 的平移相差 3000ms（>400ms 阈值）。\n\n"
    )

    # --- SHIFT-A ---
    out.write("第二步 · SHIFT-A（整体平移）\n")
    ra = s.report("SHIFT-A")
    check("SHIFT-A 段数", len(ra.segments), 1)
    check("SHIFT-A ratio", ra.segments[0].ratio, Fraction(1))
    check("SHIFT-A shift", ra.segments[0].shift, Fraction(-2000))
    check("SHIFT-A 无缺失", len(ra.bias.missing_intervals), 0)
    check("SHIFT-A 容差内", ra.tolerance.within_tolerance, True)
    q = s.correct_time("SHIFT-A", 42000)
    check("SHIFT-A 校正 @42000", q.corrected_ms, Fraction(40000))
    out.write("\n")

    # --- RATE-B ---
    out.write("第三步 · RATE-B（帧率漂移，越往后漂移越大）\n")
    rb = s.report("RATE-B")
    check("RATE-B 段数", len(rb.segments), 1)
    check("RATE-B ratio", rb.segments[0].ratio, Fraction(1001, 1000))
    check("RATE-B shift", rb.segments[0].shift, Fraction(-3, 2))
    check("RATE-B 最大残差", rb.segments[0].residual_max_abs, 0)
    check("RATE-B 容差内", rb.tolerance.within_tolerance, True)
    drift_early = s.correct_time("RATE-B", 11500).corrected_ms - 11500
    drift_late = s.correct_time("RATE-B", 111500).corrected_ms - 111500
    check("RATE-B 早期漂移小", drift_early, Fraction(10))
    check("RATE-B 晚期漂移大", drift_late, Fraction(110))
    check("漂移随时间增大", drift_late > drift_early, True)
    out.write("\n")

    # --- GAP-C ---
    out.write("第四步 · GAP-C（中段缺失，只在两侧分别对齐）\n")
    rc = s.report("GAP-C")
    check("GAP-C 段数", len(rc.segments), 2)
    check("GAP-C 左段 ratio", rc.segments[0].ratio, Fraction(1))
    check("GAP-C 左段 shift", rc.segments[0].shift, Fraction(0))
    check("GAP-C 右段 ratio", rc.segments[1].ratio, Fraction(1))
    check("GAP-C 右段 shift", rc.segments[1].shift, Fraction(20020))
    check("GAP-C 缺失区间数", len(rc.bias.missing_intervals), 1)
    miss = rc.bias.missing_intervals[0]
    # 基准第 5 条起 50050，第 6 条止 63060。
    check("GAP-C 缺失起点", miss.ref_lo, 5 * STEP_REF)
    check("GAP-C 缺失终点", miss.ref_hi, 6 * STEP_REF + DUR)
    check("GAP-C 缺失时长", miss.duration_ms, (6 * STEP_REF + DUR) - 5 * STEP_REF)
    check("GAP-C 左侧锚点", miss.left_anchor, (4, 4))
    check("GAP-C 右侧锚点", miss.right_anchor, (7, 5))
    # 关键验收：速率没有被缺失扭曲成 (N-2)/N。
    check("GAP-C 速率未被扭曲", rc.bias.rate_ratio, Fraction(1))
    check("GAP-C 左侧校正 @11510", s.correct_time("GAP-C", 11510).corrected_ms,
          Fraction(11510))
    check("GAP-C 右侧校正 @61560", s.correct_time("GAP-C", 61560).corrected_ms,
          Fraction(81580))
    check("GAP-C 容差内", rc.tolerance.within_tolerance, True)
    out.write("\n")

    # --- 冲突 ---
    out.write("第五步 · 矛盾参数双方保留（不静默择一）\n")
    conflicts = s.conflicts()
    key_ad = None
    for c in conflicts:
        pair = {c.track_a.track_id, c.track_b.track_id}
        if pair == {"SHIFT-A", "CONFLICT-D"}:
            key_ad = c
    check("存在 A↔D 冲突记录", key_ad is not None, True)
    if key_ad:
        check("冲突区间起点(中点覆盖)", key_ad.interval_ref_lo, 1500)
        aside = key_ad.track_a if key_ad.track_a.track_id == "SHIFT-A" else key_ad.track_b
        dside = key_ad.track_b if key_ad.track_b.track_id == "CONFLICT-D" else key_ad.track_a
        check("A 侧 shift 保留", aside.shift, Fraction(-2000))
        check("D 侧 shift 保留", dside.shift, Fraction(-5000))
        check("冲突错位量", key_ad.shift_delta_ms, Fraction(3000))
    # 双方原始参数同时可查。
    check("系统中 A 参数仍为 -2000", s.report("SHIFT-A").segments[0].shift, Fraction(-2000))
    check("系统中 D 参数仍为 -5000", s.report("CONFLICT-D").segments[0].shift, Fraction(-5000))
    out.write(f"  共生成冲突记录 {len(conflicts)} 条（含帧率轨/删减版与其他轨在同一\n"
              "  基准区间的参数矛盾；逐条列于完整报告）。\n\n")

    # --- 顺序无关 + 重复一致 ---
    out.write("第六步 · 顺序无关与重复计算一致\n")
    ref2 = [Entry(i * 10000, i * 10000 + 3000, f"第{i:02d}句 K{i}") for i in range(N)]
    specs = {
        "a": ("s", [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref2]),
        "b": ("s", [Entry(e.start + 5000, e.end + 5000, e.text) for e in ref2]),
    }
    s1 = SubtitleSystem.build(ref2, {"a": specs["a"], "b": specs["b"]})
    s2 = SubtitleSystem.build(ref2, {"b": specs["b"], "a": specs["a"]})
    s1.align(); s2.align()
    same = (
        [c.key() for c in s1.conflicts()] == [c.key() for c in s2.conflicts()]
        and s1.report("a").segments[0].shift == s2.report("a").segments[0].shift
    )
    check("轨插入顺序不影响结果", same, True)
    q1 = s.correct_time("RATE-B", 77777)
    q2 = s.correct_time("RATE-B", 77777)
    check("同一时刻重复查询逐位一致", (q1.corrected_ms, q1.segment_index),
          (q2.corrected_ms, q2.segment_index))
    out.write("\n")

    # --- 导出导入 ---
    out.write("第七步 · 导出/导入后结果不变\n")
    payload = to_json(s)
    s3 = from_json_text(payload)
    identical = to_json(s3) == payload
    check("再导出字节级一致", identical, True)
    all_q = all(
        s3.correct_time(t, x).corrected_ms == s.correct_time(t, x).corrected_ms
        for t in s.track_ids() for x in (0, 1500, 42000, 99999)
    )
    check("导入后全部抽查查询一致", all_q, True)
    check("导入后缺失区间一致",
          [(m.ref_lo, m.ref_hi) for m in s3.report("GAP-C").bias.missing_intervals],
          [(m.ref_lo, m.ref_hi) for m in s.report("GAP-C").bias.missing_intervals])
    check("导入后冲突记录一致",
          [c.key() for c in s3.conflicts()], [c.key() for c in s.conflicts()])
    out.write("\n")
    return failures


def main(argv: list[str]) -> int:
    s = build_system()
    buf = io.StringIO()
    failures = expect_and_check(buf, s)
    buf.write("=" * 78 + "\n完整对齐报告\n" + "=" * 78 + "\n")
    buf.write(render_system(s))
    buf.write("\n")
    buf.write("-" * 78 + "\n抽样查询溯源\n" + "-" * 78 + "\n")
    buf.write(render_query(s.correct_time("GAP-C", 61560)) + "\n")
    buf.write(render_query(s.correct_time("RATE-B", 111500)) + "\n")
    for c in s.conflicts():
        if {c.track_a.track_id, c.track_b.track_id} == {"SHIFT-A", "CONFLICT-D"}:
            buf.write("-" * 78 + "\n")
            buf.write(render_conflict(c) + "\n")
            break

    text = buf.getvalue()
    sys.stdout.write(text)
    if len(argv) > 1:
        with open(argv[1], "w", encoding="utf-8", newline="\n") as f:
            f.write(to_json(s))
        sys.stdout.write(f"\n工程文件已写入：{argv[1]}\n")

    sys.stdout.write(f"\n验收结果：{'全部通过' if failures == 0 else str(failures) + ' 项失败'}\n")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
