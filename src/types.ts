export type RuneColor = 'red' | 'blue' | 'green';
export type RuneEffect = 'explosion' | 'lightning' | 'shield';

export interface CellState {
  id: string;
  color: RuneColor | null;
  row: number;
  col: number;
  isAnimating?: boolean;
  isSelected?: boolean;
  isEliminating?: boolean;
  isNew?: boolean;
}

export type BoardState = CellState[][];

export interface ChainGroup {
  cells: { row: number; col: number }[];
  color: RuneColor;
  effect: RuneEffect;
  chainLevel: number;
}

export interface Skill {
  id: string;
  name: string;
  manaCost: number;
  description: string;
  icon: string;
}

export interface LevelConfig {
  id: number;
  targetScore: number;
  maxSteps: number;
  initialBoard: (RuneColor | null)[][];
}

export interface PlayerState {
  score: number;
  mana: number;
  stepsRemaining: number;
  currentLevel: number;
  totalRunesEliminated: number;
  selectedColor: RuneColor;
}

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  score: number;
  levelId: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
  maxProgress: number;
}

export interface GameResult {
  levelId: number;
  score: number;
  playerName: string;
  passed: boolean;
}
