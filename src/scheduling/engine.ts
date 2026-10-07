import type {
  Assignment,
  Pin,
  Plan,
  ScheduleError,
  ScheduleResult,
  SchedulingInput,
  SchedulingChange,
  PartialRescheduleOptions,
  PartialRescheduleResult,
  TimeWindow,
} from './types.ts';

/** 合并重叠/相接的可用时段，输出按起点升序的不相交时段 */
export function normalizeWindows(windows: TimeWindow[]): TimeWindow[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TimeWindow[] = [];
  for (const window of sorted) {
    if (window.end <= window.start) continue;
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

type Graph = Map<string, string[]>;

function buildGraph(input: SchedulingInput): { graph: Graph; indegree: Map<string, number> } {
  const graph: Graph = new Map(input.operations.map((op) => [op.id, []]));
  const indegree = new Map<string, number>(input.operations.map((op) => [op.id, 0]));
  for (const op of input.operations) {
    for (const dep of op.deps) {
      graph.get(dep)?.push(op.id);
      indegree.set(op.id, (indegree.get(op.id) ?? 0) + 1);
    }
  }
  return { graph, indegree };
}

function validate(input: SchedulingInput): ScheduleError | null {
  const ops = new Set(input.operations.map((op) => op.id));

  for (const op of input.operations) {
    for (const dep of op.deps) {
      if (!ops.has(dep)) {
        return {
          code: 'DEPENDENCY_MISSING',
          message: `工序 ${op.id} 依赖的工序 ${dep} 不存在`,
          refs: [op.id, dep],
        };
      }
    }
  }

  const { graph, indegree } = buildGraph(input);
  const ready: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) ready.push(id);
  ready.sort();
  const visited = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    visited.add(id);
    for (const next of [...(graph.get(id) ?? [])].sort()) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) ready.push(next);
    }
    ready.sort();
  }
  if (visited.size !== input.operations.length) {
    const cyclic = input.operations
      .map((op) => op.id)
      .filter((id) => !visited.has(id))
      .sort();
    return {
      code: 'DEPENDENCY_CYCLE',
      message: `依赖图中存在成环工序: ${cyclic.join(', ')}`,
      refs: cyclic,
    };
  }

  for (const op of input.operations) {
    const covered = input.devices.some((device) => device.capabilities.includes(op.capability));
    if (!covered) {
      return {
        code: 'CAPABILITY_UNCOVERED',
        message: `没有设备具备工序 ${op.id} 所需的能力 ${op.capability}`,
        refs: [op.id, op.capability],
      };
    }
  }

  return null;
}

/**
 * 在设备可用时段内、避开已占用区间，求不早于 lowerBound 的最早可行起点。
 * blocked 已按 start 升序。
 */
function earliestSlot(
  windows: TimeWindow[],
  blocked: Assignment[],
  duration: number,
  lowerBound: number,
): number | null {
  for (const window of windows) {
    let t = Math.max(lowerBound, window.start);
    if (t + duration > window.end) continue;
    for (const item of blocked) {
      if (item.end <= t) continue;
      if (item.start >= t + duration) break;
      t = Math.max(t, item.end);
    }
    if (t + duration <= window.end) return t;
  }
  return null;
}

interface DeviceRuntime {
  windows: TimeWindow[];
  blocked: Assignment[];
}

function runtimePush(runtimes: Map<string, DeviceRuntime>, deviceId: string, assignment: Assignment): void {
  const runtime = runtimes.get(deviceId)!;
  runtime.blocked.push(assignment);
  runtime.blocked.sort((a, b) => a.start - b.start || a.end - b.end);
}

function pinError(pin: Pin, message: string): ScheduleError {
  return { code: 'PIN_INVALID', message, refs: [pin.opId, pin.deviceId] };
}

/**
 * 整体排布推导。
 * pins 为冲突来源保留裁决：被钉住的工序不参与重排，其余工序绕开它们排布。
 * 推导规则确定性：按拓扑序（同层按工序 id 升序）依次为每道工序选择
 * “最早可行起点；并列时能耗率更低；再并列时设备 id 字典序更小”的设备。
 */
export function deriveSchedule(input: SchedulingInput, pins: Pin[] = []): ScheduleResult {
  const validationError = validate(input);
  if (validationError) return { ok: false, error: validationError };

  const ops = new Map(input.operations.map((op) => [op.id, op]));
  const devices = new Map(input.devices.map((device) => [device.id, device]));
  const pinMap = new Map(pins.map((pin) => [pin.opId, pin]));

  for (const pin of pins) {
    const op = ops.get(pin.opId);
    if (!op) return { ok: false, error: pinError(pin, `钉住的工序 ${pin.opId} 不存在`) };
    const device = devices.get(pin.deviceId);
    if (!device) return { ok: false, error: pinError(pin, `钉住的设备 ${pin.deviceId} 不存在`) };
    if (!device.capabilities.includes(op.capability)) {
      return { ok: false, error: pinError(pin, `设备 ${pin.deviceId} 不具备工序 ${pin.opId} 所需能力`) };
    }
    const fits = device.windows.some(
      (window) => pin.start >= window.start && pin.start + op.duration <= window.end,
    );
    if (!fits) {
      return { ok: false, error: pinError(pin, `工序 ${pin.opId} 的钉住位置不在设备 ${pin.deviceId} 可用时段内`) };
    }
  }
  for (const [index, pin] of pins.entries()) {
    for (const other of pins.slice(index + 1)) {
      const pinOp = ops.get(pin.opId)!;
      const otherOp = ops.get(other.opId)!;
      if (
        pin.deviceId === other.deviceId &&
        pin.start < other.start + otherOp.duration &&
        other.start < pin.start + pinOp.duration
      ) {
        return { ok: false, error: pinError(pin, `钉住的工序 ${pin.opId} 与 ${other.opId} 在同一设备上冲突`) };
      }
    }
  }

  const runtimes = new Map<string, DeviceRuntime>();
  for (const device of input.devices) {
    runtimes.set(device.id, { windows: normalizeWindows(device.windows), blocked: [] });
  }
  // 钉住工序从推导一开始就占用设备时段，后续工序（包括拓扑序更早的）都必须绕开
  for (const pin of pins) {
    const op = ops.get(pin.opId)!;
    runtimePush(runtimes, pin.deviceId, {
      opId: pin.opId,
      deviceId: pin.deviceId,
      start: pin.start,
      end: pin.start + op.duration,
      cost: op.duration * devices.get(pin.deviceId)!.energyRate,
    });
  }

  const { graph, indegree } = buildGraph(input);
  const ready: string[] = [];
  for (const [id, degree] of indegree) if (degree === 0) ready.push(id);
  ready.sort();
  const assignments = new Map<string, Assignment>();

  const place = (opId: string): ScheduleError | null => {
    const op = ops.get(opId)!;
    const pin = pinMap.get(opId);
    const lowerBound = Math.max(0, ...op.deps.map((dep) => assignments.get(dep)?.end ?? 0));

    if (pin) {
      if (pin.start < lowerBound) {
        return pinError(pin, `工序 ${opId} 的钉住起点早于其前置工序完成时刻`);
      }
      const assignment: Assignment = {
        opId,
        deviceId: pin.deviceId,
        start: pin.start,
        end: pin.start + op.duration,
        cost: op.duration * devices.get(pin.deviceId)!.energyRate,
      };
      assignments.set(opId, assignment);
      return null;
    }

    let chosen: { deviceId: string; start: number } | null = null;
    for (const device of input.devices) {
      if (!device.capabilities.includes(op.capability)) continue;
      const runtime = runtimes.get(device.id)!;
      const start = earliestSlot(runtime.windows, runtime.blocked, op.duration, lowerBound);
      if (start === null) continue;
      const chosenDevice = chosen ? devices.get(chosen.deviceId)! : null;
      if (
        chosen === null ||
        start < chosen.start ||
        (start === chosen.start && device.energyRate < chosenDevice!.energyRate) ||
        (start === chosen.start && device.energyRate === chosenDevice!.energyRate && device.id < chosen.deviceId)
      ) {
        chosen = { deviceId: device.id, start };
      }
    }
    if (!chosen) {
      return {
        code: 'UNFEASIBLE',
        message: `工序 ${opId} 在可用设备与时段内无法完成排布`,
        refs: [opId],
      };
    }
    const device = devices.get(chosen.deviceId)!;
    const assignment: Assignment = {
      opId,
      deviceId: chosen.deviceId,
      start: chosen.start,
      end: chosen.start + op.duration,
      cost: op.duration * device.energyRate,
    };
    assignments.set(opId, assignment);
    runtimePush(runtimes, chosen.deviceId, assignment);
    return null;
  };

  while (ready.length) {
    const opId = ready.shift()!;
    const error = place(opId);
    if (error) return { ok: false, error };
    for (const next of [...(graph.get(opId) ?? [])].sort()) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) ready.push(next);
    }
    ready.sort();
  }

  const ordered = input.operations.map((op) => assignments.get(op.id)!);
  return {
    ok: true,
    plan: {
      assignments: ordered,
      totalCost: ordered.reduce((sum, item) => sum + item.cost, 0),
    },
  };
}

export function applyChange(input: SchedulingInput, change: SchedulingChange): SchedulingInput {
  const devices = input.devices.map((device) => {
    if (device.id !== change.deviceId) {
      return { ...device, capabilities: [...device.capabilities], windows: device.windows.map((w) => ({ ...w })) };
    }
    if (change.kind === 'device-windows') {
      return { ...device, capabilities: [...device.capabilities], windows: change.windows.map((w) => ({ ...w })) };
    }
    if (change.kind === 'device-energy-rate') {
      return { ...device, capabilities: [...device.capabilities], windows: device.windows.map((w) => ({ ...w })), energyRate: change.energyRate };
    }
    return { ...device, capabilities: [...change.capabilities], windows: device.windows.map((w) => ({ ...w })) };
  });
  return {
    devices,
    operations: input.operations.map((op) => ({ ...op, deps: [...op.deps] })),
  };
}

/**
 * 局部重推：保留冲突来源（pins 与未受影响工序的原排布），只重推受影响部分。
 *
 * 受影响集合 = 相对基线结论（设备/起点/代价）发生变化的工序（钉住工序除外）。
 * 未受影响工序钉回基线位置（即整体重排结论中的同一位置）后重新推导，
 * 由推导的确定性可知结果与同等裁决条件下的整体重排完全一致。
 */
export function reschedulePartial(
  input: SchedulingInput,
  basePlan: Plan,
  options: PartialRescheduleOptions,
): PartialRescheduleResult {
  const nextInput = applyChange(input, options.change);
  const validationError = validate(nextInput);
  if (validationError) return { ok: false, error: validationError };

  const pins: Pin[] = (options.pins ?? []).map((pin) => ({ ...pin }));
  const pinned = new Set(pins.map((pin) => pin.opId));

  const oracle = deriveSchedule(nextInput, pins);
  if (!oracle.ok) return { ok: false, error: oracle.error };
  const oracleByOp = new Map(oracle.plan.assignments.map((item) => [item.opId, item]));

  const affected = new Set<string>();
  for (const baseItem of basePlan.assignments) {
    if (pinned.has(baseItem.opId)) continue;
    const oracleItem = oracleByOp.get(baseItem.opId);
    if (
      !oracleItem ||
      oracleItem.deviceId !== baseItem.deviceId ||
      oracleItem.start !== baseItem.start ||
      oracleItem.cost !== baseItem.cost
    ) {
      affected.add(baseItem.opId);
    }
  }

  const fixedPins: Pin[] = [
    ...pins,
    ...basePlan.assignments
      .filter((item) => !affected.has(item.opId) && !pinned.has(item.opId))
      .map((item) => ({ opId: item.opId, deviceId: item.deviceId, start: item.start })),
  ];
  const result = deriveSchedule(nextInput, fixedPins);
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    plan: result.plan,
    affected: [...affected].sort(),
  };
}
