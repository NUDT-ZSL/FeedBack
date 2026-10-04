import {
  COLOR_STAGES,
  CONSUMPTION_PER_REF_DIP,
  DEFAULT_PARAMS,
  DEPTH_GAIN,
  DIP_REF_SEC,
  MAX_AIR_DRY_SEC,
  MAX_DIP_COUNT,
  MAX_DIP_DURATION_SEC,
  MAX_STAGE,
  MAX_TOTAL_AIR_DRY_SEC,
  OXIDATION_FLOOR,
  OXIDATION_REF_SEC,
} from './constants';
import type {
  Derivation,
  DyeingParams,
  DyeingResult,
  OxidationStageResult,
  UptakeStageResult,
} from './types';

/** 将输入值钳制到 [min, max]；NaN 回退为 fallback，±Infinity 钳到边界。 */
function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return max;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/** 参数清洗：所有非法/极端取值都会被规范化，推演函数不接受脏输入。 */
export function sanitizeParams(params: DyeingParams): DyeingParams {
  return {
    dyeConcentration: clampFinite(
      params.dyeConcentration,
      0,
      1,
      DEFAULT_PARAMS.dyeConcentration,
    ),
    dipDurationSec: clampFinite(
      params.dipDurationSec,
      0,
      MAX_DIP_DURATION_SEC,
      DEFAULT_PARAMS.dipDurationSec,
    ),
    dipCount: Math.floor(
      clampFinite(params.dipCount, 0, MAX_DIP_COUNT, DEFAULT_PARAMS.dipCount),
    ),
    airDrySec: clampFinite(
      params.airDrySec,
      0,
      MAX_AIR_DRY_SEC,
      DEFAULT_PARAMS.airDrySec,
    ),
  };
}

/**
 * 吸色阶段：染液浓度消耗与布料着色原始深度。
 * 依赖：dyeConcentration、dipDurationSec、dipCount。
 */
export function computeUptake(params: DyeingParams): UptakeStageResult {
  const dipFactor = 1 - Math.exp(-params.dipDurationSec / DIP_REF_SEC);
  const decayPerDip = CONSUMPTION_PER_REF_DIP * dipFactor;
  const remainingRatio = Math.pow(1 - decayPerDip, params.dipCount);
  const finalConcentration = params.dyeConcentration * remainingRatio;
  const concentrationLoss = params.dyeConcentration - finalConcentration;

  const perDipGain = DEPTH_GAIN * dipFactor;
  let product = 1;
  let concentrationBeforeDip = params.dyeConcentration;
  for (let i = 0; i < params.dipCount; i += 1) {
    product *= 1 - perDipGain * concentrationBeforeDip;
    concentrationBeforeDip *= 1 - decayPerDip;
  }
  return {
    dipFactor,
    decayPerDip,
    finalConcentration,
    concentrationLoss,
    rawColorDepth: 1 - product,
  };
}

/**
 * 氧化阶段：浸染次数与晾晒时长的换算。
 * 依赖：dipCount、airDrySec。
 * 乘积先钳制后再参与指数计算，极端取值下不会溢出或为负。
 */
export function computeOxidation(params: DyeingParams): OxidationStageResult {
  const product = params.dipCount * params.airDrySec;
  const totalAirDrySec = Math.min(
    Number.isFinite(product) ? product : MAX_TOTAL_AIR_DRY_SEC,
    MAX_TOTAL_AIR_DRY_SEC,
  );
  const oxidationProgress = 1 - Math.exp(-totalAirDrySec / OXIDATION_REF_SEC);
  return { totalAirDrySec, oxidationProgress };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** 由连续着色深度映射到色阶序号与插值后的 HEX 色值。 */
export function colorFromDepth(depth: number): { stage: number; colorHex: string } {
  const safeDepth = clampFinite(depth, 0, 1, 0);
  const position = Math.min(MAX_STAGE, safeDepth * (MAX_STAGE + 1));
  const stage = Math.min(MAX_STAGE, Math.floor(position));
  if (stage >= MAX_STAGE) {
    return { stage: MAX_STAGE, colorHex: COLOR_STAGES[MAX_STAGE] };
  }
  const fraction = position - stage;
  const from = hexToRgb(COLOR_STAGES[stage]);
  const to = hexToRgb(COLOR_STAGES[stage + 1]);
  return {
    stage,
    colorHex: rgbToHex(
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
      from[2] + (to[2] - from[2]) * fraction,
    ),
  };
}

function buildResult(
  params: DyeingParams,
  uptake: UptakeStageResult,
  oxidation: OxidationStageResult,
): DyeingResult {
  const colorDepth =
    uptake.rawColorDepth *
    (OXIDATION_FLOOR + (1 - OXIDATION_FLOOR) * oxidation.oxidationProgress);
  const { stage, colorHex } = colorFromDepth(colorDepth);
  return {
    dipCount: params.dipCount,
    initialConcentration: params.dyeConcentration,
    dyeConcentration: uptake.finalConcentration,
    concentrationLoss: uptake.concentrationLoss,
    totalAirDrySec: oxidation.totalAirDrySec,
    oxidationProgress: oxidation.oxidationProgress,
    colorDepth,
    stage,
    colorHex,
    isComplete: stage >= MAX_STAGE,
  };
}

const UPTAKE_KEYS: (keyof DyeingParams)[] = [
  'dyeConcentration',
  'dipDurationSec',
  'dipCount',
];
const OXIDATION_KEYS: (keyof DyeingParams)[] = ['dipCount', 'airDrySec'];

function equalOn(a: DyeingParams, b: DyeingParams, keys: (keyof DyeingParams)[]): boolean {
  return keys.every((key) => a[key] === b[key]);
}

/**
 * 统一推演入口。
 *
 * - 不传 `prev`（或相关依赖变化）时全量重算；
 * - 传入上一次的 `Derivation` 时只重算受影响的阶段，未变化的阶段直接复用；
 * - 由于各阶段都是参数的纯函数，增量结果与全量重算严格一致。
 */
export function derive(params: DyeingParams, prev?: Derivation): Derivation {
  const sanitized = sanitizeParams(params);
  const uptake =
    prev && equalOn(prev.params, sanitized, UPTAKE_KEYS)
      ? prev.uptake
      : computeUptake(sanitized);
  const oxidation =
    prev && equalOn(prev.params, sanitized, OXIDATION_KEYS)
      ? prev.oxidation
      : computeOxidation(sanitized);
  return {
    params: sanitized,
    uptake,
    oxidation,
    result: buildResult(sanitized, uptake, oxidation),
  };
}
