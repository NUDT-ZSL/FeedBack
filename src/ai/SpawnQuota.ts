/**
 * SpawnQuota - deterministic spawn-quota reasoning per difficulty level.
 *
 * For each difficulty level the three enemy behaviors have a target share
 * (derived from the level's enemy weights). Given the spawn records of the
 * current level and the currently active enemies, this module derives:
 *  - targetRatios:  normalized target share per behavior;
 *  - actualRatios:  share of the spawns recorded since the level started;
 *  - activeRatios:  share among currently active enemies;
 *  - nextType:      the behavior whose spawn best closes the gap between
 *                   actual and target ratios (max deficit, deterministic
 *                   tie-break by TYPE_ORDER).
 *
 * Quota state is per-level: on a difficulty change the tracker is reset
 * with the new level's weights and starts counting from zero, so no
 * unfinished quota from the previous level leaks into the new one. The
 * tracker holds no hidden state beyond the spawn counts, therefore its
 * snapshot is always identical to a full recompute from the raw records
 * (see computeQuotaSnapshot).
 */

import type { EnemyBehavior } from '../configs/enemyTemplates';

export const ENEMY_TYPES: EnemyBehavior[] = ['melee', 'ranged', 'suicide'];

/** Deterministic tie-break order for equal deficits. */
const TYPE_ORDER: EnemyBehavior[] = ['melee', 'ranged', 'suicide'];

export type BehaviorCounts = Record<EnemyBehavior, number>;
export type BehaviorRatios = Record<EnemyBehavior, number>;

export interface QuotaSnapshot {
  level: number;
  targetRatios: BehaviorRatios;
  actualRatios: BehaviorRatios;
  activeRatios: BehaviorRatios;
  spawnedCounts: BehaviorCounts;
  activeCounts: BehaviorCounts;
  nextType: EnemyBehavior;
}

export function zeroCounts(): BehaviorCounts {
  return { melee: 0, ranged: 0, suicide: 0 };
}

/** Normalize raw weights into ratios that sum to 1 (zero weights -> equal). */
export function normalizeWeights(weights: Record<string, number>): BehaviorRatios {
  const total = ENEMY_TYPES.reduce((sum, t) => sum + Math.max(0, weights[t] || 0), 0);
  const ratios = {} as BehaviorRatios;
  for (const t of ENEMY_TYPES) {
    ratios[t] = total > 0 ? Math.max(0, weights[t] || 0) / total : 1 / ENEMY_TYPES.length;
  }
  return ratios;
}

function countsToRatios(counts: BehaviorCounts): BehaviorRatios {
  const total = ENEMY_TYPES.reduce((sum, t) => sum + counts[t], 0);
  const ratios = {} as BehaviorRatios;
  for (const t of ENEMY_TYPES) {
    ratios[t] = total > 0 ? counts[t] / total : 0;
  }
  return ratios;
}

/**
 * Pick the behavior with the largest (target - actual) deficit.
 * With no spawns yet, the largest target share wins. Ties break by
 * TYPE_ORDER so the result is fully deterministic.
 */
export function computeNextSpawnType(
  targetRatios: BehaviorRatios,
  spawnedCounts: BehaviorCounts
): EnemyBehavior {
  const total = ENEMY_TYPES.reduce((sum, t) => sum + spawnedCounts[t], 0);
  let best: EnemyBehavior = TYPE_ORDER[0];
  let bestDeficit = Number.NEGATIVE_INFINITY;
  for (const t of TYPE_ORDER) {
    const actual = total > 0 ? spawnedCounts[t] / total : 0;
    const deficit = targetRatios[t] - actual;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = t;
    }
  }
  return best;
}

/**
 * Pure full recompute of the quota state for a level from raw inputs.
 * `spawnRecords` are the behavior types spawned since the level started,
 * `activeTypes` the behavior types of the currently active enemies.
 */
export function computeQuotaSnapshot(
  level: number,
  weights: Record<string, number>,
  spawnRecords: EnemyBehavior[],
  activeTypes: EnemyBehavior[]
): QuotaSnapshot {
  const targetRatios = normalizeWeights(weights);
  const spawnedCounts = zeroCounts();
  for (const t of spawnRecords) spawnedCounts[t]++;
  const activeCounts = zeroCounts();
  for (const t of activeTypes) activeCounts[t]++;
  return {
    level,
    targetRatios,
    actualRatios: countsToRatios(spawnedCounts),
    activeRatios: countsToRatios(activeCounts),
    spawnedCounts,
    activeCounts,
    nextType: computeNextSpawnType(targetRatios, spawnedCounts)
  };
}

/**
 * Stateful tracker used by the spawner at runtime. Its snapshot is always
 * equal to computeQuotaSnapshot over the same records, because the only
 * state it keeps is the per-level spawn counts.
 */
export class SpawnQuotaTracker {
  private level: number;
  private weights: Record<string, number>;
  private spawnedCounts: BehaviorCounts = zeroCounts();
  private spawnLog: EnemyBehavior[] = [];

  constructor(level: number, weights: Record<string, number>) {
    this.level = level;
    this.weights = { ...weights };
  }

  /**
   * Switch to a new difficulty level. All counters and records from the
   * previous level are discarded; quota reasoning restarts from the new
   * level's weights.
   */
  resetForLevel(level: number, weights: Record<string, number>): void {
    this.level = level;
    this.weights = { ...weights };
    this.spawnedCounts = zeroCounts();
    this.spawnLog = [];
  }

  recordSpawn(type: EnemyBehavior): void {
    this.spawnedCounts[type]++;
    this.spawnLog.push(type);
  }

  /** Behavior that should be spawned next to approach the target ratios. */
  getNextType(): EnemyBehavior {
    return computeNextSpawnType(normalizeWeights(this.weights), this.spawnedCounts);
  }

  getSnapshot(activeTypes: EnemyBehavior[]): QuotaSnapshot {
    return computeQuotaSnapshot(this.level, this.weights, this.spawnLog, activeTypes);
  }

  getLevel(): number {
    return this.level;
  }
}
