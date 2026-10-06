import type { BeaconConfig, Direction, WaveSpec } from './types.ts';
import { createRng } from './prng.ts';

/** 推演规则常量：全部集中在此，调整口径只改这一处 */
export const TUNING = {
  /** 敌情出现的初始距离（步），向 0 推进 */
  spawnDistance: 100,
  /** 火炬：持续 tick / 冷却 tick，燃烧期间敌军推进速度减半 */
  torchDuration: 150,
  torchCooldown: 200,
  torchSlowFactor: 0.5,
  /** 狼烟：消耗补给、对全部推进中敌军造成的即时杀伤、冷却 */
  smokeCost: 10,
  smokeDamage: 8,
  smokeCooldown: 300,
  /** 战鼓：持续 / 冷却，期间戍卒战力翻倍并恢复疲劳 */
  drumDuration: 100,
  drumCooldown: 200,
  drumPowerFactor: 2,
  drumFatigueRecovery: 0.5,
  /** 派遣冷却 */
  deployCooldown: 100,
  /** 戍卒基础战力（每 tick 对目标敌军造成的杀伤） */
  soldierPower: 1,
  /** 哨位接战半径：敌军进入 post±engageRange 即被该哨位戍卒攻击 */
  engageRange: 5,
  /** 部署后每 tick 疲劳增长；归队后每 tick 恢复 */
  fatiguePerTick: 0.4,
  fatigueRecoveryPerTick: 1,
  /** 疲劳超过该值战力减半 */
  fatigueWeakened: 80,
  /** 每 tick 基础补给消耗 + 每名部署戍卒的额外消耗 */
  supplyBasePerTick: 0.02,
  supplyPerDeployed: 0.03,
  /** 补给耗尽后每 tick 体力流失；体力归零失能 */
  starvationPerTick: 1,
  /** 连续防御成功多少波后难度 +1 */
  wavesPerDifficulty: 3,
  /** 难度每级：生成敌军人数加成 / 速度加成 */
  difficultyCountBonus: 5,
  difficultySpeedBonus: 0.01,
  /** 每波防御得分 */
  scorePerWave: 10,
} as const;

export const DEFAULTS = {
  seed: 1,
  tickMs: 100,
  maxTicks: 6000,
  garrisonSize: 6,
  supplies: 120,
  waveCount: 5,
} as const;

const DIRECTIONS: Direction[] = ['west', 'north', 'south'];

/** 配置缺省波次表时，用 seed 确定性生成 */
export function generateWaves(config: BeaconConfig): WaveSpec[] {
  const rng = createRng(config.seed ?? DEFAULTS.seed);
  const count = config.waveCount ?? DEFAULTS.waveCount;
  const waves: WaveSpec[] = [];
  let at = 100 + Math.floor(rng() * 100);
  for (let i = 0; i < count; i++) {
    waves.push({
      atTick: at,
      direction: DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)],
      count: 5 + Math.floor(rng() * 26),
      speed: 0.03 + rng() * 0.05,
    });
    at += 200 + Math.floor(rng() * 300);
  }
  return waves;
}
