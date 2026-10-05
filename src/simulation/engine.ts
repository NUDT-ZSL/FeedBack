/**
 * 灌溉推演引擎 —— 核心推演路径
 *
 * 每个 tick 的推演顺序（与渲染无关的纯函数）：
 *   1. 渠道分流：allocated = upstreamInflow × shareRatio
 *   2. 水车提水：speed = gateOpening × sin(sailAngle°) × 0.8
 *                 lifted = min(allocated, speed × liftEfficiency)
 *   3. 田块蓄水：storage = clamp(storageBefore + inflow - evaporation, 0, capacity)
 *   4. 缺水判定：storage < cropDemandThreshold → 缺水
 *
 * 确定性保证：无随机数、无系统时间、所有输出经定点舍入，
 * 同一份输入重复推演结果逐字节一致。
 */

import type {
  ChannelTickRecord,
  FieldDeficitSummary,
  FieldTickRecord,
  ScenarioInput,
  SimulationResult,
  WheelTickRecord,
} from './types.ts';

/** 输出统一保留 6 位小数，消除浮点尾差 */
export const PRECISION = 6;

export function round(value: number): number {
  const factor = 10 ** PRECISION;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 水车转速：开度 × sin(风帆角度) × 0.8（PRD 口径） */
export function wheelSpeed(gateOpening: number, sailAngle: number): number {
  return round(gateOpening * Math.sin(degreesToRadians(sailAngle)) * 0.8);
}

/** 校验输入合法性，非法输入直接抛错而不是静默产出错误结论 */
export function validateScenario(input: ScenarioInput): void {
  if (!Number.isInteger(input.ticks) || input.ticks <= 0) {
    throw new Error(`场景 ${input.id}: ticks 必须为正整数，当前为 ${input.ticks}`);
  }
  if (input.upstreamInflow < 0) {
    throw new Error(`场景 ${input.id}: 上游来水量不能为负`);
  }
  const wheelIds = new Set(input.wheels.map((w) => w.id));
  const fieldIds = new Set(input.fields.map((f) => f.id));
  let shareSum = 0;
  for (const channel of input.channels) {
    if (channel.shareRatio < 0) {
      throw new Error(`场景 ${input.id}: 渠道 ${channel.id} 分流比例不能为负`);
    }
    shareSum += channel.shareRatio;
    if (!wheelIds.has(channel.wheelId)) {
      throw new Error(`场景 ${input.id}: 渠道 ${channel.id} 引用了不存在的水车 ${channel.wheelId}`);
    }
    for (const fieldId of channel.fieldIds) {
      if (!fieldIds.has(fieldId)) {
        throw new Error(`场景 ${input.id}: 渠道 ${channel.id} 引用了不存在的田块 ${fieldId}`);
      }
    }
  }
  if (shareSum > 1 + 1e-9) {
    throw new Error(`场景 ${input.id}: 渠道分流比例之和 ${round(shareSum)} 超过 1`);
  }
  const channelFieldOwners = new Map<string, string>();
  for (const channel of input.channels) {
    for (const fieldId of channel.fieldIds) {
      const owner = channelFieldOwners.get(fieldId);
      if (owner && owner !== channel.id) {
        throw new Error(
          `场景 ${input.id}: 田块 ${fieldId} 同时挂在渠道 ${owner} 与 ${channel.id} 下，一块田只能由一条渠道供水`,
        );
      }
      channelFieldOwners.set(fieldId, owner ?? channel.id);
    }
  }
  for (const field of input.fields) {
    if (field.capacity <= 0) {
      throw new Error(`场景 ${input.id}: 田块 ${field.id} 容量必须为正`);
    }
    if (field.initialStorage < 0 || field.initialStorage > field.capacity) {
      throw new Error(`场景 ${input.id}: 田块 ${field.id} 初始蓄水超出 [0, capacity]`);
    }
  }
}

/** 执行一次完整推演，返回逐 tick 可追溯的完整记录 */
export function runScenario(input: ScenarioInput): SimulationResult {
  validateScenario(input);

  const channelRecords: ChannelTickRecord[] = [];
  const fieldRecords: FieldTickRecord[] = [];
  const wheelRecords: WheelTickRecord[] = [];

  const storage = new Map<string, number>();
  for (const field of input.fields) {
    storage.set(field.id, field.initialStorage);
  }

  let totalAllocated = 0;
  let totalLifted = 0;
  let totalSpilled = 0;
  let totalEvaporated = 0;
  let totalFieldOverflow = 0;

  for (let tick = 0; tick < input.ticks; tick += 1) {
    for (const channel of input.channels) {
      const wheel = input.wheels.find((w) => w.id === channel.wheelId);
      if (!wheel) {
        throw new Error(`渠道 ${channel.id} 引用了不存在的水车 ${channel.wheelId}`);
      }

      const allocated = round(input.upstreamInflow * channel.shareRatio);
      const speed = wheelSpeed(wheel.gateOpening, wheel.sailAngle);
      const lifted = round(Math.min(allocated, speed * wheel.liftEfficiency));
      const spilled = round(allocated - lifted);

      totalAllocated = round(totalAllocated + allocated);
      totalLifted = round(totalLifted + lifted);
      totalSpilled = round(totalSpilled + spilled);

      channelRecords.push({ tick, channelId: channel.id, allocated, lifted, spilled });
      wheelRecords.push({ tick, wheelId: wheel.id, speed, lifted });

      const perFieldInflow = channel.fieldIds.length > 0 ? lifted / channel.fieldIds.length : 0;
      for (const fieldId of channel.fieldIds) {
        const field = input.fields.find((f) => f.id === fieldId);
        if (!field) {
          throw new Error(`渠道 ${channel.id} 引用了不存在的田块 ${fieldId}`);
        }
        const storageBefore = storage.get(fieldId) ?? 0;
        const inflow = round(perFieldInflow);
        const evaporation = round(Math.min(storageBefore + inflow, field.evaporationRate));
        const storageAfter = round(
          Math.min(Math.max(storageBefore + inflow - evaporation, 0), field.capacity),
        );
        const overflow = round(Math.max(storageBefore + inflow - evaporation - field.capacity, 0));
        const deficit = storageAfter < field.cropDemandThreshold;
        const deficitMargin = round(storageAfter - field.cropDemandThreshold);

        storage.set(fieldId, storageAfter);
        totalEvaporated = round(totalEvaporated + evaporation);
        totalFieldOverflow = round(totalFieldOverflow + overflow);

        fieldRecords.push({
          tick,
          fieldId,
          storageBefore: round(storageBefore),
          inflow,
          evaporation,
          storageAfter,
          overflow,
          deficit,
          deficitMargin,
        });
      }
    }
  }

  const fieldSummaries: FieldDeficitSummary[] = input.fields.map((field) => {
    const records = fieldRecords.filter((r) => r.fieldId === field.id);
    const deficitTicks = records.filter((r) => r.deficit).map((r) => r.tick);
    return {
      fieldId: field.id,
      deficitTicks,
      deficitCount: deficitTicks.length,
      finalStorage: storage.get(field.id) ?? 0,
      threshold: field.cropDemandThreshold,
      deficit: deficitTicks.length > 0,
    };
  });

  const result: SimulationResult = {
    scenarioId: input.id,
    label: input.label,
    ticks: input.ticks,
    channelRecords,
    fieldRecords,
    wheelRecords,
    fieldSummaries,
    totals: {
      upstreamInflow: round(input.upstreamInflow * input.ticks),
      allocated: totalAllocated,
      lifted: totalLifted,
      spilled: totalSpilled,
      evaporated: totalEvaporated,
      fieldOverflow: totalFieldOverflow,
      deficitFieldCount: fieldSummaries.filter((s) => s.deficit).length,
    },
    checksum: '',
  };
  orderResultRecords(result);
  result.checksum = checksumResult(result);
  return result;
}

/** 生成与键序无关的规范化 JSON，保证跨环境序列化结果一致 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** FNV-1a 32 位哈希，纯算术实现，跨平台稳定 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}


/** 记录的规范排序：保证整体推演与增量拼装输出顺序一致 */
export function orderResultRecords(result: SimulationResult): SimulationResult {
  result.channelRecords.sort((a, b) =>
    a.tick === b.tick ? a.channelId.localeCompare(b.channelId) : a.tick - b.tick,
  );
  result.wheelRecords.sort((a, b) =>
    a.tick === b.tick ? a.wheelId.localeCompare(b.wheelId) : a.tick - b.tick,
  );
  result.fieldRecords.sort((a, b) =>
    a.tick === b.tick ? a.fieldId.localeCompare(b.fieldId) : a.tick - b.tick,
  );
  result.fieldSummaries.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  return result;
}

export function checksumResult(result: SimulationResult): string {
  const { checksum: _checksum, ...rest } = result;
  return fnv1a(canonicalize(rest));
}
