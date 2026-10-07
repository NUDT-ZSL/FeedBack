export type PieceType = 'infantry' | 'archer' | 'cavalry';
export type Side = 'player' | 'ai';
export type PieceStatus = 'alive' | 'dead' | 'moving';
export type FormationType = 'yulin' | 'fangyuan' | 'heyi';

export enum GamePhase {
  IDLE = 'idle',
  DRAGGING = 'dragging',
  FORMING = 'forming',
  SIMULATING = 'simulating',
  FINISHED = 'finished',
}

export interface Piece {
  id: string;
  type: PieceType;
  side: Side;
  x: number;
  y: number;
  status: PieceStatus;
  attack: number;
  defense: number;
}

export interface Formation {
  name: FormationType;
  nameCN: string;
  description: string;
  attackBonus: number;
  defenseBonus: number;
  positions: Array<{ dx: number; dy: number; type: PieceType }>;
}

export interface SimulationResult {
  winner: Side | 'draw';
  playerRemaining: number;
  aiRemaining: number;
  playerFormation: FormationType;
  aiFormation: FormationType;
  timestamp: number;
  snapshot: Piece[];
}

export interface DragState {
  isDragging: boolean;
  pieceId: string | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface HistoryItem {
  id: string;
  playerFormation: string;
  aiFormation: string;
  result: 'win' | 'lose' | 'draw';
  remaining: number;
  timestamp: number;
  snapshot: Piece[];
}

export interface GameState {
  pieces: Piece[];
  phase: GamePhase;
  playerFormation: FormationType | null;
  aiFormation: FormationType | null;
  playerMorale: number;
  aiMorale: number;
  result: SimulationResult | null;
  history: HistoryItem[];
}

export interface HaloEffect {
  id: string;
  x: number;
  y: number;
  startTime: number;
  duration: number;
  color: string;
  radius: number;
}

export interface FormationText {
  text: string;
  startTime: number;
  duration: number;
}

export const BOARD_SIZE = 16;
export const CELL_SIZE = 60;
export const PIECE_RADIUS = 15;
export const SNAP_DISTANCE = 20;

export const COLORS = {
  parchment: '#f5e6c8',
  darkBrown: '#2b1a0e',
  gold: '#b8860b',
  darkRed: '#8b0000',
  lightRed: '#cc0000',
  deepBlue: '#000066',
  player: '#1e3a8a',
  ai: '#991b1b',
  grid: '#b8860b',
  ink: '#000000',
};

export const PIECE_STATS = {
  infantry: { attack: 3, defense: 4, icon: '⚔' },
  archer: { attack: 4, defense: 2, icon: '🏹' },
  cavalry: { attack: 5, defense: 3, icon: '🐎' },
};

export const FORMATION_NAMES: Record<FormationType, string> = {
  yulin: '鱼鳞阵',
  fangyuan: '方圆阵',
  heyi: '鹤翼阵',
};
