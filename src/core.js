/**
 * core.js — 专注会话恢复工作台的纯函数推导引擎
 *
 * 设计约定：
 * - 所有时间使用「会话相对分钟数」（非负有限数，允许小数），由 UI 负责与 HH:MM 互转。
 * - 阶段：有先后顺序（order 从 1 开始、唯一）、预算时长（正数分钟）、状态。
 * - 打断记录：带来源、发生区间 [start,end]、消解状态；同一 interruptionId 可被多个来源分别报入。
 * - 净打断区间：只采用「消解为成立（confirmed）」的记录，按确定性规则合并：
 *     先按 (start 升序, end 升序, 来源名) 排序，再线性扫描，相交或相接（gap<=0）即归并。
 * - 排程：阶段从 t=0 起按顺序排布，净打断落在某阶段占用窗内的部分顺延该阶段，
 *     即「占用窗 = 预算 + 窗内打断」，阶段间首尾相接。
 * - 全程纯函数、无 Date.now/Math.random，同一输入永远得到同一输出（含数组顺序）。
 */

const STAGE_STATUS = Object.freeze({
  PENDING: 'pending',   // 未开始
  ACTIVE: 'active',     // 进行中
  DONE: 'done',         // 已完成
});

const RESOLUTION = Object.freeze({
  PENDING: 'pending',     // 待消解（未确认，不参与净打断）
  CONFIRMED: 'confirmed', // 确认打断成立 → 计入净打断
  DISMISSED: 'dismissed', // 否决（误报）→ 不参与净打断
});

let stageSeq = 0;
let interruptionSeq = 0;
let sourceSeq = 0;

/** 构造一个阶段输入对象（顺序默认追加到末尾） */
function makeStage({ id, name, budgetMinutes, order, status = STAGE_STATUS.PENDING }) {
  return {
    id: id || `stage_${++stageSeq}`,
    name: name || `阶段 ${order ?? '?'}`,
    budgetMinutes,
    order,
    status,
  };
}

/** 构造一条打断来源记录 */
function makeSourceRecord({ id, source, start, end, resolution = RESOLUTION.PENDING }) {
  return { id: id || `src_${++sourceSeq}`, source, start, end, resolution };
}

/** 构造一条打断（可含多个来源记录） */
function makeInterruption({ id, reason, sources = [] }) {
  return { id: id || `int_${++interruptionSeq}`, reason: reason || '未说明原因', sources: sources.map((s) => ({ ...s })) };
}

function createSession({ name = '专注会话', stages = [], interruptions = [], nowMinutes = null } = {}) {
  return {
    name,
    nowMinutes,
    stages: stages.map((s) => ({ ...s })),
    interruptions: interruptions.map((i) => ({ ...i, sources: i.sources.map((s) => ({ ...s })) })),
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 校验阶段。返回 { ok, errors }，errors 形如：
 * { stageId, index, order, code, message, at } —— at 给出顺序号等定位信息。
 */
function validateStages(stages) {
  const errors = [];
  if (!Array.isArray(stages) || stages.length === 0) {
    errors.push({ code: 'NO_STAGES', message: '至少需要一个工作阶段' });
    return { ok: false, errors };
  }

  stages.forEach((s, index) => {
    if (!isNum(s.budgetMinutes) || s.budgetMinutes <= 0) {
      errors.push({
        stageId: s.id, index, order: s.order,
        code: 'BAD_BUDGET',
        message: `第 ${index + 1} 行「${s.name || '(未命名阶段)'}」预算时长必须为正数，收到 ${fmt(s.budgetMinutes)}`,
        at: `index=${index}, order=${s.order}`,
      });
    }
    if (!Number.isInteger(s.order) || s.order < 1) {
      errors.push({
        stageId: s.id, index, order: s.order,
        code: 'BAD_ORDER',
        message: `第 ${index + 1} 行「${s.name || '(未命名阶段)'}」顺序必须为 ≥1 的整数，收到 ${fmt(s.order)}`,
        at: `index=${index}`,
      });
    }
    if (s.status && !Object.values(STAGE_STATUS).includes(s.status)) {
      errors.push({
        stageId: s.id, index, order: s.order,
        code: 'BAD_STATUS',
        message: `第 ${index + 1} 行「${s.name}」状态非法：${s.status}`,
      });
    }
  });

  const seen = new Map();
  for (const s of stages) {
    if (!Number.isInteger(s.order) || s.order < 1) continue;
    if (seen.has(s.order)) {
      const other = seen.get(s.order);
      errors.push({
        stageId: s.id, index: stages.indexOf(s), order: s.order,
        code: 'DUP_ORDER',
        message: `顺序重复：order=${s.order} 同时出现在「${other.name}」与「${s.name}」`,
        at: `order=${s.order}`,
      });
    } else {
      seen.set(s.order, s);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 校验打断来源记录。返回 { ok, errors }。
 * 零长区间、起止颠倒、缺来源、非法消解状态都会被拒绝并定位到打断与来源。
 */
function validateInterruptions(interruptions) {
  const errors = [];
  if (!Array.isArray(interruptions)) {
    return { ok: false, errors: [{ code: 'BAD_SHAPE', message: '打断列表必须是数组' }] };
  }
  interruptions.forEach((it, iIndex) => {
    if (!it.sources || it.sources.length === 0) {
      errors.push({
        interruptionId: it.id, index: iIndex, code: 'NO_SOURCE',
        message: `打断「${it.reason || it.id}」至少需要一个来源记录`,
      });
    }
    it.sources?.forEach((sr, sIndex) => {
      const where = `打断「${it.reason || it.id}」/来源「${sr.source || '?'}」`;
      if (!sr.source || String(sr.source).trim() === '') {
        errors.push({ interruptionId: it.id, sourceId: sr.id, index: iIndex, sourceIndex: sIndex, code: 'NO_SOURCE_NAME', message: `${where}：来源名称不能为空` });
      }
      if (!isNum(sr.start) || !isNum(sr.end)) {
        errors.push({ interruptionId: it.id, sourceId: sr.id, index: iIndex, sourceIndex: sIndex, code: 'BAD_TIME', message: `${where}：区间端点必须是有限数字，收到 [${fmt(sr.start)}, ${fmt(sr.end)}]` });
      } else {
        if (sr.end <= sr.start) {
          errors.push({
            interruptionId: it.id, sourceId: sr.id, index: iIndex, sourceIndex: sIndex,
            code: sr.end === sr.start ? 'ZERO_LEN' : 'REVERSED',
            message: `${where}：${sr.end === sr.start ? '零长区间' : '起止颠倒'} [${fmt(sr.start)}, ${fmt(sr.end)}]，要求 start < end`,
          });
        }
        if (sr.start < 0) {
          errors.push({ interruptionId: it.id, sourceId: sr.id, index: iIndex, sourceIndex: sIndex, code: 'NEG_START', message: `${where}：起点不能为负（${fmt(sr.start)}）` });
        }
      }
      if (sr.resolution && !Object.values(RESOLUTION).includes(sr.resolution)) {
        errors.push({ interruptionId: it.id, sourceId: sr.id, index: iIndex, sourceIndex: sIndex, code: 'BAD_RESOLUTION', message: `${where}：消解状态非法 ${sr.resolution}` });
      }
    });
  });
  return { ok: errors.length === 0, errors };
}

const fmt = (v) => (isNum(v) ? String(Math.round(v * 1000) / 1000) : String(v));

/** 区间交集；无交集返回 null */
function intersect(a, b) {
  const lo = Math.max(a.start, b.start);
  const hi = Math.min(a.end, b.end);
  return hi > lo ? { start: lo, end: hi } : null;
}

function intervalLen(iv) {
  return Math.max(0, iv.end - iv.start);
}

/**
 * 由「已确认」来源记录构建净打断区间。
 * 确定性规则：
 *  1) 只取 resolution === 'confirmed' 的来源记录（每条记录自带 interruptionId/source 元数据）；
 *  2) 按 (start, end, interruptionId, sourceId) 升序排序；
 *  3) 线性扫描，与当前段相交或首尾相接（start <= cur.end）即归并；
 * 合并段 members 记录贡献了它的全部来源，便于追溯。
 */
function buildNetIntervals(interruptions) {
  const flat = [];
  for (const it of interruptions) {
    for (const sr of it.sources || []) {
      if (sr.resolution === RESOLUTION.CONFIRMED && isNum(sr.start) && isNum(sr.end) && sr.end > sr.start) {
        flat.push({
          start: sr.start, end: sr.end,
          interruptionId: it.id, reason: it.reason,
          sourceId: sr.id, source: sr.source,
        });
      }
    }
  }
  flat.sort((a, b) =>
    a.start - b.start ||
    a.end - b.end ||
    (a.interruptionId < b.interruptionId ? -1 : a.interruptionId > b.interruptionId ? 1 : 0) ||
    (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
  );

  const merged = [];
  for (const f of flat) {
    const cur = merged[merged.length - 1];
    if (cur && f.start <= cur.end) {
      if (f.end > cur.end) cur.end = f.end;
      cur.members.push({ interruptionId: f.interruptionId, reason: f.reason, sourceId: f.sourceId, source: f.source, start: f.start, end: f.end });
    } else {
      merged.push({ start: f.start, end: f.end, members: [{ interruptionId: f.interruptionId, reason: f.reason, sourceId: f.sourceId, source: f.source, start: f.start, end: f.end }] });
    }
  }
  return merged.map((m, idx) => ({ ...m, index: idx, duration: intervalLen(m) }));
}

/**
 * 多源冲突检测（不做静默择一）。冲突类型：
 *  - interval : 同一打断的来源记录区间不一致（端点差异）且时间上有重叠；
 *  - resolution: 同一打断的来源之间消解结论矛盾（confirmed vs dismissed）。
 * 同一打断下「来源名 + 区间 + 结论」完全相同的记录视为重复佐证，不算冲突。
 * 返回确定性排序的冲突列表。
 */
function detectConflicts(interruptions) {
  const conflicts = [];
  for (const it of interruptions) {
    const recs = (it.sources || []).filter((s) => isNum(s.start) && isNum(s.end) && s.end > s.start);
    // 区间矛盾：两两比较
    for (let i = 0; i < recs.length; i++) {
      for (let j = i + 1; j < recs.length; j++) {
        const a = recs[i], b = recs[j];
        const overlap = intersect(a, b);
        const differs = a.start !== b.start || a.end !== b.end;
        if (differs && overlap) {
          conflicts.push({
            id: `${it.id}:interval:${a.id}|${b.id}`,
            interruptionId: it.id, reason: it.reason, type: 'interval',
            a: { sourceId: a.id, source: a.source, start: a.start, end: a.end, resolution: a.resolution },
            b: { sourceId: b.id, source: b.source, start: b.start, end: b.end, resolution: b.resolution },
            overlap,
            message: `打断「${it.reason}」区间冲突：${a.source} 报 [${fmt(a.start)}, ${fmt(a.end)}]，${b.source} 报 [${fmt(b.start)}, ${fmt(b.end)}]，重叠 [${fmt(overlap.start)}, ${fmt(overlap.end)}]`,
          });
        }
      }
    }
    // 消解结论矛盾：同时存在 confirmed 与 dismissed
    const confirmed = recs.filter((s) => s.resolution === RESOLUTION.CONFIRMED);
    const dismissed = recs.filter((s) => s.resolution === RESOLUTION.DISMISSED);
    if (confirmed.length && dismissed.length) {
      conflicts.push({
        id: `${it.id}:resolution`,
        interruptionId: it.id, reason: it.reason, type: 'resolution',
        a: { sourceId: confirmed[0].id, source: confirmed[0].source, start: confirmed[0].start, end: confirmed[0].end, resolution: 'confirmed' },
        b: { sourceId: dismissed[0].id, source: dismissed[0].source, start: dismissed[0].start, end: dismissed[0].end, resolution: 'dismissed' },
        message: `打断「${it.reason}」消解冲突：${confirmed.map((c) => c.source).join('、')} 判定成立，${dismissed.map((d) => d.source).join('、')} 判定否决`,
      });
    }
  }
  conflicts.sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return conflicts;
}

/**
 * 排程 + 计入推导。
 *
 * 轴：会话相对「挂钟分钟」，阶段从 t=0 起首尾相接。净打断区间也在同一根挂钟轴上
 * （打断发生的客观时刻固定，不随后续排程移动）。
 *
 * 阶段占用窗：起点 = 上一阶段占用窗终点。沿挂钟轴单趟扫描——工作间隙里累计工作分钟，
 * 遇到净打断整段跳过（不产出工作），累计满 budget 的那一刻即占用窗终点。这样净打断横跨
 * 阶段边界、相接、多条交错都能一次正确处理，且同一净打断绝不会被重复计入。
 * 占用窗 = 预算工作 + 窗内净打断，阶段间首尾相接。
 *
 * 已计工作前沿 F（挂钟时刻）：F 之前的挂钟时间都已经历。某阶段
 *   countedMinutes   = 该阶段占用窗内、且位于 [0,F] 中的「工作片段」总长（占用窗扣除打断）；
 *   remainingMinutes = budget − counted。
 * F 取 session.nowMinutes（界面上可显式推进/回退）；未设置时回退到「从第一个阶段起连续
 * done 前缀」的最后一个 done 阶段占用窗终点。这样计入完全由净打断区间与前沿决定。
 */
function computeSchedule(session, netIntervals) {
  const stages = [...session.stages].sort((a, b) => a.order - b.order);
  const results = [];
  let cursor = 0;

  for (const stage of stages) {
    const windowStart = cursor;
    // 单趟扫描：在工作间隙累计工作时长，遇到净打断整段跳过，直到攒满 budget。
    const cuts = [];
    let work = 0;
    let t = windowStart;
    for (const net of netIntervals) {
      if (net.end <= t) continue; // 净区间完全落在游标之前
      if (net.start > t) {
        const need = stage.budgetMinutes - work;
        const gap = net.start - t;
        if (gap >= need) { t += need; work = stage.budgetMinutes; break; }
        work += gap;
        t = net.start;
      }
      // 此刻 net.start <= t < net.end：游标处于打断内，整段跳到打断终点。
      cuts.push({ netIndex: net.index, start: t, end: net.end, duration: net.end - t, members: net.members });
      t = net.end;
    }
    if (work < stage.budgetMinutes) t += stage.budgetMinutes - work;
    const windowEnd = t;
    // 安全裁剪：仅保留确实落在本阶段占用窗内的打断片段（跨阶段边界处自然切开）。
    for (const c of cuts) {
      c.start = Math.max(windowStart, c.start);
      c.end = Math.min(windowEnd, c.end);
      c.duration = intervalLen({ start: c.start, end: c.end });
    }

    const workingFragments = fragmentsAfterCuts(windowStart, windowEnd, cuts);
    results.push({
      stageId: stage.id,
      name: stage.name,
      order: stage.order,
      status: stage.status,
      budgetMinutes: stage.budgetMinutes,
      windowStart,
      windowEnd,
      interruptionInWindow: cuts.reduce((n, c) => n + c.duration, 0),
      cuts: cuts.sort((a, b) => a.start - b.start || a.end - b.end),
      workingFragments,
    });
    cursor = windowEnd;
  }

  const sessionEnd = cursor;
  const frontier = selectFrontier(session, results);

  for (const r of results) {
    let counted = 0;
    for (const f of r.workingFragments) {
      const hit = intersect(f, { start: 0, end: frontier });
      if (hit) counted += intervalLen(hit);
    }
    counted = Math.max(0, Math.min(r.budgetMinutes, counted));
    counted = Math.round(counted * 1e6) / 1e6;
    r.countedMinutes = counted;
    r.remainingMinutes = Math.round((r.budgetMinutes - counted) * 1e6) / 1e6;
    r.countedFragments = r.workingFragments
      .map((f) => intersect(f, { start: 0, end: frontier }))
      .filter(Boolean);
  }

  const resume = computeResume(results, frontier);
  return { stages: results, resume, frontier, sessionEnd };
}

/** 已计工作前沿：显式 nowMinutes 优先（裁到 [0,sessionEnd]），否则取连续 done 前缀末端。 */
function selectFrontier(session, stageResults) {
  if (isNum(session.nowMinutes)) {
    return Math.max(0, Math.min(session.nowMinutes, stageResults.length ? stageResults[stageResults.length - 1].windowEnd : 0));
  }
  let f = 0;
  for (const r of stageResults) {
    if (r.status === STAGE_STATUS.DONE) f = r.windowEnd;
    else break;
  }
  return f;
}

/** 把 [start,end] 中被 cuts 覆盖的部分挖掉，返回剩余工作片段（cuts 互不重叠） */
function fragmentsAfterCuts(start, end, cuts) {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const frags = [];
  let t = start;
  for (const c of sorted) {
    const cs = Math.max(c.start, start);
    const ce = Math.min(c.end, end);
    if (ce <= cs) continue;
    if (cs > t) frags.push({ start: t, end: cs });
    t = Math.max(t, ce);
  }
  if (t < end) frags.push({ start: t, end: end });
  return frags;
}

/**
 * 恢复位置：第一个仍有剩余额度的阶段；offsetMinutes 为该阶段已计入的工作分钟，
 * 即「继续进入」时应落在的工作位置（剩余位置）。全部完成 → completed。
 */
function computeResume(stageResults, frontier) {
  const next = stageResults.find((s) => s.remainingMinutes > 1e-6);
  if (!next) {
    return { completed: true, stageId: null, name: null, order: null, offsetMinutes: 0, remainingMinutes: 0, frontier };
  }
  return {
    completed: false,
    stageId: next.stageId,
    name: next.name,
    order: next.order,
    offsetMinutes: next.countedMinutes,
    remainingMinutes: next.remainingMinutes,
    windowStart: next.windowStart,
    frontier,
  };
}

/**
 * 把一条来源记录补报进会话。返回新会话 + 处理说明。
 * - 校验失败：{ ok:false, errors }，会话不变。
 * - 越界（起点 < 0 或区间超出会话末端）：裁剪后写入，truncations 说明原始/裁剪后区间与丢弃长度。
 * - 同一 interruptionId 下追加来源；新 interruptionId 则新建打断。
 */
function addSourceReport(session, { interruptionId, reason, source, start, end, resolution = RESOLUTION.PENDING }) {
  const draft = makeSourceRecord({ source, start, end, resolution });
  const probeIt = makeInterruption({ id: interruptionId, reason, sources: [draft] });
  // 结构性错误（零长/颠倒/非数字/缺来源/非法状态）直接拒绝；
  // 负起点不在此拒绝——补报语义下它由越界裁剪处理（裁到 0）。
  const v = validateInterruptions([probeIt]);
  const hardErrors = v.errors.filter((e) => e.code !== 'NEG_START');
  if (hardErrors.length) return { ok: false, errors: hardErrors, session: cloneSession(session) };

  const truncations = [];
  let s = start, e = end;
  if (s < 0) {
    truncations.push({ kind: 'before-start', original: { start, end }, clipped: { start: 0, end: e }, droppedMinutes: -s });
    s = 0;
  }
  // 会话末端：当前排程末端（不含新打断自身）。用 confirmed 净区间估算末端。
  const existingNet = buildNetIntervals(session.interruptions);
  const tentative = computeSchedule(session, existingNet);
  const horizon = tentative.sessionEnd;
  if (e > horizon) {
    truncations.push({ kind: 'past-end', original: { start, end }, clipped: { start: s, end: horizon }, droppedMinutes: e - horizon });
    e = horizon;
  }
  if (!(e > s)) {
    return { ok: false, errors: [{ code: 'CLIPPED_AWAY', message: `补报区间 [${fmt(start)}, ${fmt(end)}] 裁剪后为空（会话范围 [0, ${fmt(horizon)}]），未写入` }], session: cloneSession(session), truncations };
  }

  const next = cloneSession(session);
  let it = next.interruptions.find((x) => x.id === interruptionId);
  if (!it) {
    it = makeInterruption({ id: interruptionId, reason: reason || '未说明原因', sources: [] });
    next.interruptions.push(it);
  } else if (reason) {
    it.reason = reason;
  }
  it.sources.push(makeSourceRecord({ source, start: s, end: e, resolution }));
  next.interruptions.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { ok: true, session: next, truncations: truncations.map((t) => ({ ...t, source, interruptionId })) };
}

/** 设置某条来源记录的消解结论（返回新会话） */
function resolveSource(session, interruptionId, sourceId, resolution) {
  if (!Object.values(RESOLUTION).includes(resolution)) {
    return { ok: false, errors: [{ code: 'BAD_RESOLUTION', message: `非法消解状态 ${resolution}` }] };
  }
  const next = cloneSession(session);
  const it = next.interruptions.find((x) => x.id === interruptionId);
  const sr = it?.sources.find((s) => s.id === sourceId);
  if (!sr) return { ok: false, errors: [{ code: 'NOT_FOUND', message: '未找到对应来源记录' }] };
  sr.resolution = resolution;
  return { ok: true, session: next };
}

/**
 * 重推后的影响审计：对比前后两次排程，给出：
 *  - changedStages / unchangedStages（按 counted 与 timeline 判定，未受影响阶段必须不动）；
 *  - doubleCountDeductions：回填后净打断与「旧排程中已计入片段」交叠而被扣减的部分，
 *    逐条给出净打断、阶段、交叠区间与贡献来源（扣减来源台账）；
 *  - conservation：逐阶段校验 counted + remaining === budget。
 */
function diffSchedules(before, after) {
  const changedStages = [];
  const unchangedStages = [];
  for (const b of before.stages) {
    const a = after.stages.find((x) => x.stageId === b.stageId);
    const same = a &&
      a.windowStart === b.windowStart && a.windowEnd === b.windowEnd &&
      a.countedMinutes === b.countedMinutes && a.remainingMinutes === b.remainingMinutes;
    if (same) unchangedStages.push(b.stageId);
    else changedStages.push({ stageId: b.stageId, name: a?.name ?? b.name, before: b, after: a });
  }

  // 双重计扣减：新净打断裁掉的片段若位于旧排程该阶段「已计入工作片段」（旧前沿之前）内，
  // 则该部分在补报前已被计过一次，回填后必须扣减，做到同一时刻不被计两次。
  const deductions = [];
  for (const a of after.stages) {
    const b = before.stages.find((x) => x.stageId === a.stageId);
    if (!b) continue;
    for (const cut of a.cuts) {
      for (const frag of (b.countedFragments || b.workingFragments)) {
        const over = intersect({ start: cut.start, end: cut.end }, frag);
        if (over) {
          deductions.push({
            stageId: a.stageId, name: a.name,
            netIndex: cut.netIndex,
            overlap: over,
            duration: intervalLen(over),
            // 只保留真正落在交叠段内的成员来源（台账精确到来源区间）
            sources: cut.members
              .map((m) => ({ m, part: intersect(m, over) }))
              .filter((x) => x.part)
              .map((x) => ({ interruptionId: x.m.interruptionId, reason: x.m.reason, source: x.m.source, sourceId: x.m.sourceId, interval: x.part })),
            message: `阶段「${a.name}」扣减重复计入 ${fmt(intervalLen(over))} 分钟 [${fmt(over.start)}, ${fmt(over.end)}]，来源：${cut.members.map((m) => `${m.source}(${m.reason})`).join('、')}`,
          });
        }
      }
    }
  }

  const conservation = after.stages.map((s) => ({
    stageId: s.stageId, name: s.name,
    budget: s.budgetMinutes, counted: s.countedMinutes, remaining: s.remainingMinutes,
    ok: Math.abs(s.countedMinutes + s.remainingMinutes - s.budgetMinutes) < 1e-6,
  }));

  return {
    changedStages,
    unchangedStages,
    doubleCountDeductions: deductions,
    conservation,
    conservationOk: conservation.every((c) => c.ok),
  };
}

/** 一键推导：校验 → 净区间 → 冲突 → 排程。任何校验失败都返回 errors 而不产出排程。 */
function derive(session) {
  const sv = validateStages(session.stages);
  const iv = validateInterruptions(session.interruptions);
  const errors = [...sv.errors, ...iv.errors];
  if (errors.length) return { ok: false, errors, netIntervals: [], conflicts: detectConflicts(session.interruptions), schedule: null };
  const netIntervals = buildNetIntervals(session.interruptions);
  const conflicts = detectConflicts(session.interruptions);
  const schedule = computeSchedule(session, netIntervals);
  return { ok: true, errors: [], netIntervals, conflicts, schedule };
}

function cloneSession(s) {
  return createSession({
    name: s.name,
    nowMinutes: s.nowMinutes,
    stages: s.stages,
    interruptions: s.interruptions,
  });
}

// ---- 双环境挂载：浏览器经典脚本挂 globalThis.FocusCore；Node 走 module.exports ----
const FocusCore = {
  STAGE_STATUS, RESOLUTION,
  makeStage, makeSourceRecord, makeInterruption, createSession, cloneSession,
  validateStages, validateInterruptions,
  intersect, intervalLen, buildNetIntervals, detectConflicts,
  computeSchedule, derive, addSourceReport, resolveSource, diffSchedules,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FocusCore;
} else {
  globalThis.FocusCore = FocusCore;
}
