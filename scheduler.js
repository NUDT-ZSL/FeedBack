/* 媒体生产队列 - 确定性调度核心（纯逻辑，无 DOM 依赖，浏览器/Node 均可加载） */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Scheduler = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 稳定排序键：优先级高者优先 -> 耗时短者优先 -> id 字典序。保证同输入必然同输出。
  function compareTasks(a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.duration !== b.duration) return a.duration - b.duration;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // 校验一批任务：重复 id、依赖未知任务、自依赖、素材未登记、循环依赖。
  // 返回错误数组；非空则必须阻止调度。
  function validate(tasks, assetIds) {
    const errors = [];
    const assets = new Set(assetIds);
    const ids = new Set();
    for (const t of tasks) {
      if (ids.has(t.id)) {
        errors.push({ type: 'duplicate-id', taskId: t.id, message: '任务ID重复: ' + t.id });
      }
      ids.add(t.id);
    }
    for (const t of tasks) {
      if (!assets.has(t.assetId)) {
        errors.push({ type: 'missing-asset', taskId: t.id, message: '任务 ' + t.id + ' 引用的素材 ' + t.assetId + ' 未登记' });
      }
      for (const d of t.deps) {
        if (d === t.id) {
          errors.push({ type: 'self-dep', taskId: t.id, message: '任务 ' + t.id + ' 依赖了自身' });
        } else if (!ids.has(d)) {
          errors.push({ type: 'missing-dep', taskId: t.id, message: '任务 ' + t.id + ' 依赖了不存在的任务 ' + d });
        }
      }
    }
    return errors.concat(validateCycles(tasks, ids));
  }

  // Kahn 拓扑排序检测环；在剩余节点中剔除出度为 0 者，剩下的即真正的环成员
  function validateCycles(tasks, ids) {
    const indeg = new Map();
    const adj = new Map();
    for (const t of tasks) { indeg.set(t.id, 0); adj.set(t.id, []); }
    for (const t of tasks) {
      for (const d of t.deps) {
        if (ids.has(d) && d !== t.id) { adj.get(d).push(t.id); indeg.set(t.id, indeg.get(t.id) + 1); }
      }
    }
    const queue = tasks.filter(t => indeg.get(t.id) === 0).map(t => t.id).sort();
    let seen = 0;
    while (queue.length) {
      const id = queue.shift();
      seen++;
      for (const n of adj.get(id).slice().sort()) {
        indeg.set(n, indeg.get(n) - 1);
        if (indeg.get(n) === 0) queue.push(n);
      }
    }
    if (seen >= tasks.length) return [];
    const remaining = new Set(tasks.filter(t => indeg.get(t.id) > 0).map(t => t.id));
    const outdeg = new Map();
    for (const id of remaining) outdeg.set(id, 0);
    for (const t of tasks) {
      if (!remaining.has(t.id)) continue;
      for (const d of t.deps) if (remaining.has(d)) outdeg.set(d, outdeg.get(d) + 1);
    }
    const trim = [...remaining].filter(id => outdeg.get(id) === 0);
    while (trim.length) {
      const id = trim.pop();
      remaining.delete(id);
      for (const t of tasks) {
        if (!remaining.has(t.id)) continue;
        if (t.deps.includes(id)) {
          outdeg.set(t.id, outdeg.get(t.id) - 1);
          if (outdeg.get(t.id) === 0) trim.push(t.id);
        }
      }
    }
    const cyclic = [...remaining].sort();
    return [{ type: 'cycle', taskId: cyclic.join(','), message: '检测到循环依赖，涉及任务: ' + cyclic.join(', ') }];
  }

  // 在单个通道的已占用区间（按 start 升序）中，为时长 duration 找不早于 readyAt 的最早起点
  function earliestFit(intervals, readyAt, duration) {
    let candidate = readyAt;
    for (const iv of intervals) {
      if (candidate + duration <= iv.start) return candidate;
      if (iv.end > candidate) candidate = iv.end;
    }
    return candidate;
  }

  // 确定性列表调度。
  // tasks: 待排程任务（含 deps）；channelCount: 通道数；
  // fixed: 固定占用 [{taskId, channel, start, end}]（已完成/执行中任务的槽位，作为保留）。
  // 返回 [{taskId, channel, start, end}]，顺序即调度决策顺序。同输入必然同输出。
  function schedule(tasks, channelCount, fixed) {
    fixed = fixed || [];
    const endTime = new Map();
    for (const f of fixed) endTime.set(f.taskId, f.end);
    const busy = [];
    for (let c = 0; c < channelCount; c++) busy.push([]);
    for (const f of fixed) busy[f.channel].push({ start: f.start, end: f.end });
    for (const b of busy) b.sort((x, y) => x.start - y.start || x.end - y.end);

    const remaining = new Map(tasks.map(t => [t.id, t]));
    const plan = [];
    while (remaining.size) {
      const ready = [];
      for (const t of remaining.values()) {
        let ok = true;
        let readyAt = 0;
        for (const d of t.deps) {
          if (!endTime.has(d)) { ok = false; break; }
          readyAt = Math.max(readyAt, endTime.get(d));
        }
        if (ok) ready.push({ t, readyAt });
      }
      if (!ready.length) throw new Error('存在无法满足的依赖（疑似环），调度中止');
      ready.sort((x, y) => compareTasks(x.t, y.t) || (x.readyAt - y.readyAt));
      const pick = ready[0];
      let best = null;
      for (let c = 0; c < channelCount; c++) {
        const start = earliestFit(busy[c], pick.readyAt, pick.t.duration);
        if (!best || start < best.start) best = { channel: c, start };
      }
      const entry = { taskId: pick.t.id, channel: best.channel, start: best.start, end: best.start + pick.t.duration };
      busy[best.channel].push({ start: entry.start, end: entry.end });
      busy[best.channel].sort((x, y) => x.start - y.start || x.end - y.end);
      endTime.set(pick.t.id, entry.end);
      plan.push(entry);
      remaining.delete(pick.t.id);
    }
    return plan;
  }

  // 由源任务集合出发，沿依赖边推出全部下游任务（传递闭包）
  function downstreamClosure(tasks, sourceIds) {
    const dependents = new Map();
    for (const t of tasks) {
      for (const d of t.deps) {
        if (!dependents.has(d)) dependents.set(d, []);
        dependents.get(d).push(t.id);
      }
    }
    const out = new Set();
    const stack = [...sourceIds];
    while (stack.length) {
      const id = stack.pop();
      for (const n of dependents.get(id) || []) {
        if (!out.has(n)) { out.add(n); stack.push(n); }
      }
    }
    return out;
  }

  return { compareTasks, validate, schedule, downstreamClosure, earliestFit };
});
