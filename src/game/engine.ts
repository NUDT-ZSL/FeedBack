/**
 * 推演引擎（内部实现，不对外暴露）。
 *
 * 确定性保证：
 *  - 只以整数 tick 计步，不读取任何真实时钟；
 *  - 所有遍历均按固定顺序（敌军按 id、戍卒按 id、波次按配置顺序）；
 *  - 随机数仅来自带种子的 mulberry32，且只在生成缺省波次表时消耗；
 *  - 同一 tick 内处理顺序固定：指令 -> 波次生成 -> 敌军推进 -> 交战
 *    -> 抵达判定 -> 补给/疲劳 -> 胜负判定。
 */
import { DEFAULTS, TUNING, generateWaves } from './defaults.ts';
import type {
  BeaconConfig,
  Command,
  EnemyState,
  GameStatus,
  Rejection,
  RejectReason,
  SimEvent,
  Snapshot,
  SoldierState,
  ThreatLevel,
  WaveSpec,
} from './types.ts';

interface InternalSoldier extends SoldierState {
  returnUntil: number;
}

interface State {
  tick: number;
  status: GameStatus;
  verdictReason: string | null;
  supplies: number;
  score: number;
  repelled: number;
  consecutiveWins: number;
  difficulty: number;
  soldiers: InternalSoldier[];
  enemies: EnemyState[];
  torchUntil: number;
  smokeUntil: number;
  drumUntil: number;
  cooldownUntil: { torch: number; smoke: number; drum: number; deploy: number };
  exhaustionNotified: boolean;
  wavesSpawned: number;
}

const REJECT_MESSAGES: Record<RejectReason, string> = {
  'game-over': '对局已结束，指令不再受理',
  cooldown: '操作尚在冷却中',
  'already-active': '对应烽烟信号已在生效',
  'insufficient-supplies': '补给不足，无法执行',
  'unknown-soldier': '目标戍卒不存在',
  'soldier-unavailable': '目标戍卒当前不可调度（已部署/归队中/失能）',
  'soldier-not-deployed': '目标戍卒未在哨位，无法召回',
  'invalid-post': '哨位超出可部署范围',
  'unknown-enemy': '目标敌情不存在或已失效',
  'invalid-command': '无法识别的指令',
};

function threatOf(count: number): ThreatLevel {
  if (count >= 20) return 'high';
  if (count >= 10) return 'medium';
  return 'low';
}

export class Engine {
  private state: State;
  private waves: WaveSpec[];
  /** 指令生效时产生的事件，并入下一次 step 的快照 */
  private pendingEvents: SimEvent[] = [];
  readonly tickMs: number;
  readonly maxTicks: number;

  constructor(config: BeaconConfig = {}) {
    this.tickMs = config.tickMs ?? DEFAULTS.tickMs;
    this.maxTicks = config.maxTicks ?? DEFAULTS.maxTicks;
    this.waves = (config.waves ?? generateWaves(config)).slice().sort((a, b) => a.atTick - b.atTick);
    const garrison = config.garrisonSize ?? DEFAULTS.garrisonSize;
    this.state = {
      tick: 0,
      status: 'playing',
      verdictReason: null,
      supplies: config.supplies ?? DEFAULTS.supplies,
      score: 0,
      repelled: 0,
      consecutiveWins: 0,
      difficulty: 0,
      soldiers: Array.from({ length: garrison }, (_, i) => ({
        id: `soldier-${i + 1}`,
        status: 'idle' as const,
        post: null,
        fatigue: 0,
        stamina: 100,
        returnUntil: 0,
      })),
      enemies: [],
      torchUntil: 0,
      smokeUntil: 0,
      drumUntil: 0,
      cooldownUntil: { torch: 0, smoke: 0, drum: 0, deploy: 0 },
      exhaustionNotified: false,
      wavesSpawned: 0,
    };
  }

  get tick(): number {
    return this.state.tick;
  }

  get isOver(): boolean {
    return this.state.status !== 'playing';
  }

  /** 在当前 tick 按序应用一批指令；被拒绝的指令不改变状态、不影响后续指令 */
  submit(commands: Command[]): Rejection[] {
    const rejections: Rejection[] = [];
    commands.forEach((command, index) => {
      const reason = this.apply(command);
      if (reason) {
        rejections.push({
          tick: this.state.tick,
          index,
          command,
          reason,
          message: REJECT_MESSAGES[reason],
        });
      }
    });
    return rejections;
  }

  /** 推进一个 tick，返回推进后的完整快照；对局结束后为幂等空操作 */
  step(): Snapshot {
    const s = this.state;
    if (s.status !== 'playing') return this.snapshot([]);
    s.tick += 1;
    const events: SimEvent[] = this.pendingEvents;
    this.pendingEvents = [];

    this.spawnWaves(events);
    this.moveEnemies();
    this.resolveCombat(events);
    this.resolveBreaches(events);
    if (s.status === 'playing') {
      this.upkeep(events);
      this.checkOutcome(events);
    }
    return this.snapshot(events);
  }

  snapshot(events: SimEvent[] = []): Snapshot {
    const s = this.state;
    const remaining = (until: number) => Math.max(0, until - s.tick);
    return {
      tick: s.tick,
      status: s.status,
      verdictReason: s.verdictReason,
      supplies: Math.round(s.supplies * 100) / 100,
      score: s.score,
      repelled: s.repelled,
      consecutiveWins: s.consecutiveWins,
      difficulty: s.difficulty,
      enemies: s.enemies.map((e) => ({ ...e })),
      soldiers: s.soldiers.map(({ returnUntil, ...rest }) => ({ ...rest })),
      effects: {
        torch: remaining(s.torchUntil),
        smoke: remaining(s.smokeUntil),
        drum: remaining(s.drumUntil),
      },
      cooldowns: {
        torch: remaining(s.cooldownUntil.torch),
        smoke: remaining(s.cooldownUntil.smoke),
        drum: remaining(s.cooldownUntil.drum),
        deploy: remaining(s.cooldownUntil.deploy),
      },
      events,
    };
  }

  // ---- 指令处理 ----

  private apply(command: Command): RejectReason | null {
    const s = this.state;
    if (s.status !== 'playing') return 'game-over';
    switch (command.type) {
      case 'noop':
        return null;
      case 'light-torch': {
        if (s.cooldownUntil.torch > s.tick) return 'cooldown';
        if (s.torchUntil > s.tick) return 'already-active';
        s.torchUntil = s.tick + TUNING.torchDuration;
        s.cooldownUntil.torch = s.tick + TUNING.torchCooldown;
        this.pendingEvents.push({ kind: 'torch-lit', until: s.torchUntil });
        return null;
      }
      case 'raise-smoke': {
        if (s.cooldownUntil.smoke > s.tick) return 'cooldown';
        if (s.supplies < TUNING.smokeCost) return 'insufficient-supplies';
        s.supplies -= TUNING.smokeCost;
        s.smokeUntil = s.tick + TUNING.torchDuration;
        s.cooldownUntil.smoke = s.tick + TUNING.smokeCooldown;
        this.pendingEvents.push({ kind: 'smoke-raised', cost: TUNING.smokeCost });
        for (const enemy of this.advancingEnemies()) {
          this.damageEnemy(enemy, TUNING.smokeDamage, this.pendingEvents);
        }
        return null;
      }
      case 'beat-drum': {
        if (s.cooldownUntil.drum > s.tick) return 'cooldown';
        s.drumUntil = s.tick + TUNING.drumDuration;
        s.cooldownUntil.drum = s.tick + TUNING.drumCooldown;
        this.pendingEvents.push({ kind: 'drum-beaten', until: s.drumUntil });
        return null;
      }
      case 'deploy-soldier': {
        if (s.cooldownUntil.deploy > s.tick) return 'cooldown';
        const soldier = s.soldiers.find((it) => it.id === command.soldierId);
        if (!soldier) return 'unknown-soldier';
        if (soldier.status !== 'idle') return 'soldier-unavailable';
        if (!Number.isFinite(command.post) || command.post < 0 || command.post > TUNING.spawnDistance) {
          return 'invalid-post';
        }
        soldier.status = 'deployed';
        soldier.post = command.post;
        s.cooldownUntil.deploy = s.tick + TUNING.deployCooldown;
        this.pendingEvents.push({ kind: 'soldier-deployed', soldierId: soldier.id, post: soldier.post ?? 0 });
        return null;
      }
      case 'recall-soldier': {
        const soldier = s.soldiers.find((it) => it.id === command.soldierId);
        if (!soldier) return 'unknown-soldier';
        if (soldier.status !== 'deployed') return 'soldier-not-deployed';
        soldier.status = 'returning';
        soldier.post = null;
        soldier.returnUntil = s.tick + 50;
        this.pendingEvents.push({ kind: 'soldier-recalled', soldierId: soldier.id });
        return null;
      }
      case 'mark-threat': {
        const enemy = s.enemies.find((it) => it.id === command.enemyId);
        if (!enemy || enemy.phase !== 'advancing') return 'unknown-enemy';
        enemy.marked = command.level;
        return null;
      }
      default:
        return 'invalid-command';
    }
  }

  // ---- 世界推进 ----

  private advancingEnemies(): EnemyState[] {
    return this.state.enemies
      .filter((e) => e.phase === 'advancing')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private spawnWaves(events: SimEvent[]): void {
    const s = this.state;
    for (let i = s.wavesSpawned; i < this.waves.length; i++) {
      const wave = this.waves[i];
      if (wave.atTick > s.tick) break;
      const count = wave.count + s.difficulty * TUNING.difficultyCountBonus;
      const speed = wave.speed + s.difficulty * TUNING.difficultySpeedBonus;
      const enemy: EnemyState = {
        id: `enemy-${i + 1}`,
        wave: i + 1,
        direction: wave.direction,
        count,
        initialCount: count,
        distance: TUNING.spawnDistance,
        speed,
        threat: threatOf(count),
        marked: null,
        phase: 'advancing',
      };
      s.enemies.push(enemy);
      s.wavesSpawned = i + 1;
      events.push({ kind: 'wave-spawned', enemyId: enemy.id, direction: enemy.direction, count });
    }
  }

  private moveEnemies(): void {
    const s = this.state;
    const slowed = s.torchUntil > s.tick;
    for (const enemy of this.advancingEnemies()) {
      const speed = slowed ? enemy.speed * TUNING.torchSlowFactor : enemy.speed;
      enemy.distance = Math.round((enemy.distance - speed) * 1000) / 1000;
    }
  }

  private resolveCombat(events: SimEvent[]): void {
    const s = this.state;
    const drumActive = s.drumUntil > s.tick;
    const starving = s.supplies <= 0;
    const soldiers = s.soldiers
      .filter((it) => it.status === 'deployed' && it.stamina > 0)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const soldier of soldiers) {
      const post = soldier.post ?? 0;
      const targets = this.advancingEnemies().filter(
        (e) => e.distance <= post + TUNING.engageRange,
      );
      if (targets.length === 0) continue;
      // 优先拦截最接近烽燧（距离最小）的敌军，并列时按 id 保证确定顺序
      targets.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1));
      let power = TUNING.soldierPower;
      if (drumActive) power *= TUNING.drumPowerFactor;
      if (soldier.fatigue >= TUNING.fatigueWeakened) power *= 0.5;
      if (starving) power *= 0.5;
      this.damageEnemy(targets[0], power, events);
    }
  }

  private damageEnemy(enemy: EnemyState, damage: number, events: SimEvent[]): void {
    const s = this.state;
    if (enemy.phase !== 'advancing') return;
    enemy.count = Math.round((enemy.count - damage) * 1000) / 1000;
    if (enemy.count > 0) return;
    enemy.count = 0;
    enemy.phase = 'repelled';
    s.repelled += 1;
    s.score += TUNING.scorePerWave;
    s.consecutiveWins += 1;
    events.push({ kind: 'enemy-repelled', enemyId: enemy.id, wave: enemy.wave, score: s.score });
    if (s.consecutiveWins % TUNING.wavesPerDifficulty === 0) {
      s.difficulty += 1;
      events.push({ kind: 'difficulty-up', difficulty: s.difficulty });
    }
  }

  private resolveBreaches(events: SimEvent[]): void {
    const s = this.state;
    const breached = this.advancingEnemies().filter((e) => e.distance <= 0);
    if (breached.length === 0) return;
    for (const enemy of breached) {
      enemy.phase = 'breached';
      events.push({ kind: 'enemy-breached', enemyId: enemy.id, direction: enemy.direction, count: enemy.count });
    }
    s.status = 'lost';
    const dirs = breached.map((e) => e.direction).join('/');
    s.verdictReason = `敌兵自${dirs}方向抵达烽燧（共${breached.length}股），烽燧失守`;
    events.push({ kind: 'tower-fallen', directions: dirs, groups: breached.length });
  }

  private upkeep(events: SimEvent[]): void {
    const s = this.state;
    const deployed = s.soldiers.filter((it) => it.status === 'deployed').length;
    s.supplies = Math.max(
      0,
      s.supplies - TUNING.supplyBasePerTick - deployed * TUNING.supplyPerDeployed,
    );
    if (s.supplies <= 0 && !s.exhaustionNotified) {
      s.exhaustionNotified = true;
      events.push({ kind: 'supplies-exhausted' });
    }
    const starving = s.supplies <= 0;
    const drumActive = s.drumUntil > s.tick;
    for (const soldier of s.soldiers) {
      if (soldier.status === 'returning' && soldier.returnUntil <= s.tick) {
        soldier.status = 'idle';
      }
      if (soldier.status === 'deployed') {
        soldier.fatigue = Math.min(100, soldier.fatigue + TUNING.fatiguePerTick);
        if (drumActive) soldier.fatigue = Math.max(0, soldier.fatigue - TUNING.drumFatigueRecovery);
      } else {
        soldier.fatigue = Math.max(0, soldier.fatigue - TUNING.fatigueRecoveryPerTick);
      }
      if (starving && soldier.status !== 'incapacitated') {
        soldier.stamina = Math.max(0, soldier.stamina - TUNING.starvationPerTick);
        if (soldier.stamina <= 0) {
          soldier.status = 'incapacitated';
          soldier.post = null;
          events.push({ kind: 'soldier-incapacitated', soldierId: soldier.id });
        }
      }
    }
  }

  private checkOutcome(events: SimEvent[]): void {
    const s = this.state;
    const allSpawned = s.wavesSpawned >= this.waves.length;
    const anyAdvancing = s.enemies.some((e) => e.phase === 'advancing');
    if (allSpawned && !anyAdvancing) {
      s.status = 'won';
      s.verdictReason = `全部${this.waves.length}波敌情均被击退，烽燧无恙`;
      events.push({ kind: 'victory', score: s.score });
      return;
    }
    if (s.tick >= this.maxTicks) {
      s.status = 'lost';
      s.verdictReason = '推演时限已至，仍有敌情未肃清';
    }
  }
}
