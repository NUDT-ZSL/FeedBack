export interface Position {
  x: number;
  y: number;
}

export interface Crack {
  id: string;
  size: number;
  clipPath: string;
}

export interface WallSegment {
  id: string;
  position: Position;
  durability: number;
  cracks: Crack[];
  isGate: boolean;
}

export interface Catapult {
  id: string;
  position: Position;
  health: number;
  hasActed: boolean;
  isStunned: boolean;
  stunTurns: number;
}

export interface Soldier {
  id: string;
  side: 'rebels' | 'imperial';
  position: Position;
  health: number;
  hasMoved: boolean;
  isDying: boolean;
}

export interface Particle {
  id: string;
  type: 'smoke' | 'spatter' | 'dust' | 'arrow' | 'oil' | 'mist';
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Projectile {
  id: string;
  startPos: Position;
  endPos: Position;
  progress: number;
  duration: number;
  type: 'stone' | 'arrow';
}

export interface Resources {
  grain: number;
  arrows: number;
  morale: number;
  wallDurability: number;
}

export type TurnPhase = 'player' | 'imperial' | 'transition' | 'gameOver';

export interface GameState {
  turn: number;
  phase: TurnPhase;
  winner: 'rebels' | 'imperial' | null;
  catapults: Catapult[];
  wallSegments: WallSegment[];
  soldiers: Soldier[];
  resources: Resources;
  particles: Particle[];
  projectiles: Projectile[];
  selectedCatapult: string | null;
  hoveredTile: Position | null;
  maxCatapults: number;
  gateDestroyed: boolean;
  oilAreas: { position: Position; turnsLeft: number }[];
}

export type GameAction =
  | { type: 'SELECT_CATAPULT'; id: string | null }
  | { type: 'DEPLOY_CATAPULT'; position: Position }
  | { type: 'MOVE_CATAPULT'; id: string; position: Position }
  | { type: 'ATTACK'; catapultId: string; target: Position }
  | { type: 'END_TURN' }
  | { type: 'HOVER_TILE'; position: Position | null }
  | { type: 'RESET_GAME' }
  | { type: 'UPDATE_PARTICLES' }
  | { type: 'UPDATE_PROJECTILES' };

export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 12;
export const WALL_ROW = 3;
export const TILE_SIZE = 50;
export const GRAIN_PER_PILE = 10;
export const ARROWS_PER_QUIVER = 20;
export const MAX_MORALE = 100;
export const GRAIN_CONSUMPTION_PER_TURN = 2;
export const INITIAL_GRAIN = 20;
export const INITIAL_ARROWS = 5;
export const INITIAL_MORALE = 100;
export const INITIAL_WALL_DURABILITY = 100;
export const MAX_CATAPULTS = 5;
export const CATAPULT_MOVE_RANGE = 2;
export const CATAPULT_ATTACK_RANGE = 8;
export const SOLDIER_MOVE_RANGE = 3;
