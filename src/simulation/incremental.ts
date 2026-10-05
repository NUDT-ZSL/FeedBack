/**
 * 增量推演：参数局部变化时，只重算受影响的下游节点，
 * 未受影响的田块直接复用上一轮结果。
 *
 * 依赖关系（单向）：
 *   上游来水量 / 水车参数 → 总来流 → 渠道分流 → 田块蓄水 → 缺水判定
 *   渠道分流比例           → 该渠道及其挂接田块
 *   田块容量 / 需水阈值等  → 仅该田块
 *
 * 由于重算路径与全量推演使用完全相同的纯函数与运算次序，
 * 增量结果与整体重算在数值上严格一致（可用 verify.ts 校验）。
 */
import { buildContext, runFull, simulateField } from './engine.ts';
import type { FieldResult, SimulationParams, SimulationResult } from './types.ts';

export interface ParamDiff {
  /** 上游来水量变化：影响全部渠道与田块 */
  upstreamChanged: boolean;
  /** 水车参数（开度/角度/提水系数）变化：影响全部渠道与田块 */
  wheelChanged: boolean;
  /** 分流比例发生变化的渠道 id */
  changedChannels: Set<string>;
  /** 自身参数发生变化的田块 id */
  changedFields: Set<string>;
  /** 结构变化（刻数、节点增删、田块换渠）：退化为整体重算 */
  structureChanged: boolean;
}

export function diffParams(prev: SimulationParams, next: SimulationParams): ParamDiff {
  const diff: ParamDiff = {
    upstreamChanged: prev.upstreamInflow !== next.upstreamInflow,
    wheelChanged:
      prev.wheel.gateOpening !== next.wheel.gateOpening ||
      prev.wheel.sailAngle !== next.wheel.sailAngle ||
      prev.wheel.liftCoefficient !== next.wheel.liftCoefficient,
    changedChannels: new Set<string>(),
    changedFields: new Set<string>(),
    structureChanged: false,
  };

  if (prev.ticks !== next.ticks) diff.structureChanged = true;
  if (prev.channels.length !== next.channels.length) diff.structureChanged = true;
  if (prev.fields.length !== next.fields.length) diff.structureChanged = true;

  const prevChannels = new Map(prev.channels.map((c) => [c.id, c]));
  for (const channel of next.channels) {
    const before = prevChannels.get(channel.id);
    if (!before) {
      diff.structureChanged = true;
    } else if (before.ratio !== channel.ratio) {
      diff.changedChannels.add(channel.id);
    }
  }

  const prevFields = new Map(prev.fields.map((f) => [f.id, f]));
  for (const field of next.fields) {
    const before = prevFields.get(field.id);
    if (!before) {
      diff.structureChanged = true;
      continue;
    }
    if (before.channelId !== field.channelId) diff.structureChanged = true;
    if (
      before.capacity !== field.capacity ||
      before.cropThreshold !== field.cropThreshold ||
      before.consumptionRate !== field.consumptionRate ||
      before.initialStorage !== field.initialStorage
    ) {
      diff.changedFields.add(field.id);
    }
  }

  return diff;
}

/**
 * 增量推演入口。
 * 返回结果与对 nextParams 直接 runFull 的可比较内容完全一致，
 * 仅 meta.mode / meta.recomputedFields 不同（用于溯源，不参与等价比较）。
 */
export function runIncremental(
  prevParams: SimulationParams,
  prevResult: SimulationResult,
  nextParams: SimulationParams,
): SimulationResult {
  const diff = diffParams(prevParams, nextParams);

  if (diff.structureChanged) {
    const full = runFull(nextParams);
    return {
      ...full,
      meta: {
        ticks: nextParams.ticks,
        mode: 'incremental',
        recomputedFields: nextParams.fields.map((f) => f.id),
      },
    };
  }

  const allFieldsAffected = diff.upstreamChanged || diff.wheelChanged;

  // 受影响田块 = 全部（上游变化）∪ 变化渠道挂接的田块 ∪ 自身参数变化的田块
  const affected = new Set<string>();
  if (allFieldsAffected) {
    for (const field of nextParams.fields) affected.add(field.id);
  } else {
    for (const field of nextParams.fields) {
      if (diff.changedChannels.has(field.channelId) || diff.changedFields.has(field.id)) {
        affected.add(field.id);
      }
    }
  }

  const ctx = buildContext(nextParams);
  const prevFieldResults = new Map(prevResult.fields.map((f) => [f.fieldId, f]));
  const prevChannelFlows = new Map(prevResult.channels.map((c) => [c.channelId, c.flow]));

  const fields: FieldResult[] = nextParams.fields.map((field) => {
    if (!affected.has(field.id)) {
      const cached = prevFieldResults.get(field.id);
      if (cached) return cached;
    }
    return simulateField(field, ctx.fieldInflow.get(field.id) ?? 0, nextParams.ticks);
  });

  const channels = nextParams.channels.map((channel) => {
    const flowTouched = allFieldsAffected || diff.changedChannels.has(channel.id);
    const flow = flowTouched
      ? ctx.channelFlow.get(channel.id) ?? 0
      : prevChannelFlows.get(channel.id) ?? ctx.channelFlow.get(channel.id) ?? 0;
    return {
      channelId: channel.id,
      name: channel.name,
      ratio: channel.ratio,
      flow,
    };
  });

  return {
    wheelSpeed: ctx.wheelSpeed,
    liftedFlow: ctx.liftedFlow,
    totalInflow: ctx.totalInflow,
    channels,
    fields,
    meta: {
      ticks: nextParams.ticks,
      mode: 'incremental',
      recomputedFields: [...affected].sort(),
    },
  };
}
