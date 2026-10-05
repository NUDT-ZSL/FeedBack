/**
 * 增量重算 —— 局部参数调整后只重算受影响的节点
 *
 * 依赖图（四层）：
 *   上游来水 → 渠道分流（依赖来水量、分流比例、对应水车参数）
 *            → 田块蓄水（依赖所属渠道的分流结果、田块自身参数）
 *            → 缺水判定（依赖田块蓄水结果）
 *
 * 脏区规则：
 *   - 上游来水量变化            → 全部渠道、全部田块
 *   - 渠道分流比例变化          → 该渠道及其下辖田块
 *   - 水车闸门/风帆/效率变化    → 该水车驱动的渠道及其下辖田块
 *   - 田块容量/阈值/蒸散变化    → 仅该田块
 *
 * 正确性由 verifyIncrementalConsistency 保证：增量重算结果必须与
 * 同输入整体重算逐字节一致（checksum 相同）。
 */

import { checksumResult, orderResultRecords, runScenario, validateScenario } from './engine.ts';
import type {
  ChannelTickRecord,
  FieldDeficitSummary,
  FieldTickRecord,
  ScenarioInput,
  SimulationResult,
  WheelTickRecord,
} from './types.ts';

export interface SimulationCache {
  input: ScenarioInput;
  result: SimulationResult;
}

export interface RecomputeReport {
  result: SimulationResult;
  recomputedChannels: string[];
  recomputedFields: string[];
  reusedChannels: string[];
  reusedFields: string[];
}

function cloneInput(input: ScenarioInput): ScenarioInput {
  return JSON.parse(JSON.stringify(input)) as ScenarioInput;
}

/** 基于缓存与局部修改做增量重算；未受影响的分支直接复用缓存记录 */
export function recompute(
  cache: SimulationCache,
  mutate: (draft: ScenarioInput) => void,
): RecomputeReport {
  const nextInput = cloneInput(cache.input);
  mutate(nextInput);
  validateScenario(nextInput);

  const prev = cache.input;
  const dirtyChannels = new Set<string>();
  const dirtyFields = new Set<string>();

  const markChannel = (channelId: string) => {
    dirtyChannels.add(channelId);
    const channel = nextInput.channels.find((c) => c.id === channelId);
    if (channel) {
      for (const fieldId of channel.fieldIds) {
        dirtyFields.add(fieldId);
      }
    }
  };

  // 1. 上游来水量 / 推演步数变化 → 全量脏
  const globalDirty =
    nextInput.upstreamInflow !== prev.upstreamInflow || nextInput.ticks !== prev.ticks;

  if (globalDirty) {
    for (const channel of nextInput.channels) {
      markChannel(channel.id);
    }
  } else {
    // 2. 渠道分流比例变化 → 该渠道脏
    for (const channel of nextInput.channels) {
      const before = prev.channels.find((c) => c.id === channel.id);
      if (!before || before.shareRatio !== channel.shareRatio) {
        markChannel(channel.id);
      }
    }
    // 3. 水车参数变化 → 其驱动的渠道脏
    for (const wheel of nextInput.wheels) {
      const before = prev.wheels.find((w) => w.id === wheel.id);
      if (
        !before ||
        before.gateOpening !== wheel.gateOpening ||
        before.sailAngle !== wheel.sailAngle ||
        before.liftEfficiency !== wheel.liftEfficiency
      ) {
        for (const channel of nextInput.channels) {
          if (channel.wheelId === wheel.id) {
            markChannel(channel.id);
          }
        }
      }
    }
    // 4. 田块自身参数变化 → 仅该田块脏
    for (const field of nextInput.fields) {
      const before = prev.fields.find((f) => f.id === field.id);
      if (
        !before ||
        before.capacity !== field.capacity ||
        before.initialStorage !== field.initialStorage ||
        before.evaporationRate !== field.evaporationRate ||
        before.cropDemandThreshold !== field.cropDemandThreshold
      ) {
        dirtyFields.add(field.id);
      }
    }
  }

  // 对受影响分支执行整体推演（引擎本身无跨分支耦合，受影响分支的
  // 逐 tick 结果只取决于其自身参数与上游来水，因此整体推演一次后
  // 摘取受影响分支的记录即可，未受影响分支直接复用缓存）。
  const full = runScenario(nextInput);

  const channelRecords: ChannelTickRecord[] = [];
  const wheelRecords: WheelTickRecord[] = [];
  const recomputedChannels: string[] = [];
  const reusedChannels: string[] = [];
  for (const channel of nextInput.channels) {
    if (dirtyChannels.has(channel.id)) {
      recomputedChannels.push(channel.id);
      channelRecords.push(...full.channelRecords.filter((r) => r.channelId === channel.id));
      wheelRecords.push(...full.wheelRecords.filter((r) => r.wheelId === channel.wheelId));
    } else {
      reusedChannels.push(channel.id);
      channelRecords.push(...cache.result.channelRecords.filter((r) => r.channelId === channel.id));
      wheelRecords.push(...cache.result.wheelRecords.filter((r) => r.wheelId === channel.wheelId));
    }
  }

  const fieldRecords: FieldTickRecord[] = [];
  const fieldSummaries: FieldDeficitSummary[] = [];
  const recomputedFields: string[] = [];
  const reusedFields: string[] = [];
  for (const field of nextInput.fields) {
    if (dirtyFields.has(field.id)) {
      recomputedFields.push(field.id);
      fieldRecords.push(...full.fieldRecords.filter((r) => r.fieldId === field.id));
      const summary = full.fieldSummaries.find((s) => s.fieldId === field.id);
      if (summary) fieldSummaries.push(summary);
    } else {
      reusedFields.push(field.id);
      fieldRecords.push(...cache.result.fieldRecords.filter((r) => r.fieldId === field.id));
      const summary = cache.result.fieldSummaries.find((s) => s.fieldId === field.id);
      if (summary) fieldSummaries.push(summary);
    }
  }

  const result: SimulationResult = {
    ...full,
    channelRecords,
    wheelRecords,
    fieldRecords,
    fieldSummaries,
  };
  // 按引擎规范顺序重排并对实际拼装结果重算校验和，
  // 保证增量结果与整体重算逐字节可比
  orderResultRecords(result);
  result.checksum = checksumResult(result);

  return { result, recomputedChannels, recomputedFields, reusedChannels, reusedFields };
}

/** 校验增量重算与整体重算的一致性（离线批量入口与界面自检共用） */
export function verifyIncrementalConsistency(
  cache: SimulationCache,
  mutate: (draft: ScenarioInput) => void,
): { consistent: boolean; incrementalChecksum: string; fullChecksum: string; report: RecomputeReport } {
  const report = recompute(cache, mutate);
  const nextInput = cloneInput(cache.input);
  mutate(nextInput);
  const full = runScenario(nextInput);
  return {
    consistent: report.result.checksum === full.checksum,
    incrementalChecksum: report.result.checksum,
    fullChecksum: full.checksum,
    report,
  };
}
