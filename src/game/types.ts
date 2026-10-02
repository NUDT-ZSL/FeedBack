export type CatapultType = 'light' | 'medium' | 'heavy';
export type AmmoType = 'stone' | 'fire';
export type GamePhase = 'deploy' | 'playerTurn' | 'enemyTurn' | 'victory' | 'defeat';
export type ParticleType = 'stone' | 'fire' | 'arrow';

export interface Catapult {
  id: string;
  type: CatapultType;
  position: { x: number; y: number };
  slotIndex: number | null;
  health: number;
  maxHealth: number;
  isDamaged: boolean;
  hasFired: boolean;
  angle: number;
  ammoType: AmmoType;
}

export interface Wall {
  durability: number;
  maxDurability: number;
  morale: number;
  maxMorale: number;
  crackLevel: number[];
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: ParticleType;
  life: number;
  maxLife: number;
  size: number;
}

export interface Projectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: AmmoType;
  active: boolean;
}

export interface GameState {
  phase: GamePhase;
  turn: number;
  catapults: Catapult[];
  wall: Wall;
  ammo: { stone: number; fire: number };
  particles: Particle[];
  projectiles: Projectile[];
  deployedSlots: (string | null)[];
  selectedCatapult: string | null;
  isAiming: boolean;
  trajectoryPoints: { x: number; y: number }[];
  draggingCatapult: { type: CatapultType; x: number; y: number } | null;
}

export interface CatapultConfig {
  name: string;
  damage: number;
  range: { min: number; max: number };
  reloadTime: number;
  maxHealth: number;
  velocity: number;
}

export interface GameEngineCallbacks {
  onStateChange: (state: GameState) => void;
  onVictory: () => void;
  onDefeat: () => void;
}
