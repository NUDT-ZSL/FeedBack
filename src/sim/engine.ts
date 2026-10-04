import {
  Effect,
  ElevatorConfig,
  EngineConfig,
  EngineState,
  GameEvent,
  StateSnapshot,
  SurfaceType,
} from './types';

export const DEFAULT_FIXED_DT = 1 / 60;
export const DEFAULT_LIVES = 5;
export const DEFAULT_STARS_TO_UNLOCK = 3;
export const FIRE_ACTIVE_DURATION = 0.8; // 原 setTimeout(800) 的激活窗口
export const BURN_DURATION = 1;         // 原 takeDamage 后的燃烧/无敌时长
export const STAR_SCORE = 100;
export const GOAL_SCORE = 200;
export const HIDDEN_GOAL_SCORE = 500;
export const HIDDEN_PATH_SCORE = 10;
const TIME_EPSILON = 1e-9;

/**
 * 同一步内事件的确定性结算顺序。
 * 不依赖 cannon 回调触发次序：先材质，再机关（锤→火），
 * 再奖励（星星→通道→终点），最后坠落结算。
 */
const EVENT_PRIORITY: Record<GameEvent['kind'], number> = {
  surface: 0,
  hammer: 1,
  fire: 2,
  star: 3,
  hiddenPath: 4,
  goal: 5,
  fall: 6,
};

/**
 * 同一物理步内对同一机关 / 同一奖励只结算一次的去重键。
 * surface 不参与去重（按序生效，最后一次接触的材质胜出，与原实现一致）。
 */
function dedupeKey(event: GameEvent): string | null {
  switch (event.kind) {
    case 'hammer':
      return `hammer:${event.id}`;
    case 'fire':
      return `fire:${event.id}`;
    case 'star':
      return `star:${event.index}`;
    case 'goal':
      return 'goal';
    case 'hiddenPath':
      return 'hiddenPath';
    case 'fall':
      return 'fall';
    default:
      return null;
  }
}

export class GameEngine {
  readonly fixedDt: number;
  readonly state: EngineState;
  private readonly starsToUnlock: number;
  private queue: Array<{ seq: number; event: GameEvent }> = [];
  private seq: number = 0;

  constructor(config: EngineConfig = {}) {
    this.fixedDt = config.fixedDt ?? DEFAULT_FIXED_DT;
    this.starsToUnlock = config.starsToUnlock ?? DEFAULT_STARS_TO_UNLOCK;

    const fires: EngineState['fires'] = {};
    for (const f of config.fires ?? []) {
      fires[f.id] = {
        timer: 0,
        active: false,
        activeElapsed: 0,
        interval: f.interval,
        activeDuration: f.activeDuration ?? FIRE_ACTIVE_DURATION,
      };
    }

    const elevators: EngineState['elevators'] = {};
    for (const e of config.elevators ?? []) {
      elevators[e.id] = {
        y: e.startY ?? e.baseY,
        direction: e.direction ?? 1,
        baseY: e.baseY,
        minHeight: e.minHeight,
        maxHeight: e.maxHeight,
        speed: e.speed,
      };
    }

    this.state = {
      time: 0,
      lives: config.lives ?? DEFAULT_LIVES,
      maxLives: config.lives ?? DEFAULT_LIVES,
      score: 0,
      starsCollected: new Set<number>(),
      burning: false,
      burnTimer: 0,
      surface: 'metal',
      gameOver: false,
      won: false,
      hiddenPathUnlocked: false,
      gateOpen: false,
      fires,
      elevators,
    };
  }

  /** 物理碰撞回调的唯一入口：只入队，不改状态 */
  queueEvent(event: GameEvent): void {
    this.queue.push({ seq: this.seq++, event });
  }

  /**
   * 推进一个固定物理步：
   * 1) 按累计物理时间推进火焰柱 / 电梯 / 燃烧计时（不读真实时钟）；
   * 2) 按确定性顺序归并并去重本步事件；
   * 3) 统一结算血量、得分、星星、机关与隐藏通道，返回渲染层需要的副作用。
   */
  step(): Effect[] {
    const dt = this.fixedDt;
    const s = this.state;
    s.time += dt;

    this.advanceFires(dt);
    this.advanceElevators(dt);
    this.advanceBurn(dt);

    return this.settleEvents();
  }

  private advanceFires(dt: number): void {
    for (const id of Object.keys(this.state.fires)) {
      const f = this.state.fires[id];
      f.timer += dt;
      if (f.timer + TIME_EPSILON >= f.interval) {
        f.timer -= f.interval;
        f.activeElapsed = 0;
        f.active = true;
      }
      if (f.active) {
        f.activeElapsed += dt;
        if (f.activeElapsed + TIME_EPSILON >= f.activeDuration) {
          f.active = false;
        }
      }
    }
  }

  private advanceElevators(dt: number): void {
    for (const id of Object.keys(this.state.elevators)) {
      const e = this.state.elevators[id];
      const lower = e.baseY + e.minHeight;
      const upper = e.baseY + e.maxHeight;

      let y = e.y + e.direction * e.speed * dt;
      if (y > upper) {
        y = upper;
        e.direction = -1;
      } else if (y < lower) {
        y = lower;
        e.direction = 1;
      }
      e.y = y;
    }
  }

  private advanceBurn(dt: number): void {
    if (!this.state.burning) return;
    this.state.burnTimer -= dt;
    if (this.state.burnTimer <= 0) {
      this.state.burning = false;
      this.state.burnTimer = 0;
    }
  }

  private settleEvents(): Effect[] {
    const s = this.state;
    const effects: Effect[] = [];

    const pending = this.queue.splice(0, this.queue.length);
    pending.sort((a, b) => {
      const pa = EVENT_PRIORITY[a.event.kind];
      const pb = EVENT_PRIORITY[b.event.kind];
      return pa !== pb ? pa - pb : a.seq - b.seq;
    });

    const settled = new Set<string>();
    for (const { event } of pending) {
      const key = dedupeKey(event);
      if (key !== null) {
        if (settled.has(key)) continue;
        settled.add(key);
      }

      switch (event.kind) {
        case 'surface':
          this.settleSurface(event.surface, effects);
          break;
        case 'hammer':
          this.settleHammer(event.id, event.direction, effects);
          break;
        case 'fire':
          this.settleFire(event.id, effects);
          break;
        case 'star':
          this.settleStar(event.index, effects);
          break;
        case 'hiddenPath':
          this.addScore(HIDDEN_PATH_SCORE, effects);
          break;
        case 'goal':
          this.settleGoal(event.hiddenPath, effects);
          break;
        case 'fall':
          this.applyDamage('fall', effects);
          effects.push({ type: 'respawn' });
          break;
      }
    }

    return effects;
  }

  private settleSurface(surface: SurfaceType, effects: Effect[]): void {
    if (this.state.surface !== surface) {
      this.state.surface = surface;
      effects.push({ type: 'surface', surface });
    }
  }

  private settleHammer(id: string, direction: [number, number], effects: Effect[]): void {
    if (this.state.gameOver) return;
    const dx = direction[0];
    const dz = direction[1];
    const len = Math.sqrt(dx * dx + 0.5 * 0.5 + dz * dz) || 1;
    effects.push({
      type: 'hammerHit',
      id,
      velocity: [(dx / len) * 12, (0.5 / len) * 8, (dz / len) * 12],
    });
  }

  private settleFire(id: string, effects: Effect[]): void {
    const f = this.state.fires[id];
    // 火焰未激活 / 燃烧无敌窗口内 / 已结束：均不重复扣血
    if (!f || !f.active || this.state.burning || this.state.gameOver) return;
    this.applyDamage('fire', effects);
  }

  private settleStar(index: number, effects: Effect[]): void {
    if (this.state.starsCollected.has(index)) return;
    this.state.starsCollected.add(index);
    this.addScore(STAR_SCORE, effects);
    effects.push({ type: 'star', index, total: this.state.starsCollected.size });

    if (
      this.state.starsCollected.size >= this.starsToUnlock &&
      !this.state.hiddenPathUnlocked
    ) {
      this.state.hiddenPathUnlocked = true;
      this.state.gateOpen = true;
      effects.push({ type: 'unlockHiddenPath' });
    }
  }

  private settleGoal(hiddenPath: boolean, effects: Effect[]): void {
    if (this.state.won) return;
    this.state.won = true;
    this.addScore(hiddenPath ? HIDDEN_GOAL_SCORE : GOAL_SCORE, effects);
    effects.push({ type: 'goal', hiddenPath });
  }

  private applyDamage(cause: 'fire' | 'fall', effects: Effect[]): void {
    const s = this.state;
    if (s.gameOver) return;
    s.lives = Math.max(0, s.lives - 1);
    s.burning = true;
    s.burnTimer = BURN_DURATION;
    effects.push({ type: 'damage', cause, lives: s.lives });
    if (s.lives === 0) {
      s.gameOver = true;
      effects.push({ type: 'gameOver', score: s.score });
    }
  }

  private addScore(points: number, effects: Effect[]): void {
    this.state.score += points;
    effects.push({ type: 'score', points, total: this.state.score });
  }

  snapshot(): StateSnapshot {
    const s = this.state;
    const fires: StateSnapshot['fires'] = {};
    for (const id of Object.keys(s.fires)) {
      fires[id] = { timer: s.fires[id].timer, active: s.fires[id].active };
    }
    const elevators: StateSnapshot['elevators'] = {};
    for (const id of Object.keys(s.elevators)) {
      elevators[id] = { y: s.elevators[id].y, direction: s.elevators[id].direction };
    }
    return {
      time: s.time,
      lives: s.lives,
      score: s.score,
      stars: [...s.starsCollected].sort((a, b) => a - b),
      burning: s.burning,
      surface: s.surface,
      gameOver: s.gameOver,
      won: s.won,
      hiddenPathUnlocked: s.hiddenPathUnlocked,
      gateOpen: s.gateOpen,
      fires,
      elevators,
    };
  }
}
