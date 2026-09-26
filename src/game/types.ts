export type PipeType = 'straight' | 'curve' | 'tee' | 'valve';

export type Direction = 0 | 1 | 2 | 3;

export interface GridCell {
  x: number;
  y: number;
  pipeType: PipeType | null;
  rotation: Direction;
  isWaterSource: boolean;
  isTarget: boolean;
  terrainType: 'grass' | 'sand';
  rotationAnimation?: {
    startTime: number;
    startRotation: number;
    targetRotation: number;
  };
}

export interface WaterParticle {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  progress: number;
  pathIndex: number;
  color: string;
}

export interface WaterSplash {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
}

export interface LevelConfig {
  id: number;
  name: string;
  gridSize: number;
  waterSource: { x: number; y: number };
  target: { x: number; y: number };
  availablePipes: PipeType[];
  maxSteps: number;
  starThresholds: [number, number, number];
}

export interface GameState {
  currentLevel: number;
  grid: GridCell[][];
  steps: number;
  waterPath: { x: number; y: number }[];
  particles: WaterParticle[];
  splashes: WaterSplash[];
  isWaterFlowing: boolean;
  isLevelComplete: boolean;
  stars: number;
  showHint: boolean;
  hintText: string;
  hintOpacity: number;
  selectedPipe: PipeType | null;
  waterWheelRotation: number;
  showWaterWheel: boolean;
  levelConfigs: LevelConfig[];
}

export interface GameActions {
  placePipe: (x: number, y: number, type: PipeType) => void;
  rotatePipe: (x: number, y: number) => void;
  resetLevel: () => void;
  selectPipe: (type: PipeType | null) => void;
  nextLevel: () => void;
  checkWaterFlow: () => void;
  updateParticles: (deltaTime: number) => void;
  setHint: (text: string) => void;
  updateHintOpacity: (deltaTime: number) => void;
}

export const PIPE_CONNECTIONS: Record<PipeType, Direction[]> = {
  straight: [0, 2],
  curve: [0, 1],
  tee: [1, 2, 3],
  valve: [0, 2],
};

export const DIRECTION_OFFSETS: Record<Direction, { dx: number; dy: number }> = {
  0: { dx: 0, dy: -1 },
  1: { dx: 1, dy: 0 },
  2: { dx: 0, dy: 1 },
  3: { dx: -1, dy: 0 },
};

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  0: 2,
  1: 3,
  2: 0,
  3: 1,
};

export const LEVEL_CONFIGS: LevelConfig[] = [
  {
    id: 1,
    name: '初涉水渠',
    gridSize: 6,
    waterSource: { x: 0, y: 2 },
    target: { x: 5, y: 2 },
    availablePipes: ['straight', 'curve'],
    maxSteps: 20,
    starThresholds: [8, 12, 20],
  },
  {
    id: 2,
    name: '蜿蜒水道',
    gridSize: 7,
    waterSource: { x: 0, y: 3 },
    target: { x: 6, y: 3 },
    availablePipes: ['straight', 'curve'],
    maxSteps: 25,
    starThresholds: [10, 15, 25],
  },
  {
    id: 3,
    name: '分流枢纽',
    gridSize: 8,
    waterSource: { x: 0, y: 4 },
    target: { x: 7, y: 2 },
    availablePipes: ['straight', 'curve', 'tee'],
    maxSteps: 30,
    starThresholds: [12, 18, 30],
  },
  {
    id: 4,
    name: '阀门控制',
    gridSize: 10,
    waterSource: { x: 0, y: 5 },
    target: { x: 9, y: 5 },
    availablePipes: ['straight', 'curve', 'tee', 'valve'],
    maxSteps: 40,
    starThresholds: [18, 25, 40],
  },
  {
    id: 5,
    name: '罗马水道',
    gridSize: 12,
    waterSource: { x: 0, y: 6 },
    target: { x: 11, y: 6 },
    availablePipes: ['straight', 'curve', 'tee', 'valve'],
    maxSteps: 50,
    starThresholds: [22, 30, 50],
  },
];

export const COLORS = {
  background: '#F5E6D3',
  gridLine: '#8B5E3C',
  grass: '#A3D977',
  sand: '#E8D5A4',
  pipeStroke: '#94A3B8',
  waterStart: '#3B82F6',
  waterEnd: '#06B6D4',
  waterGlow: 'rgba(59, 130, 246, 0.3)',
  targetGold: '#FFD700',
  sourceBlue: '#3B82F6',
  hintText: '#FF6B6B',
  stoneBg: 'rgba(255, 248, 230, 0.9)',
  stoneBorder: '#C8A96E',
  toolbarBg: '#1E293B',
  star: '#FFD700',
  starEmpty: '#D1D5DB',
  disconnectedPath: '#9CA3AF',
};
