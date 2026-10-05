/**
 * 纯状态推演层：与 THREE / cannon-es / DOM 完全无关。
 *
 * 设计目标：
 * - 碰撞回调只产生 SimEvent（带 tick 时间戳），不直接改写任何状态。
 * - 每个固定物理步先推进时间驱动的机关（火焰柱、电梯、燃烧计时），
 *   再按确定性顺序归并本步事件并统一结算。
 * - 同一 tick 内对同一机关 / 奖励的重复事件只结算一次。
 * - 给定事件日志 + 固定时间步，runScenario 可在无浏览器环境下复算，
 *   结果与实时固定步循环逐 tick 一致。
 */

export type SurfaceType = 'metal' | 'sand' | 'ice';

export const FIXED_DT = 1 / 60;
export const MAX_LIVES = 5;
export const BURN_DURATION = 1;
export const FIRE_ACTIVE_DURATION = 0.8;
export const STAR_SCORE = 100;
export const GOAL_SCORE = 200;
export const HIDDEN_GOAL_SCORE = 500;
export const HIDDEN_PATH_SCORE = 10;
export const STARS_TO_UNLOCK = 3;

const EPS = 1e-9;

export type SimEventType =
  | 'surface'
  | 'hammer'
  | 'fire'
  | 'fall'
  | 'star'
  | 'hiddenPath'
  | 'goal';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  /** 火焰柱 / 锤子 id，或星星编号 */
  id?: number;
  /** type === 'surface' */
  surface?: SurfaceType;
  /** type === 'goal'：是否为隐藏通道终点 */
  hiddenPath?: boolean;
  /** type === 'hammer'：碰撞瞬间球心相对锤头的水平方向（未归一化，结算时复算击退） */
  dirX?: number;
  dirZ?: number;
}

export type SimEffect =
  | { type: 'surfaceChanged'; surface: SurfaceType }
  | { type: 'hammerHit'; id: number; dirX: number; dirZ: number }
  | { type: 'lifeLost'; lives: number; source: 'fire' | 'fall' }
  | { type: 'gameOver'; score: number }
  | { type: 'scoreAdd'; points: number; score: number }
  | { type: 'starCollected'; index: number; stars: number }
  | { type: 'gateOpened' }
  | { type: 'goal'; hiddenPath: boolean; score: number };

export interface FireColumnConfig {
  interval: number;
  /** 初始计时偏移（原实现为 Math.random()，离线复算需要确定性，默认 0） */
  phase?: number;
  activeDuration?: number;
}

export interface ElevatorConfig {
  baseY: number;
  minHeight: number;
  maxHeight: number;
  speed: number;
}

export interface SimConfig {
  fireColumns: FireColumnConfig[];
  elevators: ElevatorConfig[];
}

export interface FireState {
  timer: number;
  active: boolean;
  activeTimer: number;
}

export interface ElevatorState {
  y: number;
  direction: 1 | -1;
}

export interface SimSnapshot {
  tick: number;
  time: number;
  lives: number;
  score: number;
  stars: number[];
  burning: boolean;
  burnTimer: number;
  currentSurface: SurfaceType;
  gateOpen: boolean;
  hiddenPathUnlocked: boolean;
  won: boolean;
  wonViaHiddenPath: boolean;
  gameOver: boolean;
  fires: FireState[];
  elevators: ElevatorState[];
}

const EVENT_PRIORITY: Record<SimEventType, number> = {
  surface: 0,
  hammer: 1,
  fire: 2,
  fall: 3,
  star: 4,
  hiddenPath: 5,
  goal: 6
};

function eventKey(e: SimEvent): string {
  return [e.tick, e.type, e.id ?? '', e.surface ?? '', e.hiddenPath ? 1 : 0].join('|');
}

function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  const priorityDiff = EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type];
  if (priorityDiff !== 0) return priorityDiff;
  const idA = a.id ?? -1;
  const idB = b.id ?? -1;
  if (idA !== idB) return idA - idB;
  const surfaceA = a.surface ?? '';
  const surfaceB = b.surface ?? '';
  return surfaceA < surfaceB ? -1 : surfaceA > surfaceB ? 1 : 0;
}

export class Simulation {
  tick: number = 0;
  time: number = 0;

  lives: number = MAX_LIVES;
  score: number = 0;
  starsCollected: Set<number> = new Set();

  burning: boolean = false;
  burnTimer: number = 0;

  currentSurface: SurfaceType = 'metal';

  gateOpen: boolean = false;
  hiddenPathUnlocked: boolean = false;
  won: boolean = false;
  wonViaHiddenPath: boolean = false;
  gameOver: boolean = false;

  fires: FireState[];
  elevators: ElevatorState[];

  private readonly fireConfigs: Required<FireColumnConfig>[];
  private readonly elevatorConfigs: ElevatorConfig[];
  private queue: SimEvent[] = [];

  /** 收到的原始事件（含重复），可直接作为离线回放输入 */
  readonly eventLog: SimEvent[] = [];

  constructor(config: SimConfig) {
    this.fireConfigs = config.fireColumns.map((f) => ({
      interval: f.interval,
      phase: f.phase ?? 0,
      activeDuration: f.activeDuration ?? FIRE_ACTIVE_DURATION
    }));
    this.fires = this.fireConfigs.map((f) => ({
      timer: f.phase,
      active: false,
      activeTimer: 0
    }));

    this.elevatorConfigs = config.elevators;
    this.elevators = config.elevators.map((e) => ({
      y: e.baseY,
      direction: 1
    }));
  }

  get state(): SimSnapshot {
    return this.snapshot();
  }

  /** 碰撞 / 坠落等外部输入只入队，不立即结算 */
  enqueue(event: SimEvent): void {
    if (this.gameOver || this.won) return;
    this.queue.push(event);
    this.eventLog.push(event);
  }

  /**
   * 推进一个固定物理步：只推进时间驱动的状态。
   * 实时循环中先调用本方法，再执行物理步进（碰撞在此期间入队），
   * 最后调用 settle() 统一结算。
   */
  nextTick(dt: number = FIXED_DT): void {
    if (this.gameOver || this.won) return;
    this.tick += 1;
    this.time += dt;

    this.advanceFireColumns(dt);
    this.advanceElevators(dt);

    if (this.burning) {
      this.burnTimer -= dt;
      if (this.burnTimer <= EPS) {
        this.burnTimer = 0;
        this.burning = false;
      }
    }
  }

  /** 按确定性顺序归并本批事件并结算，返回视图层需要执行的副作用 */
  settle(): SimEffect[] {
    if (this.gameOver || this.won || this.queue.length === 0) {
      this.queue.length = 0;
      return [];
    }

    const events = this.queue.splice(0);
    events.sort(compareEvents);

    const seen = new Set<string>();
    const effects: SimEffect[] = [];

    for (const event of events) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      this.applyEvent(event, effects);
    }

    return effects;
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.tick,
      time: this.time,
      lives: this.lives,
      score: this.score,
      stars: [...this.starsCollected].sort((a, b) => a - b),
      burning: this.burning,
      burnTimer: this.burnTimer,
      currentSurface: this.currentSurface,
      gateOpen: this.gateOpen,
      hiddenPathUnlocked: this.hiddenPathUnlocked,
      won: this.won,
      wonViaHiddenPath: this.wonViaHiddenPath,
      gameOver: this.gameOver,
      fires: this.fires.map((f) => ({ ...f })),
      elevators: this.elevators.map((e) => ({ ...e }))
    };
  }

  private advanceFireColumns(dt: number): void {
    for (let i = 0; i < this.fires.length; i += 1) {
      const fire = this.fires[i];
      const config = this.fireConfigs[i];

      fire.timer += dt;
      if (fire.timer >= config.interval - EPS) {
        fire.timer -= config.interval;
        fire.active = true;
        fire.activeTimer = 0;
      }

      if (fire.active) {
        fire.activeTimer += dt;
        if (fire.activeTimer >= config.activeDuration - EPS) {
          fire.active = false;
        }
      }
    }
  }

  private advanceElevators(dt: number): void {
    for (let i = 0; i < this.elevators.length; i += 1) {
      const elevator = this.elevators[i];
      const config = this.elevatorConfigs[i];

      let y = elevator.y + elevator.direction * config.speed * dt;

      if (y >= config.baseY + config.maxHeight) {
        y = config.baseY + config.maxHeight;
        elevator.direction = -1;
      } else if (y <= config.baseY + config.minHeight) {
        y = config.baseY + config.minHeight;
        elevator.direction = 1;
      }

      elevator.y = y;
    }
  }

  private applyEvent(event: SimEvent, effects: SimEffect[]): void {
    switch (event.type) {
      case 'surface':
        if (event.surface && event.surface !== this.currentSurface) {
          this.currentSurface = event.surface;
          effects.push({ type: 'surfaceChanged', surface: event.surface });
        }
        break;

      case 'hammer':
        effects.push({
          type: 'hammerHit',
          id: event.id ?? 0,
          dirX: event.dirX ?? 0,
          dirZ: event.dirZ ?? 0
        });
        break;

      case 'fire': {
        const fire = this.fires[event.id ?? -1];
        if (fire && fire.active && !this.burning) {
          this.applyDamage('fire', effects);
        }
        break;
      }

      case 'fall':
        this.applyDamage('fall', effects);
        break;

      case 'star': {
        const index = event.id ?? -1;
        if (this.starsCollected.has(index)) break;
        this.starsCollected.add(index);
        this.score += STAR_SCORE;
        effects.push({ type: 'scoreAdd', points: STAR_SCORE, score: this.score });
        effects.push({
          type: 'starCollected',
          index,
          stars: this.starsCollected.size
        });
        if (
          this.starsCollected.size >= STARS_TO_UNLOCK &&
          !this.hiddenPathUnlocked
        ) {
          this.hiddenPathUnlocked = true;
          this.gateOpen = true;
          effects.push({ type: 'gateOpened' });
        }
        break;
      }

      case 'hiddenPath':
        if (this.hiddenPathUnlocked) {
          this.score += HIDDEN_PATH_SCORE;
          effects.push({ type: 'scoreAdd', points: HIDDEN_PATH_SCORE, score: this.score });
        }
        break;

      case 'goal':
        if (this.won) break;
        this.won = true;
        this.wonViaHiddenPath = !!event.hiddenPath;
        const points = event.hiddenPath ? HIDDEN_GOAL_SCORE : GOAL_SCORE;
        this.score += points;
        effects.push({ type: 'scoreAdd', points, score: this.score });
        effects.push({
          type: 'goal',
          hiddenPath: this.wonViaHiddenPath,
          score: this.score
        });
        break;
    }
  }

  private applyDamage(source: 'fire' | 'fall', effects: SimEffect[]): void {
    this.lives = Math.max(0, this.lives - 1);
    this.burning = true;
    this.burnTimer = BURN_DURATION;
    effects.push({ type: 'lifeLost', lives: this.lives, source });
    if (this.lives === 0) {
      this.gameOver = true;
      effects.push({ type: 'gameOver', score: this.score });
    }
  }
}

/**
 * 离线复算：给定带 tick 时间戳的事件序列与固定时间步，
 * 独立推演 ticks 个物理步并返回每一步之后的完整状态快照。
 */
export function runScenario(
  config: SimConfig,
  events: SimEvent[],
  ticks: number,
  dt: number = FIXED_DT
): SimSnapshot[] {
  const sim = new Simulation(config);
  const snapshots: SimSnapshot[] = [];

  for (let targetTick = 1; targetTick <= ticks; targetTick += 1) {
    sim.nextTick(dt);
    for (const event of events) {
      if (event.tick === targetTick) sim.enqueue(event);
    }
    sim.settle();
    snapshots.push(sim.snapshot());
  }

  return snapshots;
}
