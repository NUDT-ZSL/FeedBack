import {
  Plant,
  PlantTraits,
  OptimalEnvironment,
  EnvDimension,
  TraitKey,
  DriftEvent,
} from './plants';
import { EnvironmentState } from './environment';

/** 各环境维度的全局合法范围 */
const DIM_BOUNDS: Record<EnvDimension, { min: number; max: number }> = {
  temperature: { min: 5, max: 45 },
  humidity: { min: 0, max: 100 },
  light: { min: 0, max: 100 },
};

const DIM_FIELDS: Record<EnvDimension, [keyof OptimalEnvironment, keyof OptimalEnvironment]> = {
  temperature: ['tempMin', 'tempMax'],
  humidity: ['humidityMin', 'humidityMax'],
  light: ['lightMin', 'lightMax'],
};

/**
 * 环境维度 → 联动性状。
 * gain 为每单位区间位移对应的性状变化量，方向由胁迫方向决定：
 * 温度偏高→植株更高，湿度偏低→更耐旱，光照偏强→颜色/形态值增大。
 */
const DRIFT_TRAITS: Record<EnvDimension, { trait: TraitKey; gain: number }[]> = {
  temperature: [{ trait: 'height', gain: 0.6 }],
  humidity: [{ trait: 'droughtResistance', gain: 1.2 }],
  light: [
    { trait: 'color', gain: 0.4 },
    { trait: 'shape', gain: 0.4 },
  ],
};

/** 区间位移速率：每（偏离度 × 秒）移动的区间单位数 */
export const DRIFT_RATE = 0.002;

interface PendingEpisode {
  exposureMs: number;
  envSum: number;
  envSamples: number;
  shift: number;
  traitDeltas: Partial<Record<TraitKey, number>>;
  rangeBefore: [number, number];
}

function clampRange(value: number, dim: EnvDimension): number {
  const bounds = DIM_BOUNDS[dim];
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

/**
 * 环境压力驱动的性状漂移系统。
 * 每帧/每 tick 调用 update：环境在最适区间内（含边界）时不产生漂移；
 * 在区间外时按“偏离度 × 暴露时长”渐进推移最适区间并联动性状。
 * 暴露时长按维度累计，反复进出不会清零也不会重复计入。
 */
export class DriftSystem {
  /** 进行中的漂移片段，key 为 `${plantId}:${dimension}` */
  private pending: Map<string, PendingEpisode> = new Map();

  update(plant: Plant, env: EnvironmentState, deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }
    const dims: EnvDimension[] = ['temperature', 'humidity', 'light'];
    for (const dim of dims) {
      const value = env[dim];
      const [minKey, maxKey] = DIM_FIELDS[dim];
      const min = plant.optimalEnv[minKey];
      const max = plant.optimalEnv[maxKey];

      // 边界按包含处理：落在区间内（含端点）不漂移
      if (value >= min && value <= max) {
        this.flush(plant, dim);
        continue;
      }

      const deviation = value < min ? min - value : value - max;
      const direction = value < min ? -1 : 1;
      plant.stressExposure[dim] += deltaMs;

      const key = `${plant.id}:${dim}`;
      let episode = this.pending.get(key);
      if (!episode) {
        episode = {
          exposureMs: 0,
          envSum: 0,
          envSamples: 0,
          shift: 0,
          traitDeltas: {},
          rangeBefore: [min, max],
        };
        this.pending.set(key, episode);
      }
      episode.exposureMs += deltaMs;
      episode.envSum += value;
      episode.envSamples += 1;

      const shift = direction * DRIFT_RATE * deviation * (deltaMs / 1000);
      episode.shift += shift;

      // 立即生效：区间整体向环境方向推移（保持区间宽度）
      plant.optimalEnv[minKey] = clampRange(plant.optimalEnv[minKey] + shift, dim);
      plant.optimalEnv[maxKey] = clampRange(plant.optimalEnv[maxKey] + shift, dim);

      // 联动性状漂移，同样立即生效
      for (const { trait, gain } of DRIFT_TRAITS[dim]) {
        const delta = shift * gain;
        episode.traitDeltas[trait] = (episode.traitDeltas[trait] ?? 0) + delta;
        // 保留小数累计，避免单 tick 增量小于 1 时被取整吞掉；越界时截断
        plant.traits[trait] = Math.max(0, Math.min(255, plant.traits[trait] + delta));
      }

      plant.cumulativeDrift += Math.abs(shift);
    }
  }

  /** 结算某维度进行中的漂移片段（环境回到区间内或手动调用时触发） */
  flush(plant: Plant, dim: EnvDimension): void {
    const key = `${plant.id}:${dim}`;
    const episode = this.pending.get(key);
    if (!episode || episode.exposureMs <= 0) {
      this.pending.delete(key);
      return;
    }
    const [minKey, maxKey] = DIM_FIELDS[dim];
    const traitDeltas: Partial<Record<TraitKey, number>> = {};
    for (const [trait, delta] of Object.entries(episode.traitDeltas)) {
      traitDeltas[trait as TraitKey] = Math.round(delta * 100) / 100;
    }
    const event: DriftEvent = {
      dimension: dim,
      exposureMs: episode.exposureMs,
      totalExposureMs: plant.stressExposure[dim],
      avgEnvValue: Math.round((episode.envSum / episode.envSamples) * 10) / 10,
      rangeBefore: episode.rangeBefore,
      rangeAfter: [plant.optimalEnv[minKey], plant.optimalEnv[maxKey]],
      traitDeltas,
      magnitude: Math.abs(episode.shift),
    };
    plant.driftEvents.push(event);
    this.pending.delete(key);
  }

  /** 结算该植株所有维度的进行中片段（如收获、导出或打印报告前） */
  flushAll(plant: Plant): void {
    const dims: EnvDimension[] = ['temperature', 'humidity', 'light'];
    for (const dim of dims) {
      this.flush(plant, dim);
    }
  }
}
