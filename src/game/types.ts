/**
 * 烽燧戍守推演内核 —— 对外类型定义
 *
 * 本文件中的类型构成内核的全部对外契约：
 *  - BeaconConfig        初始烽燧配置
 *  - Command             玩家指令（判别联合，全部可 JSON 序列化）
 *  - CommandBatch        按 tick 顺序提交的指令批次
 *  - Snapshot            每一时刻的完整状态快照（可 JSON 序列化）
 *  - SimulationResult    runSimulation 的完整返回
 *
 * 调用方只需要依赖本文件与 runSimulation / createSession 两个入口，
 * 不需要感知内核内部数据结构。
 */

export type Direction = 'west' | 'north' | 'south';
export type ThreatLevel = 'low' | 'medium' | 'high';
export type GameStatus = 'playing' | 'won' | 'lost';
export type SoldierStatus = 'idle' | 'deployed' | 'returning' | 'incapacitated';
export type EnemyPhase = 'advancing' | 'repelled' | 'breached';

/** 单波敌情的固定配置（显式给出时推演结果完全确定，不消耗随机数） */
export interface WaveSpec {
  /** 在第几个 tick 出现 */
  atTick: number;
  direction: Direction;
  /** 人数（战斗力） */
  count: number;
  /** 每 tick 向烽燧推进的步数（距离坐标 100 -> 0） */
  speed: number;
}

/** 初始烽燧配置 */
export interface BeaconConfig {
  /** 随机种子：仅在 waves 缺省、由内核生成波次时使用 */
  seed?: number;
  /** 每个 tick 对应的真实毫秒数，默认 100。内核只以 tick 计步，与帧率无关 */
  tickMs?: number;
  /** 推演的最大 tick 数（超时仍在作战判定为失败，原因 time-limit） */
  maxTicks?: number;
  /** 戍卒数量，默认 6 */
  garrisonSize?: number;
  /** 初始补给，默认 120 */
  supplies?: number;
  /** 显式波次表；给出后推演完全由输入决定 */
  waves?: WaveSpec[];
  /** waves 缺省时按 seed 生成的波次数，默认 5 */
  waveCount?: number;
}

/** 玩家指令 */
export type Command =
  | { type: 'noop' }
  | { type: 'light-torch' }
  | { type: 'raise-smoke' }
  | { type: 'beat-drum' }
  | { type: 'deploy-soldier'; soldierId: string; post: number }
  | { type: 'recall-soldier'; soldierId: string }
  | { type: 'mark-threat'; enemyId: string; level: ThreatLevel };

/** 在指定 tick 按序提交的一批指令（批次内部保持数组顺序） */
export interface CommandBatch {
  tick: number;
  commands: Command[];
}

/** 指令被拒绝时的明确原因 */
export type RejectReason =
  | 'game-over'
  | 'cooldown'
  | 'already-active'
  | 'insufficient-supplies'
  | 'unknown-soldier'
  | 'soldier-unavailable'
  | 'soldier-not-deployed'
  | 'invalid-post'
  | 'unknown-enemy'
  | 'invalid-command';

export interface Rejection {
  tick: number;
  /** 批次内的序号，便于定位是哪一条指令 */
  index: number;
  command: Command;
  reason: RejectReason;
  /** 人类可读的中文说明，用于界面提示与离线报告 */
  message: string;
}

/** 戍卒快照 */
export interface SoldierState {
  id: string;
  status: SoldierStatus;
  /** 部署哨位（距烽燧步数）；未部署时为 null */
  post: number | null;
  /** 疲劳度 0-100 */
  fatigue: number;
  /** 体力 0-100，补给耗尽时持续流失，归零后失能 */
  stamina: number;
}

/** 敌情快照 */
export interface EnemyState {
  id: string;
  wave: number;
  direction: Direction;
  /** 当前剩余人数（战斗力），<=0 表示被击退 */
  count: number;
  /** 初始人数 */
  initialCount: number;
  /** 距烽燧步数，100 表示远方边缘，<=0 即抵达 */
  distance: number;
  speed: number;
  threat: ThreatLevel;
  /** 玩家标记的威胁等级，未标记为 null */
  marked: ThreatLevel | null;
  phase: EnemyPhase;
}

/** 推演事件（仅记录当前 tick 新发生的事件，保证结果可解释） */
export interface SimEvent {
  kind:
    | 'wave-spawned'
    | 'enemy-repelled'
    | 'enemy-breached'
    | 'tower-fallen'
    | 'torch-lit'
    | 'smoke-raised'
    | 'drum-beaten'
    | 'soldier-deployed'
    | 'soldier-recalled'
    | 'soldier-incapacitated'
    | 'supplies-exhausted'
    | 'difficulty-up'
    | 'victory';
  [key: string]: string | number;
}

/** 某一时刻的完整状态快照（纯 JSON，可序列化、可离线比对） */
export interface Snapshot {
  tick: number;
  status: GameStatus;
  verdictReason: string | null;
  supplies: number;
  score: number;
  repelled: number;
  consecutiveWins: number;
  /** 难度等级，每连续防御 3 波提升一级 */
  difficulty: number;
  enemies: EnemyState[];
  soldiers: SoldierState[];
  /** 各效果剩余持续 tick 数 */
  effects: { torch: number; smoke: number; drum: number };
  /** 各操作剩余冷却 tick 数 */
  cooldowns: { torch: number; smoke: number; drum: number; deploy: number };
  events: SimEvent[];
}

/** 推演结束判定 */
export interface Verdict {
  status: 'won' | 'lost';
  reason: string;
  tick: number;
  score: number;
  repelled: number;
}

/** 单一离线入口 runSimulation 的返回值 */
export interface SimulationResult {
  config: Required<Pick<BeaconConfig, 'tickMs' | 'maxTicks'>>;
  /** snapshots[0] 为初始时刻（tick=0），之后每 tick 一帧 */
  snapshots: Snapshot[];
  final: Snapshot;
  verdict: Verdict;
  /** 全部被拒绝的指令（不影响后续推演） */
  rejections: Rejection[];
}
