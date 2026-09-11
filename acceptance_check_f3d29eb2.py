# -*- coding: utf-8 -*-
"""对 f3d29eb2 的 WindowAggregator 做独立验收核查（只读，不改项目文件）。

参考实现在此文件内独立编写（不引用项目测试），规则来自需求与 README。
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import tempfile
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

PROJECT = r"E:\USER\AutoDemo\AutoDemo\tasks\20260910_084516_f3d29eb2\workspace"
sys.path.insert(0, PROJECT)

from aggregator import Event, WindowAggregator, SnapshotError, window_starts_for_ts  # noqa: E402

results: List[Tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    results.append((name, bool(cond), detail))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# 独立参考实现：先按到达顺序做合法性/配对，再把存活 add 按 (ts, event_id)
# 排序做一次性批处理聚合。
# ---------------------------------------------------------------------------
class Reference:
    def __init__(self, window_size: int, slide: int):
        self.ws, self.sl = window_size, slide
        self.adds: Dict[str, Event] = {}
        self.pending: Dict[str, Event] = {}
        self.retracted: set = set()
        self.alive: Dict[str, Event] = {}
        self.illegal = 0

    def ingest(self, ev: Event) -> None:
        if ev.op == "add":
            if ev.event_id in self.adds:
                self.illegal += 1  # 重复 add：拒绝
                return
            self.adds[ev.event_id] = ev
            pr = self.pending.pop(ev.event_id, None)
            if pr is None:
                self.alive[ev.event_id] = ev
            elif (pr.key, pr.ts, pr.value) == (ev.key, ev.ts, ev.value):
                self.retracted.add(ev.event_id)  # 提前撤回配对，净贡献 0
            else:
                self.illegal += 1  # 提前 retract 与 add 不一致，retract 判非法
                self.alive[ev.event_id] = ev
        else:
            if ev.event_id in self.pending:
                self.illegal += 1  # 重复 pending retract
                return
            add = self.adds.get(ev.event_id)
            if add is None:
                self.pending[ev.event_id] = ev  # 提前撤回，暂存
            elif ev.event_id in self.retracted:
                self.illegal += 1  # 撤回已撤回的 add
            elif (ev.key, ev.ts, ev.value) != (add.key, add.ts, add.value):
                self.illegal += 1  # retract 字段不匹配
            else:
                self.retracted.add(ev.event_id)
                self.alive.pop(ev.event_id, None)

    def windows(self, agg: str) -> Dict[Tuple[str, int], Any]:
        ordered = sorted(self.alive.values(), key=lambda e: (e.ts, e.event_id))
        buckets: Dict[Tuple[str, int], List[float]] = defaultdict(list)
        starts: Dict[str, List[int]] = defaultdict(list)
        for ev in ordered:
            for s in window_starts_for_ts(ev.ts, self.ws, self.sl):
                buckets[(ev.key, s)].append(ev.value)
                starts[ev.key].append(s)
        out: Dict[Tuple[str, int], Any] = {}
        for (k, s), vals in buckets.items():
            if agg == "sum":
                out[(k, s)] = math.fsum(vals)
            elif agg == "count":
                out[(k, s)] = len(vals)
            elif agg == "min":
                out[(k, s)] = min(vals)
            else:
                out[(k, s)] = max(vals)
        return out


def engine_windows(eng: WindowAggregator, agg: str,
                   keys: List[str], starts: List[int]) -> Dict[Tuple[str, int], Any]:
    out: Dict[Tuple[str, int], Any] = {}
    if not starts:
        return out
    lo, hi = min(starts), max(starts) + eng.slide
    for k in keys:
        for w in eng.query(k, lo, hi, agg=agg):
            out[(k, w.window_start)] = w.value
    return out


# ===== 1. 提前撤回：retract 先到暂存，add 到达自动抵消，且不可再被撤回 =====
eng = WindowAggregator(10, 5)
r0 = eng.ingest(Event("e1", "k", 3, "retract", 7.0))
check("1a retract 先到被暂存",
      r0.accepted and r0.status == "pending_retract"
      and eng.get_state()["pending_retracts"] == 1)
r1 = eng.ingest(Event("e1", "k", 3, "add", 7.0))
st = eng.get_state()
check("1b add 到达与提前 retract 自动配对（净值 0、暂存清空）",
      r1.status == "retracted" and r1.pending_matched is True
      and st["pending_retracts"] == 0
      and all(w.value in (0.0, 0) for w in eng.query("k", 0, 20)))
r2 = eng.ingest(Event("e1", "k", 3, "retract", 7.0))
check("1c 配对完成后同一 add 不能再被别的 retract 匹配",
      not r2.accepted and r2.error_kind == "double_retract")

# ===== 3. 重复 event_id 的 add 被拒，聚合不被污染 =========================
eng = WindowAggregator(10, 5)
eng.ingest(Event("dup", "k", 4, "add", 1.0))
before = [w.value for w in eng.query("k", 0, 10)]
rr = eng.ingest(Event("dup", "k", 4, "add", 1.0))
after = [w.value for w in eng.query("k", 0, 10)]
check("3 重复 add 被拒（含 event_id）且聚合值不变",
      not rr.accepted and rr.error_kind == "duplicate_add" and "dup" in (rr.error or "")
      and before == after and eng.get_state()["tracked_adds"] == 1)

# ===== 4. watermark 边界：ts == t 正常接受，不算迟到 ======================
eng = WindowAggregator(10, 5)
eng.advance_watermark(10)
rx = eng.ingest(Event("x", "k", 10, "add", 3.0))
check("4 ts == watermark 正常接受且不标迟到",
      rx.accepted and rx.late is False and rx.dirty_windows == [])
ry = eng.ingest(Event("y", "k", 9, "add", 1.0))
check("4b ts == watermark-1 落入刚关闭的旧区间 [0,10) -> 迟到",
      ry.late is True and ry.dirty_windows == [0])

# ===== 5. watermark 单调；相同值允许；回退报错带两个值 ====================
eng = WindowAggregator(10, 5)
eng.advance_watermark(10)
same = eng.advance_watermark(10)
try:
    eng.advance_watermark(9)
    msg = ""
except ValueError as exc:
    msg = str(exc)
check("5 watermark 可持平、回退报错且含当前值/尝试值",
      same == 10 and "10" in msg and "9" in msg and "回退" in msg, msg)

# ===== 6. finalized 区间迟到：单独计数 + finalized 翻回 false ============
eng = WindowAggregator(10, 5)
eng.ingest(Event("a0", "k", 1, "add", 5.0))
eng.advance_watermark(20)
w0 = {w.window_start: w for w in eng.query("k", 0, 10)}
late = eng.ingest(Event("late1", "k", 2, "add", 1.0))
w1 = {w.window_start: w for w in eng.query("k", 0, 10)}
check("6 迟到写入计数 +1，受影响 finalized 区间翻为 false 且值更新",
      eng.get_state()["late_events"] == 1 and late.late
      and w0[0].finalized is True
      and w1[0].finalized is False and w1[0].finalized_dirty is True
      and w1[0].value == 6.0)
# dirty 单调：再推进 watermark 也不会“重新封口”
eng.advance_watermark(100)
w2 = {w.window_start: w for w in eng.query("k", 0, 10)}
check("6b finalized_dirty 单调，不随 watermark 再推进而清除",
      w2[0].finalized is False and w2[0].finalized_dirty is True)

# ===== 7. get_state 含 pending_retracts 且数量正确 =======================
eng = WindowAggregator(10, 5)
eng.ingest(Event("p1", "k", 1, "retract", 1.0))
eng.ingest(Event("p2", "k", 2, "retract", 2.0))
check("7 get_state().pending_retracts 反映暂存堆积",
      "pending_retracts" in eng.get_state()
      and eng.get_state()["pending_retracts"] == 2)

# ===== 8. 快照包含两字段；旧快照缺字段默认补齐；其它缺字段仍报错 =========
with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "s.json")
    eng = WindowAggregator(10, 5)
    eng.ingest(Event("p1", "k", 1, "retract", 1.0))   # 未配对 pending
    eng.ingest(Event("a1", "k", 1, "add", 4.0))
    eng.advance_watermark(20)
    eng.ingest(Event("late", "k", 1, "add", 2.0))     # 迟到
    eng.save(path)
    raw = json.load(open(path, encoding="utf-8"))
    check("8a save JSON 含 pending_retracts 与 stats.late_events",
          "pending_retracts" in raw and "late_events" in raw["stats"]
          and len(raw["pending_retracts"]) == 1 and raw["stats"]["late_events"] == 1)

    # 构造“旧版快照”：删掉 stats.late_events（README 明确承诺向前兼容的字段）
    old_late = json.loads(json.dumps(raw))
    old_late["stats"] = {k: v for k, v in old_late["stats"].items()
                         if k != "late_events"}
    restored = WindowAggregator.from_snapshot(old_late)
    check("8b 旧快照缺 stats.late_events 时按 0 补齐加载（README 承诺）",
          restored.get_state()["late_events"] == 0
          and restored.get_state()["pending_retracts"] == 1)

    # 需求原文“缺这两个字段按 0 补齐”：再测缺顶层 pending_retracts 的旧快照
    old_pending = {k: v for k, v in raw.items() if k != "pending_retracts"}
    pending_missing_ok = True
    pending_detail = ""
    try:
        restored2 = WindowAggregator.from_snapshot(old_pending)
        pending_missing_ok = restored2.get_state()["pending_retracts"] == 0
    except SnapshotError as exc:
        pending_missing_ok = False
        pending_detail = f"实际行为：缺字段即报错 -> {exc}"
    check("8b' 旧快照缺顶层 pending_retracts 时按空补齐（需求字面要求）",
          pending_missing_ok, pending_detail or "按空列表补齐成功")

    # 旧快照加载后继续工作
    rl = restored.ingest(Event("late2", "k", 1, "add", 1.0))
    check("8c 旧快照补齐加载后迟到计数从 0 正常累计",
          restored.get_state()["late_events"] == 1 and rl.late)

    # 必填字段缺失要抛“清晰错误”（SnapshotError），不应是裸 KeyError
    cases = []
    bad1 = json.loads(json.dumps(raw)); del bad1["config"]; cases.append(("缺 config", bad1))
    bad2 = json.loads(json.dumps(raw)); del bad2["events"]; cases.append(("缺 events", bad2))
    bad3 = json.loads(json.dumps(raw)); del bad3["stats"]; cases.append(("缺 stats", bad3))
    bad4 = json.loads(json.dumps(raw)); del bad4["events"][0]["ts"]; cases.append(("events[0] 缺 ts", bad4))
    bad5 = json.loads(json.dumps(raw)); del bad5["stats"]["accepted_events"]
    cases.append(("stats 缺 accepted_events", bad5))
    ok_missing = True
    details = []
    for label, bad in cases:
        try:
            WindowAggregator.from_snapshot(bad)
            ok_missing = False; details.append(f"{label} 未报错")
        except SnapshotError:
            pass
        except KeyError as exc:
            ok_missing = False; details.append(f"{label} 抛裸 KeyError({exc})，非清晰错误")
    check("8d 其它必填字段缺失抛清晰 SnapshotError", ok_missing, "; ".join(details))

    # 损坏文件 / 不存在文件
    with open(os.path.join(tmp, "corrupt.json"), "w", encoding="utf-8") as f:
        f.write("{oops")
    try:
        WindowAggregator.load(os.path.join(tmp, "corrupt.json"))
        corrupt_ok = False
    except SnapshotError:
        corrupt_ok = True
    try:
        WindowAggregator.load(os.path.join(tmp, "nope.json"))
        missing_ok = False
    except SnapshotError:
        missing_ok = True
    check("8e 损坏 JSON / 文件不存在均清晰报错", corrupt_ok and missing_ok)

# ===== 9. 边界情况 ========================================================
# 空引擎 retract 不存在的 id -> 暂存（提前撤回），不报错
eng = WindowAggregator(10, 5)
r = eng.ingest(Event("ghost", "k", 1, "retract", 1.0))
check("9a 空引擎 retract 不存在 id -> pending_retract",
      r.accepted and r.status == "pending_retract"
      and eng.get_state()["pending_retracts"] == 1)

# retract 已被撤回的 add
eng = WindowAggregator(10, 5)
eng.ingest(Event("e", "k", 1, "add", 1.0))
eng.ingest(Event("e", "k", 1, "retract", 1.0))
r = eng.ingest(Event("e", "k", 1, "retract", 1.0))
check("9b retract 已被撤回的 add -> double_retract 拒绝",
      not r.accepted and r.error_kind == "double_retract")

# retract 先到 -> add 到达配对 -> 再 retract 同一 add
eng = WindowAggregator(10, 5)
eng.ingest(Event("e", "k", 1, "retract", 1.0))
eng.ingest(Event("e", "k", 1, "add", 1.0))
r = eng.ingest(Event("e", "k", 1, "retract", 1.0))
check("9c 提前撤回配对后再 retract -> 拒绝",
      not r.accepted and r.error_kind == "double_retract")

# poll/query 空引擎
eng = WindowAggregator(10, 5)
check("9d 空引擎 query 返回网格空值、peek 类状态正常",
      all(w.value == 0.0 and w.finalized is False for w in eng.query("k", 0, 10))
      and eng.get_state()["active_windows"] == 0)

# ===== 2 + 10. 随机乱序差分：add/retract 交错、retract 先到、重复 add =====
def run_diff(seed: int, n: int, ws: int, sl: int) -> Tuple[bool, str]:
    rng = random.Random(seed)
    eng = WindowAggregator(ws, sl)
    ref = Reference(ws, sl)
    events: List[Event] = []
    ids = [f"id{i:04d}" for i in range(n)]
    keys = ["dev-a", "dev-b", "dev-c"]
    # 每个 id 先决定一条“真身” add；再追加一些操作（可能 retract-first / dup）
    stream: List[Event] = []
    for i in ids:
        ts = rng.randrange(-20, 120)
        val = float(rng.randrange(1, 10))
        key = rng.choice(keys)
        roll = rng.random()
        if roll < 0.20:
            # retract 先到，add 后到（其中一部分字段故意写错 -> 非法 retract）
            bad = rng.random() < 0.25
            stream.append(Event(i, key, ts, "retract",
                                val + (100.0 if bad else 0.0)))
            stream.append(Event(i, key, ts, "add", val))
            if rng.random() < 0.3:
                stream.append(Event(i, key, ts, "retract", val))  # 第三次 retract
        elif roll < 0.35:
            stream.append(Event(i, key, ts, "add", val))
            stream.append(Event(i, key, ts, "retract", val))
        elif roll < 0.45:
            stream.append(Event(i, key, ts, "add", val))
            stream.append(Event(i, key, ts, "add", val))  # 重复 add
        else:
            stream.append(Event(i, key, ts, "add", val))
    rng.shuffle(stream)
    for ev in stream:
        res = eng.ingest(ev)
        ref.ingest(ev)
        events.append(ev)
        # 引擎非法计数必须与参考一致（重复 add / 双撤回 / 不匹配 / 重复 pending）
        if eng.get_state()["illegal_events"] != ref.illegal:
            return False, (
                f"非法计数分叉 after {ev.to_dict()}: "
                f"engine={eng.get_state()['illegal_events']} ref={ref.illegal} "
                f"res={res.status}/{res.error_kind}")
    all_starts = sorted({s for ev in events
                         for s in window_starts_for_ts(ev.ts, ws, sl)})
    for agg in ("sum", "count", "min", "max"):
        got = engine_windows(eng, agg, keys, all_starts)
        want = ref.windows(agg)
        keyset = set(got) | set(want)
        empty_default = {"sum": 0.0, "count": 0, "min": None, "max": None}[agg]
        for kk in keyset:
            # query 对网格内每个区间都返回结果（空区间 sum=0/count=0/min|max=None），
            # 参考实现只输出非空桶；缺失键按空区间默认值归一化后比较。
            gv, wv = got.get(kk, empty_default), want.get(kk, empty_default)
            if gv != wv:
                return False, f"{agg} 区间 {kk} 不一致: engine={gv} ref={wv}"
    return True, f"stream={len(stream)} 非法={ref.illegal}"


ok_all = True
detail_all = []
for seed, n, ws, sl in [(1, 300, 10, 5), (2, 500, 12, 4), (3, 800, 10, 10),
                        (4, 400, 15, 3), (5, 1000, 8, 2)]:
    ok, detail = run_diff(seed, n, ws, sl)
    ok_all &= ok
    detail_all.append(f"seed{seed}/{n}/w{ws}/s{sl}: {detail}")
check("2/10 随机乱序流式 ≡ 排序批处理（4 种聚合，含 retract 先到/交错/重复 add）",
      ok_all, " | ".join(detail_all))

# ===== 10b. save/load 往返后继续 ingest，结果与不中断一致 =================
def build_stream(seed: int) -> List[Event]:
    rng = random.Random(seed)
    out = []
    for i in range(200):
        eid = f"m{i:03d}"
        ts = rng.randrange(0, 100)
        v = float(rng.randrange(1, 5))
        roll = rng.random()
        if roll < 0.15:
            out.append(Event(eid, "k", ts, "retract", v))
            out.append(Event(eid, "k", ts, "add", v))
        elif roll < 0.30:
            out.append(Event(eid, "k", ts, "add", v))
            out.append(Event(eid, "k", ts, "retract", v))
        else:
            out.append(Event(eid, "k", ts, "add", v))
    rng.shuffle(out)
    return out


stream = build_stream(42)
cut = 120
uninterrupted = WindowAggregator(10, 5)
for ev in stream:
    uninterrupted.ingest(ev)

with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "mid.json")
    cut_eng = WindowAggregator(10, 5)
    for ev in stream[:cut]:
        cut_eng.ingest(ev)
    cut_eng.advance_watermark(30)
    cut_eng.save(path)
    resumed = WindowAggregator.load(path)
    for ev in stream[cut:]:
        resumed.ingest(ev)

same = True
detail = ""
for k in ("k",):
    a = [(w.window_start, w.value) for w in uninterrupted.query(k, -20, 140)]
    b = [(w.window_start, w.value) for w in resumed.query(k, -20, 140)]
    if a != b:
        same, detail = False, f"{k} 区间序列不一致"
# pending retract 也要随快照带走：构造 pending -> save -> load -> add 配对
with tempfile.TemporaryDirectory() as tmp:
    p2 = os.path.join(tmp, "p.json")
    e2 = WindowAggregator(10, 5)
    e2.ingest(Event("zzz", "k", 7, "retract", 2.5))
    e2.save(p2)
    e3 = WindowAggregator.load(p2)
    match = e3.ingest(Event("zzz", "k", 7, "add", 2.5))
    pending_survives = (e3.get_state()["pending_retracts"] == 0
                        and match.pending_matched is True
                        and all(w.value in (0.0, 0) for w in e3.query("k", 0, 20)))
check("10b save/load 往返（含 watermark、pending retract）后继续 ingest 与不中断一致",
      same and pending_survives, detail)

# ===== 汇总 ==============================================================
fails = [n for n, ok, _ in results if not ok]
print("\n" + "=" * 70)
print(f"共 {len(results)} 项，通过 {len(results) - len(fails)}，失败 {len(fails)}")
if fails:
    print("失败项：")
    for n, _, d in results:
        if not n or True:
            pass
    for n, _, d in results:
        if n in fails:
            print(f"  - {n}: {d}")
    sys.exit(1)
print("全部验收项通过。")
