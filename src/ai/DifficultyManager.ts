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
  private currentLevel: number = 1;
  private readonly maxLevel: number = 5;
  private readonly minLevel: number = 1;
  private metrics: DifficultyMetrics;

  private readonly consecutiveKillsForLevelUp: number = 5;
  private readonly healthThresholdForLevelUp: number = 0.8;
  private readonly healthThresholdForLevelDown: number = 0.3;
  private readonly consecutiveFailuresForLevelDown: number = 3;

  private readonly levelTimeThresholdSeconds: number = 120;
  private readonly killRateThreshold: number = 0.08;
  private lastLevelUpTime: number = 0;
  private levelStartTime: number = 0;

  private onDifficultyChangeCallback: ((level: number) => void) | null = null;

  constructor() {
    this.levelStartTime = Date.now();
    this.lastLevelUpTime = this.levelStartTime;
    this.metrics = {
      playerHealth: 100,
      maxPlayerHealth: 100,
      killCount: 0,
      consecutiveKills: 0,
      consecutiveFailures: 0,
      levelTime: 0,
      currentLevel: 1,
      activeEnemies: 0
    };
  }

  setOnDifficultyChange(callback: (level: number) => void): void {
    this.onDifficultyChangeCallback = callback;
  }

  updateMetrics(partial: Partial<DifficultyMetrics>): void {
    if (partial.playerHealth !== undefined) {
      if (partial.playerHealth < this.metrics.playerHealth) {
        this.metrics.consecutiveKills = 0;
      }
      if (partial.playerHealth <= 0 && this.metrics.playerHealth > 0) {
        this.metrics.consecutiveFailures++;
      }
    }
    Object.assign(this.metrics, partial);

    if (partial.levelTime !== undefined) {
      this.metrics.levelTime = partial.levelTime;
      this.evaluateLevelTime(partial.levelTime);
    }
    this.evaluateDifficulty();
  }

  recordKill(): void {
    this.metrics.killCount++;
    this.metrics.consecutiveKills++;
    this.metrics.consecutiveFailures = 0;
    this.evaluateDifficulty();
  }

  recordPlayerHit(): void {
    this.metrics.consecutiveKills = 0;
  }

  private evaluateLevelTime(levelTimeSec: number): void {
    const timeSinceLastLevelUp = (Date.now() - this.lastLevelUpTime) / 1000;

    if (
      timeSinceLastLevelUp >= 30 &&
      levelTimeSec >= this.levelTimeThresholdSeconds &&
      this.currentLevel < this.maxLevel
    ) {
      const killRate = this.metrics.killCount / Math.max(1, levelTimeSec);
      const healthRatio = this.metrics.playerHealth / this.metrics.maxPlayerHealth;

      if (killRate >= this.killRateThreshold && healthRatio >= 0.5) {
        this.currentLevel++;
        this.metrics.consecutiveKills = 0;
        this.lastLevelUpTime = Date.now();
        this.notifyLevelChange();
      }
    }

    if (
      levelTimeSec >= 60 &&
      this.metrics.killCount / Math.max(1, levelTimeSec) < 0.02 &&
      this.currentLevel > this.minLevel
    ) {
      this.currentLevel--;
      this.lastLevelUpTime = Date.now();
      this.notifyLevelChange();
    }
  }

  private evaluateDifficulty(): void {
    const healthRatio = this.metrics.playerHealth / this.metrics.maxPlayerHealth;
    let levelChanged = false;

    if (
      this.metrics.consecutiveKills >= this.consecutiveKillsForLevelUp &&
      healthRatio >= this.healthThresholdForLevelUp &&
      this.currentLevel < this.maxLevel
    ) {
      this.currentLevel++;
      this.metrics.consecutiveKills = 0;
      this.lastLevelUpTime = Date.now();
      levelChanged = true;
    }

    if (
      (healthRatio <= this.healthThresholdForLevelDown ||
        this.metrics.consecutiveFailures >= this.consecutiveFailuresForLevelDown) &&
      this.currentLevel > this.minLevel
    ) {
      this.currentLevel--;
      this.metrics.consecutiveFailures = 0;
      this.metrics.consecutiveKills = 0;
      levelChanged = true;
    }

    this.metrics.currentLevel = this.currentLevel;

    if (levelChanged) {
      this.notifyLevelChange();
    }
  }

  private notifyLevelChange(): void {
    this.metrics.currentLevel = this.currentLevel;
    if (this.onDifficultyChangeCallback) {
      this.onDifficultyChangeCallback(this.currentLevel);
    }
  }

  getDifficultyConfig(): DifficultyConfig {
    const level = this.currentLevel;
    const spawnInterval = Phaser.Math.Clamp(
      2000 - (level - 1) * 375,
      500,
      2000
    );
    const enemyWeights = this.calculateEnemyWeights();

    return {
      level,
      spawnInterval,
      enemyWeights
    };
  }

  private calculateEnemyWeights(): Record<string, number> {
    const level = this.currentLevel;
    let meleeWeight = Math.max(30, 60 - level * 5);
    let suicideWeight = Math.min(40, 10 + level * 6);
    let rangedWeight = 100 - meleeWeight - suicideWeight;
    rangedWeight = Math.max(10, rangedWeight);

    return {
      melee: meleeWeight,
      ranged: rangedWeight,
      suicide: suicideWeight
    };
  }

  getCurrentLevel(): number {
    return this.currentLevel;
  }

  getMetrics(): DifficultyMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.currentLevel = 1;
    this.levelStartTime = Date.now();
    this.lastLevelUpTime = this.levelStartTime;
    this.metrics = {
      playerHealth: 100,
      maxPlayerHealth: 100,
      killCount: 0,
      consecutiveKills: 0,
      consecutiveFailures: 0,
      levelTime: 0,
      currentLevel: 1,
      activeEnemies: 0
    };
  }
}
