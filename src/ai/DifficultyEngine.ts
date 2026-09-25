/**
 * DifficultyEngine - deterministic, replayable difficulty progression.
 *
 * Input: player events (kill / playerHit / healthChange / timeAdvance), each
 * stamped with the game-time (levelTime seconds) at which it occurred.
 * Output: a deterministic level timeline; every change records timestamp,
 * from/to level and the trigger basis (consecutiveKills, healthRatio,
 * killRate, consecutiveFailures).
 *
 * Guarantees:
 *  - Events are sorted by timestamp and merged per distinct timestamp, so
 *    the same input set yields the same timeline regardless of arrival
 *    order or batching. Each timestamp produces AT MOST one level change
 *    of exactly one level (no multi-level jumps within a frame). This
 *    holds across ingest() calls too: a timestamp that was already
 *    evaluated updates metrics but never yields a second level change;
 *    its conditions are re-evaluated at the next distinct timestamp.
 *  - No wall-clock is used; time only advances via timeAdvance events,
 *    monotonically. Regressed/repeated timeAdvance never causes changes.
 *
 * Merge semantics for events sharing one timestamp (order-independent):
 *  kills = count of kill events; hit = any playerHit; health = minimum of
 *  healthChange values; levelTime = maximum of timeAdvance values.
 *
 * Application order inside a merged group (fixed):
 *  1. Health: damage breaks the kill streak; dropping to <=0 from >0
 *     increments consecutiveFailures.
 *  2. Kills: killCount += K; consecutiveKills += K unless the streak was
 *     broken this group (then 0). Any kill resets consecutiveFailures.
 *  3. levelTime advances (monotonic clamp).
 *  4. The group is evaluated exactly once.
 *
 * Evaluation (per group, at most one level change):
 *  - Upgrade first; if it fires, no downgrade is evaluated this group.
 *    a) consecutiveKills >= 5 AND healthRatio >= 0.8, or
 *    b) time advanced AND >= 30s since last change AND levelTime >= 120
 *       AND killRate >= 0.08 AND healthRatio >= 0.5.
 *    On upgrade: level += 1, consecutiveKills = 0.
 *  - Downgrade (only if no upgrade): healthRatio <= 0.3 OR
 *    consecutiveFailures >= 3, or time-based (time advanced AND >= 30s
 *    since last change AND levelTime >= 60 AND killRate < 0.02).
 *    On downgrade: level -= 1, both streak counters reset. Multiple
 *    simultaneous downgrade conditions still drop only one level.
 *  - Bounds: at maxLevel a valid upgrade resets consecutiveKills instead;
 *    at minLevel a valid downgrade resets consecutiveFailures instead.
 */

export type DifficultyEventType = 'kill' | 'playerHit' | 'healthChange' | 'timeAdvance';

export interface DifficultyEvent {
  /** Game time (levelTime seconds) at which the event occurred. */
  time: number;
  type: DifficultyEventType;
  /** For healthChange events. */
  health?: number;
  maxHealth?: number;
}

export interface LevelChangeTrigger {
  consecutiveKills: number;
  healthRatio: number;
  killRate: number;
  consecutiveFailures: number;
  /** Machine readable list of the conditions that fired. */
  reasons: string[];
}

export interface LevelChangeRecord {
  time: number;
  fromLevel: number;
  toLevel: number;
  trigger: LevelChangeTrigger;
}

export interface EngineState {
  currentLevel: number;
  killCount: number;
  consecutiveKills: number;
  consecutiveFailures: number;
  playerHealth: number;
  maxPlayerHealth: number;
  levelTime: number;
}

export interface EngineThresholds {
  consecutiveKillsForLevelUp: number;
  healthThresholdForLevelUp: number;
  healthThresholdForLevelDown: number;
  consecutiveFailuresForLevelDown: number;
  levelTimeThresholdSeconds: number;
  killRateThresholdForLevelUp: number;
  killRateThresholdForLevelDown: number;
  levelTimeDowngradeSeconds: number;
  minSecondsBetweenTimeBasedChanges: number;
  minLevel: number;
  maxLevel: number;
}

export const DEFAULT_THRESHOLDS: EngineThresholds = {
  consecutiveKillsForLevelUp: 5,
  healthThresholdForLevelUp: 0.8,
  healthThresholdForLevelDown: 0.3,
  consecutiveFailuresForLevelDown: 3,
  levelTimeThresholdSeconds: 120,
  killRateThresholdForLevelUp: 0.08,
  killRateThresholdForLevelDown: 0.02,
  levelTimeDowngradeSeconds: 60,
  minSecondsBetweenTimeBasedChanges: 30,
  minLevel: 1,
  maxLevel: 5
};

interface MergedGroup {
  time: number;
  kills: number;
  hit: boolean;
  hasHealth: boolean;
  health: number;
  maxHealth: number | undefined;
  hasTimeAdvance: boolean;
  levelTime: number;
}

export class DifficultyEngine {
  private readonly thresholds: EngineThresholds;
  private state: EngineState;
  private timeline: LevelChangeRecord[] = [];
  private lastLevelChangeTime: number = 0;
  private lastEvaluatedGroupTime: number = Number.NEGATIVE_INFINITY;

  constructor(initialHealth: number = 100, thresholds: EngineThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
    this.state = this.initialState(initialHealth);
  }

  private initialState(health: number): EngineState {
    return {
      currentLevel: this.thresholds.minLevel,
      killCount: 0,
      consecutiveKills: 0,
      consecutiveFailures: 0,
      playerHealth: health,
      maxPlayerHealth: health,
      levelTime: 0
    };
  }

  /**
   * Ingest a batch of events. Events are sorted by timestamp and merged per
   * distinct timestamp, so the resulting timeline is independent of the
   * order and batching in which events arrive.
   * Returns the level changes produced by this batch.
   */
  ingest(events: DifficultyEvent[]): LevelChangeRecord[] {
    if (events.length === 0) return [];
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const groups: MergedGroup[] = [];
    for (const ev of sorted) {
      let g = groups[groups.length - 1];
      if (!g || g.time !== ev.time) {
        g = {
          time: ev.time,
          kills: 0,
          hit: false,
          hasHealth: false,
          health: Number.POSITIVE_INFINITY,
          maxHealth: undefined,
          hasTimeAdvance: false,
          levelTime: Number.NEGATIVE_INFINITY
        };
        groups.push(g);
      }
      switch (ev.type) {
        case 'kill':
          g.kills++;
          break;
        case 'playerHit':
          g.hit = true;
          break;
        case 'healthChange':
          g.hasHealth = true;
          if (ev.health !== undefined && ev.health < g.health) g.health = ev.health;
          if (ev.maxHealth !== undefined) g.maxHealth = ev.maxHealth;
          break;
        case 'timeAdvance':
          g.hasTimeAdvance = true;
          if (ev.time > g.levelTime) g.levelTime = ev.time;
          break;
      }
    }

    const produced: LevelChangeRecord[] = [];
    for (const g of groups) {
      const rec = this.applyGroup(g);
      if (rec) produced.push(rec);
    }
    return produced;
  }

  private applyGroup(g: MergedGroup): LevelChangeRecord | null {
    const s = this.state;

    // 1. Health.
    let damaged = false;
    if (g.hasHealth) {
      if (g.maxHealth !== undefined) s.maxPlayerHealth = g.maxHealth;
      if (g.health < s.playerHealth) damaged = true;
      if (g.health <= 0 && s.playerHealth > 0) s.consecutiveFailures++;
      s.playerHealth = g.health;
    }

    // 2. Kills / hits.
    if (g.kills > 0) {
      s.killCount += g.kills;
      s.consecutiveKills = damaged || g.hit ? 0 : s.consecutiveKills + g.kills;
      s.consecutiveFailures = 0;
    } else if (damaged || g.hit) {
      s.consecutiveKills = 0;
    }

    // 3. Time advance (monotonic: regression or repetition is a no-op).
    let timeAdvanced = false;
    if (g.hasTimeAdvance && g.levelTime > s.levelTime) {
      s.levelTime = g.levelTime;
      timeAdvanced = true;
    }

    // 4. Single evaluation for the whole merged group. A timestamp that
    // was already evaluated by a previous ingest() call never produces a
    // second level change.
    const allowChange = g.time > this.lastEvaluatedGroupTime;
    if (g.time > this.lastEvaluatedGroupTime) {
      this.lastEvaluatedGroupTime = g.time;
    }
    if (!allowChange) return null;
    return this.evaluateGroup(g.time, timeAdvanced);
  }

  private evaluateGroup(time: number, timeAdvanced: boolean): LevelChangeRecord | null {
    const s = this.state;
    const th = this.thresholds;
    const healthRatio = s.maxPlayerHealth > 0 ? s.playerHealth / s.maxPlayerHealth : 0;
    const killRate = s.killCount / Math.max(1, s.levelTime);
    const timeGateOpen =
      timeAdvanced && time - this.lastLevelChangeTime >= th.minSecondsBetweenTimeBasedChanges;

    const streakUp =
      s.consecutiveKills >= th.consecutiveKillsForLevelUp &&
      healthRatio >= th.healthThresholdForLevelUp;
    const timeUp =
      timeGateOpen &&
      s.levelTime >= th.levelTimeThresholdSeconds &&
      killRate >= th.killRateThresholdForLevelUp &&
      healthRatio >= 0.5;

    const snapshot = (): LevelChangeTrigger => ({
      consecutiveKills: s.consecutiveKills,
      healthRatio,
      killRate,
      consecutiveFailures: s.consecutiveFailures,
      reasons: []
    });

    // Upgrade first; an upgrade suppresses any downgrade for this group.
    if (streakUp || timeUp) {
      if (s.currentLevel < th.maxLevel) {
        const trigger = snapshot();
        if (streakUp) {
          trigger.reasons.push(`consecutiveKills>=${th.consecutiveKillsForLevelUp}`);
          trigger.reasons.push(`healthRatio>=${th.healthThresholdForLevelUp}`);
        }
        if (timeUp) {
          trigger.reasons.push(`levelTime>=${th.levelTimeThresholdSeconds}`);
          trigger.reasons.push(`killRate>=${th.killRateThresholdForLevelUp}`);
          trigger.reasons.push('healthRatio>=0.5');
        }
        const rec: LevelChangeRecord = {
          time,
          fromLevel: s.currentLevel,
          toLevel: s.currentLevel + 1,
          trigger
        };
        s.currentLevel++;
        s.consecutiveKills = 0;
        this.lastLevelChangeTime = time;
        this.timeline.push(rec);
        return rec;
      }
      // At maxLevel: reset the streak so it does not stay pinned.
      if (streakUp) s.consecutiveKills = 0;
      return null;
    }

    // Downgrade (only reached when no upgrade fired this group).
    const pressureDown =
      healthRatio <= th.healthThresholdForLevelDown ||
      s.consecutiveFailures >= th.consecutiveFailuresForLevelDown;
    const timeDown =
      timeGateOpen &&
      s.levelTime >= th.levelTimeDowngradeSeconds &&
      killRate < th.killRateThresholdForLevelDown;

    if (pressureDown || timeDown) {
      if (s.currentLevel > th.minLevel) {
        const trigger = snapshot();
        if (healthRatio <= th.healthThresholdForLevelDown) {
          trigger.reasons.push(`healthRatio<=${th.healthThresholdForLevelDown}`);
        }
        if (s.consecutiveFailures >= th.consecutiveFailuresForLevelDown) {
          trigger.reasons.push(`consecutiveFailures>=${th.consecutiveFailuresForLevelDown}`);
        }
        if (timeDown) {
          trigger.reasons.push(`levelTime>=${th.levelTimeDowngradeSeconds}`);
          trigger.reasons.push(`killRate<${th.killRateThresholdForLevelDown}`);
        }
        const rec: LevelChangeRecord = {
          time,
          fromLevel: s.currentLevel,
          toLevel: s.currentLevel - 1,
          trigger
        };
        s.currentLevel--;
        s.consecutiveFailures = 0;
        s.consecutiveKills = 0;
        this.lastLevelChangeTime = time;
        this.timeline.push(rec);
        return rec;
      }
      // At minLevel: reset failure pressure so it does not stay pinned.
      if (s.consecutiveFailures >= th.consecutiveFailuresForLevelDown) {
        s.consecutiveFailures = 0;
      }
      return null;
    }

    return null;
  }

  getTimeline(): LevelChangeRecord[] {
    return this.timeline.map(r => ({
      ...r,
      trigger: { ...r.trigger, reasons: [...r.trigger.reasons] }
    }));
  }

  getState(): EngineState {
    return { ...this.state };
  }

  getCurrentLevel(): number {
    return this.state.currentLevel;
  }

  reset(initialHealth: number = 100): void {
    this.state = this.initialState(initialHealth);
    this.timeline = [];
    this.lastLevelChangeTime = 0;
    this.lastEvaluatedGroupTime = Number.NEGATIVE_INFINITY;
  }
}
