export type MaterialType = 'cotton' | 'silk' | 'denim' | 'wool';

export type ModelType = 'tshirt' | 'skirt' | 'scarf';

export interface MaterialConfig {
  name: string;
  roughness: number;
  metalness: number;
  normalScale: number;
  color: string;
}

export interface SceneState {
  modelType: ModelType;
  materialType: MaterialType;
  wrinkleIntensity: number;
  ambientIntensity: number;
  lightAngle: number;
}

export const MATERIAL_CONFIGS: Record<MaterialType, MaterialConfig> = {
  cotton: {
    name: '棉',
    roughness: 0.8,
    metalness: 0.0,
    normalScale: 0.5,
    color: '#f5f5dc'
  },
  silk: {
    name: '丝绸',
    roughness: 0.2,
    metalness: 0.1,
    normalScale: 0.2,
    color: '#fff8dc'
  },
  denim: {
    name: '牛仔',
    roughness: 0.9,
    metalness: 0.0,
    normalScale: 0.8,
    color: '#1560bd'
  },
  wool: {
    name: '羊毛',
    roughness: 0.95,
    metalness: 0.0,
    normalScale: 0.6,
    color: '#d3d3d3'
  }
};

export const MODEL_NAMES: Record<ModelType, string> = {
  tshirt: 'T恤',
  skirt: '裙子',
  scarf: '围巾'
};
