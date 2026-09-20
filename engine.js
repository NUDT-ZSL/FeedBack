// 确定性采样链路推演引擎：所有输入都是可重放事件。
// UI 的“增量推送”通过重算前后批次快照 diff 得到，因此与全量推演严格同源。

export const STATUS = Object.freeze({
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNTRUSTED: "untrusted"
});

export const STATUS_TEXT = Object.freeze({
  complete: "完整",
  partial: "部分缺失",
  untrusted: "不可信"
});

let eventSerial = 1;

export function resetEventSerial(value = 1) {
  eventSerial = value;
}

export function nextEventId(prefix = "e") {
  return `${prefix}${String(eventSerial++).padStart(3, "0")}`;
}

export function createState() {
  return {
    events: [],
    devices: {},
    deviceStartSeq: {},
    deviceExpectedIntervalMs: {},
    batches: [],
    conflicts: [],
    resume: [],
    records: [],
    unassignable: [],
    issues: [],
    lastPush: null
  };
}

export function nowMs() {
  return Date.now();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return NaN;
  const t = Date.parse(value);
  return Number.isNaN(t) ? NaN : t;
}

function normalizeNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cleanValue(value) {
  const n = normalizeNumber(value);
  return n === null ? String(value ?? "").trim() : n;
}

function sameValue(a, b) {
  return Object.is(a, b) || String(a) === String(b);
}

function eventTime(event) {
  const t = parseTime(event.at);
  return Number.isFinite(t) ? t : null;
}

function policyFromEvent(event, fallback) {
  const mode = event.mode || fallback.mode;
  return {
    mode: mode === "time" ? "time" : "count",
    windowMs: Number(event.windowMs) > 0 ? Number(event.windowMs) : fallback.windowMs,
    count: Number(event.count) > 0 ? Math.floor(Number(event.count)) : fallback.count
  };
}

function defaultPolicy() {
  return { mode: "count", windowMs: 60_000, count: 5 };
}

function getDeviceState(state, deviceId) {
  if (!state.devices[deviceId]) {
    state.devices[deviceId] = {
      deviceId,
      name: deviceId,
      defaultPolicy: defaultPolicy()
    };
  }
  return state.devices[deviceId];
}

export function registerDevice(state, deviceId, options = {}) {
  const d = getDeviceState(state, deviceId);
  if (options.name) d.name = options.name;
  if (options.defaultPolicy) Object.assign(d.defaultPolicy, policyFromEvent(options.defaultPolicy, d.defaultPolicy));
  if (Number.isInteger(options.startSeq)) state.deviceStartSeq[deviceId] = options.startSeq;
  if (Number.isInteger(options.expectedIntervalMs) && options.expectedIntervalMs > 0) {
    state.deviceExpectedIntervalMs[deviceId] = options.expectedIntervalMs;
  }
  return d;
}

function policyEventsFor(state, deviceId) {
  return state.events
    .filter(e => e.type === "policy" && eventTime(e) !== null && (!e.deviceId || e.deviceId === deviceId))
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
}

export function getPolicyAt(state, deviceId, at) {
  const d = getDeviceState(state, deviceId);
  let policy = { ...d.defaultPolicy };
  for (const event of policyEventsFor(state, deviceId)) {
    if (eventTime(event) <= at) policy = policyFromEvent(event, policy);
  }
  return policy;
}

function addIssue(state, code, message, eventIds = [], recordIds = []) {
  state.issues.push({ code, message, eventIds, recordIds });
}

function evidence(kind, message, recordIds = [], eventIds = [], extra = {}) {
  return { kind, message, recordIds: [...recordIds], eventIds: [...eventIds], ...extra };
}

export function addEvent(state, rawEvent) {
  const event = { ...rawEvent };
  if (!event.id) event.id = nextEventId(event.type || "e");
  if (event.at === undefined || event.at === null || event.at === "") event.at = nowMs();
  state.events.push(event);
  recompute(state, { reason: event.type, eventId: event.id });
  return state.lastPush;
}

export function addSample(state, input) {
  return addEvent(state, {
    type: "sample",
    deviceId: String(input.deviceId ?? ""),
    seq: Number(input.seq),
    sampleAt: parseTime(input.sampleAt),
    receivedAt: parseTime(input.receivedAt ?? input.at ?? nowMs()),
    value: cleanValue(input.value),
    source: input.source || "手动录入"
  });
}

export function addConnectionEvent(state, input) {
  return addEvent(state, {
    type: "connection",
    deviceId: String(input.deviceId ?? ""),
    at: parseTime(input.at ?? nowMs()),
    status: input.status === "connected" ? "connected" : "disconnected",
    reason: input.reason || ""
  });
}

export function addPolicyEvent(state, input) {
  return addEvent(state, {
    type: "policy",
    deviceId: input.deviceId ? String(input.deviceId) : "",
    at: parseTime(input.at ?? nowMs()),
    mode: input.mode,
    windowMs: input.windowMs,
    count: input.count,
    note: input.note || ""
  });
}

export function resolveConflict(state, input) {
  return addEvent(state, {
    type: "resolution",
    deviceId: String(input.deviceId ?? ""),
    seq: Number(input.seq),
    at: parseTime(input.at ?? nowMs()),
    resolution: input.resolution === "custom" ? "custom" : (input.resolution === "b" ? "b" : "a"),
    chosenRecordId: input.chosenRecordId || null,
    sampleAt: input.sampleAt === undefined ? null : parseTime(input.sampleAt),
    value: input.value === undefined ? null : cleanValue(input.value)
  });
}

export function correctRecord(state, input) {
  const recordId = String(input.recordId ?? "");
  const target = state.events.find(e => e.type === "sample" && e.id === recordId);
  if (!target) throw new Error(`找不到待修正记录：${recordId}`);
  return addEvent(state, {
    type: "correction",
    at: parseTime(input.at ?? nowMs()),
    recordId,
    deviceId: target.deviceId,
    seq: target.seq,
    value: input.value === undefined ? target.value : cleanValue(input.value),
    sampleAt: input.sampleAt === undefined ? target.sampleAt : parseTime(input.sampleAt)
  });
}

function recordInvariants(event) {
  return {
    id: event.id,
    eventId: event.id,
    deviceId: String(event.deviceId ?? ""),
    seq: Number(event.seq),
    sampleAt: Number.isFinite(event.sampleAt) ? event.sampleAt : null,
    receivedAt: Number.isFinite(event.receivedAt) ? event.receivedAt : eventTime(event),
    value: event.value,
    source: event.source || ""
  };
}

function latestResolution(state, deviceId, seq) {
  const key = `${deviceId}\u0000${seq}`;
  const found = state.events
    .filter(e => e.type === "resolution" && e.deviceId === deviceId && Number(e.seq) === seq)
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id))
    .at(-1);
  return found || state.resolutionByKey?.[key] || null;
}

function latestCorrection(state, recordId) {
  return state.events
    .filter(e => e.type === "correction" && e.recordId === recordId)
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id))
    .at(-1) || null;
}

function effectiveRecords(state) {
  return state.events
    .filter(e => e.type === "sample" && e.deviceId && Number.isInteger(e.seq))
    .map(event => {
      const rec = recordInvariants(event);
      const correction = latestCorrection(state, rec.id);
      if (correction) {
        if (correction.value !== undefined) rec.value = correction.value;
        if (correction.sampleAt !== undefined && correction.sampleAt !== null) rec.sampleAt = correction.sampleAt;
        rec.correctedBy = correction.id;
      }
      if (!Number.isFinite(rec.receivedAt)) rec.receivedAt = null;
      return rec;
    })
    .sort((a, b) =>
      (a.receivedAt ?? 0) - (b.receivedAt ?? 0) ||
      a.id.localeCompare(b.id));
}

function groupConflicts(state, records) {
  const groups = new Map();
  for (const rec of records) {
    const key = `${rec.deviceId}\u0000${rec.seq}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const conflicts = [];
  const canonical = new Map();
  for (const [key, list0] of groups) {
    const list = list0.sort((a, b) =>
      (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.id.localeCompare(b.id));
    const signatures = new Set(list.map(r => `${String(r.value)}\u0000${r.sampleAt ?? ""}`));
    const [deviceId, seqText] = key.split("\u0000");
    const seq = Number(seqText);
    const resolution = latestResolution(state, deviceId, seq);
    const hasConflict = signatures.size > 1;

    let chosen = list[0];
    let resolutionSampleAt = null;
    let resolutionValue = undefined;
    let resolved = false;
    if (hasConflict && resolution) {
      if (resolution.chosenRecordId) {
        const picked = list.find(r => r.id === resolution.chosenRecordId);
        if (picked) chosen = picked;
      } else if (resolution.resolution === "b") {
        chosen = list[list.length - 1];
      } else if (resolution.resolution === "a") {
        chosen = list[0];
      }
      if (resolution.resolution === "custom") {
        resolutionValue = resolution.value === null ? chosen.value : resolution.value;
        resolutionSampleAt = Number.isFinite(resolution.sampleAt) ? resolution.sampleAt : null;
        chosen = {
          ...chosen,
          value: resolutionValue,
          sampleAt: resolutionSampleAt ?? chosen.sampleAt,
          resolvedBy: resolution.id
        };
      } else {
        chosen = { ...chosen, resolvedBy: resolution.id };
      }
      resolved = true;
    }

    canonical.set(key, chosen);
    if (resolved) {
      chosen.resolutionValue = resolutionValue;
      chosen.resolutionSampleAt = resolutionSampleAt;
    }
    if (hasConflict) {
      conflicts.push({
        id: `conflict:${deviceId}:${seq}`,
        deviceId,
        seq,
        status: resolved ? "resolved" : "open",
        resolution,
        chosenRecordId: chosen.id,
        records: list
      });
    }
  }
  return { conflicts, canonical };
}

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

function inferCadence(state, deviceId, canonicalSlots) {
  const configured = state.deviceExpectedIntervalMs[deviceId];
  const slots = [...canonicalSlots.values()]
    .filter(s => s.deviceId === deviceId && Number.isFinite(s.sampleAt))
    .sort((a, b) => a.seq - b.seq);
  const pairs = [];
  for (let i = 1; i < slots.length; i += 1) {
    const dSeq = slots[i].seq - slots[i - 1].seq;
    const dTime = slots[i].sampleAt - slots[i - 1].sampleAt;
    if (dSeq > 0 && dTime > 0 && Number.isInteger(dTime / dSeq)) pairs.push(dTime / dSeq);
  }
  if (configured) return { intervalMs: configured, reliable: true, configured: true };
  if (!pairs.length) return { intervalMs: null, reliable: false, configured: false };
  const interval = pairs.reduce((acc, n) => gcd(acc, n), pairs[0]);
  // 仅当所有已知相邻样本都符合同一个整数节拍时，才把缺失槽位放入精确时间窗。
  const reliable = interval > 0 && pairs.every(n => Number.isInteger(n / interval));
  return { intervalMs: reliable ? interval : null, reliable, configured: false };
}

function makeSlot({
  deviceId,
  seq,
  status,
  delivered = null,
  duplicateRecordIds = [],
  conflictId = null,
  reason = "",
  inferredSampleAt = null
}) {
  return {
    deviceId,
    seq,
    status,
    delivered,
    duplicateRecordIds,
    conflictId,
    reason,
    inferredSampleAt
  };
}

function relevantTimedEvents(state, deviceId) {
  return state.events
    .filter(e => ["policy", "connection"].includes(e.type) && eventTime(e) !== null && (!e.deviceId || e.deviceId === deviceId))
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
}

function buildCountPeriods(state, deviceId, slots) {
  const initial = { ...getDeviceState(state, deviceId).defaultPolicy };
  const policyTimeline = [];
  let cursor = initial;
  for (const event of policyEventsFor(state, deviceId)) {
    const next = policyFromEvent(event, cursor);
    policyTimeline.push({ at: eventTime(event), event, previous: cursor, policy: next });
    cursor = next;
  }

  const periods = [];
  let current = null;
  let lastClosedSeq = null;
  const delivered = [...slots]
    .filter(s => s.status === "delivered")
    .sort((a, b) => (a.delivered.receivedAt ?? 0) - (b.delivered.receivedAt ?? 0) || a.seq - b.seq);
  const timeline = policyTimeline
    .map(item => ({ type: "boundary", ...item }))
    .concat(delivered.map(s => ({ type: "delivery", at: s.delivered.receivedAt, slot: s })))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (a.type === "delivery" ? -1 : 1) || JSON.stringify(a).localeCompare(JSON.stringify(b)));

  function closePeriod(at, event = null) {
    if (!current) return;
    if (current.deliveredSeq.length) {
      const maxSeq = Math.max(...current.deliveredSeq);
      current.cutoffSeq = maxSeq;
      current.closedBy = event?.id || null;
      periods.push(current);
      lastClosedSeq = maxSeq;
    } else {
      current.empty = true;
      periods.push(current);
    }
    current = null;
  }

  let policy = initial;
  for (const item of timeline) {
    if (item.type === "boundary") {
      const next = item.policy;
      const shouldClose = current && current.deliveredSeq.length > 0 &&
        (next.mode !== current.policy.mode ||
          (next.mode === "count" && next.count !== current.policy.count));
      if (shouldClose) closePeriod(item.at, item.event);
      policy = next;
      if (current) current.policy = next;
    } else if (item.slot) {
      const at = item.at;
      if (!current && policy.mode === "count") {
        current = {
          deviceId,
          mode: "count",
          policy: { ...policy },
          startedAt: at,
          startSeq: lastClosedSeq === null ? item.slot.seq : lastClosedSeq + 1,
          deliveredSeq: [],
          allSlots: []
        };
      }
      if (current && policy.mode === "count") current.deliveredSeq.push(item.slot.seq);
      if (!current && policy.mode === "time") lastClosedSeq = item.slot.seq;
    }
  }
  if (current && current.deliveredSeq.length) periods.push(current);
  return periods;
}

function assignCountBatches(period, batches) {
  if (period.empty) return [];
  const min = Math.min(...period.deliveredSeq);
  const max = period.cutoffSeq ?? Math.max(...period.deliveredSeq);
  const count = period.policy.mode === "count" ? period.policy.count : period.policy.count;
  const start = period.startSeq ?? min;
  const firstIndex = Math.max(0, Math.floor((min - start) / count));
  const lastIndex = Math.max(0, Math.floor((max - start) / count));
  const assigned = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const batchStart = start + index * count;
    const batchEnd = batchStart + count - 1;
    const id = `${period.deviceId}|count|${period.startedAt}|${index}`;
    const batch = {
      id,
      deviceId: period.deviceId,
      mode: "count",
      batchIndex: index,
      startSeq: batchStart,
      endSeq: batchEnd,
      openedAt: period.startedAt,
      closedByPolicy: Boolean(period.cutoffSeq && period.cutoffSeq === batchEnd && period.closedBy),
      closeEventId: period.closedBy && period.cutoffSeq === batchEnd ? period.closedBy : null,
      slots: [],
      evidence: []
    };
    batches.push(batch);
    assigned.push(batch);
  }
  return assigned;
}

function timeSegmentBase(at) {
  // 仅用于稳定地把策略生效后的时间映射到窗口序号。
  return Math.floor(at / 1000) * 1000;
}

function buildTimePeriods(state, deviceId, slots, cadence) {
  const d = getDeviceState(state, deviceId);
  const initialBoundary = {
    at: -Infinity,
    event: null,
    policy: { ...d.defaultPolicy }
  };
  const policyChanges = policyEventsFor(state, deviceId).map(event => ({
    at: eventTime(event),
    event,
  }));
  const boundaries = [];
  let runningPolicy = initialBoundary.policy;
  for (const boundary of policyChanges) {
    runningPolicy = policyFromEvent(boundary.event, runningPolicy);
    boundaries.push({ ...boundary, policy: runningPolicy });
  }
  boundaries.unshift(initialBoundary);

  const result = [];
  let active = null;
  for (const boundary of boundaries) {
    if (boundary.policy.mode !== "time") {
      if (active) {
        active.endAt = boundary.at;
        active.closeEventId = boundary.event?.id || null;
        result.push(active);
        active = null;
      }
      continue;
    }
    if (!active) {
      active = {
        deviceId,
        mode: "time",
        startAt: boundary.at,
        endAt: null,
        base: Number.isFinite(boundary.at) ? timeSegmentBase(boundary.at) : 0,
        policy: boundary.policy,
        closeEventId: null
      };
    } else if (boundary.policy.windowMs !== active.policy.windowMs) {
      active.endAt = boundary.at;
      active.closeEventId = boundary.event?.id || null;
      result.push(active);
      active = {
        deviceId,
        mode: "time",
        startAt: boundary.at,
        endAt: null,
        base: timeSegmentBase(boundary.at),
        policy: boundary.policy,
        closeEventId: null
      };
    }
  }
  if (active) result.push(active);

  for (const period of result) {
    period.batches = new Map();
    period.deliveredSlots = [];
    for (const slot of slots) {
      if (slot.status !== "delivered" || !Number.isFinite(slot.delivered.sampleAt)) continue;
      const t = slot.delivered.sampleAt;
      if (t < period.startAt) continue;
      if (period.endAt !== null && t >= period.endAt) continue;
      const windowMs = period.policy.windowMs;
      const index = Math.floor((t - period.base) / windowMs);
      const start = period.base + index * windowMs;
      const end = start + windowMs;
      const id = `${deviceId}|time|${period.base}|${windowMs}|${index}`;
      if (!period.batches.has(id)) {
        period.batches.set(id, {
          id,
          deviceId,
          mode: "time",
          batchIndex: index,
          startAt: start,
          endAt: end,
          openedAt: Number.isFinite(period.startAt) ? period.startAt : start,
          closeEventId: period.closeEventId,
          closedByPolicy: period.closeEventId !== null,
          slots: [],
          evidence: []
        });
      }
      period.batches.get(id).slots.push(slot);
      period.deliveredSlots.push(slot);
    }
    if (period.endAt === null && period.closeEventId === null) {
      const lastSample = Math.max(...period.deliveredSlots.map(s => s.delivered.sampleAt).filter(Number.isFinite));
      const disconnect = state.events
        .filter(e => e.type === "connection" && e.status === "disconnected" &&
          (!e.deviceId || e.deviceId === deviceId) && eventTime(e) !== null)
        .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id))
        .find(e => Number.isFinite(lastSample) && eventTime(e) >= lastSample);
      if (disconnect) period.closeEventId = disconnect.id;
    }
    for (const batch of period.batches.values()) {
      const closeAt = period.closeEventId ? eventTime(state.events.find(e => e.id === period.closeEventId)) : null;
      batch.closeEventId = period.closeEventId && batch.endAt > closeAt
        ? period.closeEventId
        : batch.closeEventId;
      batch.closedByPolicy = batch.closeEventId !== null;
    }
  }
  return result;
}

function slotSeqRange(slots) {
  const delivered = slots.filter(s => s.status === "delivered");
  if (!delivered.length) return null;
  return {
    min: Math.min(...delivered.map(s => s.seq)),
    max: Math.max(...delivered.map(s => s.seq))
  };
}

function assignMissingForCount(period, batchList, slotById) {
  if (!period.deliveredSeq.length) return;
  const batches = assignCountBatches(period, batchList);
  for (const batch of batches) {
    for (let seq = batch.startSeq; seq <= batch.endSeq; seq += 1) {
      const slot = slotById.get(seq) || makeSlot({
        deviceId: period.deviceId,
        seq,
        status: "missing",
        reason: "计数阈值窗口内未交付该序号槽位"
      });
      slotById.set(seq, slot);
      batch.slots.push(slot);
    }
  }
}

function assignMissingForTime(timePeriods, slotById, cadence, unassignable) {
  if (!cadence.reliable) return;
  for (const period of timePeriods) {
    const ordered = [...period.batches.values()].sort((a, b) => a.startAt - b.startAt);
    for (let i = 0; i < ordered.length; i += 1) {
      const batch = ordered[i];
      const seqs = new Set(batch.slots.filter(s => s.status === "delivered").map(s => s.seq));
      if (!seqs.size) continue;
      const known = [...seqs].sort((a, b) => a - b);
      const firstKnown = slotById.get(known[0]);
      const lastKnown = slotById.get(known[known.length - 1]);
      const interval = cadence.intervalMs;
      const firstSampleAt = firstKnown.delivered.sampleAt;
      const lastSampleAt = lastKnown.delivered.sampleAt;
      const min = known[0] - Math.floor((firstSampleAt - batch.startAt) / interval);
      const endInclusive = batch.endAt - 1;
      let max = known[known.length - 1] + Math.floor((endInclusive - lastSampleAt) / interval);
      const next = ordered[i + 1];
      if (next) {
        const nextDelivered = next.slots.filter(s => s.status === "delivered").sort((a, b) => a.seq - b.seq)[0];
        if (nextDelivered) max = Math.min(max, nextDelivered.seq - 1);
      }
      for (let seq = min; seq <= max; seq += 1) {
        if (slotById.has(seq)) {
          const existing = slotById.get(seq);
          if (!batch.slots.includes(existing)) batch.slots.push(existing);
          continue;
        }
        const inferredSampleAt = firstSampleAt + (seq - known[0]) * interval;
        const slot = makeSlot({
          deviceId: period.deviceId,
          seq,
          status: "missing",
          reason: "按已验证采样节拍推得该序号属于此时间窗口，但未见记录",
          inferredSampleAt
        });
        slotById.set(seq, slot);
        batch.slots.push(slot);
      }
    }
  }
  for (const slot of slotById.values()) {
    if (slot.status === "missing" && slot.reason === "__pending__") {
      slot.reason = "节拍无法可靠推断，不能确定其时间批次";
      unassignable.push({ type: "missingSlot", deviceId: slot.deviceId, seq: slot.seq, slot });
    }
  }
}

function addConnectionEvidence(state, deviceId, batches, slotById) {
  const connections = relevantTimedEvents(state, deviceId)
    .filter(e => e.type === "connection")
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id));
  const delivered = [...slotById.values()]
    .filter(s => s.status === "delivered")
    .sort((a, b) => a.seq - b.seq);

  for (let i = 0; i < connections.length; i += 1) {
    const event = connections[i];
    if (event.status !== "disconnected") continue;
    const nextConn = connections.slice(i + 1).find(e => e.status === "connected");
    const before = delivered.filter(s => (s.delivered.receivedAt ?? 0) <= eventTime(event));
    const after = nextConn ? delivered.filter(s => (s.delivered.receivedAt ?? 0) > eventTime(nextConn)) : [];
    const anchor = before.at(-1);
    const resume = after[0];
    const candidates = batches.filter(b => {
      const seqs = b.slots.filter(s => s.status === "delivered").map(s => s.seq);
      if (anchor && seqs.includes(anchor.seq)) return true;
      if (resume && seqs.includes(resume.seq)) return true;
      const missing = b.slots.filter(s => s.status === "missing").map(s => s.seq);
      if (anchor && resume && missing.some(seq => seq > anchor.seq && seq < resume.seq)) return true;
      return false;
    });
    const target = candidates.find(b => anchor && b.slots.some(s => s.status === "delivered" && s.seq === anchor.seq)) || candidates.at(-1);
    const ev = evidence(
      "connection",
      `${eventTime(event) ? new Date(eventTime(event)).toISOString() : "未知时刻"} 连接断开${nextConn ? `，${new Date(eventTime(nextConn)).toISOString()} 重连` : "，尚未观察到重连"}`,
      [],
      [event.id, ...(nextConn ? [nextConn.id] : [])],
      { anchorSeq: anchor?.seq ?? null, resumeSeq: resume?.seq ?? null }
    );
    if (target) {
      target.evidence.push(ev);
      target.interruptedBy = event.id;
      if (!target.closed) target.closed = true;
    }
  }
}

function buildDeviceBatches(state, deviceId, canonicalSlots, conflictMap, unassignable) {
  const slots = [...canonicalSlots.values()]
    .filter(s => s.deviceId === deviceId)
    .sort((a, b) => a.seq - b.seq);
  const slotById = new Map(slots.map(s => [s.seq, s]));
  const cadence = inferCadence(state, deviceId, canonicalSlots);
  const batches = [];

  const countPeriods = buildCountPeriods(state, deviceId, slots);
  for (const period of countPeriods) assignMissingForCount(period, batches, slotById);

  const timePeriods = buildTimePeriods(state, deviceId, slots, cadence);
  for (const period of timePeriods) {
    batches.push(...period.batches.values());
  }

  // 时间模式只在节拍可靠时填充内部缺口；否则保留为显式无法归属。
  if (!cadence.reliable) {
    const delivered = [...slotById.values()].filter(s => s.status === "delivered").sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < delivered.length; i += 1) {
      for (let seq = delivered[i - 1].seq + 1; seq < delivered[i].seq; seq += 1) {
        if (!slotById.has(seq)) {
          const slot = makeSlot({
            deviceId,
            seq,
            status: "missing",
            reason: "采样节拍不足，无法把缺口可靠归属到时间窗口"
          });
          slotById.set(seq, slot);
          unassignable.push({ type: "missingSlot", deviceId, seq, slot });
        }
      }
    }
  } else {
    assignMissingForTime(timePeriods, slotById, cadence, unassignable);
  }

  for (const batch of batches) {
    batch.slots.sort((a, b) => a.seq - b.seq);
    for (const slot of batch.slots) {
      if (slot.status === "delivered") {
        const ids = slot.duplicateRecordIds;
        batch.evidence.push(evidence(
          ids.length > 1 ? "duplicate" : "record",
          ids.length > 1
            ? `序号 ${slot.seq} 由 ${ids.length} 条重复/重发记录共同证明`
            : `序号 ${slot.seq} 由采样记录 ${ids[0]} 证明`,
          ids
        ));
        if (slot.delivered.correctedBy) {
          batch.evidence.push(evidence("correction", `记录 ${ids[0]} 已由裁决/修正事件 ${slot.delivered.correctedBy} 更新`, ids, [slot.delivered.correctedBy]));
        }
      } else {
        batch.evidence.push(evidence("missing", `序号 ${slot.seq} 缺失：${slot.reason}`, [], [], { seq: slot.seq }));
      }
      if (slot.conflictId) {
        const conflict = conflictMap.get(slot.conflictId);
        batch.evidence.push(evidence(
          "conflict",
          conflict.status === "open"
            ? `序号 ${slot.seq} 存在未裁决冲突，保留 ${conflict.records.length} 份不一致记录`
            : `序号 ${slot.seq} 冲突已由 ${conflict.resolution.id} 裁决，采信值为 ${slot.delivered.value}`,
          conflict.records.map(r => r.id),
          conflict.resolution ? [conflict.resolution.id] : [],
          { conflictId: conflict.id, conflictStatus: conflict.status }
        ));
      }
    }
  }

  addConnectionEvidence(state, deviceId, batches, slotById);
  classifyBatches(state, deviceId, batches);
  return { batches, slots: [...slotById.values()].sort((a, b) => a.seq - b.seq), cadence };
}

function classifyBatches(state, deviceId, batches) {
  const conflictById = new Map(state.conflicts.map(c => [c.id, c]));
  const connections = relevantTimedEvents(state, deviceId)
    .filter(e => e.type === "connection")
    .sort((a, b) => eventTime(a) - eventTime(b));
  for (const batch of batches.sort((a, b) =>
    (a.startAt ?? a.startSeq) - (b.startAt ?? b.startSeq) || a.id.localeCompare(b.id))) {
    const missing = batch.slots.filter(s => s.status === "missing");
    const openConflicts = batch.slots
      .filter(s => s.conflictId)
      .map(s => conflictById.get(s.conflictId))
      .filter(c => c && c.status === "open");
    let closed = Boolean(batch.closed);
    if (batch.mode === "count") {
      const delivered = batch.slots.filter(s => s.status === "delivered").length;
      if (batch.closedByPolicy || delivered >= batch.endSeq - batch.startSeq + 1 || batch.interruptedBy) closed = true;
      if (!batch.closeEventId && delivered >= batch.endSeq - batch.startSeq + 1) {
        batch.evidence.push(evidence("boundary", `数量阈值 ${batch.endSeq - batch.startSeq + 1} 达到，批次闭合`));
      }
    } else {
      const laterEvent = state.events.some(e =>
        eventTime(e) !== null && (!e.deviceId || e.deviceId === deviceId) &&
        eventTime(e) >= batch.endAt && e.id !== batch.closeEventId);
      if (batch.closedByPolicy || batch.interruptedBy || laterEvent) closed = true;
      if (closed && !batch.interruptedBy && !batch.closedByPolicy) {
        batch.evidence.push(evidence("boundary", `时间窗口 ${new Date(batch.startAt).toISOString()}–${new Date(batch.endAt).toISOString()} 已结束`));
      }
    }
    if (batch.closedByPolicy && batch.closeEventId) {
      batch.evidence.push(evidence("boundary", "连接或阈值变化关闭当前物理批次", [], [batch.closeEventId]));
    }
    batch.closed = closed;
    if (openConflicts.length) {
      batch.status = STATUS.UNTRUSTED;
      batch.reason = "存在未裁决的冲突记录，不能静默择一";
    } else if (!closed || missing.length) {
      batch.status = STATUS.PARTIAL;
      batch.reason = !closed ? "批次仍开放，尾部是否还有采样尚未确认" : `缺少 ${missing.length} 个序号槽位`;
    } else {
      batch.status = STATUS.COMPLETE;
      batch.reason = "批次闭合，且批次范围内每个序号槽位均有已采信记录";
    }
    batch.deliveredCount = batch.slots.filter(s => s.status === "delivered").length;
    batch.missingCount = missing.length;
    batch.conflictCount = openConflicts.length;
  }
}

function canonicalSlotsFrom(state, records, conflicts, canonicalRecords) {
  const conflictByKey = new Map(conflicts.map(c => [`${c.deviceId}\u0000${c.seq}`, c]));
  const slots = new Map();
  for (const [key, chosen] of canonicalRecords) {
    const list = records
      .filter(r => r.deviceId === chosen.deviceId && r.seq === chosen.seq)
      .sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0) || a.id.localeCompare(b.id));
    const conflict = conflictByKey.get(key);
    slots.set(`${chosen.deviceId}\u0000${chosen.seq}`, {
      deviceId: chosen.deviceId,
      seq: chosen.seq,
      status: "delivered",
      delivered: chosen,
      duplicateRecordIds: list.map(r => r.id),
      conflictId: conflict ? conflict.id : null
    });
  }
  return slots;
}

function buildResume(deviceId, slots, events, conflicts) {
  const openConflictSeqs = new Set(conflicts
    .filter(c => c.deviceId === deviceId && c.status === "open")
    .map(c => c.seq));
  const delivered = slots
    .filter(s => s.status === "delivered" && !openConflictSeqs.has(s.seq))
    .sort((a, b) => a.seq - b.seq);
  const conflicting = slots
    .filter(s => s.status === "delivered" && openConflictSeqs.has(s.seq))
    .map(s => s.seq)
    .sort((a, b) => a - b);
  if (!delivered.length) {
    return {
      deviceId,
      anchorSeq: null,
      resumeSeq: null,
      missingSeq: [],
      delivered: false,
    connection: "unknown",
      note: "尚未观察到任何无冲突有效采样，需要从设备声明的首个序号开始"
    };
  }
  const seqSet = new Set(delivered.map(s => s.seq));
  const min = Math.min(...seqSet);
  const max = Math.max(...seqSet);
  const missing = [];
  const conflictingInside = [];
  let contiguousMax = min - 1;
  for (let seq = min; seq <= max; seq += 1) {
    if (seqSet.has(seq)) {
      if (seq === contiguousMax + 1) contiguousMax = seq;
    } else {
      missing.push(seq);
    }
  }
  for (const seq of conflicting) {
    if (seq >= min && seq <= max && !missing.includes(seq)) conflictingInside.push(seq);
  }
  const conn = [...events]
    .filter(e => e.type === "connection" && (!e.deviceId || e.deviceId === deviceId))
    .sort((a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id))
    .at(-1);
  return {
    deviceId,
    anchorSeq: contiguousMax,
    resumeSeq: contiguousMax + 1,
    missingSeq: missing,
    delivered: true,
    connection: conn?.status || "unknown",
    latestConnectionAt: conn ? eventTime(conn) : null,
    conflictingSeq: conflicting,
    note:
      (conflictingInside.length ? `序号 ${conflictingInside.join(", ")} 尚未裁决，不能作为可靠锚点；` : "") +
      (missing.length
        ? `已连续交付到 ${contiguousMax}；除了下一条 ${contiguousMax + 1}，还需补采历史空洞`
        : `已连续交付到 ${contiguousMax}，重连后从 ${contiguousMax + 1} 续采`)
  };
}

export function recompute(state, trigger = { reason: "init", eventId: null }) {
  const previous = state.lastSnapshot ? new Map(state.lastSnapshot.batches.map(b => [b.id, b])) : null;
  state.issues = [];
  state.unassignable = [];
  state.records = effectiveRecords(state);

  const invalidRaw = state.events.filter(e =>
    e.type === "sample" && (!e.deviceId || !Number.isInteger(Number(e.seq))));
  for (const event of invalidRaw) {
    state.unassignable.push({
      type: "invalidRecord",
      deviceId: event.deviceId || "",
      seq: event.seq,
      recordId: event.id,
      reason: "缺少设备标识或序号不是整数"
    });
  }

  const grouped = groupConflicts(state, state.records);
  state.conflicts = grouped.conflicts;
  const conflictMap = new Map(state.conflicts.map(c => [c.id, c]));
  const canonicalSlots = canonicalSlotsFrom(state, state.records, state.conflicts, grouped.canonical);

  const deviceIds = [...new Set([
    ...Object.keys(state.devices),
    ...state.records.map(r => r.deviceId)
  ])].filter(Boolean).sort();
  state.batches = [];
  state.resume = [];

  for (const deviceId of deviceIds) {
    const built = buildDeviceBatches(state, deviceId, canonicalSlots, conflictMap, state.unassignable);
    state.batches.push(...built.batches);
    state.resume.push(buildResume(deviceId, built.slots, state.events, state.conflicts));
    const invalidTime = built.slots.filter(s => s.status === "delivered" && s.delivered.sampleAt === null);
    for (const slot of invalidTime) {
      state.unassignable.push({
        type: "invalidTime",
        deviceId,
        seq: slot.seq,
        recordId: slot.delivered.id,
        reason: "采样时刻缺失或不可解析，不能归入时间窗口"
      });
    }
  }

  state.batches.sort((a, b) =>
    a.deviceId.localeCompare(b.deviceId) ||
    (a.startAt ?? a.startSeq) - (b.startAt ?? b.startSeq) ||
    a.id.localeCompare(b.id));
  state.batches.forEach((b, index) => {
    b.deviceBatchIndex = index;
  });

  const snapshot = exportSnapshot(state);
  const current = new Map(snapshot.batches.map(b => [b.id, b]));
  const changed = [];
  if (previous) {
    for (const [id, nextBatch] of current) {
      const oldBatch = previous.get(id);
      if (!oldBatch || JSON.stringify(oldBatch) !== JSON.stringify(nextBatch)) changed.push(nextBatch.id);
    }
    for (const id of previous.keys()) if (!current.has(id)) changed.push(id);
  }
  state.lastSnapshot = snapshot;
  state.lastPush = {
    reason: trigger.reason,
    eventId: trigger.eventId,
    changedBatchIds: changed,
    fullReplay: !previous,
    consistentWithFullReplay: true,
    snapshot
  };
  return state.lastPush;
}

export function exportSnapshot(state) {
  return {
    devices: Object.values(state.devices),
    events: state.events,
    records: state.records,
    batches: state.batches,
    conflicts: state.conflicts,
    resume: state.resume,
    unassignable: state.unassignable,
    issues: state.issues
  };
}
