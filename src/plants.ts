export interface PlantTraits {
  color: number;
  shape: number;
  height: number;
  droughtResistance: number;
}

export interface PlantPosition {
  x: number;
  y: number;
}

export interface OptimalEnvironment {
  tempMin: number;
  tempMax: number;
  humidityMin: number;
  humidityMax: number;
  lightMin: number;
  lightMax: number;
}

export interface EnvironmentSnapshot {
  temperature: number;
  humidity: number;
  light: number;
}

export interface DriftEvent {
  startTime: number;
  endTime: number;
  duration: number;
  env: EnvironmentSnapshot;
  traitDelta: PlantTraits;
  envDelta: OptimalEnvironment;
}

export interface EnvRangeSource {
  parentId: string;
  parentName: string;
  env: OptimalEnvironment;
  weight: number;
}

export type EnvDimension = 'temperature' | 'humidity' | 'light';

export interface EnvConflict {
  dimension: EnvDimension;
  parentA: { id: string; min: number; max: number };
  parentB: { id: string; min: number; max: number };
  resolution: string;
}

export interface EnvOrigin {
  sources: EnvRangeSource[];
  strategy: string;
  conflicts: EnvConflict[];
}

export interface CumulativeDrift {
  stressTime: number;
  traits: PlantTraits;
  optimalEnv: OptimalEnvironment;
  traitMagnitude: number;
}

export type EnvAdjudicationStrategy =
  | 'weighted'
  | 'union'
  | 'intersection'
  | 'parentA'
  | 'parentB';

export interface PlantJSON {
  id: string;
  name: string;
  traits: PlantTraits;
  generation: number;
  parentIds: string[];
  lineage: string[];
  growthProgress: number;
  isMature: boolean;
  position: PlantPosition | null;
  optimalEnv: OptimalEnvironment;
  driftHistory?: DriftEvent[];
  activeDrift?: DriftEvent | null;
  totalStressTime?: number;
  envOrigin?: EnvOrigin | null;
}

export interface BasePlantConfig {
  traits: PlantTraits;
  optimalEnv: OptimalEnvironment;
}

export const BASE_PLANTS: Record<string, BasePlantConfig> = {
  sunflower: {
    traits: {
      color: 220,
      shape: 180,
      height: 200,
      droughtResistance: 100,
    },
    optimalEnv: {
      tempMin: 20,
      tempMax: 35,
      humidityMin: 30,
      humidityMax: 70,
      lightMin: 60,
      lightMax: 100,
    },
  },
  cactus: {
    traits: {
      color: 80,
      shape: 60,
      height: 50,
      droughtResistance: 240,
    },
    optimalEnv: {
      tempMin: 25,
      tempMax: 40,
      humidityMin: 0,
      humidityMax: 30,
      lightMin: 50,
      lightMax: 100,
    },
  },
  mushroom: {
    traits: {
      color: 160,
      shape: 120,
      height: 30,
      droughtResistance: 60,
    },
    optimalEnv: {
      tempMin: 15,
      tempMax: 25,
      humidityMin: 60,
      humidityMax: 100,
      lightMin: 0,
      lightMax: 40,
    },
  },
  vine: {
    traits: {
      color: 100,
      shape: 200,
      height: 150,
      droughtResistance: 120,
    },
    optimalEnv: {
      tempMin: 18,
      tempMax: 30,
      humidityMin: 40,
      humidityMax: 80,
      lightMin: 30,
      lightMax: 70,
    },
  },
  fern: {
    traits: {
      color: 60,
      shape: 150,
      height: 80,
      droughtResistance: 80,
    },
    optimalEnv: {
      tempMin: 15,
      tempMax: 28,
      humidityMin: 50,
      humidityMax: 90,
      lightMin: 20,
      lightMax: 60,
    },
  },
};

const PLANT_NAMES = [
  '晨曦', '暮光', '星辰', '月华', '清风', '细雨', '暖阳', '寒霜',
  '翠羽', '金鳞', '银辉', '丹焰', '蓝田', '紫玉', '青虹', '白练',
  '扶摇', '缱绻', '婆娑', '潋滟', '缥缈', '翩跹', '缱绻', '迤逦',
];

function generateId(): string {
  return `plant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateName(): string {
  return PLANT_NAMES[Math.floor(Math.random() * PLANT_NAMES.length)] +
    PLANT_NAMES[Math.floor(Math.random() * PLANT_NAMES.length)];
}

function clamp(value: number, min: number = 0, max: number = 255): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

const ENV_DIMENSION_BOUNDS: Record<EnvDimension, { minKey: keyof OptimalEnvironment; maxKey: keyof OptimalEnvironment; physicalMin: number; physicalMax: number }> = {
  temperature: { minKey: 'tempMin', maxKey: 'tempMax', physicalMin: 10, physicalMax: 40 },
  humidity: { minKey: 'humidityMin', maxKey: 'humidityMax', physicalMin: 0, physicalMax: 100 },
  light: { minKey: 'lightMin', maxKey: 'lightMax', physicalMin: 0, physicalMax: 100 },
};

function getDimensionRange(env: OptimalEnvironment, dimension: EnvDimension): { min: number; max: number } {
  const keys = ENV_DIMENSION_BOUNDS[dimension];
  return { min: env[keys.minKey], max: env[keys.maxKey] };
}

export function detectEnvConflicts(
  idA: string,
  envA: OptimalEnvironment,
  idB: string,
  envB: OptimalEnvironment
): EnvConflict[] {
  const conflicts: EnvConflict[] = [];
  for (const dimension of ['temperature', 'humidity', 'light'] as EnvDimension[]) {
    const a = getDimensionRange(envA, dimension);
    const b = getDimensionRange(envB, dimension);
    const disjoint = a.max < b.min || b.max < a.min;
    if (disjoint) {
      conflicts.push({
        dimension,
        parentA: { id: idA, min: a.min, max: a.max },
        parentB: { id: idB, min: b.min, max: b.max },
        resolution: '双方区间互不相交，默认按加权平均裁决，原始来源已保留，可重新裁决',
      });
    }
  }
  return conflicts;
}

export function adjudicateEnvs(
  sources: EnvRangeSource[],
  strategy: EnvAdjudicationStrategy
): OptimalEnvironment {
  const resolved: OptimalEnvironment = {
    tempMin: 0,
    tempMax: 0,
    humidityMin: 0,
    humidityMax: 0,
    lightMin: 0,
    lightMax: 0,
  };

  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0) || 1;
  const dims: { dimension: EnvDimension; minKey: keyof OptimalEnvironment; maxKey: keyof OptimalEnvironment }[] = [
    { dimension: 'temperature', minKey: 'tempMin', maxKey: 'tempMax' },
    { dimension: 'humidity', minKey: 'humidityMin', maxKey: 'humidityMax' },
    { dimension: 'light', minKey: 'lightMin', maxKey: 'lightMax' },
  ];

  for (const { dimension, minKey, maxKey } of dims) {
    const bounds = ENV_DIMENSION_BOUNDS[dimension];
    if (strategy === 'weighted') {
      resolved[minKey] = Math.round(sources.reduce((sum, s) => sum + s.env[minKey] * s.weight, 0) / totalWeight);
      resolved[maxKey] = Math.round(sources.reduce((sum, s) => sum + s.env[maxKey] * s.weight, 0) / totalWeight);
    } else if (strategy === 'union') {
      resolved[minKey] = Math.min(...sources.map(s => s.env[minKey]));
      resolved[maxKey] = Math.max(...sources.map(s => s.env[maxKey]));
    } else if (strategy === 'intersection') {
      resolved[minKey] = Math.max(...sources.map(s => s.env[minKey]));
      resolved[maxKey] = Math.min(...sources.map(s => s.env[maxKey]));
      if (resolved[minKey] > resolved[maxKey]) {
        resolved[minKey] = Math.round((resolved[minKey] + resolved[maxKey]) / 2);
        resolved[maxKey] = resolved[minKey];
      }
    } else {
      const chosen = strategy === 'parentA' ? sources[0] : sources[sources.length - 1];
      resolved[minKey] = chosen.env[minKey];
      resolved[maxKey] = chosen.env[maxKey];
    }
    resolved[minKey] = Math.max(bounds.physicalMin, Math.min(bounds.physicalMax, resolved[minKey]));
    resolved[maxKey] = Math.max(bounds.physicalMin, Math.min(bounds.physicalMax, resolved[maxKey]));
  }

  return resolved;
}

export class Plant {
  public id: string;
  public name: string;
  public traits: PlantTraits;
  public generation: number;
  public parentIds: string[];
  public lineage: string[];
  public growthProgress: number;
  public isMature: boolean;
  public position: PlantPosition | null;
  public optimalEnv: OptimalEnvironment;
  public driftHistory: DriftEvent[];
  public activeDrift: DriftEvent | null;
  public totalStressTime: number;
  public envOrigin: EnvOrigin | null;

  constructor(
    traits: PlantTraits,
    generation: number = 0,
    parentIds: string[] = [],
    lineage: string[] = [],
    optimalEnv?: OptimalEnvironment,
    envOrigin: EnvOrigin | null = null
  ) {
    this.id = generateId();
    this.name = generateName();
    this.traits = {
      color: clamp(traits.color),
      shape: clamp(traits.shape),
      height: clamp(traits.height),
      droughtResistance: clamp(traits.droughtResistance),
    };
    this.generation = generation;
    this.parentIds = [...parentIds];
    this.lineage = lineage.length > 0 ? [...lineage] : [this.id];
    this.growthProgress = 0;
    this.isMature = false;
    this.position = null;
    this.optimalEnv = optimalEnv
      ? { ...optimalEnv }
      : {
          tempMin: 15,
          tempMax: 30,
          humidityMin: 30,
          humidityMax: 80,
          lightMin: 30,
          lightMax: 80,
        };
    this.driftHistory = [];
    this.activeDrift = null;
    this.totalStressTime = 0;
    this.envOrigin = envOrigin;
  }

  static hybridize(parent1: Plant, parent2: Plant): Plant {
    const traitKeys: (keyof PlantTraits)[] = ['color', 'shape', 'height', 'droughtResistance'];
    const numTraitsToBlend = Math.floor(Math.random() * 2) + 2;
    const shuffled = [...traitKeys].sort(() => Math.random() - 0.5);
    const traitsToBlend = shuffled.slice(0, numTraitsToBlend);
    const traitsToInherit = shuffled.slice(numTraitsToBlend);

    const newTraits: PlantTraits = {
      color: 0,
      shape: 0,
      height: 0,
      droughtResistance: 0,
    };

    for (const key of traitsToBlend) {
      const midValue = (parent1.traits[key] + parent2.traits[key]) / 2;
      const offset = (Math.random() - 0.5) * 40;
      newTraits[key] = clamp(midValue + offset);
    }

    for (const key of traitsToInherit) {
      const source = Math.random() < 0.5 ? parent1 : parent2;
      newTraits[key] = source.traits[key];
    }

    const envOrigin: EnvOrigin = {
      sources: [
        { parentId: parent1.id, parentName: parent1.name, env: { ...parent1.optimalEnv }, weight: 0.5 },
        { parentId: parent2.id, parentName: parent2.name, env: { ...parent2.optimalEnv }, weight: 0.5 },
      ],
      strategy: 'weighted',
      conflicts: detectEnvConflicts(parent1.id, parent1.optimalEnv, parent2.id, parent2.optimalEnv),
    };
    const newOptimalEnv = adjudicateEnvs(envOrigin.sources, 'weighted');

    const newGeneration = Math.max(parent1.generation, parent2.generation) + 1;
    const newLineage = Array.from(new Set([...parent1.lineage, ...parent2.lineage]));
    const child = new Plant(newTraits, newGeneration, [parent1.id, parent2.id], newLineage, newOptimalEnv, envOrigin);
    child.lineage.push(child.id);
    return child;
  }

  static selfCross(plant: Plant): Plant {
    const newTraits: PlantTraits = {
      color: plant.traits.color,
      shape: plant.traits.shape,
      height: plant.traits.height,
      droughtResistance: plant.traits.droughtResistance,
    };

    const traitKeys: (keyof PlantTraits)[] = ['color', 'shape', 'height', 'droughtResistance'];
    for (const key of traitKeys) {
      if (Math.random() < 0.05) {
        const mutation = (Math.random() - 0.5) * 60;
        newTraits[key] = clamp(newTraits[key] + mutation);
      }
    }

    const newGeneration = plant.generation + 1;
    const envOrigin: EnvOrigin = {
      sources: [
        { parentId: plant.id, parentName: plant.name, env: { ...plant.optimalEnv }, weight: 1 },
      ],
      strategy: 'weighted',
      conflicts: [],
    };
    const child = new Plant(newTraits, newGeneration, [plant.id], [...plant.lineage], { ...plant.optimalEnv }, envOrigin);
    child.lineage.push(child.id);
    return child;
  }

  static backcross(plant: Plant, parent: Plant): Plant {
    const traitKeys: (keyof PlantTraits)[] = ['color', 'shape', 'height', 'droughtResistance'];
    const newTraits: PlantTraits = {
      color: 0,
      shape: 0,
      height: 0,
      droughtResistance: 0,
    };

    for (const key of traitKeys) {
      if (Math.random() < 0.6) {
        newTraits[key] = parent.traits[key];
      } else {
        newTraits[key] = plant.traits[key];
      }
    }

    const envOrigin: EnvOrigin = {
      sources: [
        { parentId: plant.id, parentName: plant.name, env: { ...plant.optimalEnv }, weight: 0.4 },
        { parentId: parent.id, parentName: parent.name, env: { ...parent.optimalEnv }, weight: 0.6 },
      ],
      strategy: 'weighted',
      conflicts: detectEnvConflicts(plant.id, plant.optimalEnv, parent.id, parent.optimalEnv),
    };
    const newOptimalEnv = adjudicateEnvs(envOrigin.sources, 'weighted');

    const newGeneration = Math.max(plant.generation, parent.generation) + 1;
    const newLineage = Array.from(new Set([...plant.lineage, ...parent.lineage]));
    const child = new Plant(newTraits, newGeneration, [plant.id, parent.id], newLineage, newOptimalEnv, envOrigin);
    child.lineage.push(child.id);
    return child;
  }

  getTraitHash(): string {
    const { color, shape, height, droughtResistance } = this.traits;
    const hash = [color, shape, height, droughtResistance]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('');
    return hash.toUpperCase();
  }

  hasEnvironmentalDrift(): boolean {
    return this.driftHistory.length > 0 || this.activeDrift !== null;
  }

  getCumulativeDrift(): CumulativeDrift {
    const traits: PlantTraits = { color: 0, shape: 0, height: 0, droughtResistance: 0 };
    const optimalEnv: OptimalEnvironment = {
      tempMin: 0, tempMax: 0,
      humidityMin: 0, humidityMax: 0,
      lightMin: 0, lightMax: 0,
    };
    const episodes = this.activeDrift ? [...this.driftHistory, this.activeDrift] : this.driftHistory;
    for (const episode of episodes) {
      traits.color += episode.traitDelta.color;
      traits.shape += episode.traitDelta.shape;
      traits.height += episode.traitDelta.height;
      traits.droughtResistance += episode.traitDelta.droughtResistance;
      optimalEnv.tempMin += episode.envDelta.tempMin;
      optimalEnv.tempMax += episode.envDelta.tempMax;
      optimalEnv.humidityMin += episode.envDelta.humidityMin;
      optimalEnv.humidityMax += episode.envDelta.humidityMax;
      optimalEnv.lightMin += episode.envDelta.lightMin;
      optimalEnv.lightMax += episode.envDelta.lightMax;
    }
    const traitMagnitude =
      Math.abs(traits.color) + Math.abs(traits.shape) +
      Math.abs(traits.height) + Math.abs(traits.droughtResistance);
    return { stressTime: this.totalStressTime, traits, optimalEnv, traitMagnitude };
  }

  adjudicateEnv(strategy: EnvAdjudicationStrategy): OptimalEnvironment {
    if (!this.envOrigin || this.envOrigin.sources.length === 0) {
      return { ...this.optimalEnv };
    }
    return adjudicateEnvs(this.envOrigin.sources, strategy);
  }

  toJSON(): PlantJSON {
    return {
      id: this.id,
      name: this.name,
      traits: { ...this.traits },
      generation: this.generation,
      parentIds: [...this.parentIds],
      lineage: [...this.lineage],
      growthProgress: this.growthProgress,
      isMature: this.isMature,
      position: this.position ? { ...this.position } : null,
      optimalEnv: { ...this.optimalEnv },
      driftHistory: this.driftHistory.map(e => ({
        ...e,
        env: { ...e.env },
        traitDelta: { ...e.traitDelta },
        envDelta: { ...e.envDelta },
      })),
      activeDrift: this.activeDrift
        ? {
            ...this.activeDrift,
            env: { ...this.activeDrift.env },
            traitDelta: { ...this.activeDrift.traitDelta },
            envDelta: { ...this.activeDrift.envDelta },
          }
        : null,
      totalStressTime: this.totalStressTime,
      envOrigin: this.envOrigin
        ? {
            strategy: this.envOrigin.strategy,
            sources: this.envOrigin.sources.map(s => ({ ...s, env: { ...s.env } })),
            conflicts: this.envOrigin.conflicts.map(c => ({
              ...c,
              parentA: { ...c.parentA },
              parentB: { ...c.parentB },
            })),
          }
        : null,
    };
  }

  static fromJSON(data: PlantJSON): Plant {
    const plant = new Plant(
      data.traits,
      data.generation,
      data.parentIds,
      data.lineage,
      data.optimalEnv,
      data.envOrigin ?? null
    );
    plant.id = data.id;
    plant.name = data.name;
    plant.growthProgress = data.growthProgress;
    plant.isMature = data.isMature;
    plant.position = data.position ? { ...data.position } : null;
    plant.driftHistory = (data.driftHistory ?? []).map(e => ({
      ...e,
      env: { ...e.env },
      traitDelta: { ...e.traitDelta },
      envDelta: { ...e.envDelta },
    }));
    plant.activeDrift = data.activeDrift
      ? {
          ...data.activeDrift,
          env: { ...data.activeDrift.env },
          traitDelta: { ...data.activeDrift.traitDelta },
          envDelta: { ...data.activeDrift.envDelta },
        }
      : null;
    plant.totalStressTime = data.totalStressTime ?? 0;
    return plant;
  }
}

export class Collection {
  private discoveredPlants: Map<string, Plant>;

  constructor() {
    this.discoveredPlants = new Map();
  }

  addPlant(plant: Plant): boolean {
    const hash = plant.getTraitHash();
    if (this.discoveredPlants.has(hash)) {
      return false;
    }
    this.discoveredPlants.set(hash, plant);
    return true;
  }

  getCount(): number {
    return this.discoveredPlants.size;
  }

  getAllPlants(): Plant[] {
    return Array.from(this.discoveredPlants.values());
  }
}

export function createBasePlant(type: string): Plant {
  const config = BASE_PLANTS[type.toLowerCase()];
  if (!config) {
    throw new Error(`Unknown plant type: ${type}. Available types: ${Object.keys(BASE_PLANTS).join(', ')}`);
  }
  return new Plant(config.traits, 0, [], [], config.optimalEnv);
}
