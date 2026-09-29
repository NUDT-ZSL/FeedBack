export type ComponentType = 'column' | 'beam' | 'slab' | 'wall';

export interface BuildingParams {
  floors: number;
  floorHeight: number;
  columnSpacingX: number;
  columnSpacingZ: number;
  columnsX: number;
  columnsZ: number;
  wallMaterial: string;
}

export interface ComponentInfo {
  id: string;
  type: ComponentType;
  width: number;
  height: number;
  length: number;
  material: string;
  position: { x: number; y: number; z: number };
}

export interface CollisionResult {
  id: string;
  componentA: ComponentInfo;
  componentB: ComponentInfo;
  isColliding: boolean;
  overlapVolumePercent: number;
  thumbnailA?: string;
  thumbnailB?: string;
  timestamp: number;
}

export interface BIMMeshUserData {
  componentInfo: ComponentInfo;
  originalColor: number;
  originalEmissive: number;
  originalEmissiveIntensity: number;
}

export const ComponentTypeName: Record<ComponentType, string> = {
  column: '柱',
  beam: '梁',
  slab: '楼板',
  wall: '外墙'
};

export const ComponentTypeColor: Record<ComponentType, number> = {
  column: 0x3a3a42,
  beam: 0x4a4a52,
  slab: 0x8fa4c4,
  wall: 0xa8b2c4
};

export const DefaultParams: BuildingParams = {
  floors: 6,
  floorHeight: 3.6,
  columnSpacingX: 6,
  columnSpacingZ: 6,
  columnsX: 5,
  columnsZ: 4,
  wallMaterial: '混凝土空心砖'
};
