export type MaterialType = 'glass' | 'metal' | 'wood' | 'fabric';

export type WallType = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling';

export interface MaterialProps {
  color: string;
  reflectionRate: number;
  transmissionRate: number;
  thickness: number;
  label: string;
}

export interface RoomConfig {
  width: number;
  height: number;
  depth: number;
  walls: Record<WallType, MaterialType>;
}

export interface SoundSourceConfig {
  position: [number, number, number];
  radius: number;
  active: boolean;
}

export interface RayBounce {
  position: [number, number, number];
  wall: WallType;
  material: MaterialType;
  incidentAngle: number;
  reflectAngle: number;
  energyRemaining: number;
  segmentIndex: number;
}

export interface RayData {
  id: number;
  startPoint: [number, number, number];
  direction: [number, number, number];
  bounces: RayBounce[];
  totalBounces: number;
  path: [number, number, number][];
  energies: number[];
}

export interface SimulationStats {
  totalRays: number;
  averageBounces: number;
  wallHitCounts: Record<WallType, number>;
  materialHitCounts: Record<MaterialType, number>;
}

export interface ReverbConfig {
  enabled: boolean;
  rt60: number;
  particleCount: number;
}

export interface HitDetail {
  type: 'bounce' | 'ray';
  rayId: number;
  bounceIndex?: number;
  position: [number, number, number];
  incidentAngle?: number;
  reflectAngle?: number;
  energyRemaining?: number;
  material?: MaterialType;
  wall?: WallType;
}

export const MATERIAL_PROPS: Record<MaterialType, MaterialProps> = {
  glass: {
    color: '#a8d8ea',
    reflectionRate: 0.8,
    transmissionRate: 0.15,
    thickness: 0.1,
    label: '玻璃',
  },
  metal: {
    color: '#c0c0c0',
    reflectionRate: 0.7,
    transmissionRate: 0.0,
    thickness: 0.1,
    label: '金属',
  },
  wood: {
    color: '#8b5a2b',
    reflectionRate: 0.5,
    transmissionRate: 0.0,
    thickness: 0.1,
    label: '木材',
  },
  fabric: {
    color: '#4a304a',
    reflectionRate: 0.2,
    transmissionRate: 0.0,
    thickness: 0.1,
    label: '织物',
  },
};

export const WALL_LABELS: Record<WallType, string> = {
  front: '前墙',
  back: '后墙',
  left: '左墙',
  right: '右墙',
  floor: '地板',
  ceiling: '天花板',
};

export const DEFAULT_ROOM: RoomConfig = {
  width: 8,
  height: 4,
  depth: 6,
  walls: {
    front: 'glass',
    back: 'wood',
    left: 'metal',
    right: 'metal',
    floor: 'wood',
    ceiling: 'fabric',
  },
};

export const DEFAULT_SOURCE: SoundSourceConfig = {
  position: [0, 1.5, 0],
  radius: 0.3,
  active: false,
};
