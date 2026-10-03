import {
  Plant,
  PlantTraits,
  OptimalEnvironment,
  EnvironmentSnapshot,
  DriftEvent,
  EnvDimension,
} from './plants.js';

export interface DriftConfig {
  traitDriftRate: number;
  envDriftRate: number;
}

export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  traitDriftRate: 0.05,
  envDriftRate: 0.02,
};

interface DimensionSpec {
  dimension: EnvDimension;
  valueKey: keyof EnvironmentSnapshot;
  minKey: keyof OptimalEnvironment;
  maxKey: keyof OptimalEnvironment;
  physicalMin: number;
  physicalMax: number;
}

const DIMENSIONS: DimensionSpec[] = [
  { dimension: 'temperature', valueKey: 'temperature', minKey: 'tempMin', maxKey: 'tempMax', physicalMin: 10, physicalMax: 40 },
  { dimension: 'humidity', valueKey: 'humidity', minKey: 'humidityMin', maxKey: 'humidityMax', physicalMin: 0, physicalMax: 100 },
  { dimension: 'light', valueKey: 'light', minKey: 'lightMin', maxKey: 'lightMax', physicalMin: 0, physicalMax: 100 },
];

const TRAIT_RESPONSES: Record<keyof PlantTraits, { dimension: EnvDimension; direction: 1 | -1 }> = {
  color: { dimension: 'temperature', direction: 1 },
  shape: { dimension: 'temperature', direction: -1 },
  droughtResistance: { dimension: 'humidity', direction: -1 },
  height: { dimension: 'light', direction: -1 },
};

function clampTrait(value: number): number {
  return Math.max(0, Math.min(255, value));
}

export class EnvironmentalDriftSystem {
  private config: DriftConfig;

  constructor(config: DriftConfig = DEFAULT_DRIFT_CONFIG) {
    this.config = { ...config };
  }

  update(plant: Plant, env: EnvironmentSnapshot, deltaTime: number, currentTime: number): void {
    if (deltaTime <= 0) {
      return;
    }

    const deviations = new Map<EnvDimension, number>();
    let stressed = false;

    for (const spec of DIMENSIONS) {
      const value = env[spec.valueKey];
      const min = plant.optimalEnv[spec.minKey];
      const max = plant.optimalEnv[spec.maxKey];
      let deviation = 0;
      if (value < min) {
        deviation = value - min;
      } else if (value > max) {
        deviation = value - max;
      }
      if (deviation !== 0) {
        stressed = true;
        const range = Math.max(1e-6, max - min);
        deviations.set(spec.dimension, deviation / range);
      }
    }

    if (!stressed) {
      this.closeEpisode(plant, currentTime);
      return;
    }

    plant.totalStressTime += deltaTime;
    const episode = this.ensureEpisode(plant, env, currentTime);
    episode.endTime = currentTime;
    episode.duration += deltaTime;
    episode.env = { ...env };

    for (const spec of DIMENSIONS) {
      const deviation = deviations.get(spec.dimension);
      if (deviation === undefined) {
        continue;
      }

      const envShift = this.config.envDriftRate * deviation * deltaTime;
      const newMin = this.clampBound(plant.optimalEnv[spec.minKey] + envShift, spec);
      const newMax = this.clampBound(plant.optimalEnv[spec.maxKey] + envShift, spec);
      episode.envDelta[spec.minKey] += newMin - plant.optimalEnv[spec.minKey];
      episode.envDelta[spec.maxKey] += newMax - plant.optimalEnv[spec.maxKey];
      plant.optimalEnv[spec.minKey] = newMin;
      plant.optimalEnv[spec.maxKey] = newMax;
    }

    for (const traitKey of Object.keys(TRAIT_RESPONSES) as (keyof PlantTraits)[]) {
      const response = TRAIT_RESPONSES[traitKey];
      const deviation = deviations.get(response.dimension);
      if (deviation === undefined) {
        continue;
      }
      const delta = this.config.traitDriftRate * response.direction * deviation * deltaTime;
      const newValue = clampTrait(plant.traits[traitKey] + delta);
      episode.traitDelta[traitKey] += newValue - plant.traits[traitKey];
      plant.traits[traitKey] = newValue;
    }
  }

  finalize(plant: Plant, currentTime: number): void {
    this.closeEpisode(plant, currentTime);
    for (const key of Object.keys(plant.traits) as (keyof PlantTraits)[]) {
      plant.traits[key] = Math.round(plant.traits[key]);
    }
    for (const spec of DIMENSIONS) {
      plant.optimalEnv[spec.minKey] = Math.round(plant.optimalEnv[spec.minKey]);
      plant.optimalEnv[spec.maxKey] = Math.round(plant.optimalEnv[spec.maxKey]);
    }
  }

  private ensureEpisode(plant: Plant, env: EnvironmentSnapshot, currentTime: number): DriftEvent {
    if (!plant.activeDrift) {
      plant.activeDrift = {
        startTime: currentTime,
        endTime: currentTime,
        duration: 0,
        env: { ...env },
        traitDelta: { color: 0, shape: 0, height: 0, droughtResistance: 0 },
        envDelta: {
          tempMin: 0, tempMax: 0,
          humidityMin: 0, humidityMax: 0,
          lightMin: 0, lightMax: 0,
        },
      };
    }
    return plant.activeDrift;
  }

  private closeEpisode(plant: Plant, currentTime: number): void {
    if (!plant.activeDrift) {
      return;
    }
    plant.activeDrift.endTime = currentTime;
    plant.driftHistory.push(plant.activeDrift);
    plant.activeDrift = null;
  }

  private clampBound(value: number, spec: DimensionSpec): number {
    return Math.max(spec.physicalMin, Math.min(spec.physicalMax, value));
  }
}
