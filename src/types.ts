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
  /** 本回合是否已被计入突围兵力，防止同一士兵重复计入 */
  inSortie: boolean;
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
  startTime?: number;
}

export interface Resources {
  grain: number;
  arrows: number;
  morale: number;
  wallDurability: number;
}

export type DefenderStatus = 'holding' | 'breaking' | 'routed' | 'escaped';

export type SortieDirection = 'gate' | 'leftFlank' | 'rightFlank';

export type BreakoutPhase =
  | 'decision'
  | 'sortie'
  | 'interception'
  | 'morale'
  | 'rout';

/** 守军（官兵）状态：城门破坏后的突围连锁核心数据 */
export interface DefenderState {
  morale: number;
  grain: number;
  status: DefenderStatus;
  /** 城墙残余段落的防守强度，基准 100，影响巷战反击 */
  wallDefense: number;
  /** 累计成功突围出城的守军人数 */
  escapedCount: number;
  /** 累计在突围中被歼灭的守军人数 */
  casualtyCount: number;
}

export interface BreakoutEventData {
  reason?: string;
  direction?: SortieDirection;
  exitX?: number;
  moraleBefore?: number;
  moraleAfter?: number;
  moraleDelta?: number;
  grainBefore?: number;
  grainAfter?: number;
  grainCost?: number;
  committed?: number;
  moved?: number;
  escaped?: number;
  casualties?: number;
  arrowsBefore?: number;
  arrowsAfter?: number;
  arrowsUsed?: number;
  threat?: number;
  suppressed?: number;
  coverRatio?: number;
  wallDefenseBefore?: number;
  wallDefenseAfter?: number;
  statusBefore?: DefenderStatus;
  statusAfter?: DefenderStatus;
  garrisonBefore?: number;
  garrisonAfter?: number;
  breachedCount?: number;
}

/** 突围连锁的单个结算事件，完整记录前后值，供界面与离线推演观察 */
export interface BreakoutEvent {
  turn: number;
  phase: BreakoutPhase;
  message: string;
  data: BreakoutEventData;
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
  defenders: DefenderState;
  /** 城门破坏后的突围/士气连锁事件日志 */
  breakoutLog: BreakoutEvent[];
  /** 突围链路上次结算的回合号，防止同回合重复结算 */
  breakoutSettledTurn: number;
}

export type GameAction =
  | { type: 'SELECT_CATAPULT'; id: string | null }
  | { type: 'DEPLOY_CATAPULT'; position: Position }
  | { type: 'MOVE_CATAPULT'; id: string; position: Position }
  | { type: 'ATTACK'; catapultId: string; target: Position }
  | { type: 'END_TURN' }
  | { type: 'HOVER_TILE'; position: Position | null }
  | { type: 'BREAK_GATE' }
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

/* ---- 城门破坏后：守军突围与士气连锁常量 ---- */
export const DEFENDER_INITIAL_GARRISON = 6;
export const DEFENDER_INITIAL_MORALE = 100;
export const DEFENDER_INITIAL_GRAIN = 30;
/** 城门破坏后补给线被切断，守军每回合固定军粮消耗 */
export const DEFENDER_GRAIN_UPKEEP_PER_TURN = 1;
/** 每名突围士兵每回合消耗的军粮 */
export const BREAKOUT_GRAIN_COST_PER_SOLDIER = 2;
/** 士气高于该值才会主动组织突围 */
export const BREAKOUT_MORALE_REQUIRED = 50;
/** 士气跌破该阈值（或军粮耗尽）即转为溃散 */
export const ROUT_MORALE_THRESHOLD = 20;
/** 坚守状态下每回合士气衰减 */
export const HOLD_MORALE_DECAY = 4;
/** 每名突围士兵阵亡造成的士气打击 */
export const BREAKOUT_CASUALTY_MORALE = 8;
/** 每名成功突围士兵带来的士气提振 */
export const BREAKOUT_ESCAPE_MORALE = 6;
/** 箭矢掩护成功时残余城墙段落防守强度提升 */
export const WALL_DEFENSE_COVER_BONUS = 10;
/** 掩护失败（出现阵亡）时残余城墙段落防守强度下降 */
export const WALL_DEFENSE_FAILURE_PENALTY = 10;
export const WALL_DEFENSE_BASE = 100;
export const WALL_DEFENSE_MAX = 160;
/** 每个封堵出口的起义军需要消耗的箭筒数（1 筒 = ARROWS_PER_QUIVER 支） */
export const ARROWS_PER_REBEL_SUPPRESSED = 1;
/** 单个封堵出口的起义军能截杀的突围士兵数 */
export const REBEL_INTERCEPT_KILL = 1;
export const SORTIE_THREAT_RANGE = 3;
