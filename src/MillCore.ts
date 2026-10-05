import type {
  Batch,
  Fineness,
  FlourOutput,
  FlourRatios,
  FlourType,
  MillConditions,
  ProductionSegment,
} from './types';
import { FLOUR_TYPES } from './types';

/**
 * 磨坊核心账目引擎（纯函数、可离线确定性运行）。
 *
 * 结算口径（与 UI、仿真脚本共用同一套规则）：
 * 1. 每一袋面粉的内容 = 自上次打包以来，各个工况段落的实际产出之和，
 *    而不是打包瞬间的单一快照。
 * 2. 调整间隙或阀门只影响调整之后的新产出；已累积的段落保持其历史工况不变，
 *    未打包累计量自动按"各段实际状态"重新归集。
 * 3. 打包是原子事件：只结算打包时刻之前已累积的段落；打包之后（含同一时刻）
 *    的产出计入下一袋。已打包批次永久冻结其历史依据。
 * 4. 极端输入（间隙≈0、阀门 0/100、负 dt、NaN）一律先钳制再计算，
 *    不产生除零、负值或 NaN。
 */

export const MIN_GAP = 0.5;
export const MAX_GAP = 3;
export const MIN_VALVE = 0;
export const MAX_VALVE = 100;
export const OVERLOAD_THRESHOLD = 85;
/** 负载标定间隙（mm）：间隙为该值且满速时负载约 40% */
export const NOMINAL_GAP = 1.5;
/** 单帧/单步最大结算时长，防止后台挂起后一次性结算出天文数字 */
export const MAX_DT = 1;

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const clampGap = (gap: number): number => clamp(gap, MIN_GAP, MAX_GAP);
export const clampValve = (valve: number): number => clamp(valve, MIN_VALVE, MAX_VALVE);

export const calculateWheelSpeed = (valveOpening: number): number => {
  return clampValve(valveOpening) * 0.6;
};

export const calculateLoad = (gap: number, speed: number): number => {
  const safeGap = clampGap(gap);
  const safeSpeed = clamp(speed, 0, calculateWheelSpeed(MAX_VALVE));
  const ratio = NOMINAL_GAP / safeGap;
  const load = (safeSpeed / 60) * ratio * ratio * 40;
  return clamp(load, 0, 100);
};

export const isOverloaded = (load: number): boolean => load > OVERLOAD_THRESHOLD;

export const getFlourFineness = (gap: number): Fineness => {
  const safeGap = clampGap(gap);
  if (safeGap < 1) return 'fine';
  if (safeGap < 2) return 'medium';
  return 'coarse';
};

/** 各间隙档下的产出比例，三档之和恒为 1 */
export const getFlourRatios = (gap: number): FlourRatios => {
  const fineness = getFlourFineness(gap);
  if (fineness === 'fine') return { fine: 0.6, medium: 0.3, bran: 0.1 };
  if (fineness === 'medium') return { fine: 0.3, medium: 0.5, bran: 0.2 };
  return { fine: 0.1, medium: 0.4, bran: 0.5 };
};

export const ZERO_OUTPUT: FlourOutput = { fine: 0, medium: 0, bran: 0 };

export const totalOutput = (output: FlourOutput): number =>
  output.fine + output.medium + output.bran;

export const calculateFlourOutput = (
  gap: number,
  speed: number,
  dt: number
): FlourOutput => {
  const safeDt = clamp(dt, 0, MAX_DT);
  const safeSpeed = clamp(speed, 0, calculateWheelSpeed(MAX_VALVE));
  if (safeDt === 0 || safeSpeed === 0) return { ...ZERO_OUTPUT };

  const ratios = getFlourRatios(gap);
  const baseRate = safeSpeed * 0.01 * 0.5; // 斤/秒
  const total = baseRate * safeDt;

  return {
    fine: total * ratios.fine,
    medium: total * ratios.medium,
    bran: total * ratios.bran,
  };
};

/** 磨坊台账：磨盘当前工况 + 未打包段落 + 已冻结批次 */
export interface MillLedger {
  /** 仿真时钟，秒 */
  time: number;
  gap: number;
  valve: number;
  speed: number;
  load: number;
  overloaded: boolean;
  /** 未打包的产出段落（按时间顺序，末段对应当前工况） */
  pending: ProductionSegment[];
  /** 未打包累计量（pending 各段之和的缓存） */
  pendingTotals: FlourOutput;
  /** 已打包批次，冻结后不再变化 */
  batches: Batch[];
  /** 批次顺序号计数器，保证连续打包编号唯一 */
  packSeq: number;
  segmentSeq: number;
}

const deriveConditions = (gap: number, valve: number): MillConditions => {
  const safeGap = clampGap(gap);
  const safeValve = clampValve(valve);
  const speed = calculateWheelSpeed(safeValve);
  const load = calculateLoad(safeGap, speed);
  return {
    gap: safeGap,
    valve: safeValve,
    speed,
    load,
    fineness: getFlourFineness(safeGap),
    ratios: getFlourRatios(safeGap),
  };
};

const applyConditions = (
  ledger: MillLedger,
  gap: number,
  valve: number
): MillLedger => {
  const c = deriveConditions(gap, valve);
  return {
    ...ledger,
    gap: c.gap,
    valve: c.valve,
    speed: c.speed,
    load: c.load,
    overloaded: isOverloaded(c.load),
  };
};

export const createLedger = (
  init: { gap?: number; valve?: number } = {}
): MillLedger =>
  applyConditions(
    {
      time: 0,
      gap: MIN_GAP,
      valve: 0,
      speed: 0,
      load: 0,
      overloaded: false,
      pending: [],
      pendingTotals: { ...ZERO_OUTPUT },
      batches: [],
      packSeq: 0,
      segmentSeq: 0,
    },
    init.gap ?? NOMINAL_GAP,
    init.valve ?? 0
  );

export const setGap = (ledger: MillLedger, gap: number): MillLedger =>
  applyConditions(ledger, gap, ledger.valve);

export const setValve = (ledger: MillLedger, valve: number): MillLedger =>
  applyConditions(ledger, ledger.gap, valve);

const sameConditions = (a: MillConditions, gap: number, valve: number): boolean =>
  a.gap === gap && a.valve === valve;

/**
 * 推进仿真时钟并累积产出。
 * 过载保护触发时磨盘停转，该时段不产生任何产出（也不产生空段落）。
 */
export const tick = (ledger: MillLedger, dt: number): MillLedger => {
  const safeDt = clamp(dt, 0, MAX_DT);
  if (safeDt === 0) return ledger;

  const time = ledger.time + safeDt;
  if (ledger.overloaded || ledger.speed <= 0) {
    return { ...ledger, time };
  }

  const output = calculateFlourOutput(ledger.gap, ledger.speed, safeDt);
  if (totalOutput(output) <= 0) {
    return { ...ledger, time };
  }

  const pending = ledger.pending.slice();
  const last = pending[pending.length - 1];
  if (last && !last.sealed && sameConditions(last.conditions, ledger.gap, ledger.valve)) {
    pending[pending.length - 1] = {
      ...last,
      endTime: time,
      output: {
        fine: last.output.fine + output.fine,
        medium: last.output.medium + output.medium,
        bran: last.output.bran + output.bran,
      },
    };
  } else {
    pending.push({
      id: `seg-${ledger.segmentSeq + 1}`,
      startTime: ledger.time,
      endTime: time,
      conditions: deriveConditions(ledger.gap, ledger.valve),
      output,
    });
  }

  return {
    ...ledger,
    time,
    pending,
    segmentSeq: ledger.segmentSeq + (pending.length > ledger.pending.length ? 1 : 0),
    pendingTotals: {
      fine: ledger.pendingTotals.fine + output.fine,
      medium: ledger.pendingTotals.medium + output.medium,
      bran: ledger.pendingTotals.bran + output.bran,
    },
  };
};

export const roundWeight = (weight: number): number =>
  Math.round(clamp(weight, 0, Number.MAX_SAFE_INTEGER) * 10) / 10;

export interface PackResult {
  ledger: MillLedger;
  /** 重量不足 0.1 斤时为 null（不生成空袋、不消耗编号） */
  batch: Batch | null;
}

/**
 * 打包：把当前未打包段落冻结为一个批次。
 * 批次重量与成色完全由产出期间各段落的实际工况决定；
 * 已打包批次从此与磨盘后续状态变化无关。
 */
export const pack = (
  ledger: MillLedger,
  type: FlourType,
  packedAt: number
): PackResult => {
  const weight = roundWeight(ledger.pendingTotals[type]);
  if (weight <= 0) {
    return { ledger, batch: null };
  }

  const seq = ledger.packSeq + 1;
  const batch: Batch = {
    id: `batch-${seq}`,
    seq,
    type,
    weight,
    packedAt: Number.isFinite(packedAt) ? packedAt : 0,
    evidence: ledger.pending
      .filter((seg) => seg.output[type] > 0)
      .map((seg) => ({
        ...seg.conditions,
        segmentId: seg.id,
        duration: seg.endTime - seg.startTime,
        output: { ...seg.output },
        typeWeight: seg.output[type],
      })),
  };

  // 只清空本品类的累计（对应"清空本桶"），其余品类继续累积；
  // 三种品类都清零的段落从台账中移除，仍有剩余的段落封账，
  // 后续产出另起新段，保证每段时长与其贡献严格对应。
  const pending = ledger.pending
    .map((seg) => ({ ...seg, output: { ...seg.output, [type]: 0 }, sealed: true }))
    .filter((seg) => totalOutput(seg.output) > 0);

  return {
    ledger: {
      ...ledger,
      pending,
      pendingTotals: { ...ledger.pendingTotals, [type]: 0 },
      batches: [...ledger.batches, batch],
      packSeq: seq,
    },
    batch,
  };
};

/** 从持久化记录恢复批次列表（保持编号单调，避免与后续打包冲突） */
export const restoreBatches = (
  ledger: MillLedger,
  batches: Batch[]
): MillLedger => {
  const maxSeq = batches.reduce((max, b) => Math.max(max, b.seq), ledger.packSeq);
  return { ...ledger, batches: batches.slice(), packSeq: maxSeq };
};

/** 校验批次内部一致性：袋重 ≈ 各段贡献之和（允许 0.1 斤结算误差） */
export const batchConsistent = (batch: Batch): boolean => {
  const sum = batch.evidence.reduce((acc, ev) => acc + ev.typeWeight, 0);
  return Math.abs(roundWeight(sum) - batch.weight) <= 0.1;
};

export const getFlourTypeName = (type: FlourType): string => {
  const names: Record<FlourType, string> = {
    fine: '精白面',
    medium: '中筋面',
    bran: '麸皮',
  };
  return names[type];
};

export const getFlourTypeColor = (type: FlourType): string => {
  const colors: Record<FlourType, string> = {
    fine: '#faf8f0',
    medium: '#f5e6c8',
    bran: '#d4a574',
  };
  return colors[type];
};

export const getFinenessName = (fineness: Fineness): string => {
  const names: Record<Fineness, string> = {
    fine: '细',
    medium: '中',
    coarse: '粗',
  };
  return names[fineness];
};

export const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const formatRatios = (ratios: FlourRatios): string =>
  FLOUR_TYPES.map((t) => `${getFlourTypeName(t)} ${(ratios[t] * 100).toFixed(0)}%`).join(
    ' / '
  );
