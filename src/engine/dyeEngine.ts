/**
 * 靛蓝浸染推演模块（纯函数，无 UI / 无 DOM 依赖）。
 *
 * 链路唯一入口：给定一组浸染参数 DyeParams，由 deriveAll 稳定推演出
 * DyeDerivation（氧化进度、染液浓度变化、布料着色深度、浸染次数、色值）。
 * 界面任何位置都只能消费本模块的结果，不允许自行推算。
 *
 * 数据流：参数 DyeParams -> deriveAll / deriveAffected -> DyeDerivation
 */

/** 浸染参数：所有界面入口最终归一化为该结构后再交给推演模块。 */
export interface DyeParams {
  /** 染液初始浓度（0..1，归一化）。 */
  dyeConcentration: number;
  /** 单次浸染时长（秒）。 */
  dipDurationSec: number;
  /** 浸染次数（非负整数）。 */
  dipCount: number;
  /** 单次浸染后的晾晒时长（秒），决定氧化进度。 */
  airDurationSec: number;
}

/** 推演结果：界面只允许读取这里的字段。 */
export interface DyeDerivation {
  /** 归一化后的浸染次数。 */
  dipCount: number;
  /** 氧化进度 0..1（晾晒时长 / 完全氧化所需时长）。 */
  oxidationProgress: number;
  /** 浸染后剩余染液浓度 0..1。 */
  concentrationAfter: number;
  /** 染液消耗量 0..1。 */
  concentrationConsumed: number;
  /** 布料着色深度 0..1。 */
  colorDepth: number;
  /** 当前色阶下标（0..COLOR_STAGES.length-1，会按深度取整）。 */
  stageIndex: number;
  /** 当前色值 hex（在相邻预设色阶间线性插值）。 */
  colorHex: string;
  /** 是否达到最深色阶。 */
  completed: boolean;
}

export type DyeParamKey = keyof DyeParams;

/** 预设 10 个色阶：淡绿 -> 深蓝（见 PRD 5.3）。 */
export const COLOR_STAGES: readonly string[] = [
  '#b5d8a7',
  '#8fc27e',
  '#6ba85e',
  '#4f8b4d',
  '#35703a',
  '#1f562b',
  '#154024',
  '#0e2e1c',
  '#061e12',
  '#0a2c5d',
];

/** 完全氧化所需晾晒时长（秒）。 */
export const OXIDATION_FULL_SEC = 10;
/** 两次浸染之间的最小间隔（秒），用于快速连点去重。 */
export const MIN_INTERVAL_SEC = OXIDATION_FULL_SEC;
/** 浸染时长饱和常数（秒），浸染上色随时间指数饱和。 */
export const DIP_TIME_CONSTANT_SEC = 30;
/** 单次浸染最多消耗染液的比例（乘以浸染时长因子）。 */
export const CONSUMPTION_RATE = 0.06;
/** 浸染次数硬上限，防止极端输入下迭代溢出。 */
export const MAX_DIP_COUNT = 10000;
/** 时长（秒）硬上限，约 24 小时；超出截断，不允许 Infinity 流入推演。 */
export const MAX_DURATION_SEC = 86400;

/** 规范化后的默认参数（极端输入兜底也使用它）。 */
export const DEFAULT_PARAMS: DyeParams = {
  dyeConcentration: 0.8,
  dipDurationSec: 8,
  dipCount: 0,
  airDurationSec: OXIDATION_FULL_SEC,
};

/** 字段级依赖表：每个推演结果字段依赖哪些入参，供增量重算使用。 */
const FIELD_DEPENDENCIES: Readonly<Record<keyof DyeDerivation, readonly DyeParamKey[]>> = {
  dipCount: ['dipCount'],
  oxidationProgress: ['airDurationSec'],
  concentrationAfter: ['dyeConcentration', 'dipDurationSec', 'dipCount'],
  concentrationConsumed: ['dyeConcentration', 'dipDurationSec', 'dipCount'],
  colorDepth: ['dyeConcentration', 'dipDurationSec', 'dipCount', 'airDurationSec'],
  stageIndex: ['dyeConcentration', 'dipDurationSec', 'dipCount', 'airDurationSec'],
  colorHex: ['dyeConcentration', 'dipDurationSec', 'dipCount', 'airDurationSec'],
  completed: ['dyeConcentration', 'dipDurationSec', 'dipCount', 'airDurationSec'],
};

/** 结果中所有字段名（保持与依赖表同步）。 */
const DERIVATION_FIELDS = Object.keys(FIELD_DEPENDENCIES) as (keyof DyeDerivation)[];

/**
 * 把任意输入收敛为有限、有界的数值：
 * NaN / Infinity / -Infinity -> fallback；再夹到 [min, max]。
 */
export function saneNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

/** 收敛浸染次数为 [0, MAX_DIP_COUNT] 的非负整数。 */
export function saneDipCount(value: unknown): number {
  return Math.trunc(saneNumber(value, 0, 0, MAX_DIP_COUNT));
}

/** 对外部参数做一次性归一化，保证推演函数永远只见到有界数值。 */
export function sanitizeParams(params: Partial<DyeParams> | null | undefined): DyeParams {
  const p = params ?? {};
  return {
    dyeConcentration: saneNumber(p.dyeConcentration, DEFAULT_PARAMS.dyeConcentration, 0, 1),
    dipDurationSec: saneNumber(p.dipDurationSec, DEFAULT_PARAMS.dipDurationSec, 0, MAX_DURATION_SEC),
    dipCount: saneDipCount(p.dipCount),
    airDurationSec: saneNumber(p.airDurationSec, DEFAULT_PARAMS.airDurationSec, 0, MAX_DURATION_SEC),
  };
}

/* ------------------------------------------------------------------ */
/* 各结果字段的独立推演（全部为纯函数，便于增量重算与离线验证）。        */
/* ------------------------------------------------------------------ */

export function deriveDipCount(params: DyeParams): number {
  return saneDipCount(params.dipCount);
}

export function deriveOxidationProgress(params: DyeParams): number {
  if (OXIDATION_FULL_SEC <= 0) {
    return 1;
  }
  const progress = saneNumber(params.airDurationSec, 0, 0, MAX_DURATION_SEC) / OXIDATION_FULL_SEC;
  return Math.min(1, Math.max(0, progress));
}

/** 单次浸染时长因子：0 秒 -> 0，时间越久越趋近 1（指数饱和）。 */
export function dipDurationFactor(dipDurationSec: number): number {
  const t = saneNumber(dipDurationSec, 0, 0, MAX_DURATION_SEC);
  if (t <= 0) {
    return 0;
  }
  return 1 - Math.exp(-t / DIP_TIME_CONSTANT_SEC);
}

/**
 * 逐次浸染的浓度轨迹：每次浸染染液按 消耗率 * 时长因子 等比下降。
 * 返回长度 dipCount+1 的数组，第一项为初始浓度。
 */
export function deriveConcentrationPath(params: DyeParams): number[] {
  const count = deriveDipCount(params);
  const initial = saneNumber(params.dyeConcentration, 0, 0, 1);
  const factor = dipDurationFactor(params.dipDurationSec);
  const retention = 1 - Math.min(1, Math.max(0, CONSUMPTION_RATE * factor));
  const path = new Array<number>(count + 1);
  path[0] = initial;
  for (let i = 1; i <= count; i += 1) {
    path[i] = path[i - 1] * retention;
  }
  return path;
}

export function deriveConcentrationAfter(params: DyeParams): number {
  const path = deriveConcentrationPath(params);
  return path[path.length - 1];
}

export function deriveConcentrationConsumed(params: DyeParams): number {
  const initial = saneNumber(params.dyeConcentration, 0, 0, 1);
  const consumed = initial - deriveConcentrationAfter(params);
  return Math.min(1, Math.max(0, consumed));
}

/**
 * 布料着色深度：逐次浸染按剩余浓度上色（饱和叠加），
 * 再乘以氧化进度（未氧化的染色不显色）。
 */
export function deriveColorDepth(params: DyeParams): number {
  const count = deriveDipCount(params);
  const path = deriveConcentrationPath(params);
  const duration = dipDurationFactor(params.dipDurationSec);
  const oxidation = deriveOxidationProgress(params);
  let depth = 0;
  for (let i = 0; i < count; i += 1) {
    const uptake = path[i] * duration;
    depth += (1 - depth) * uptake;
  }
  return Math.min(1, Math.max(0, depth * oxidation));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** 在两个预设色阶之间按 t(0..1) 线性插值出 hex。 */
export function interpolateColor(fromHex: string, toHex: string, t: number): string {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const ratio = Math.min(1, Math.max(0, t));
  const r = lerp(from.r, to.r, ratio).toString(16).padStart(2, '0');
  const g = lerp(from.g, to.g, ratio).toString(16).padStart(2, '0');
  const b = lerp(from.b, to.b, ratio).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function deriveStageIndex(colorDepth: number): number {
  const depth = Math.min(1, Math.max(0, colorDepth));
  const scaled = depth * (COLOR_STAGES.length - 1);
  return Math.min(COLOR_STAGES.length - 1, Math.floor(scaled + 1e-9));
}

export function deriveColorHex(colorDepth: number): string {
  const depth = Math.min(1, Math.max(0, colorDepth));
  const scaled = depth * (COLOR_STAGES.length - 1);
  const index = Math.min(COLOR_STAGES.length - 2, Math.floor(scaled));
  return interpolateColor(COLOR_STAGES[index], COLOR_STAGES[index + 1], scaled - index);
}

/**
 * 全量推演：同一组参数无论从哪个界面入口进来结果都一致。
 * 入参会先经过 sanitizeParams 归一化。
 */
export function deriveAll(rawParams: Partial<DyeParams> | null | undefined): DyeDerivation {
  const params = sanitizeParams(rawParams);
  const colorDepth = deriveColorDepth(params);
  const stageIndex = deriveStageIndex(colorDepth);
  return {
    dipCount: deriveDipCount(params),
    oxidationProgress: deriveOxidationProgress(params),
    concentrationAfter: deriveConcentrationAfter(params),
    concentrationConsumed: deriveConcentrationConsumed(params),
    colorDepth,
    stageIndex,
    colorHex: deriveColorHex(colorDepth),
    completed: stageIndex >= COLOR_STAGES.length - 1,
  };
}

/** 判断某结果字段是否会被变更的入参影响。 */
export function isFieldAffected(field: keyof DyeDerivation, changedKeys: readonly DyeParamKey[]): boolean {
  return FIELD_DEPENDENCIES[field].some((dep) => changedKeys.includes(dep));
}

/**
 * 增量重算：参数被修改后只重算受影响的字段，其余字段沿用 previous。
 * 因为每个字段都是入参的纯函数，增量结果与 deriveAll 全量结果逐字段一致
 * （该不变量由离线验证脚本覆盖）。
 */
export function deriveAffected(
  previous: DyeDerivation,
  rawParams: Partial<DyeParams> | null | undefined,
  changedKeys: readonly DyeParamKey[],
): DyeDerivation {
  const params = sanitizeParams(rawParams);
  const full = deriveAll(params);
  const next: DyeDerivation = { ...previous };
  const writable = next as Record<keyof DyeDerivation, DyeDerivation[keyof DyeDerivation]>;
  for (const field of DERIVATION_FIELDS) {
    if (isFieldAffected(field, changedKeys)) {
      writable[field] = full[field];
    }
  }
  return next;
}

/** 浸染次数与晾晒总时长的换算（秒 -> 可完成的浸染次数），极端取值下不出现负值。 */
export function airSecondsToDipCount(totalAirSeconds: unknown): number {
  const seconds = saneNumber(totalAirSeconds, 0, 0, MAX_DIP_COUNT * MAX_DURATION_SEC);
  if (MIN_INTERVAL_SEC <= 0) {
    return 0;
  }
  return Math.min(MAX_DIP_COUNT, Math.floor(seconds / MIN_INTERVAL_SEC));
}

/** 浸染次数 -> 所需最小晾晒总时长（秒），次数经归一化，结果恒为非负有界。 */
export function dipCountToAirSeconds(dipCount: unknown): number {
  const count = saneDipCount(dipCount);
  return count * MIN_INTERVAL_SEC;
}
