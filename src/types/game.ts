export type CellType = 0 | 1;

export interface Rift {
  x: number;
  y: number;
  direction: 'horizontal' | 'vertical';
}

export interface Fragment {
  id: number;
  x: number;
  y: number;
  rotation: number;
  collected: boolean;
  collectParticles: CollectParticle[];
}

export interface CollectParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

export interface TrailParticle {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

export interface StormParticle {
  angle: number;
  radius: number;
  speed: number;
}

export interface Storm {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxRadius: number;
  lifetime: number;
  maxLifetime: number;
  particles: StormParticle[];
  riftIndex: number;
}

export interface MazeData {
  grid: CellType[][];
  width: number;
  height: number;
  cellSize: number;
  rifts: Rift[];
  exit: { gridX: number; gridY: number };
}

export interface ShipState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  energy: number;
  maxEnergy: number;
  isHit: boolean;
  hitTime: number;
  trail: TrailParticle[];
}

export interface StarParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
}

export type GamePhase = 'start' | 'playing' | 'victory' | 'gameover';

export interface GameState {
  phase: GamePhase;
  maze: MazeData | null;
  ship: ShipState;
  storms: Storm[];
  fragments: Fragment[];
  collectedFragments: number;
  startTime: number;
  elapsedTime: number;
  camera: { x: number; y: number; scale: number };
  isStormNearby: boolean;
  stormBorderTime: number;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}
