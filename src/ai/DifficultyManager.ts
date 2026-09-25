import { DifficultyEngine } from './DifficultyEngine.ts';
import type { DifficultyEvent, LevelChangeRecord } from './DifficultyEngine.ts';

export interface DifficultyMetrics {
  playerHealth: number;
  maxPlayerHealth: number;
  killCount: number;
  consecutiveKills: number;
  consecutiveFailures: number;
  levelTime: number;
  currentLevel: number;
  activeEnemies: number;
}

export interface DifficultyConfig {
  level: number;
  spawnInterval: number;
  enemyWeights: Record<string, number>;
}

/**
 * DifficultyManager - frame-level adapter around DifficultyEngine.
 *
 * Instead of evaluating difficulty inside every recordKill/updateMetrics
 * call (which allowed multiple level changes per frame and order-dependent
 * results), every gameplay signal is queued as a timestamped event and the
 * queue is flushed exactly once per frame through the deterministic
 * engine. All events flushed together share the frame's levelTime, so the
 * engine merges them into a single evaluation: at most one level change
 * per frame, independent of the order the signals arrived in.
 */
export class DifficultyManager {
  private readonly engine: DifficultyEngine;
  private pendingEvents: DifficultyEvent[] = [];
  private currentLevelTime: number = 0;
  private activeEnemies: number = 0;
  private notifiedTimelineLength: number = 0;

  private onDifficultyChangeCallback: ((level: number) => void) | null = null;

  constructor() {
    this.engine = new DifficultyEngine(100);
  }

  setOnDifficultyChange(callback: (level: number) => void): void {
    this.onDifficultyChangeCallback = callback;
  }

  /**
   * Queue this frame's metrics as events and flush the pending queue.
   * The queue is flushed only when levelTime is provided, i.e. by the game
   * loop's once-per-frame call; incidental metric updates (such as
   * activeEnemies from the spawner) never trigger a mid-frame evaluation.
   */
  updateMetrics(partial: Partial<DifficultyMetrics>): void {
    if (partial.levelTime !== undefined) {
      this.currentLevelTime = partial.levelTime;
    }
    if (partial.activeEnemies !== undefined) {
      this.activeEnemies = partial.activeEnemies;
    }
    if (partial.playerHealth !== undefined) {
      this.pendingEvents.push({
        time: this.currentLevelTime,
        type: 'healthChange',
        health: partial.playerHealth,
        maxHealth: partial.maxPlayerHealth
      });
    }
    if (partial.levelTime !== undefined) {
      this.pendingEvents.push({
        time: this.currentLevelTime,
        type: 'timeAdvance'
      });
      this.flush();
    }
  }

  recordKill(): void {
    this.pendingEvents.push({ time: this.currentLevelTime, type: 'kill' });
  }

  recordPlayerHit(): void {
    this.pendingEvents.push({ time: this.currentLevelTime, type: 'playerHit' });
  }

  /** Flush queued events through the engine; notify at most once per flush. */
  private flush(): void {
    if (this.pendingEvents.length === 0) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.engine.ingest(events);
    const timeline = this.engine.getTimeline();
    if (timeline.length > this.notifiedTimelineLength) {
      this.notifiedTimelineLength = timeline.length;
      if (this.onDifficultyChangeCallback) {
        this.onDifficultyChangeCallback(this.engine.getCurrentLevel());
      }
    }
  }

  /** The deterministic level timeline produced so far (replayable). */
  getTimeline(): LevelChangeRecord[] {
    return this.engine.getTimeline();
  }

  getDifficultyConfig(): DifficultyConfig {
    const level = this.engine.getCurrentLevel();
    const spawnInterval = Math.min(2000, Math.max(500, 2000 - (level - 1) * 375));
    return {
      level,
      spawnInterval,
      enemyWeights: this.calculateEnemyWeights(level)
    };
  }

  private calculateEnemyWeights(level: number): Record<string, number> {
    const meleeWeight = Math.max(30, 60 - level * 5);
    const suicideWeight = Math.min(40, 10 + level * 6);
    const rangedWeight = Math.max(10, 100 - meleeWeight - suicideWeight);
    return {
      melee: meleeWeight,
      ranged: rangedWeight,
      suicide: suicideWeight
    };
  }

  getCurrentLevel(): number {
    return this.engine.getCurrentLevel();
  }

  getMetrics(): DifficultyMetrics {
    const s = this.engine.getState();
    return {
      playerHealth: s.playerHealth,
      maxPlayerHealth: s.maxPlayerHealth,
      killCount: s.killCount,
      consecutiveKills: s.consecutiveKills,
      consecutiveFailures: s.consecutiveFailures,
      levelTime: s.levelTime,
      currentLevel: s.currentLevel,
      activeEnemies: this.activeEnemies
    };
  }

  reset(): void {
    this.engine.reset(100);
    this.pendingEvents = [];
    this.currentLevelTime = 0;
    this.activeEnemies = 0;
    this.notifiedTimelineLength = 0;
  }
}
