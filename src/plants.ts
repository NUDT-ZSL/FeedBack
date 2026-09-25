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

  constructor(
    traits: PlantTraits,
    generation: number = 0,
    parentIds: string[] = [],
    lineage: string[] = [],
    optimalEnv?: OptimalEnvironment
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
    const child = new Plant(newTraits, newGeneration, [parent1.id, parent2.id], newLineage, newOptimalEnv);
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
    const child = new Plant(newTraits, newGeneration, [plant.id], [...plant.lineage], { ...plant.optimalEnv });
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
    const child = new Plant(newTraits, newGeneration, [plant.id, parent.id], newLineage, newOptimalEnv);
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
    };
  }

  static fromJSON(data: PlantJSON): Plant {
    const plant = new Plant(
      data.traits,
      data.generation,
      data.parentIds,
      data.lineage,
      data.optimalEnv
    );
    plant.id = data.id;
    plant.name = data.name;
    plant.growthProgress = data.growthProgress;
    plant.isMature = data.isMature;
    plant.position = data.position ? { ...data.position } : null;
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
