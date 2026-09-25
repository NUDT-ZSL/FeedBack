// Deterministic spawn quota planning, driven by the difficulty level.
//
// For each level the three enemy types have target ratios (derived from the
// level weights). The planner tracks spawn records since the last level
// change and derives, from those records plus the currently active enemies:
//   - the target ratio per type at the current level,
//   - the actual ratio per type (from active enemies),
//   - which type should spawn next to move the actual mix towards the target.
//
// When the difficulty level changes, the quota baseline is reset: planning
// restarts from scratch at the new level instead of carrying over the old
// level's unfulfilled quota.

import { EnemyBehavior } from '../configs/enemyTemplates';

export const ENEMY_TYPES: EnemyBehavior[] = ['melee', 'ranged', 'suicide'];

export type TypeCounts = Record<EnemyBehavior, number>;

const zeroCounts = (): TypeCounts => ({ melee: 0, ranged: 0, suicide: 0 });

export function computeEnemyWeights(level: number): TypeCounts {
  const melee = Math.max(30, 60 - level * 5);
  const suicide = Math.min(40, 10 + level * 6);
  const ranged = Math.max(10, 100 - melee - suicide);
  return { melee, ranged, suicide };
}

export function computeSpawnInterval(level: number): number {
  return Math.min(2000, Math.max(500, 2000 - (level - 1) * 375));
}

export interface QuotaSnapshot {
  level: number;
  targetRatios: TypeCounts;
  actualRatios: TypeCounts;
  spawnedCounts: TypeCounts;
  activeCounts: TypeCounts;
  nextType: EnemyBehavior;
}

export class SpawnQuotaPlanner {
  private level: number;
  private spawned: TypeCounts = zeroCounts();

  constructor(level: number) {
    this.level = level;
  }

  getLevel(): number {
    return this.level;
  }

  /**
   * Switch to a new difficulty level. Spawn records are reset so the quota
   * is recomputed from scratch under the new level's target ratios.
   */
  setLevel(level: number): void {
    if (level === this.level) return;
    this.level = level;
    this.spawned = zeroCounts();
  }

  recordSpawn(type: EnemyBehavior): void {
    this.spawned[type]++;
  }

  targetRatios(): TypeCounts {
    const w = computeEnemyWeights(this.level);
    const total = w.melee + w.ranged + w.suicide;
    return {
      melee: w.melee / total,
      ranged: w.ranged / total,
      suicide: w.suicide / total
    };
  }

  /**
   * The type whose spawn is most overdue relative to the target mix.
   * Deterministic: ties break by the fixed ENEMY_TYPES order.
   */
  nextType(): EnemyBehavior {
    const target = this.targetRatios();
    const total = ENEMY_TYPES.reduce((sum, t) => sum + this.spawned[t], 0);
    let best: EnemyBehavior = ENEMY_TYPES[0];
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (const type of ENEMY_TYPES) {
      const deficit = target[type] * (total + 1) - this.spawned[type];
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = type;
      }
    }
    return best;
  }

  /** Derives the full quota view from spawn records and active enemies. */
  snapshot(activeCounts: Partial<TypeCounts>): QuotaSnapshot {
    const active = { ...zeroCounts(), ...activeCounts };
    const activeTotal = ENEMY_TYPES.reduce((sum, t) => sum + active[t], 0);
    const actualRatios = zeroCounts();
    for (const type of ENEMY_TYPES) {
      actualRatios[type] = activeTotal > 0 ? active[type] / activeTotal : 0;
    }
    return {
      level: this.level,
      targetRatios: this.targetRatios(),
      actualRatios,
      spawnedCounts: { ...this.spawned },
      activeCounts: active,
      nextType: this.nextType()
    };
  }
}
