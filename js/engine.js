// 推演引擎：围栏判定、抖动过滤、优先级冲突消解。
// 纯函数，不依赖 DOM，可在 Node 下做单元测试。
(function (root) {
  "use strict";
  const Geo = root.Geo || require("./geo.js");

  const TYPE_ORDER = { enter: 0, exit: 1, overspeed: 2, dwell: 3 };
  const TYPE_LABEL = { enter: "进入", exit: "离开", dwell: "停留超时", overspeed: "超速" };

  // 计算每个点相对围栏的 inside 布尔序列
  function insideSeq(fence, points) {
    return points.map(p => Geo.pointInPolygon(p, fence.polygon));
  }

  // 找出连续同值区间 [startIdx, endIdx)
  function runs(flags) {
    const out = [];
    let i = 0;
    while (i < flags.length) {
      let j = i + 1;
      while (j < flags.length && flags[j] === flags[i]) j++;
      out.push({ value: flags[i], start: i, end: j });
      i = j;
    }
    return out;
  }

  function runDuration(points, run) {
    const t0 = points[run.start].t;
    const t1 = run.end < points.length ? points[run.end].t : points[run.end - 1].t;
    return t1 - t0;
  }

  // 抖动过滤：
  // 1) 外部短区间（边界抖动造成的瞬时出界）时长 < minGapSec -> 视为仍在内部
  // 2) 内部短区间（短暂穿越）时长 < minDwellSec -> 视为未进入，记录被压制候选
  function debounce(fence, points) {
    const flags = insideSeq(fence, points);
    const suppressed = [];
    const minGap = fence.minGapSec || 0;
    const minDwell = fence.minDwellSec || 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const r of runs(flags)) {
        const dur = runDuration(points, r);
        if (!r.value && minGap > 0 && dur < minGap &&
            r.start > 0 && r.end < points.length) {
          for (let i = r.start; i < r.end; i++) flags[i] = true;
          suppressed.push({
            fenceId: fence.id, type: "exit", pointIndex: r.start,
            t: points[r.start].t,
            reason: `出界仅 ${dur.toFixed(1)}s，小于最小穿越时长 ${minGap}s，判定为边界抖动，未产生离开/再进入事件`
          });
        }
        if (r.value && minDwell > 0 && dur < minDwell &&
            r.start > 0 && r.end < points.length) {
          for (let i = r.start; i < r.end; i++) flags[i] = false;
          suppressed.push({
            fenceId: fence.id, type: "enter", pointIndex: r.start,
            t: points[r.start].t,
            reason: `停留仅 ${dur.toFixed(1)}s，小于最小停留时长 ${minDwell}s，判定为短暂穿越，进入/离开事件被过滤`
          });
        }
      }
    }
    return { flags, suppressed };
  }

  // 由 inside 序列生成进入/离开/停留/超速候选事件
  function fenceEvents(fence, points, flags) {
    const events = [];
    const rules = fence.rules || {};
    const mk = (type, idx, extra) => Object.assign({
      fenceId: fence.id, fenceName: fence.name, type,
      typeLabel: TYPE_LABEL[type],
      t: points[idx].t, pointIndex: idx,
      x: points[idx].x, y: points[idx].y
    }, extra);

    for (const r of runs(flags)) {
      if (!r.value) continue;
      if (r.start > 0 && rules.enter && rules.enter.enabled) {
        events.push(mk("enter", r.start, {
          reason: `点 #${r.start} 由围栏外进入「${fence.name}」`
        }));
      }
      const dur = runDuration(points, r);
      if (rules.dwell && rules.dwell.enabled && dur >= rules.dwell.seconds) {
        let idx = r.start;
        const target = points[r.start].t + rules.dwell.seconds;
        while (idx + 1 < r.end && points[idx + 1].t <= target) idx++;
        events.push(mk("dwell", idx, {
          reason: `在「${fence.name}」内持续停留 ${dur.toFixed(1)}s，达到阈值 ${rules.dwell.seconds}s`,
          dwellSec: dur
        }));
      }
      if (r.end < points.length && rules.exit && rules.exit.enabled) {
        events.push(mk("exit", r.end, {
          reason: `点 #${r.end} 由「${fence.name}」内离开到围栏外`
        }));
      }
    }

    if (rules.overspeed && rules.overspeed.enabled) {
      let seg = null;
      for (let i = 0; i < points.length; i++) {
        const over = flags[i] && points[i].speed != null &&
                     points[i].speed > rules.overspeed.maxKmh;
        if (over && !seg) seg = { start: i, max: points[i].speed, maxIdx: i };
        if (over && seg && points[i].speed > seg.max) {
          seg.max = points[i].speed; seg.maxIdx = i;
        }
        if (!over && seg) {
          events.push(mk("overspeed", seg.maxIdx, {
            reason: `在「${fence.name}」内速度峰值 ${seg.max.toFixed(1)} km/h，超过限速 ${rules.overspeed.maxKmh} km/h`,
            speed: seg.max
          }));
          seg = null;
        }
      }
      if (seg) {
        events.push(mk("overspeed", seg.maxIdx, {
          reason: `在「${fence.name}」内速度峰值 ${seg.max.toFixed(1)} km/h，超过限速 ${rules.overspeed.maxKmh} km/h`,
          speed: seg.max
        }));
      }
    }
    return events;
  }

  // 冲突消解：重叠围栏按优先级（priority 数值小者优先）独占点位归属；
  // 非活跃围栏在同一时刻产生的事件被压制并记录原因。
  function resolveConflicts(fences, points, perFence) {
    const kept = [];
    const suppressed = [];
    // 每个点在每个围栏的 inside 状态（已过滤抖动）
    const activeFenceAt = points.map((p, i) => {
      let best = null;
      for (const f of fences) {
        if (!perFence[f.id].flags[i]) continue;
        if (!best || f.priority < best.priority) best = f;
      }
      return best;
    });
    for (const f of fences) {
      for (const ev of perFence[f.id].events) {
        // 离开事件发生在出界后的首个外部点，应按出界前最后的内部点判定归属
        const idx = ev.type === "exit" && ev.pointIndex > 0
          ? ev.pointIndex - 1 : ev.pointIndex;
        const active = activeFenceAt[idx];
        if (!active || active.id === f.id) {
          kept.push(ev);
        } else {
          suppressed.push(Object.assign({}, ev, {
            reason: `该时刻点位归属更高优先级围栏「${active.name}」(优先级 ${active.priority})，` +
                    `「${f.name}」(优先级 ${f.priority}) 的${ev.typeLabel}候选被压制`
          }));
        }
      }
      for (const s of perFence[f.id].suppressed) {
        suppressed.push(Object.assign({
          fenceId: f.id, fenceName: f.name, typeLabel: TYPE_LABEL[s.type] || s.type,
          x: points[s.pointIndex].x, y: points[s.pointIndex].y
        }, s));
      }
    }
    kept.sort((a, b) => (a.t - b.t) || (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]));
    suppressed.sort((a, b) => a.t - b.t);
    return { events: kept, suppressed };
  }

  // 主入口：fences + points -> { events, suppressed }
  function simulate(fences, points) {
    if (!points || points.length === 0) return { events: [], suppressed: [] };
    const perFence = {};
    for (const f of fences) {
      if (!f.polygon || f.polygon.length < 3) {
        perFence[f.id] = { flags: points.map(() => false), events: [], suppressed: [] };
        continue;
      }
      const { flags, suppressed } = debounce(f, points);
      perFence[f.id] = { flags, suppressed, events: fenceEvents(f, points, flags) };
    }
    return resolveConflicts(fences, points, perFence);
  }

  const Engine = { simulate, TYPE_LABEL };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
