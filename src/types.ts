export enum FractureType {
  RADIAL_DISTAL = 'radial_distal',
  HUMERAL_SHAFT = 'humeral_shaft',
  OLECRANON = 'olecranon'
}

export enum GamePhase {
  DIAGNOSIS = 'DIAGNOSIS',
  REDUCTION = 'REDUCTION',
  FIXATION = 'FIXATION',
  REHABILITATION = 'REHABILITATION',
  COMPLETE = 'COMPLETE'
}

export interface BoneJoint {
  id: string;
  name: string;
  currentAngle: number;
  targetAngle: number;
  position: { x: number; y: number };
  length: number;
}

export interface FixationMaterial {
  id: string;
  name: string;
  type: 'cotton_pad' | 'willow_splint' | 'bamboo_splint' | 'gauze';
  order: number;
  position: string;
  placed: boolean;
  correctPosition: string;
}

export interface RehabilitationAction {
  day: number;
  name: string;
  trajectoryType: 'circle' | 'line' | 'wave';
  requiredMatch: number;
  description: string;
}

export interface ParticleEffect {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}
