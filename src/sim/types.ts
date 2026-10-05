/**
 * 离线推演模块的输入配置与输出事件类型。
 *
 * 该模块不依赖 Phaser / DOM，可在 Node 下以固定步长复算弹幕风暴的
 * 波次推进、敌人行为、弹幕形态切换、能量积累与爆发（核弹）链路。
 */

export type BulletPatternType = 'fan' | 'spiral' | 'grid';
export type EnemyKind = 'normal' | 'armor';
export type KillVia = 'player' | 'nuke';

export interface EnemyKindConfig {
  hp: number;
  speed: number;
  score: number;
  energy: number;
}

export interface WaveConfig {
  /** 波次最短持续时长（毫秒），达到后且场上无存活敌人才进入下一波 */
  durationMs: number;
  /** 本波敌人数 */
  enemyCount: number;
  /** 敌人出生间隔（毫秒） */
  spawnIntervalMs: number;
  /** 装甲敌人生成概率（还会受全局 armorFromWave 限制） */
  armorChance: number;
  /** 本波弹幕颜色（仅记录，便于追溯） */
  bulletColor: string;
}

export type KillPolicy =
  | { type: 'none' }
  | { type: 'interval'; everyMs: number }
  | {
      type: 'explicit';
      /** 对指定敌人在指定时刻造成 damage 点伤害（默认 1），用于复现玩家输出 */
      kills: { timeMs: number; enemyId: string; damage?: number }[];
    };

export type NukePolicy =
  | { type: 'never' }
  | { type: 'auto' }
  | { type: 'at'; timesMs: number[] };

export interface SimConfig {
  seed: number;
  tickMs: number;
  /** 实际推演的波次数；超过 waves 显式配置后按游戏公式自动生成 */
  maxWaves?: number;
  maxTimeMs?: number;
  gameWidth: number;
  gameHeight: number;
  maxEnergy: number;
  /** 存活敌人少于该值时全部进入狂暴 */
  berserkThreshold: number;
  /** 狂暴敌人发射间隔（毫秒） */
  fireIntervalMs: number;
  bulletSpeed: number;
  /** 从第几波开始才可能出现装甲敌人（对应 Game.ts 的 currentWave >= 2） */
  armorFromWave: number;
  /** 弹幕在场上最长存在时长（毫秒），用于估算核弹清弹幕数量 */
  bulletLifetimeMs: number;
  kinds: { normal: EnemyKindConfig; armor: EnemyKindConfig };
  waves: WaveConfig[];
  killPolicy: KillPolicy;
  nukePolicy: NukePolicy;
}

export type EnergySource =
  | { type: 'kill'; enemyId: string; via: KillVia }
  | { type: 'nuke-reset' };

export type SimEvent =
  | { t: number; type: 'wave-start'; wave: number; enemyCount: number }
  | { t: number; type: 'wave-end'; wave: number }
  | { t: number; type: 'enemy-spawn'; enemyId: string; wave: number; kind: EnemyKind; x: number }
  | { t: number; type: 'enemy-berserk'; enemyId: string; wave: number }
  | {
      t: number;
      type: 'enemy-fire';
      enemyId: string;
      wave: number;
      berserk: boolean;
      pattern: BulletPatternType;
      bulletCount: number;
      x: number;
      y: number;
      color: string;
    }
  | { t: number; type: 'enemy-escape'; enemyId: string; wave: number }
  | {
      t: number;
      type: 'enemy-death';
      enemyId: string;
      wave: number;
      kind: EnemyKind;
      via: KillVia;
      scoreGained: number;
      scoreAfter: number;
    }
  | { t: number; type: 'energy'; delta: number; source: EnergySource; energyAfter: number }
  | { t: number; type: 'nuke-ready' }
  | {
      t: number;
      type: 'nuke';
      clearedEnemyIds: string[];
      scoreByEnemy: Record<string, number>;
      scoreGained: number;
      energyBefore: number;
      energyAfter: number;
      bulletsCleared: number;
    }
  | { t: number; type: 'sim-end'; reason: 'waves-complete' | 'max-time' };

export interface SimEnemyState {
  id: string;
  wave: number;
  kind: EnemyKind;
  hp: number;
  baseX: number;
  y: number;
  ageMs: number;
  berserk: boolean;
  lastShotMs: number;
  alive: boolean;
  spawnMs: number;
}

export interface EngineState {
  timeMs: number;
  waveIndex: number;
  /** 当前波次的 wave-start 事件是否尚未发射（恢复检查点时按新配置补发） */
  pendingWaveStart: boolean;
  waveTimerMs: number;
  waveEnemiesSpawned: number;
  spawnTimerMs: number;
  enemies: SimEnemyState[];
  energy: number;
  score: number;
  killCount: number;
  nukeReady: boolean;
  spiralOffset: number;
  rngState: number;
  nextKillMs: number;
  explicitKillIdx: number;
  nukeTimesIdx: number;
  bullets: { despawnMs: number; count: number }[];
  done: boolean;
}

export interface CurvePoint {
  t: number;
  energy: number;
  alive: number;
  wave: number;
}

export interface WaveSummary {
  wave: number;
  startMs: number;
  endMs: number | null;
  spawned: number;
  killedByPlayer: number;
  killedByNuke: number;
  escaped: number;
  berserkCount: number;
  scoreGained: number;
  energyGained: number;
  firesByPattern: Record<BulletPatternType, number>;
}

export interface NukeSummary {
  t: number;
  energyBefore: number;
  clearedEnemyIds: string[];
  scoreByEnemy: Record<string, number>;
  scoreGained: number;
  energyAfter: number;
  bulletsCleared: number;
}

export interface SimResult {
  meta: {
    seed: number;
    tickMs: number;
    durationMs: number;
    waves: number;
    eventCount: number;
    configHash: string;
  };
  totals: {
    score: number;
    kills: number;
    escaped: number;
    nukeCount: number;
    maxEnergyObserved: number;
    finalEnergy: number;
    firesByPattern: Record<BulletPatternType, number>;
  };
  waves: WaveSummary[];
  nukes: NukeSummary[];
  energyLedger: { t: number; delta: number; source: EnergySource; energyAfter: number }[];
  energyCurve: CurvePoint[];
  events: SimEvent[];
}
