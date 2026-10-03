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

export type EnvDimension = 'temperature' | 'humidity' | 'light';
export type TraitKey = keyof PlantTraits;

/** 一次连续偏离最适区间的环境漂移片段（离开胁迫区间时结算） */
export interface DriftEvent {
  dimension: EnvDimension;
  /** 本片段内该维度处于胁迫中的暴露时长（毫秒） */
  exposureMs: number;
  /** 片段结束时该维度历史累计暴露时长（单调递增，反复进出不清零） */
  totalExposureMs: number;
  /** 片段内平均环境值，用于解释偏移方向 */
  avgEnvValue: number;
  rangeBefore: [number, number];
  rangeAfter: [number, number];
  /** 本次片段联动的性状增量 */
  traitDeltas: Partial<Record<TraitKey, number>>;
  /** 区间位移幅度（|下界位移|） */
  magnitude: number;
}

/** 各维度累计胁迫暴露时长（毫秒），只增不减 */
export interface StressExposure {
  temperature: number;
  humidity: number;
  light: number;
}

/** 最适区间某一维的来源记录（冲突时双亲本各自的区间都会保留） */
export interface EnvRangeSource {
  plantId: string;
  plantName: string;
  range: [number, number];
}

export interface EnvParamOrigin {
  dimension: EnvDimension;
  /** 参与形成生效区间的全部来源，按权重顺序排列 */
  sources: EnvRangeSource[];
  /** base=基础植物；inherited=自交继承；blended=相容融合；adjudicated=冲突裁决 */
  resolution: 'base' | 'inherited' | 'blended' | 'adjudicated';
  rule?: string;
}

export type EnvOrigin = Record<EnvDimension, EnvParamOrigin>;

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
  stressExposure: StressExposure;
  cumulativeDrift: number;
  driftEvents: DriftEvent[];
  envOrigin: EnvOrigin;
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

const ENV_DIM_FIELDS: Record<EnvDimension, [keyof OptimalEnvironment, keyof OptimalEnvironment]> = {
  temperature: ['tempMin', 'tempMax'],
  humidity: ['humidityMin', 'humidityMax'],
  light: ['lightMin', 'lightMax'],
};

function envDimRange(env: OptimalEnvironment, dim: EnvDimension): [number, number] {
  const [minKey, maxKey] = ENV_DIM_FIELDS[dim];
  return [env[minKey], env[maxKey]];
}

function makeBaseEnvOrigin(): EnvOrigin {
  const origin = {} as EnvOrigin;
  for (const dim of Object.keys(ENV_DIM_FIELDS) as EnvDimension[]) {
    origin[dim] = { dimension: dim, sources: [], resolution: 'base' };
  }
  return origin;
}

/** 两个区间是否矛盾（完全不相交，如一个偏干一个偏湿） */
function rangesConflict(a: [number, number], b: [number, number]): boolean {
  return a[1] < b[0] || b[1] < a[0];
}

/**
 * 为子代构建最适区间的来源记录。
 * 双亲区间相容时按权重融合（blended/inherited）；
 * 矛盾时保留双方来源，按权重偏向递归亲本裁决（adjudicated），不静默平均。
 */
function buildEnvOrigin(
  parentA: Plant,
  parentB: Plant | null,
  weightA: number,
  weightB: number
): EnvOrigin {
  const origin = {} as EnvOrigin;
  for (const dim of Object.keys(ENV_DIM_FIELDS) as EnvDimension[]) {
    const rangeA = envDimRange(parentA.optimalEnv, dim);
    const sources: EnvRangeSource[] = [
      { plantId: parentA.id, plantName: parentA.name, range: [...rangeA] as [number, number] },
    ];
    if (!parentB) {
      origin[dim] = { dimension: dim, sources, resolution: 'inherited', rule: '自交：完整继承亲本区间' };
      continue;
    }
    const rangeB = envDimRange(parentB.optimalEnv, dim);
    sources.push({ plantId: parentB.id, plantName: parentB.name, range: [...rangeB] as [number, number] });
    if (rangesConflict(rangeA, rangeB)) {
      const winner = weightA >= weightB ? parentA : parentB;
      const pctA = Math.round(weightA * 100);
      const pctB = Math.round(weightB * 100);
      origin[dim] = {
        dimension: dim,
        sources,
        resolution: 'adjudicated',
        rule: `双亲区间矛盾（[${rangeA}] vs [${rangeB}]），按 ${pctA}/${pctB} 权重偏向 ${winner.name} 裁决，双方来源保留`,
      };
    } else {
      origin[dim] = {
        dimension: dim,
        sources,
        resolution: 'blended',
        rule: `双亲区间相容，按 ${Math.round(weightA * 100)}/${Math.round(weightB * 100)} 权重融合`,
      };
    }
  }
  return origin;
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
  /** 各维度累计胁迫暴露时长（ms），离开胁迫区间不清零 */
  public stressExposure: StressExposure;
  /** 历史累计区间漂移幅度（各片段 magnitude 之和） */
  public cumulativeDrift: number;
  /** 已结算的漂移片段（按发生顺序） */
  public driftEvents: DriftEvent[];
  /** 当前最适区间的来源与裁决依据 */
  public envOrigin: EnvOrigin;

  constructor(
    traits: PlantTraits,
    generation: number = 0,
    parentIds: string[] = [],
    lineage: string[] = [],
    optimalEnv?: OptimalEnvironment,
    envOrigin?: EnvOrigin
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
    this.optimalEnv = optimalEnv || {
      tempMin: 15,
      tempMax: 30,
      humidityMin: 30,
      humidityMax: 80,
      lightMin: 30,
      lightMax: 80,
    };
    this.stressExposure = { temperature: 0, humidity: 0, light: 0 };
    this.cumulativeDrift = 0;
    this.driftEvents = [];
    this.envOrigin = envOrigin || makeBaseEnvOrigin();
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

    const newOptimalEnv: OptimalEnvironment = {
      tempMin: Math.round((parent1.optimalEnv.tempMin + parent2.optimalEnv.tempMin) / 2),
      tempMax: Math.round((parent1.optimalEnv.tempMax + parent2.optimalEnv.tempMax) / 2),
      humidityMin: Math.round((parent1.optimalEnv.humidityMin + parent2.optimalEnv.humidityMin) / 2),
      humidityMax: Math.round((parent1.optimalEnv.humidityMax + parent2.optimalEnv.humidityMax) / 2),
      lightMin: Math.round((parent1.optimalEnv.lightMin + parent2.optimalEnv.lightMin) / 2),
      lightMax: Math.round((parent1.optimalEnv.lightMax + parent2.optimalEnv.lightMax) / 2),
    };

    const newGeneration = Math.max(parent1.generation, parent2.generation) + 1;
    const newLineage = Array.from(new Set([...parent1.lineage, ...parent2.lineage]));
    const child = new Plant(
      newTraits,
      newGeneration,
      [parent1.id, parent2.id],
      newLineage,
      newOptimalEnv,
      buildEnvOrigin(parent1, parent2, 0.5, 0.5)
    );
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
    const child = new Plant(
      newTraits,
      newGeneration,
      [plant.id],
      [...plant.lineage],
      { ...plant.optimalEnv },
      buildEnvOrigin(plant, null, 1, 0)
    );
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

    const newOptimalEnv: OptimalEnvironment = {
      tempMin: Math.round(plant.optimalEnv.tempMin * 0.4 + parent.optimalEnv.tempMin * 0.6),
      tempMax: Math.round(plant.optimalEnv.tempMax * 0.4 + parent.optimalEnv.tempMax * 0.6),
      humidityMin: Math.round(plant.optimalEnv.humidityMin * 0.4 + parent.optimalEnv.humidityMin * 0.6),
      humidityMax: Math.round(plant.optimalEnv.humidityMax * 0.4 + parent.optimalEnv.humidityMax * 0.6),
      lightMin: Math.round(plant.optimalEnv.lightMin * 0.4 + parent.optimalEnv.lightMin * 0.6),
      lightMax: Math.round(plant.optimalEnv.lightMax * 0.4 + parent.optimalEnv.lightMax * 0.6),
    };

    const newGeneration = Math.max(plant.generation, parent.generation) + 1;
    const newLineage = Array.from(new Set([...plant.lineage, ...parent.lineage]));
    const child = new Plant(
      newTraits,
      newGeneration,
      [plant.id, parent.id],
      newLineage,
      newOptimalEnv,
      buildEnvOrigin(plant, parent, 0.4, 0.6)
    );
    child.lineage.push(child.id);
    return child;
  }

  getTraitHash(): string {
    const { color, shape, height, droughtResistance } = this.traits;
    const hash = [color, shape, height, droughtResistance]
      .map(v => Math.round(v).toString(16).padStart(2, '0'))
      .join('');
    return hash.toUpperCase();
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
      stressExposure: { ...this.stressExposure },
      cumulativeDrift: this.cumulativeDrift,
      driftEvents: this.driftEvents.map(e => ({
        ...e,
        rangeBefore: [...e.rangeBefore] as [number, number],
        rangeAfter: [...e.rangeAfter] as [number, number],
        traitDeltas: { ...e.traitDeltas },
      })),
      envOrigin: {
        temperature: { ...this.envOrigin.temperature, sources: this.envOrigin.temperature.sources.map(s => ({ ...s, range: [...s.range] as [number, number] })) },
        humidity: { ...this.envOrigin.humidity, sources: this.envOrigin.humidity.sources.map(s => ({ ...s, range: [...s.range] as [number, number] })) },
        light: { ...this.envOrigin.light, sources: this.envOrigin.light.sources.map(s => ({ ...s, range: [...s.range] as [number, number] })) },
      },
    };
  }

  static fromJSON(data: PlantJSON): Plant {
    const plant = new Plant(
      data.traits,
      data.generation,
      data.parentIds,
      data.lineage,
      data.optimalEnv,
      data.envOrigin
    );
    plant.id = data.id;
    plant.name = data.name;
    plant.growthProgress = data.growthProgress;
    plant.isMature = data.isMature;
    plant.position = data.position ? { ...data.position } : null;
    if (data.stressExposure) {
      plant.stressExposure = { ...data.stressExposure };
    }
    if (typeof data.cumulativeDrift === 'number') {
      plant.cumulativeDrift = data.cumulativeDrift;
    }
    if (Array.isArray(data.driftEvents)) {
      plant.driftEvents = data.driftEvents.map(e => ({ ...e }));
    }
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

export interface AncestryNode {
  plant: Plant;
  /** 是否为基础植物（无亲本） */
  isBase: boolean;
  /** 亲本未在注册表中找到（例如外部导入数据） */
  missing: boolean;
  /** 该植株自身累计的漂移幅度 */
  driftMagnitude: number;
  driftEvents: DriftEvent[];
}

export interface AncestryReport {
  /** 去重后的全部祖先（含目标植株自身），按世代升序排列 */
  nodes: AncestryNode[];
  /** 发生过环境漂移的世代链（从基础植物到目标植株） */
  driftGenerations: AncestryNode[];
  /** 整条链上的累计漂移幅度 */
  totalDrift: number;
}

/**
 * 沿 parentIds 回溯到基础植物。
 * 共享祖先（如回交中同时是亲本和祖辈的植株）只计入一次，不会断链或重复。
 */
export function traceAncestry(target: Plant, registry: Map<string, Plant>): AncestryReport {
  const nodes = new Map<string, AncestryNode>();
  const queue: Plant[] = [target];
  const enqueue = (plant: Plant) => {
    if (!nodes.has(plant.id)) {
      queue.push(plant);
    }
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (nodes.has(current.id)) {
      continue;
    }
    nodes.set(current.id, {
      plant: current,
      isBase: current.parentIds.length === 0,
      missing: false,
      driftMagnitude: current.cumulativeDrift,
      driftEvents: current.driftEvents,
    });
    for (const parentId of current.parentIds) {
      if (nodes.has(parentId)) {
        continue;
      }
      const parent = registry.get(parentId);
      if (parent) {
        enqueue(parent);
      } else {
        nodes.set(parentId, {
          plant: current,
          isBase: false,
          missing: true,
          driftMagnitude: 0,
          driftEvents: [],
        });
      }
    }
  }

  const ordered = Array.from(nodes.values()).sort((a, b) => {
    if (a.missing !== b.missing) {
      return a.missing ? 1 : -1;
    }
    return a.plant.generation - b.plant.generation;
  });
  const driftGenerations = ordered.filter(n => !n.missing && n.driftMagnitude > 0);
  const totalDrift = driftGenerations.reduce((sum, n) => sum + n.driftMagnitude, 0);
  return { nodes: ordered, driftGenerations, totalDrift };
}
