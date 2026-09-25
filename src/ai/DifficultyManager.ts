// Adapter between the game loop and the deterministic DifficultyEngine.
//
// Game code reports kills / hits / health / time as they happen; the manager
// buffers them as timestamped events and evaluates them exactly once per
// frame in flush(). This guarantees that multiple kills or health changes
// within one frame merge into a single evaluation and can never chain
// several level changes in one frame.

import {
  DifficultyEngine,
  DifficultyEvent,
  LevelChangeRecord,
  DifficultyEngineState
} from './DifficultyEngine';
import { computeEnemyWeights, computeSpawnInterval } from './SpawnQuotaPlanner';

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

export class DifficultyManager {
  private readonly engine: DifficultyEngine = new DifficultyEngine();
  private pending: DifficultyEvent[] = [];
  private currentTime: number = 0;
  private activeEnemies: number = 0;

  private onDifficultyChangeCallback: ((level: number) => void) | null = null;

  setOnDifficultyChange(callback: (level: number) => void): void {
    this.onDifficultyChangeCallback = callback;
  }

  recordKill(): void {
    this.pending.push({ time: this.currentTime, type: 'kill' });
  }

  recordPlayerHit(): void {
    this.pending.push({ time: this.currentTime, type: 'playerHit' });
  }

  updateMetrics(partial: Partial<DifficultyMetrics>): void {
    if (partial.levelTime !== undefined) {
      this.currentTime = partial.levelTime;
    }
    if (partial.playerHealth !== undefined) {
      this.pending.push({
        time: this.currentTime,
        type: 'healthChange',
        health: partial.playerHealth,
        maxHealth: partial.maxPlayerHealth
      });
    }
    if (partial.activeEnemies !== undefined) {
      this.activeEnemies = partial.activeEnemies;
    }
    // killCount reported by the scene is ignored on purpose: the engine
    // derives its own kill count from recordKill() events so kills are
    // never double counted.
  }

  /**
   * Evaluates all events buffered since the last flush as one timestamp
   * group (the current frame). Returns the level changes that occurred.
   */
  flush(): LevelChangeRecord[] {
    if (this.currentTime > 0) {
      this.pending.push({
        time: this.currentTime,
        type: 'timeAdvance',
        levelTime: this.currentTime
      });
    }
    if (this.pending.length === 0) return [];
    const frameTime = this.currentTime;
    const events = this.pending.map(e => ({ ...e, time: frameTime }));
    this.pending = [];
    const changes = this.engine.ingest(events);
    for (const change of changes) {
      if (this.onDifficultyChangeCallback) {
        this.onDifficultyChangeCallback(change.toLevel);
      }
    }
    return changes;
  }

  getDifficultyConfig(): DifficultyConfig {
    const level = this.engine.getCurrentLevel();
    return {
      level,
      spawnInterval: computeSpawnInterval(level),
      enemyWeights: computeEnemyWeights(level)
    };
  }

  getCurrentLevel(): number {
    return this.engine.getCurrentLevel();
  }

  getTimeline(): LevelChangeRecord[] {
    return this.engine.getTimeline();
  }

  getMetrics(): DifficultyMetrics {
    const s: DifficultyEngineState = this.engine.getState();
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
    this.engine.reset();
    this.pending = [];
    this.currentTime = 0;
    this.activeEnemies = 0;
  }
}
