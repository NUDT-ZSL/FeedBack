import { Scene } from 'phaser';
import { v4 as uuidv4 } from 'uuid';
import { DifficultyManager, DifficultyConfig } from './DifficultyManager';
import { EnemyTemplate, enemyTemplates, EnemyBehavior } from '../configs/enemyTemplates';
import { Enemy } from '../game/Enemy';

export interface SpawnPosition {
  x: number;
  y: number;
}

export class EnemySpawner {
  private scene: Scene;
  private difficultyManager: DifficultyManager;
  private spawnTimer: Phaser.Time.TimerEvent | null = null;
  private spawnConfig: DifficultyConfig;
  private activeEnemies: Enemy[] = [];
  private readonly maxActiveEnemies: number = 20;
  private isPaused: boolean = false;
  private frameCounter: number = 0;

  constructor(scene: Scene, difficultyManager: DifficultyManager) {
    this.scene = scene;
    this.difficultyManager = difficultyManager;
    this.spawnConfig = this.difficultyManager.getDifficultyConfig();
  }

  start(): void {
    this.scheduleNextSpawn();
  }

  stop(): void {
    if (this.spawnTimer) {
      this.spawnTimer.destroy();
      this.spawnTimer = null;
    }
  }

  pause(): void {
    this.isPaused = true;
    if (this.spawnTimer) this.spawnTimer.paused = true;
  }

  resume(): void {
    this.isPaused = false;
    if (this.spawnTimer) this.spawnTimer.paused = false;
  }

  private scheduleNextSpawn(): void {
    this.spawnConfig = this.difficultyManager.getDifficultyConfig();
    if (this.spawnTimer) this.spawnTimer.destroy();
    this.spawnTimer = this.scene.time.addEvent({
      delay: this.spawnConfig.spawnInterval,
      loop: false,
      callback: () => {
        this.trySpawnEnemy();
        this.scheduleNextSpawn();
      }
    });
  }

  private trySpawnEnemy(): void {
    if (this.isPaused) return;
    if (this.activeEnemies.filter(e => e.isActive()).length >= this.maxActiveEnemies) return;
    const template = this.selectEnemyTemplate();
    if (!template) return;
    const position = this.getValidSpawnPosition(template.size);
    if (!position) return;
    this.spawnEnemy(template, position);
  }

  private selectEnemyTemplate(): EnemyTemplate | null {
    this.spawnConfig = this.difficultyManager.getDifficultyConfig();
    const weights = this.spawnConfig.enemyWeights;
    const typeList: EnemyBehavior[] = ['melee', 'ranged', 'suicide'];
    const totalWeight = typeList.reduce((s, t) => s + (weights[t] || 0), 0);
    let r = Math.random() * totalWeight;
    let selectedType: EnemyBehavior = 'melee';
    for (const t of typeList) {
      r -= weights[t] || 0;
      if (r <= 0) { selectedType = t; break; }
    }
    const matching = enemyTemplates.filter(t => t.type === selectedType);
    if (matching.length === 0) return null;
    const totalTplW = matching.reduce((s, t) => s + t.weight, 0);
    let r2 = Math.random() * totalTplW;
    for (const t of matching) {
      r2 -= t.weight;
      if (r2 <= 0) return t;
    }
    return matching[matching.length - 1];
  }

  private getValidSpawnPosition(enemySize: number): SpawnPosition | null {
    const { width, height } = this.scene.scale;
    const margin = 50;
    const safeMargin = 100;
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const edge = Math.floor(Math.random() * 4);
      let x = 0, y = 0;
      switch (edge) {
        case 0: x = Math.random() * width; y = margin; break;
        case 1: x = width - margin; y = Math.random() * height; break;
        case 2: x = Math.random() * width; y = height - margin; break;
        case 3: x = margin; y = Math.random() * height; break;
      }
      const distC = Math.hypot(x - width / 2, y - height / 2);
      if (distC < safeMargin) continue;
      let overlap = false;
      for (const e of this.activeEnemies) {
        if (!e.isActive()) continue;
        if (Math.hypot(x - e.x, y - e.y) < enemySize * 2) { overlap = true; break; }
      }
      if (!overlap) return { x, y };
    }
    return null;
  }

  private spawnEnemy(template: EnemyTemplate, position: SpawnPosition): void {
    const scaled = this.scaleTemplateByDifficulty(template);
    const enemy = new Enemy(this.scene, position.x, position.y, {
      ...scaled,
      instanceId: uuidv4()
    });
    enemy.setOnDeathCallback(() => {
      this.removeEnemy(enemy);
      this.difficultyManager.recordKill();
    });
    this.activeEnemies.push(enemy);
    this.difficultyManager.updateMetrics({
      activeEnemies: this.activeEnemies.filter(e => e.isActive()).length
    });
  }

  private scaleTemplateByDifficulty(template: EnemyTemplate): EnemyTemplate {
    const level = this.difficultyManager.getCurrentLevel();
    const factor = 1 + (level - 1) * 0.12;
    return {
      ...template,
      health: Math.round(template.health * factor),
      attack: Math.round(template.attack * factor),
      speed: template.speed * (1 + (level - 1) * 0.05)
    };
  }

  private removeEnemy(enemy: Enemy): void {
    const idx = this.activeEnemies.indexOf(enemy);
    if (idx !== -1) this.activeEnemies.splice(idx, 1);
    this.difficultyManager.updateMetrics({
      activeEnemies: this.activeEnemies.filter(e => e.isActive()).length
    });
  }

  getActiveEnemies(): Enemy[] {
    return this.activeEnemies.filter(e => e.isActive());
  }

  getAllEnemies(): Enemy[] {
    return [...this.activeEnemies];
  }

  getMaxActiveEnemies(): number {
    return this.maxActiveEnemies;
  }

  onDifficultyChanged(): void {
    this.scheduleNextSpawn();
  }

  update(time: number, delta: number, playerX: number, playerY: number): void {
    const start = performance.now();
    this.frameCounter++;
    const list = this.activeEnemies.filter(e => e.isActive());
    const half = Math.ceil(list.length / 2);
    const s = (this.frameCounter % 2 === 0) ? 0 : half;
    const e = (this.frameCounter % 2 === 0) ? half : list.length;
    for (let i = s; i < e; i++) {
      const en = list[i];
      if (en) en.update(time, delta, playerX, playerY);
    }
    const elapsed = performance.now() - start;
    if (elapsed > 2) {
      console.warn(`Enemy AI update took ${elapsed.toFixed(2)}ms, exceeds 2ms limit`);
    }
  }

  destroy(): void {
    this.stop();
    for (const e of this.activeEnemies) e.destroy();
    this.activeEnemies = [];
  }
}
