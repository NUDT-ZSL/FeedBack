import type {
  Batch,
  BatchBasisSegment,
  FlourMix,
  FlourType,
  MillAction,
  MillSegment,
  MillState,
  Particle,
} from './types';

/* ------------------------------------------------------------------ */
/* 常量与安全边界                                                      */
/* ------------------------------------------------------------------ */

export const MIN_GAP = 0.5; // mm，磨盘间隙下限，负载换算的除数下界
export const MAX_GAP = 3; // mm
export const MIN_VALVE = 0;
export const MAX_VALVE = 100;
export const OVERLOAD_THRESHOLD = 85; // 负载超过该值触发过载停机保护
export const MAX_PARTICLES = 100;

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const MAX_WHEEL_SPEED = 60;

export const clampGap = (gap: number): number => clamp(gap, MIN_GAP, MAX_GAP);
export const clampValve = (valve: number): number =>
  clamp(valve, MIN_VALVE, MAX_VALVE);

/** 斤数保留 0.1 精度 */
export const roundWeight = (weight: number): number =>
  Math.round(weight * 10) / 10;

/* ------------------------------------------------------------------ */
/* 磨盘状态换算（全部纯函数，保证无除零、无负值）                        */
/* ------------------------------------------------------------------ */

export const calculateWheelSpeed = (valveOpening: number): number => {
  // 阀门 0-100% 线性映射到 0-60 转
  return (clampValve(valveOpening) / 100) * MAX_WHEEL_SPEED;
};

/**
 * 负载 = 基准负载 × (参考间隙 / 间隙)² × (转速 / 最高转速)
 * 标定：阀门全开、间隙 1.5mm 时负载 55%；间隙越小、转速越高负载越大，
 * 小间隙配高转速（如 0.8mm + 阀门 60%）即越过 85% 触发过载停机。
 * 间隙被钳位到 [0.5, 3]，除数恒 >= 0.25，不会出现除零或负值。
 */
const REFERENCE_GAP = 1.5;
const BASE_LOAD_RATIO = 0.55;

export const calculateLoad = (gap: number, speed: number): number => {
  const safeGap = clampGap(gap);
  const safeSpeed = clamp(speed, 0, MAX_WHEEL_SPEED);
  const gapFactor = (REFERENCE_GAP / safeGap) ** 2;
  const speedFactor = safeSpeed / MAX_WHEEL_SPEED;
  return clamp(BASE_LOAD_RATIO * gapFactor * speedFactor * 100, 0, 100);
};

export const isOverloaded = (load: number): boolean => {
  return load > OVERLOAD_THRESHOLD;
};

export const getFlourFineness = (gap: number): 'fine' | 'medium' | 'coarse' => {
  const safeGap = clampGap(gap);
  if (safeGap < 1) return 'fine';
  if (safeGap < 2) return 'medium';
  return 'coarse';
};

/** 间隙 -> 产出配比，三项恒为非负且合计为 1 */
export const getFlourRatios = (gap: number): FlourMix => {
  const safeGap = clampGap(gap);
  if (safeGap < 1) return { fine: 0.6, medium: 0.3, bran: 0.1 };
  if (safeGap < 2) return { fine: 0.3, medium: 0.5, bran: 0.2 };
  return { fine: 0.1, medium: 0.4, bran: 0.5 };
};

/**
 * 计算 dt 秒内的产出。speed / dt 均被钳位为非负，
 * 因此任意输入下产出都不会出现负值或 NaN。
 */
export const calculateFlourOutput = (
  gap: number,
  speed: number,
  dt: number
): FlourMix => {
  const safeSpeed = clamp(speed, 0, 100);
  const safeDt = Math.max(0, Number.isNaN(dt) ? 0 : dt);
  const baseRate = safeSpeed * 0.01 * 0.5; // 斤/秒
  const totalOutput = baseRate * safeDt;
  const ratios = getFlourRatios(gap);
  return {
    fine: totalOutput * ratios.fine,
    medium: totalOutput * ratios.medium,
    bran: totalOutput * ratios.bran,
  };
};

/* ------------------------------------------------------------------ */
/* 分段台账                                                            */
/* ------------------------------------------------------------------ */

const zeroMix = (): FlourMix => ({ fine: 0, medium: 0, bran: 0 });

const mixTotal = (mix: FlourMix): number => mix.fine + mix.medium + mix.bran;

const addMix = (a: FlourMix, b: FlourMix): FlourMix => ({
  fine: a.fine + b.fine,
  medium: a.medium + b.medium,
  bran: a.bran + b.bran,
});

const createSegment = (
  seq: number,
  gap: number,
  speed: number,
  now: number
): MillSegment => ({
  id: `seg-${seq}`,
  gap,
  speed,
  startTime: now,
  endTime: now,
  output: zeroMix(),
});

/**
 * 把 (lastLedgerAt, now] 区间的产出按当前状态计入开口分段。
 * 状态变更与打包前都必须先结账，保证每段产出都归属于它实际产生时的状态。
 */
const accrue = (state: MillState, now: number): MillState => {
  const dt = Math.max(0, (now - state.lastLedgerAt) / 1000);
  if (dt === 0) {
    return { ...state, lastLedgerAt: now };
  }
  const producing = state.isRunning && !state.isOverloaded;
  const output = producing
    ? calculateFlourOutput(state.gap, state.wheelSpeed, dt)
    : zeroMix();
  return {
    ...state,
    lastLedgerAt: now,
    openSegment: {
      ...state.openSegment,
      endTime: now,
      output: addMix(state.openSegment.output, output),
    },
  };
};

/** 封存开口分段（无产出的空段直接丢弃），并按当前状态开启新分段 */
const sealSegment = (state: MillState, now: number): MillState => {
  const sealed =
    mixTotal(state.openSegment.output) > 0
      ? [...state.sealedSegments, state.openSegment]
      : state.sealedSegments;
  const segmentSeq = state.segmentSeq + 1;
  return {
    ...state,
    sealedSegments: sealed,
    segmentSeq,
    openSegment: createSegment(segmentSeq, state.gap, state.wheelSpeed, now),
  };
};

/** 状态变更的统一入口：先按旧状态结账封存，再以新状态开新段 */
const applyStateChange = (
  state: MillState,
  now: number,
  patch: Partial<Pick<MillState, 'valveOpening' | 'gap'>>
): MillState => {
  const accrued = accrue(state, now);
  const valveOpening =
    patch.valveOpening !== undefined
      ? clampValve(patch.valveOpening)
      : accrued.valveOpening;
  const gap = patch.gap !== undefined ? clampGap(patch.gap) : accrued.gap;
  const wheelSpeed = calculateWheelSpeed(valveOpening);
  const load = calculateLoad(gap, wheelSpeed);
  const next: MillState = {
    ...accrued,
    valveOpening,
    gap,
    wheelSpeed,
    load,
    isOverloaded: isOverloaded(load),
    isRunning: valveOpening > 0,
  };
  return sealSegment(next, now);
};

/** 全部未打包分段（已封存 + 开口） */
const allSegments = (state: MillState): MillSegment[] => [
  ...state.sealedSegments,
  state.openSegment,
];

/** 界面展示的未打包累计量（各品类跨分段求和） */
export const getUnpackedTotals = (state: MillState): FlourMix => {
  let total = zeroMix();
  for (const seg of allSegments(state)) {
    total = addMix(total, seg.output);
  }
  return total;
};

/**
 * 结算口径：打包时先把开口分段结账封存，再将该品类在所有分段中的
 * 贡献求和成袋。状态变更只影响变更时刻之后的产出，因此一袋面粉的
 * 重量与成色完全由它产出期间各分段的实际间隙/转速决定。
 */
const packFlour = (
  state: MillState,
  flourType: FlourType,
  id: string,
  now: number,
  timestamp: string
): MillState => {
  const settled = sealSegment(accrue(state, now), now);
  const segments = allSegments(settled);

  const rawWeight = segments.reduce(
    (sum, seg) => sum + seg.output[flourType],
    0
  );
  const weight = roundWeight(rawWeight);
  if (weight <= 0) {
    // 没有可打包的累计量：不产生批次，也不产生动画袋
    return settled;
  }

  const basis: BatchBasisSegment[] = segments
    .filter((seg) => seg.output[flourType] > 0)
    .map((seg) => ({
      gap: seg.gap,
      speed: seg.speed,
      durationMs: seg.endTime - seg.startTime,
      ratios: getFlourRatios(seg.gap),
      contribution: roundWeight(seg.output[flourType]),
    }));

  const weightedAvg = (pick: (seg: MillSegment) => number): number =>
    segments.reduce(
      (sum, seg) => sum + pick(seg) * seg.output[flourType],
      0
    ) / rawWeight;

  const batch: Batch = {
    id,
    seq: settled.batchSeq,
    type: flourType,
    weight,
    timestamp,
    avgGap: Math.round(weightedAvg((seg) => seg.gap) * 100) / 100,
    avgSpeed: Math.round(weightedAvg((seg) => seg.speed) * 100) / 100,
    basis,
  };

  // 该品类的贡献已从分段台账中结清；三种产出均为零的分段移除
  const remaining = segments
    .map((seg) => ({ ...seg, output: { ...seg.output, [flourType]: 0 } }))
    .filter((seg) => mixTotal(seg.output) > 0);

  return {
    ...settled,
    sealedSegments: remaining,
    openSegment: createSegment(
      settled.segmentSeq + 1,
      settled.gap,
      settled.wheelSpeed,
      now
    ),
    segmentSeq: settled.segmentSeq + 1,
    batches: [...settled.batches, batch],
    batchSeq: settled.batchSeq + 1,
    animatingBags: [
      ...settled.animatingBags,
      { id, type: flourType, weight },
    ],
  };
};

/* ------------------------------------------------------------------ */
/* Reducer：纯函数，相同 action 序列必得相同结果                         */
/* ------------------------------------------------------------------ */

export const createInitialState = (now = 0): MillState => {
  const valveOpening = 0;
  const gap = 1.5;
  const wheelSpeed = calculateWheelSpeed(valveOpening);
  const load = calculateLoad(gap, wheelSpeed);
  return {
    valveOpening,
    wheelSpeed,
    gap,
    load,
    isOverloaded: isOverloaded(load),
    isRunning: false,
    sealedSegments: [],
    openSegment: createSegment(0, gap, wheelSpeed, now),
    segmentSeq: 0,
    batches: [],
    batchSeq: 1,
    animatingBags: [],
    lastLedgerAt: now,
  };
};

export const millReducer = (
  state: MillState,
  action: MillAction
): MillState => {
  switch (action.type) {
    case 'SET_VALVE':
      return applyStateChange(state, action.now, { valveOpening: action.valve });
    case 'SET_GAP':
      return applyStateChange(state, action.now, { gap: action.gap });
    case 'TICK':
      return accrue(state, action.now);
    case 'PACK':
      return packFlour(
        state,
        action.flourType,
        action.id,
        action.now,
        action.timestamp
      );
    case 'LOAD_BATCHES': {
      const maxSeq = action.batches.reduce((m, b) => Math.max(m, b.seq), 0);
      return {
        ...state,
        batches: action.batches,
        batchSeq: Math.max(state.batchSeq, maxSeq + 1),
      };
    }
    case 'REMOVE_BAG_ANIMATION':
      return {
        ...state,
        animatingBags: state.animatingBags.filter(
          (bag) => bag.id !== action.id
        ),
      };
    default:
      return state;
  }
};

/* ------------------------------------------------------------------ */
/* 粉尘粒子（纯视觉，不参与账目）                                        */
/* ------------------------------------------------------------------ */

export const createParticle = (
  x: number,
  y: number,
  id: string,
  random: () => number = Math.random
): Particle => {
  const angle = random() * Math.PI * 2;
  const speed = 0.5 + random() * 1.5;
  return {
    id,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 1,
    size: 3 + random() * 3,
    opacity: 0.8,
    life: 1,
  };
};

export const updateParticle = (
  particle: Particle,
  dt: number
): Particle | null => {
  const gravity = 0.1;
  const newVy = particle.vy + gravity * dt * 60;
  const newLife = particle.life - dt * 0.8;
  if (newLife <= 0) return null;
  return {
    ...particle,
    x: particle.x + particle.vx * dt * 60,
    y: particle.y + newVy * dt * 60,
    vy: newVy,
    opacity: newLife * 0.8,
    life: newLife,
  };
};

/* ------------------------------------------------------------------ */
/* 展示辅助                                                            */
/* ------------------------------------------------------------------ */

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

export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
