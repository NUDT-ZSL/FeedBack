/**
 * 纯逻辑推演层的类型定义。
 * 本模块（src/sim/*）不依赖 three / cannon-es / DOM，
 * 可以在 Node 环境下离线复算，与渲染帧率完全解耦。
 */

export type SurfaceType = 'metal' | 'sand' | 'ice';

/** 火焰柱配置：每 interval 秒激活一次，激活窗口为 activeDuration 秒 */
export interface FireColumnConfig {
  id: string;
  interval: number;
  activeDuration?: number; // 默认 0.8s，与原 setTimeout(800) 行为一致
}

/** 电梯配置：在 [baseY+minHeight, baseY+maxHeight] 之间匀速往返 */
export interface ElevatorConfig {
  id: string;
  baseY: number;
  minHeight: number;
  maxHeight: number;
  speed: number;
  startY?: number;          // 默认 baseY
  direction?: 1 | -1;       // 默认 1（向上）
}

export interface EngineConfig {
  fixedDt?: number;         // 固定物理步长，默认 1/60
  lives?: number;           // 初始生命，默认 5
  starsToUnlock?: number;   // 解锁隐藏通道所需星星数，默认 3
  fires?: FireColumnConfig[];
  elevators?: ElevatorConfig[];
}

/**
 * 碰撞事件：物理回调只负责产生事件，不直接改写任何游戏状态。
 * direction 为球心相对锤头的水平向量（击退方向由引擎统一结算）。
 */
export type GameEvent =
  | { kind: 'surface'; surface: SurfaceType }
  | { kind: 'hammer'; id: string; direction: [number, number] }
  | { kind: 'fire'; id: string }
  | { kind: 'star'; index: number }
  | { kind: 'goal'; hiddenPath: boolean }
  | { kind: 'hiddenPath' }
  | { kind: 'fall' };

/** 结算产物：渲染层（音效、粒子、UI、击退速度）只消费 Effect，不改状态 */
export type Effect =
  | { type: 'damage'; cause: 'fire' | 'fall'; lives: number }
  | { type: 'gameOver'; score: number }
  | { type: 'score'; points: number; total: number }
  | { type: 'star'; index: number; total: number }
  | { type: 'hammerHit'; id: string; velocity: [number, number, number] }
  | { type: 'surface'; surface: SurfaceType }
  | { type: 'unlockHiddenPath' }
  | { type: 'goal'; hiddenPath: boolean }
  | { type: 'respawn' };

export interface FireState {
  timer: number;
  active: boolean;
  activeElapsed: number;
  interval: number;
  activeDuration: number;
}

export interface ElevatorState {
  y: number;
  direction: 1 | -1;
  baseY: number;
  minHeight: number;
  maxHeight: number;
  speed: number;
}

export interface EngineState {
  time: number;             // 累计物理时间（只随固定步长推进）
  lives: number;
  maxLives: number;
  score: number;
  starsCollected: Set<number>;
  burning: boolean;
  burnTimer: number;
  surface: SurfaceType;
  gameOver: boolean;
  won: boolean;
  hiddenPathUnlocked: boolean;
  gateOpen: boolean;
  fires: Record<string, FireState>;
  elevators: Record<string, ElevatorState>;
}

/** 可序列化的状态快照，用于离线复算比对 */
export interface StateSnapshot {
  time: number;
  lives: number;
  score: number;
  stars: number[];
  burning: boolean;
  surface: SurfaceType;
  gameOver: boolean;
  won: boolean;
  hiddenPathUnlocked: boolean;
  gateOpen: boolean;
  fires: Record<string, { timer: number; active: boolean }>;
  elevators: Record<string, { y: number; direction: number }>;
}
