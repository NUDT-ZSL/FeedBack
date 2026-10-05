/**
 * 确定性推演引擎：以固定步长复算 Game.ts 中挂在逐帧 update 上的
 * 波次推进 / 敌人狂暴 / 弹幕形态 / 能量与核弹链路。
 *
 * 每个 tick 内的处理顺序（与 Game.update 的调用顺序对齐）：
 *   1. 敌人移动、狂暴判定、开火、越界逃逸
 *   2. 场上弹幕过期
 *   3. 玩家输出策略（killPolicy）结算伤害与击杀
 *   4. 核弹策略（nukePolicy）判定与清场结算
 *   5. 波次计时、敌人生成、波次推进
 *   6. 记录能量曲线采样点
 *
 * 引擎状态（含 RNG 状态）是纯粹的可序列化对象，snapshot() 可在任意
 * tick 保存现场，供增量重推从最近的检查点恢复继续推演。
 */
import { Rng } from './rng.js';
import {
  BulletPatternType,
  CurvePoint,
  EngineState,
  KillVia,
  SimConfig,
  SimEnemyState,
  SimEvent,
  WaveConfig
} from './types.js';

const PATTERNS: BulletPatternType[] = ['fan', 'spiral', 'grid'];
const PATTERN_BULLET_COUNT: Record<BulletPatternType, number> = {
  fan: 7,
  spiral: 12,
  grid: 5
};

export class Engine {
  readonly config: SimConfig;
  readonly events: SimEvent[] = [];
  readonly curve: CurvePoint[] = [];
  private state: EngineState;
  private rng: Rng;

  constructor(config: SimConfig, snapshot?: EngineState) {
    this.config = config;
    if (snapshot) {
      this.state = structuredClone(snapshot);
      this.rng = new Rng(this.state.rngState);
    } else {
      this.rng = new Rng(config.seed);
      this.state = this.initialState();
    }
  }

  get timeMs(): number {
    return this.state.timeMs;
  }

  get done(): boolean {
    return this.state.done;
  }

  snapshot(): EngineState {
    this.state.rngState = this.rng.state;
    return structuredClone(this.state);
  }

  step(): void {
    if (this.state.done) return;
    const cfg = this.config;
    const s = this.state;
    const dtMs = cfg.tickMs;
    const dt = dtMs / 1000;

    if (s.pendingWaveStart) {
      s.pendingWaveStart = false;
      const waveCfg = this.waveConfig(s.waveIndex);
      this.emit({
        t: s.timeMs,
        type: 'wave-start',
        wave: s.waveIndex,
        enemyCount: waveCfg.enemyCount
      });
    }

    s.timeMs += dtMs;
    const t = s.timeMs;
    s.spiralOffset += dt * 2;

    // 1. 敌人：移动、狂暴、开火、逃逸
    const aliveCount = s.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    for (const e of s.enemies) {
      if (!e.alive) continue;
      e.ageMs += dtMs;
      const ageS = e.ageMs / 1000;
      e.y += cfg.kinds[e.kind].speed * dt;

      if (!e.berserk && aliveCount < cfg.berserkThreshold) {
        e.berserk = true;
        this.emit({ t, type: 'enemy-berserk', enemyId: e.id, wave: e.wave });
      }

      if (e.berserk && t - e.lastShotMs > cfg.fireIntervalMs) {
        e.lastShotMs = t;
        this.fire(e, t, ageS);
      }

      if (e.y > cfg.gameHeight + 40) {
        e.alive = false;
        this.emit({ t, type: 'enemy-escape', enemyId: e.id, wave: e.wave });
      }
    }

    // 2. 弹幕过期（核弹会整批清空，见 nuke()）
    s.bullets = s.bullets.filter(b => b.despawnMs > t);

    // 3. 玩家输出策略
    this.applyKillPolicy(t);

    // 4. 核弹策略
    this.applyNukePolicy(t);

    // 5. 波次：计时、生成、推进
    s.waveTimerMs += dtMs;
    const waveCfg = this.waveConfig(s.waveIndex);
    if (s.waveEnemiesSpawned < waveCfg.enemyCount) {
      s.spawnTimerMs += dtMs;
      if (s.spawnTimerMs >= waveCfg.spawnIntervalMs) {
        this.spawnEnemy(t);
        s.spawnTimerMs = 0;
      }
    }
    const anyAlive = s.enemies.some(e => e.alive);
    if (
      s.waveTimerMs >= waveCfg.durationMs &&
      !anyAlive &&
      s.waveEnemiesSpawned >= waveCfg.enemyCount
    ) {
      this.emit({ t, type: 'wave-end', wave: s.waveIndex });
      if (s.waveIndex >= this.maxWaves()) {
        s.done = true;
        this.emit({ t, type: 'sim-end', reason: 'waves-complete' });
      } else {
        s.waveIndex++;
        s.waveTimerMs = 0;
        s.waveEnemiesSpawned = 0;
        s.spawnTimerMs = 0;
        s.pendingWaveStart = true;
      }
    }

    // 6. 能量曲线采样
    this.curve.push({
      t,
      energy: s.energy,
      alive: s.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0),
      wave: s.waveIndex
    });

    if (!s.done && cfg.maxTimeMs !== undefined && t >= cfg.maxTimeMs) {
      s.done = true;
      this.emit({ t, type: 'sim-end', reason: 'max-time' });
    }
  }

  run(): void {
    while (!this.state.done) this.step();
  }

  private initialState(): EngineState {
    const cfg = this.config;
    return {
      timeMs: 0,
      waveIndex: 1,
      pendingWaveStart: true,
      waveTimerMs: 0,
      waveEnemiesSpawned: 0,
      spawnTimerMs: 0,
      enemies: [],
      energy: 0,
      score: 0,
      killCount: 0,
      nukeReady: false,
      spiralOffset: 0,
      rngState: cfg.seed >>> 0,
      nextKillMs: cfg.killPolicy.type === 'interval' ? cfg.killPolicy.everyMs : 0,
      explicitKillIdx: 0,
      nukeTimesIdx: 0,
      bullets: [],
      done: false
    };
  }

  private maxWaves(): number {
    return this.config.maxWaves ?? this.config.waves.length;
  }

  /** 显式配置之外的波次按 Game.ts 的递增公式生成 */
  waveConfig(wave: number): WaveConfig {
    const cfg = this.config;
    if (wave <= cfg.waves.length) return cfg.waves[wave - 1];
    return {
      durationMs: 30000,
      enemyCount: 15 + (wave - 1) * 5,
      spawnIntervalMs: 1500,
      armorChance: 0.3,
      bulletColor: '#ee82ee'
    };
  }

  private spawnEnemy(t: number): void {
    const cfg = this.config;
    const s = this.state;
    const waveCfg = this.waveConfig(s.waveIndex);
    const x = 40 + this.rng.next() * (cfg.gameWidth - 80);
    const isArmor = s.waveIndex >= cfg.armorFromWave && this.rng.next() < waveCfg.armorChance;
    const kind = isArmor ? 'armor' : 'normal';
    s.waveEnemiesSpawned++;
    const enemy: SimEnemyState = {
      id: `w${s.waveIndex}-e${s.waveEnemiesSpawned}`,
      wave: s.waveIndex,
      kind,
      hp: cfg.kinds[kind].hp,
      baseX: x,
      y: -30,
      ageMs: 0,
      berserk: false,
      lastShotMs: 0,
      alive: true,
      spawnMs: t
    };
    s.enemies.push(enemy);
    this.emit({ t, type: 'enemy-spawn', enemyId: enemy.id, wave: enemy.wave, kind, x });
  }

  private fire(e: SimEnemyState, t: number, ageS: number): void {
    const cfg = this.config;
    const pattern = PATTERNS[Math.floor(this.rng.next() * PATTERNS.length)];
    const count = PATTERN_BULLET_COUNT[pattern];
    const x = e.baseX + Math.sin(ageS * 3 + e.baseX * 0.01) * 50;
    const y = e.y + 10;
    this.state.bullets.push({ despawnMs: t + cfg.bulletLifetimeMs, count });
    this.emit({
      t,
      type: 'enemy-fire',
      enemyId: e.id,
      wave: e.wave,
      berserk: e.berserk,
      pattern,
      bulletCount: count,
      x,
      y,
      color: this.waveConfig(e.wave).bulletColor
    });
  }

  private applyKillPolicy(t: number): void {
    const cfg = this.config;
    const s = this.state;
    const policy = cfg.killPolicy;

    if (policy.type === 'interval') {
      while (s.nextKillMs <= t) {
        s.nextKillMs += policy.everyMs;
        const target = s.enemies.find(e => e.alive);
        if (target) this.damage(target, 1, t, 'player');
      }
    } else if (policy.type === 'explicit') {
      const kills = [...policy.kills].sort((a, b) => a.timeMs - b.timeMs);
      while (s.explicitKillIdx < kills.length && kills[s.explicitKillIdx].timeMs <= t) {
        const k = kills[s.explicitKillIdx++];
        const target = s.enemies.find(e => e.id === k.enemyId);
        if (target && target.alive) this.damage(target, k.damage ?? 1, t, 'player');
      }
    }
  }

  private damage(e: SimEnemyState, amount: number, t: number, via: KillVia): void {
    if (!e.alive) return;
    e.hp -= amount;
    if (e.hp <= 0) this.kill(e, t, via);
  }

  private kill(e: SimEnemyState, t: number, via: KillVia): void {
    const cfg = this.config;
    const s = this.state;
    e.alive = false;
    const kindCfg = cfg.kinds[e.kind];
    s.score += kindCfg.score;
    s.killCount++;
    this.emit({
      t,
      type: 'enemy-death',
      enemyId: e.id,
      wave: e.wave,
      kind: e.kind,
      via,
      scoreGained: kindCfg.score,
      scoreAfter: s.score
    });
    const before = s.energy;
    s.energy = Math.min(s.energy + kindCfg.energy, cfg.maxEnergy);
    this.emit({
      t,
      type: 'energy',
      delta: s.energy - before,
      source: { type: 'kill', enemyId: e.id, via },
      energyAfter: s.energy
    });
    this.updateNukeReady(t);
  }

  private applyNukePolicy(t: number): void {
    const cfg = this.config;
    const s = this.state;
    const policy = cfg.nukePolicy;

    if (policy.type === 'auto') {
      if (s.energy >= cfg.maxEnergy) this.nuke(t);
    } else if (policy.type === 'at') {
      while (s.nukeTimesIdx < policy.timesMs.length && t >= policy.timesMs[s.nukeTimesIdx]) {
        s.nukeTimesIdx++;
        if (s.energy >= cfg.maxEnergy) this.nuke(t);
      }
    }
  }

  private nuke(t: number): void {
    const cfg = this.config;
    const s = this.state;
    const energyBefore = s.energy;

    s.energy = 0;
    this.emit({
      t,
      type: 'energy',
      delta: -energyBefore,
      source: { type: 'nuke-reset' },
      energyAfter: 0
    });

    const cleared = s.enemies.filter(e => e.alive);
    const scoreByEnemy: Record<string, number> = {};
    const scoreBefore = s.score;
    for (const e of cleared) {
      scoreByEnemy[e.id] = cfg.kinds[e.kind].score;
      this.kill(e, t, 'nuke');
    }

    const bulletsCleared = s.bullets.reduce((n, b) => n + b.count, 0);
    s.bullets = [];

    this.emit({
      t,
      type: 'nuke',
      clearedEnemyIds: cleared.map(e => e.id),
      scoreByEnemy,
      scoreGained: s.score - scoreBefore,
      energyBefore,
      energyAfter: s.energy,
      bulletsCleared
    });
    this.updateNukeReady(t);
  }

  private updateNukeReady(t: number): void {
    const s = this.state;
    const ready = s.energy >= this.config.maxEnergy;
    if (ready && !s.nukeReady) {
      s.nukeReady = true;
      this.emit({ t, type: 'nuke-ready' });
    } else if (!ready && s.nukeReady) {
      s.nukeReady = false;
    }
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
  }
}
