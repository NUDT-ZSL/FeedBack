import {
  GameState,
  Position,
  Soldier,
  GRID_WIDTH,
  WALL_ROW
} from './types';
import {
  createInitialState,
  createInitialCatapult,
  calculateDamage,
  createCrack,
  imperialTurn,
  endTurn,
  setRngSeed,
  isInCity
} from './GameLogic';
import { resolveBreakoutPhase } from './BreakoutLogic';

/** 与结算顺序无关的可比较快照（剔除粒子、动画、随机 id 等表现层数据） */
export interface StateSnapshot {
  turn: number;
  winner: GameState['winner'];
  gateDestroyed: boolean;
  rebelGrain: number;
  rebelMorale: number;
  arrows: number;
  defenderMorale: number;
  defenderGrain: number;
  defenderStatus: GameState['defenders']['status'];
  wallDefense: number;
  escapedCount: number;
  casualtyCount: number;
  wallDurabilities: number[];
  soldiers: Array<{ side: Soldier['side']; x: number; y: number; health: number }>;
  catapultHealth: number[];
  breakoutLogSize: number;
  logTail: string[];
}

export const takeSnapshot = (state: GameState): StateSnapshot => ({
  turn: state.turn,
  winner: state.winner,
  gateDestroyed: state.gateDestroyed,
  rebelGrain: state.resources.grain,
  rebelMorale: state.resources.morale,
  arrows: state.resources.arrows,
  defenderMorale: state.defenders.morale,
  defenderGrain: state.defenders.grain,
  defenderStatus: state.defenders.status,
  wallDefense: state.defenders.wallDefense,
  escapedCount: state.defenders.escapedCount,
  casualtyCount: state.defenders.casualtyCount,
  wallDurabilities: state.wallSegments.map(w => w.durability),
  soldiers: state.soldiers
    .map(s => ({ side: s.side, x: s.position.x, y: s.position.y, health: s.health }))
    .sort((a, b) =>
      a.side.localeCompare(b.side) || a.x - b.x || a.y - b.y || a.health - b.health
    ),
  catapultHealth: state.catapults.map(c => c.health).sort((a, b) => a - b),
  breakoutLogSize: state.breakoutLog.length,
  logTail: state.breakoutLog.slice(-6).map(e => e.message)
});

/** 纯函数版玩家投石（不产生投射物/音效，仅改变城墙与投石机行动状态） */
export const attackWall = (
  state: GameState,
  catapultId: string,
  target: Position
): GameState => {
  const catapult = state.catapults.find(c => c.id === catapultId);
  if (!catapult || catapult.hasActed || catapult.isStunned) return state;
  if (target.y !== WALL_ROW) return state;

  const { damage, crackSize } = calculateDamage(catapult, target, state.wallSegments);
  const wallSegments = state.wallSegments.map(w =>
    w.position.x === target.x && w.position.y === target.y
      ? {
          ...w,
          durability: Math.max(0, w.durability - damage),
          cracks: crackSize > 0 ? [...w.cracks, createCrack(crackSize)].slice(-5) : w.cracks
        }
      : w
  );

  return {
    ...state,
    wallSegments,
    catapults: state.catapults.map(c => (c.id === catapultId ? { ...c, hasActed: true } : c))
  };
};

export const deployCatapults = (state: GameState, positions: Position[]): GameState => {
  let next = state;
  for (const position of positions) {
    const catapult = createInitialCatapult(position);
    catapult.hasActed = true;
    next = { ...next, catapults: [...next.catapults, catapult] };
  }
  return next;
};

/** 一个完整回合的确定性结算：守城方反击 → 回合末（含突围/士气连锁）→ 胜负 */
export const settleFullTurn = (state: GameState): GameState => {
  const afterImperial = imperialTurn(state) as Partial<GameState>;
  const merged: GameState = { ...state, ...afterImperial };
  const result = endTurn(merged) as Partial<GameState>;
  return { ...merged, ...result };
};

export interface ScenarioOptions {
  turns: number;
  seed: string;
  /** 第一回合在城下列阵的投石机（行动标记为已行动） */
  catapultPositions: Position[];
  /** 每回合玩家用所有可行动投石机集中攻击的城墙列 */
  focusColumn: number;
  /** 在指定回合开始前直接砸破城门（用于快速观察突围连锁） */
  forceGateByTurn?: number;
  /** 覆盖初始守军军粮（边界场景） */
  defenderGrain?: number;
  /** 覆盖初始守军士气（边界场景） */
  defenderMorale?: number;
}

const gateColumn = (): number => Math.floor(GRID_WIDTH / 2);

export const defaultScenario = (turns = 12): ScenarioOptions => ({
  turns,
  seed: 'hangzhou-breakout-2024',
  catapultPositions: [
    { x: gateColumn(), y: WALL_ROW + 3 },
    { x: gateColumn() - 1, y: WALL_ROW + 4 },
    { x: gateColumn() + 1, y: WALL_ROW + 4 }
  ],
  focusColumn: gateColumn(),
  forceGateByTurn: 3
});

/** 执行一回合的脚本化玩家行动：集中投石攻击指定城墙列 */
const scriptedPlayerTurn = (state: GameState, opts: ScenarioOptions): GameState => {
  let next = state;
  if (opts.forceGateByTurn !== undefined && state.turn >= opts.forceGateByTurn) {
    next = {
      ...next,
      wallSegments: next.wallSegments.map(w => (w.isGate ? { ...w, durability: 0 } : w))
    };
  }
  for (const catapult of next.catapults) {
    if (next.winner) break;
    next = attackWall(next, catapult.id, { x: opts.focusColumn, y: WALL_ROW });
  }
  return next;
};

const buildInitialState = (opts: ScenarioOptions): GameState => {
  setRngSeed(opts.seed);
  let state = createInitialState();
  if (opts.defenderGrain !== undefined) {
    state = { ...state, defenders: { ...state.defenders, grain: opts.defenderGrain } };
  }
  if (opts.defenderMorale !== undefined) {
    state = { ...state, defenders: { ...state.defenders, morale: opts.defenderMorale } };
  }
  state = deployCatapults(state, opts.catapultPositions);
  return state;
};

export interface RunResult {
  states: GameState[];
  snapshots: StateSnapshot[];
  final: GameState;
}

/** 连续模式：同一状态对象上一口气跑 N 回合 */
export const runContinuous = (options: Partial<ScenarioOptions> = {}): RunResult => {
  const opts = { ...defaultScenario(), ...options };
  let state = buildInitialState(opts);
  const states = [state];
  const snapshots = [takeSnapshot(state)];

  for (let t = 0; t < opts.turns; t++) {
    if (state.winner) break;
    state = scriptedPlayerTurn(state, opts);
    state = settleFullTurn(state);
    states.push(state);
    snapshots.push(takeSnapshot(state));
  }
  return { states, snapshots, final: state };
};

/** 逐回合模式：每回合从结构化克隆的独立状态开始结算 */
export const runStepwise = (options: Partial<ScenarioOptions> = {}): RunResult => {
  const opts = { ...defaultScenario(), ...options };
  let state = buildInitialState(opts);
  const states = [state];
  const snapshots = [takeSnapshot(state)];

  for (let t = 0; t < opts.turns; t++) {
    if (state.winner) break;
    // 跨回合深拷贝：验证结算结果只依赖状态本身，与内存连续性无关
    let cloned = structuredClone(state) as GameState;
    cloned = scriptedPlayerTurn(cloned, opts);
    cloned = settleFullTurn(cloned);
    state = cloned;
    states.push(state);
    snapshots.push(takeSnapshot(state));
  }
  return { states, snapshots, final: state };
};

/** 一致性校验：连续推演与逐回合单独结算必须逐回合一致 */
export const verifyConsistency = (
  options: Partial<ScenarioOptions> = {}
): { consistent: boolean; mismatchTurn: number | null; turns: number } => {
  const continuous = runContinuous(options);
  const stepwise = runStepwise(options);
  const turns = Math.max(continuous.snapshots.length, stepwise.snapshots.length);

  for (let i = 0; i < turns; i++) {
    const a = continuous.snapshots[i];
    const b = stepwise.snapshots[i];
    if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) {
      return { consistent: false, mismatchTurn: i, turns };
    }
  }
  return { consistent: true, mismatchTurn: null, turns: continuous.snapshots.length - 1 };
};

/** 同回合防重入：连锁在同一回合结算第二次时不得再产生事件/改动 */
export const isBreakoutIdempotent = (state: GameState): boolean => {
  if (!state.gateDestroyed) return true;
  const first = resolveBreakoutPhase(state);
  const once: GameState = {
    ...state,
    soldiers: first.soldiers,
    defenders: first.defenders,
    resources: { ...state.resources, arrows: first.arrows },
    breakoutLog: [...state.breakoutLog, ...first.events],
    breakoutSettledTurn: state.turn
  };
  const second = resolveBreakoutPhase(once);
  return (
    second.events.length === 0 &&
    JSON.stringify(second.soldiers.map(s => ({ id: s.id, p: s.position, h: s.health }))) ===
      JSON.stringify(once.soldiers.map(s => ({ id: s.id, p: s.position, h: s.health }))) &&
    second.defenders.morale === once.defenders.morale &&
    second.defenders.grain === once.defenders.grain
  );
};

/** 城门未破坏时，突围连锁完全不触发 */
export const isChainInactiveBeforeBreach = (state: GameState): boolean => {
  const result = resolveBreakoutPhase(state);
  const imperialInCity = state.soldiers.filter(
    s => s.side === 'imperial' && isInCity(s.position)
  ).length;
  return (
    result.events.length === 0 &&
    result.soldiers.filter(s => s.side === 'imperial' && isInCity(s.position)).length ===
      imperialInCity &&
    result.defenders.morale === state.defenders.morale &&
    result.defenders.grain === state.defenders.grain &&
    result.arrows === state.resources.arrows
  );
};
