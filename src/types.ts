export enum MazeCellType {
  WALL = 0,
  PATH = 1
}

export interface Position {
  x: number;
  y: number;
}

export enum GameState {
  MENU = 'menu',
  PLAYING = 'playing',
  GAMEOVER = 'gameover'
}

export enum GameStatus {
  WIN = 'win',
  LOSE = 'lose'
}

export interface Treasure {
  x: number;
  y: number;
  collected: boolean;
  pulsePhase: number;
}

export interface Trap {
  x: number;
  y: number;
  triggered: boolean;
}

export interface TrailPoint {
  x: number;
  y: number;
  createdAt: number;
}

export interface MazeReconstructState {
  active: boolean;
  regionX: number;
  regionY: number;
  regionSize: number;
  oldMaze: MazeCellType[][];
  newMaze: MazeCellType[][];
  startTime: number;
  duration: number;
}

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  moveProgress: number;
  moveDuration: number;
  isMoving: boolean;
  speedMultiplier: number;
  slowEndTime: number;
  haloEndTime: number;
  trapHits: number;
  trail: TrailPoint[];
}

export interface GameData {
  state: GameState;
  status: GameStatus | null;
  score: number;
  treasuresCollected: number;
  totalTreasures: number;
  survivalTime: number;
  highScore: number;
  gameStartTime: number;
  lastReconstructTime: number;
  reconstructInterval: number;
  screenFlashEndTime: number;
  fadeOutStartTime: number;
}
