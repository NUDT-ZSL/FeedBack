/**
 * 灌溉推演核心：水车转速 → 总来流 → 渠道分流 → 田块蓄水 → 作物缺水判定。
 *
 * 纯函数、确定性：不读取时钟、随机数、网络或任何外部状态，
 * 同一份输入必然得到同一份输出。渲染层只允许通过本模块获取数值。
 */
import type {
  ChannelParams,
  FieldParams,
  FieldResult,
  FieldTracePoint,
  SimulationParams,
  SimulationResult,
} from './types.ts';

const DEG_TO_RAD = Math.PI / 180;

/** 水车转速：口径与 PRD 一致，开度(0-100) × sin(角度) × 0.8 */
export function computeWheelSpeed(gateOpening: number, sailAngle: number): number {
  return (gateOpening / 100) * Math.sin(sailAngle * DEG_TO_RAD) * 0.8;
}

/** 水车提水量：转速 × 提水系数 */
export function computeLiftedFlow(wheelSpeed: number, liftCoefficient: number): number {
  return wheelSpeed * liftCoefficient;
}

/** 进入渠系的总来流：上游来水 + 水车提水 */
export function computeTotalInflow(upstreamInflow: number, liftedFlow: number): number {
  return upstreamInflow + liftedFlow;
}

/** 单条渠道的分流量 */
export function computeChannelFlow(totalInflow: number, ratio: number): number {
  return totalInflow * ratio;
}

/** 单个田块从 tick 1 到 ticks 的完整蓄水推进与缺水判定 */
export function simulateField(
  field: FieldParams,
  fieldInflow: number,
  ticks: number,
): FieldResult {
  const storage: number[] = new Array(ticks);
  const ratios: number[] = new Array(ticks);
  const deficits: boolean[] = new Array(ticks);

  let current = clamp(field.initialStorage, 0, field.capacity);
  let deficitTicks = 0;

  for (let tick = 1; tick <= ticks; tick += 1) {
    current = current + fieldInflow - field.consumptionRate;
    if (current > field.capacity) current = field.capacity;
    if (current < 0) current = 0;

    const ratio = field.capacity > 0 ? current / field.capacity : 0;
    const deficit = ratio < field.cropThreshold;

    storage[tick - 1] = current;
    ratios[tick - 1] = ratio;
    deficits[tick - 1] = deficit;
    if (deficit) deficitTicks += 1;
  }

  const finalStorage = storage[ticks - 1];
  const storageRatio = ratios[ticks - 1];
  const finalDeficit = deficits[ticks - 1];

  const trace: FieldTracePoint[] = [];
  for (let i = 0; i < ticks; i += 1) {
    trace.push({
      tick: i + 1,
      inflow: fieldInflow,
      consumption: field.consumptionRate,
      storage: storage[i],
      storageRatio: ratios[i],
      deficit: deficits[i],
    });
  }

  return {
    fieldId: field.id,
    name: field.name,
    channelId: field.channelId,
    capacity: field.capacity,
    cropThreshold: field.cropThreshold,
    finalStorage,
    storageRatio,
    deficit: finalDeficit,
    deficitTicks,
    basis: buildBasis({
      name: field.name,
      fieldInflow,
      consumptionRate: field.consumptionRate,
      capacity: field.capacity,
      finalStorage,
      storageRatio,
      cropThreshold: field.cropThreshold,
      deficit: finalDeficit,
      deficitTicks,
      ticks,
    }),
    trace,
  };
}

function buildBasis(parts: {
  name: string;
  fieldInflow: number;
  consumptionRate: number;
  capacity: number;
  finalStorage: number;
  storageRatio: number;
  cropThreshold: number;
  deficit: boolean;
  deficitTicks: number;
  ticks: number;
}): string {
  const {
    name, fieldInflow, consumptionRate, capacity, finalStorage,
    storageRatio, cropThreshold, deficit, deficitTicks, ticks,
  } = parts;
  const verdict = deficit ? '缺水' : '不缺水';
  return [
    `田块「${name}」经 ${ticks} 刻推演后判定为${verdict}：`,
    `每刻进水 ${fmt(fieldInflow)}、作物耗水 ${fmt(consumptionRate)}，容量 ${fmt(capacity)}，`,
    `最终蓄水 ${fmt(finalStorage)}，蓄水率 ${fmt(storageRatio)} ${cmp(storageRatio, cropThreshold)} 需水阈值 ${fmt(cropThreshold)}；`,
    `推演期内共 ${deficitTicks}/${ticks} 刻蓄水率低于阈值。`,
  ].join('');
}

function cmp(actual: number, threshold: number): string {
  return actual < threshold ? '<' : '>=';
}

function fmt(value: number): string {
  return value.toFixed(3);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 按渠道汇总挂接的田块 */
export function indexFieldsByChannel(fields: FieldParams[]): Map<string, FieldParams[]> {
  const map = new Map<string, FieldParams[]>();
  for (const field of fields) {
    const list = map.get(field.channelId);
    if (list) list.push(field);
    else map.set(field.channelId, [field]);
  }
  return map;
}

export interface EngineContext {
  wheelSpeed: number;
  liftedFlow: number;
  totalInflow: number;
  channelFlow: Map<string, number>;
  fieldInflow: Map<string, number>;
}

/** 计算到“每个田块的来水”为止的全部上游量 */
export function buildContext(params: SimulationParams): EngineContext {
  const wheelSpeed = computeWheelSpeed(params.wheel.gateOpening, params.wheel.sailAngle);
  const liftedFlow = computeLiftedFlow(wheelSpeed, params.wheel.liftCoefficient);
  const totalInflow = computeTotalInflow(params.upstreamInflow, liftedFlow);

  const channelFlow = new Map<string, number>();
  for (const channel of params.channels) {
    channelFlow.set(channel.id, computeChannelFlow(totalInflow, channel.ratio));
  }

  const byChannel = indexFieldsByChannel(params.fields);
  const fieldInflow = new Map<string, number>();
  for (const channel of params.channels) {
    const members = byChannel.get(channel.id) ?? [];
    const share = members.length > 0 ? (channelFlow.get(channel.id) ?? 0) / members.length : 0;
    for (const field of members) fieldInflow.set(field.id, share);
  }

  return { wheelSpeed, liftedFlow, totalInflow, channelFlow, fieldInflow };
}

function toChannelResults(params: SimulationParams, ctx: EngineContext) {
  return params.channels.map((channel: ChannelParams) => ({
    channelId: channel.id,
    name: channel.name,
    ratio: channel.ratio,
    flow: ctx.channelFlow.get(channel.id) ?? 0,
  }));
}

/** 全量推演：无视任何缓存，重算所有节点 */
export function runFull(params: SimulationParams): SimulationResult {
  const ctx = buildContext(params);
  const fields = params.fields.map((field) =>
    simulateField(field, ctx.fieldInflow.get(field.id) ?? 0, params.ticks),
  );
  return {
    wheelSpeed: ctx.wheelSpeed,
    liftedFlow: ctx.liftedFlow,
    totalInflow: ctx.totalInflow,
    channels: toChannelResults(params, ctx),
    fields,
    meta: { ticks: params.ticks, mode: 'full', recomputedFields: [] },
  };
}
