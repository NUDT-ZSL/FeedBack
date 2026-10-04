import type { DyeingParams } from './types';

/** 预设色阶：从淡绿到深蓝共 10 阶。 */
export const COLOR_STAGES = [
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
] as const;

export const MAX_STAGE = COLOR_STAGES.length - 1;

/** 边界钳制上限，保证极端取值下不出现负值或溢出。 */
export const MAX_DIP_COUNT = 10_000;
export const MAX_DIP_DURATION_SEC = 3_600;
export const MAX_AIR_DRY_SEC = 86_400;
/** 浸染次数 × 晾晒时长换算结果的饱和上限（秒）。 */
export const MAX_TOTAL_AIR_DRY_SEC = 1_000_000_000;
/** 记录列表最多保留条数，超出移除最早记录。 */
export const MAX_RECORDS = 50;

/** 推演模型常量。 */
export const DIP_REF_SEC = 5;
export const CONSUMPTION_PER_REF_DIP = 0.05;
export const DEPTH_GAIN = 0.3;
export const OXIDATION_REF_SEC = 10;
/** 氧化不足时着色深度的保留下限比例。 */
export const OXIDATION_FLOOR = 0.4;

export const DEFAULT_PARAMS: DyeingParams = {
  dyeConcentration: 0.8,
  dipDurationSec: 5,
  dipCount: 0,
  airDrySec: 10,
};
