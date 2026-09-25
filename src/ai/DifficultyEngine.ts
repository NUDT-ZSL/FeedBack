// Deterministic, replayable difficulty progression core.
//
// This module is intentionally pure: no Phaser, no Date.now(), no Math.random().
// All time comes from the events themselves, so a given event sequence always
// produces the same level timeline regardless of event arrival order.
//
// Semantics:
// - Events are sorted by (time, type priority, payload) before being applied,
//   so arrival order never affects the result.
// - All events sharing one timestamp are applied first, then difficulty is
//   evaluated exactly once for that timestamp: at most one level change per
//   timestamp, never multiple level jumps in one frame.
// - Within a timestamp the canonical application order is:
//   timeAdvance -> healthChange (ascending health) -> playerHit -> kill.
// - levelTime is monotonic: timeAdvance values that do not move time forward
//   (regression or duplicate) are dropped and never trigger an evaluation.
// - If both upgrade and downgrade conditions hold at one timestamp, the
//   upgrade wins and the downgrade is not evaluated at that timestamp.
// - A downgrade always moves exactly one level, even when both the
//   consecutive-failures threshold and the low-health threshold are met.
// - At the level ceiling, a met upgrade condition resets consecutiveKills;
//   at the level floor, a met downgrade condition resets consecutiveKills
//   and consecutiveFailures. No record is emitted in either case.

export type DifficultyEventType = 'kill' | 'playerHit' | 'healthChange' | 'timeAdvance';

export interface DifficultyEvent {
  time: number;
  type: DifficultyEventType;
  /** healthChange payload */
  health?: number;
  maxHealth?: number;
  /** timeAdvance payload: absolute level time in seconds */
  levelTime?: number;
}

export interface TriggerBasis {
  consecutiveKills?: number;
  healthRatio?: number;
  killRate?: number;
  consecutiveFailures?: number;
}

export interface LevelChangeRecord {
  time: number;
  fromLevel: number;
  toLevel: number;
  direction: 'up' | 'down';
  triggers: TriggerBasis;
}

export interface DifficultyEngineState {
  currentLevel: number;
  killCount: number;
  consecutiveKills: number;
  consecutiveFailures: number;
  playerHealth: number;
  maxPlayerHealth: number;
  levelTime: number;
}

export interface DifficultyTuning {
  minLevel: number;
  maxLevel: number;
  consecutiveKillsForLevelUp: number;
  healthThresholdForLevelUp: number;
  healthThresholdForLevelDown: number;
  consecutiveFailuresForLevelDown: number;
  levelTimeThresholdSeconds: number;
  killRateThreshold: number;
  healthRatioForTimedLevelUp: number;
  minSecondsBetweenLevelUps: number;
  lowKillRateThreshold: number;
  lowKillRateMinLevelTime: number;
}

export const DEFAULT_TUNING: DifficultyTuning = {
  minLevel: 1,
  maxLevel: 5,
  consecutiveKillsForLevelUp: 5,
  healthThresholdForLevelUp: 0.8,
  healthThresholdForLevelDown: 0.3,
  consecutiveFailuresForLevelDown: 3,
  levelTimeThresholdSeconds: 120,
  killRateThreshold: 0.08,
  healthRatioForTimedLevelUp: 0.5,
  minSecondsBetweenLevelUps: 30,
  lowKillRateThreshold: 0.02,
  lowKillRateMinLevelTime: 60
};

const EVENT_PRIORITY: Record<DifficultyEventType, number> = {
  timeAdvance: 0,
  healthChange: 1,
  playerHit: 2,
  kill: 3
};

function compareEvents(a: DifficultyEvent, b: DifficultyEvent): number {
  if (a.time !== b.time) return a.time - b.time;
  const p = EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type];
  if (p !== 0) return p;
  if (a.type === 'healthChange' && b.type === 'healthChange') {
    return (a.health ?? 0) - (b.health ?? 0);
  }
  return 0;
}

export class DifficultyEngine {
  private readonly tuning: DifficultyTuning;
  private state: DifficultyEngineState;
  private lastLevelChangeTime: number = Number.NEGATIVE_INFINITY;
  private readonly timeline: LevelChangeRecord[] = [];

  constructor(tuning: Partial<DifficultyTuning> = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.state = this.initialState();
  }

  private initialState(): DifficultyEngineState {
    return {
      currentLevel: this.tuning.minLevel,
      killCount: 0,
      consecutiveKills: 0,
      consecutiveFailures: 0,
      playerHealth: 100,
      maxPlayerHealth: 100,
      levelTime: 0
    };
  }

  /**
   * Ingest a batch of events. Events are canonically sorted and grouped by
   * timestamp; each timestamp produces at most one level change.
   * Returns the records appended to the timeline by this batch.
   */
  ingest(events: DifficultyEvent[]): LevelChangeRecord[] {
    const sorted = [...events].sort(compareEvents);
    const appended: LevelChangeRecord[] = [];
    let i = 0;
    while (i < sorted.length) {
      const t = sorted[i].time;
      let j = i;
      while (j < sorted.length && sorted[j].time === t) j++;
      let applied = false;
      for (let k = i; k < j; k++) {
        if (this.applyEvent(sorted[k])) applied = true;
      }
      if (applied) {
        const record = this.evaluate(t);
        if (record) {
          this.timeline.push(record);
          appended.push(record);
        }
      }
      i = j;
    }
    return appended;
  }

  /** Returns false when the event was dropped (non-advancing timeAdvance). */
  private applyEvent(event: DifficultyEvent): boolean {
    const s = this.state;
    switch (event.type) {
      case 'timeAdvance': {
        const value = event.levelTime ?? 0;
        if (value <= s.levelTime) return false; // monotonic: ignore regressions/duplicates
        s.levelTime = value;
        return true;
      }
      case 'healthChange': {
        const health = event.health ?? s.playerHealth;
        if (event.maxHealth !== undefined) s.maxPlayerHealth = event.maxHealth;
        if (health < s.playerHealth) s.consecutiveKills = 0;
        if (health <= 0 && s.playerHealth > 0) s.consecutiveFailures++;
        s.playerHealth = health;
        return true;
      }
      case 'playerHit':
        s.consecutiveKills = 0;
        return true;
      case 'kill':
        s.killCount++;
        s.consecutiveKills++;
        s.consecutiveFailures = 0;
        return true;
    }
  }

  /** Evaluates difficulty once for the given timestamp. */
  private evaluate(time: number): LevelChangeRecord | null {
    const t = this.tuning;
    const s = this.state;
    const healthRatio = s.playerHealth / Math.max(1, s.maxPlayerHealth);
    const killRate = s.killCount / Math.max(1, s.levelTime);

    const killsPath = s.consecutiveKills >= t.consecutiveKillsForLevelUp &&
      healthRatio >= t.healthThresholdForLevelUp;
    const timedPath =
      time - this.lastLevelChangeTime >= t.minSecondsBetweenLevelUps &&
      s.levelTime >= t.levelTimeThresholdSeconds &&
      killRate >= t.killRateThreshold &&
      healthRatio >= t.healthRatioForTimedLevelUp;

    if (killsPath || timedPath) {
      // Upgrade condition met: downgrade is never evaluated at this timestamp.
      s.consecutiveKills = 0;
      if (s.currentLevel >= t.maxLevel) return null; // ceiling: counter reset above
      const triggers: TriggerBasis = {};
      if (killsPath) {
        triggers.consecutiveKills = t.consecutiveKillsForLevelUp;
        triggers.healthRatio = healthRatio;
      }
      if (timedPath) {
        triggers.killRate = killRate;
        triggers.healthRatio = healthRatio;
      }
      return this.applyLevelChange(time, 'up', triggers);
    }

    const healthPath = healthRatio <= t.healthThresholdForLevelDown;
    const failurePath = s.consecutiveFailures >= t.consecutiveFailuresForLevelDown;
    const ratePath = s.levelTime >= t.lowKillRateMinLevelTime &&
      killRate < t.lowKillRateThreshold;

    if (healthPath || failurePath || ratePath) {
      // Exactly one level down even when several conditions hold at once.
      s.consecutiveKills = 0;
      s.consecutiveFailures = 0;
      if (s.currentLevel <= t.minLevel) return null; // floor: counters reset above
      const triggers: TriggerBasis = {};
      if (healthPath) triggers.healthRatio = healthRatio;
      if (failurePath) triggers.consecutiveFailures = t.consecutiveFailuresForLevelDown;
      if (ratePath) triggers.killRate = killRate;
      return this.applyLevelChange(time, 'down', triggers);
    }

    return null;
  }

  private applyLevelChange(
    time: number,
    direction: 'up' | 'down',
    triggers: TriggerBasis
  ): LevelChangeRecord {
    const fromLevel = this.state.currentLevel;
    const toLevel = direction === 'up' ? fromLevel + 1 : fromLevel - 1;
    this.state.currentLevel = toLevel;
    this.lastLevelChangeTime = time;
    return { time, fromLevel, toLevel, direction, triggers };
  }

  getState(): DifficultyEngineState {
    return { ...this.state };
  }

  getCurrentLevel(): number {
    return this.state.currentLevel;
  }

  getTimeline(): LevelChangeRecord[] {
    return this.timeline.map(r => ({ ...r, triggers: { ...r.triggers } }));
  }

  reset(): void {
    this.state = this.initialState();
    this.lastLevelChangeTime = Number.NEGATIVE_INFINITY;
    this.timeline.length = 0;
  }

  /** Replays a full event sequence on a fresh engine and returns its timeline. */
  static replay(
    events: DifficultyEvent[],
    tuning: Partial<DifficultyTuning> = {}
  ): { timeline: LevelChangeRecord[]; state: DifficultyEngineState } {
    const engine = new DifficultyEngine(tuning);
    engine.ingest(events);
    return { timeline: engine.getTimeline(), state: engine.getState() };
  }
}
