export class ScheduleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
    this.details = details;
  }
}

function topoOrder(operations) {
  const byId = new Map(operations.map((op) => [op.id, op]));
  const indegree = new Map(operations.map((op) => [op.id, (op.deps ?? []).length]));
  const ready = operations
    .filter((op) => indegree.get(op.id) === 0)
    .map((op) => op.id)
    .sort();
  const order = [];
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(byId.get(id));
    for (const op of operations) {
      if ((op.deps ?? []).includes(id)) {
        indegree.set(op.id, indegree.get(op.id) - 1);
        if (indegree.get(op.id) === 0) {
          ready.push(op.id);
          ready.sort();
        }
      }
    }
  }
  if (order.length !== operations.length) {
    const cyclic = operations.filter((op) => indegree.get(op.id) > 0).map((op) => op.id);
    throw new ScheduleError('DEPENDENCY_CYCLE', `工序依赖存在成环: ${cyclic.join(', ')}`, { cyclic });
  }
  return order;
}

export function validateModel(model) {
  const { devices, operations } = model;
  const ids = new Set();
  for (const op of operations) {
    if (ids.has(op.id)) {
      throw new ScheduleError('DUPLICATE_OPERATION', `工序 id 重复: ${op.id}`, { opId: op.id });
    }
    ids.add(op.id);
  }
  for (const op of operations) {
    for (const dep of op.deps ?? []) {
      if (!ids.has(dep)) {
        throw new ScheduleError('MISSING_DEPENDENCY', `工序 ${op.id} 依赖了不存在的工序 ${dep}`, {
          opId: op.id,
          dep,
        });
      }
    }
  }
  const order = topoOrder(operations);
  for (const op of operations) {
    if (!devices.some((dev) => dev.capabilities.includes(op.type))) {
      throw new ScheduleError('CAPABILITY_UNCOVERED', `没有设备具备工序 ${op.id} 所需的能力 ${op.type}`, {
        opId: op.id,
        type: op.type,
      });
    }
  }
  return order;
}

function freeSegments(windows, busy) {
  const segments = [];
  for (const [ws, we] of windows) {
    let cursor = ws;
    const overlapping = busy
      .filter(([bs, be]) => be > ws && bs < we)
      .sort((a, b) => a[0] - b[0]);
    for (const [bs, be] of overlapping) {
      if (bs > cursor) segments.push([cursor, Math.min(bs, we)]);
      cursor = Math.max(cursor, be);
      if (cursor >= we) break;
    }
    if (cursor < we) segments.push([cursor, we]);
  }
  return segments.sort((a, b) => a[0] - b[0]);
}

function earliestFit(windows, busy, earliestStart, duration) {
  for (const [ss, se] of freeSegments(windows, busy)) {
    const start = Math.max(ss, earliestStart);
    if (start + duration <= se) return start;
  }
  return null;
}

function addBusy(busy, deviceId, start, end) {
  if (!busy.has(deviceId)) busy.set(deviceId, []);
  busy.get(deviceId).push([start, end]);
}

function placeOp(model, busy, op, earliestStart) {
  let best = null;
  for (const dev of model.devices) {
    if (!dev.capabilities.includes(op.type)) continue;
    const start = earliestFit(dev.windows, busy.get(dev.id) ?? [], earliestStart, op.duration);
    if (start === null) continue;
    const candidate = {
      deviceId: dev.id,
      start,
      end: start + op.duration,
      cost: op.duration * dev.energyRate,
      rate: dev.energyRate,
    };
    if (
      best === null ||
      candidate.start < best.start ||
      (candidate.start === best.start &&
        (candidate.rate < best.rate ||
          (candidate.rate === best.rate && candidate.deviceId < best.deviceId)))
    ) {
      best = candidate;
    }
  }
  if (best === null) {
    throw new ScheduleError('NO_FEASIBLE_SLOT', `工序 ${op.id} 在设备可用时段内无可行排布`, {
      opId: op.id,
    });
  }
  addBusy(busy, best.deviceId, best.start, best.end);
  return { deviceId: best.deviceId, start: best.start, end: best.end, cost: best.cost };
}

function earliestFromDeps(placements, op) {
  let earliest = 0;
  for (const dep of op.deps ?? []) {
    earliest = Math.max(earliest, placements[dep].end);
  }
  return earliest;
}

export function scheduleAll(model) {
  const order = validateModel(model);
  const busy = new Map();
  const placements = {};
  let totalCost = 0;
  for (const op of order) {
    const placed = placeOp(model, busy, op, earliestFromDeps(placements, op));
    placements[op.id] = placed;
    totalCost += placed.cost;
  }
  return { placements, totalCost };
}

export function applyDeviceChanges(model, changes) {
  return {
    ...model,
    devices: model.devices.map((dev) =>
      changes[dev.id] ? { ...dev, ...changes[dev.id] } : dev
    ),
  };
}

export function computeAffected(model, previousPlacements, changedDeviceIds) {
  const changed = new Set(changedDeviceIds);
  const affected = new Set();
  for (const op of model.operations) {
    const prev = previousPlacements[op.id];
    if (prev && changed.has(prev.deviceId)) affected.add(op.id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const op of model.operations) {
      if (!affected.has(op.id) && (op.deps ?? []).some((dep) => affected.has(dep))) {
        affected.add(op.id);
        grew = true;
      }
    }
  }
  return affected;
}

export function reschedulePartial(model, previousPlacements, changedDeviceIds) {
  const order = validateModel(model);
  const affected = computeAffected(model, previousPlacements, changedDeviceIds);
  const busy = new Map();
  const placements = {};
  for (const op of order) {
    if (!affected.has(op.id)) {
      const pinned = { ...previousPlacements[op.id] };
      placements[op.id] = pinned;
      addBusy(busy, pinned.deviceId, pinned.start, pinned.end);
    }
  }
  let totalCost = 0;
  for (const op of order) {
    if (affected.has(op.id)) {
      placements[op.id] = placeOp(model, busy, op, earliestFromDeps(placements, op));
    }
    totalCost += placements[op.id].cost;
  }
  return { placements, totalCost, affected: [...affected].sort() };
}
