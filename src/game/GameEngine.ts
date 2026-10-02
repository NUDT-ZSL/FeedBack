import {
  GameState,
  CatapultType,
  Catapult,
  AmmoType,
  Particle,
  Projectile,
  GameEngineCallbacks,
} from './types';
import {
  CATAPULT_CONFIGS,
  AMMO_CONFIGS,
  SLOT_POSITIONS,
  WALL_SEGMENTS,
  MAX_PARTICLES,
  GROUND_Y,
} from './constants';
import {
  calculateTrajectory,
  getProjectilePositionAtTime,
  checkWallCollision,
  checkGroundCollision,
  calculateMorale,
  calculateDamageProbability,
  calculateAngleFromMouse,
} from './physics';
import {
  playGearSound,
  playFireSound,
  playHitSound,
  playArrowSound,
  playVictorySound,
  playDefeatSound,
} from '../utils/sound';

export class GameEngine {
  private state: GameState;
  private callbacks: GameEngineCallbacks;
  private animationFrameId: number | null = null;
  private projectileTimers: Map<string, { startTime: number; catapultId: string }> = new Map();

  constructor(callbacks: GameEngineCallbacks) {
    this.callbacks = callbacks;
    this.state = this.createInitialState();
  }

  private createInitialState(): GameState {
    return {
      phase: 'deploy',
      turn: 1,
      catapults: [],
      wall: {
        durability: 500,
        maxDurability: 500,
        morale: 100,
        maxMorale: 100,
        crackLevel: new Array(WALL_SEGMENTS).fill(0),
      },
      ammo: { stone: 15, fire: 8 },
      particles: [],
      projectiles: [],
      deployedSlots: [null, null, null],
      selectedCatapult: null,
      isAiming: false,
      trajectoryPoints: [],
      draggingCatapult: null,
    };
  }

  public getState(): GameState {
    return { ...this.state };
  }

  private emitStateChange(): void {
    this.callbacks.onStateChange({ ...this.state });
  }

  public startGame(): void {
    this.state = this.createInitialState();
    this.emitStateChange();
    this.startGameLoop();
  }

  private startGameLoop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.gameLoop();
  }

  private gameLoop = (): void => {
    this.updateParticles();
    this.updateProjectiles();
    this.emitStateChange();
    this.animationFrameId = requestAnimationFrame(this.gameLoop);
  };

  public stopGame(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public startDragCatapult(type: CatapultType, x: number, y: number): void {
    if (this.state.phase !== 'deploy') return;
    this.state.draggingCatapult = { type, x, y };
    this.emitStateChange();
  }

  public updateDragPosition(x: number, y: number): void {
    if (this.state.draggingCatapult) {
      this.state.draggingCatapult.x = x;
      this.state.draggingCatapult.y = y;
      this.emitStateChange();
    }
  }

  public endDragCatapult(x: number, y: number): void {
    if (!this.state.draggingCatapult) return;

    const slotIndex = this.findNearestSlot(x, y);
    if (slotIndex !== -1 && this.state.deployedSlots[slotIndex] === null) {
      this.deployCatapult(this.state.draggingCatapult.type, slotIndex);
      playGearSound();
    }

    this.state.draggingCatapult = null;
    this.emitStateChange();
  }

  private findNearestSlot(x: number, y: number): number {
    let nearestIndex = -1;
    let minDistance = Infinity;

    SLOT_POSITIONS.forEach((pos, index) => {
      const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
      if (dist < 60 && dist < minDistance) {
        minDistance = dist;
        nearestIndex = index;
      }
    });

    return nearestIndex;
  }

  private deployCatapult(type: CatapultType, slotIndex: number): void {
    const config = CATAPULT_CONFIGS[type];
    const position = SLOT_POSITIONS[slotIndex];
    const id = `catapult-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const catapult: Catapult = {
      id,
      type,
      position: { ...position },
      slotIndex,
      health: config.maxHealth,
      maxHealth: config.maxHealth,
      isDamaged: false,
      hasFired: false,
      angle: 45,
      ammoType: 'stone',
    };

    this.state.catapults.push(catapult);
    this.state.deployedSlots[slotIndex] = id;

    if (this.state.deployedSlots.every((s) => s !== null)) {
      this.state.phase = 'playerTurn';
    }
  }

  public startBattle(): void {
    if (this.state.phase === 'deploy' && this.state.catapults.length > 0) {
      this.state.phase = 'playerTurn';
      this.emitStateChange();
    }
  }

  public selectCatapult(catapultId: string): void {
    if (this.state.phase !== 'playerTurn') return;
    const catapult = this.state.catapults.find((c) => c.id === catapultId);
    if (!catapult || catapult.hasFired || catapult.isDamaged) return;

    this.state.selectedCatapult = catapultId;
    this.updateTrajectory();
    this.emitStateChange();
  }

  public deselectCatapult(): void {
    this.state.selectedCatapult = null;
    this.state.isAiming = false;
    this.state.trajectoryPoints = [];
    this.emitStateChange();
  }

  public startAiming(mouseX: number, mouseY: number): void {
    if (!this.state.selectedCatapult) return;
    const catapult = this.state.catapults.find((c) => c.id === this.state.selectedCatapult);
    if (!catapult) return;

    this.state.isAiming = true;
    this.updateAngle(catapult, mouseX, mouseY);
    this.emitStateChange();
  }

  public updateAim(mouseX: number, mouseY: number): void {
    if (!this.state.isAiming || !this.state.selectedCatapult) return;
    const catapult = this.state.catapults.find((c) => c.id === this.state.selectedCatapult);
    if (!catapult) return;

    this.updateAngle(catapult, mouseX, mouseY);
    this.updateTrajectory();
    this.emitStateChange();
  }

  private updateAngle(catapult: Catapult, mouseX: number, mouseY: number): void {
    const angle = calculateAngleFromMouse(
      catapult.position.x,
      catapult.position.y - 30,
      mouseX,
      mouseY
    );
    catapult.angle = angle;
  }

  private updateTrajectory(): void {
    if (!this.state.selectedCatapult) return;
    const catapult = this.state.catapults.find((c) => c.id === this.state.selectedCatapult);
    if (!catapult) return;

    const config = CATAPULT_CONFIGS[catapult.type];
    this.state.trajectoryPoints = calculateTrajectory(
      catapult.position.x,
      catapult.position.y - 30,
      catapult.angle,
      config.velocity
    );
  }

  public fireSelectedCatapult(): void {
    if (!this.state.selectedCatapult || !this.state.isAiming) return;
    const catapult = this.state.catapults.find((c) => c.id === this.state.selectedCatapult);
    if (!catapult || catapult.hasFired || catapult.isDamaged) return;

    const ammoType = catapult.ammoType;
    if (this.state.ammo[ammoType] <= 0) return;

    this.state.ammo[ammoType]--;

    const config = CATAPULT_CONFIGS[catapult.type];
    const projectileId = `proj-${Date.now()}`;

    const projectile: Projectile = {
      id: projectileId,
      x: catapult.position.x,
      y: catapult.position.y - 30,
      vx: 0,
      vy: 0,
      type: ammoType,
      active: true,
    };

    this.state.projectiles.push(projectile);
    this.projectileTimers.set(projectileId, {
      startTime: performance.now(),
      catapultId: catapult.id,
    });

    catapult.hasFired = true;
    playFireSound();

    this.state.selectedCatapult = null;
    this.state.isAiming = false;
    this.state.trajectoryPoints = [];

    this.checkPlayerTurnComplete();
    this.emitStateChange();
  }

  private updateProjectiles(): void {
    const now = performance.now();
    const toRemove: string[] = [];

    this.state.projectiles.forEach((projectile) => {
      if (!projectile.active) return;

      const timer = this.projectileTimers.get(projectile.id);
      if (!timer) return;

      const catapult = this.state.catapults.find((c) => c.id === timer.catapultId);
      if (!catapult) return;

      const config = CATAPULT_CONFIGS[catapult.type];
      const elapsed = (now - timer.startTime) / 1000;
      const pos = getProjectilePositionAtTime(
        catapult.position.x,
        catapult.position.y - 30,
        catapult.angle,
        config.velocity,
        elapsed
      );

      projectile.x = pos.x;
      projectile.y = pos.y;
      projectile.vx = pos.vx;
      projectile.vy = pos.vy;

      const wallHit = checkWallCollision(projectile.x, projectile.y);
      if (wallHit.hit) {
        this.handleWallHit(projectile, wallHit.segmentIndex, catapult);
        projectile.active = false;
        toRemove.push(projectile.id);
        return;
      }

      if (checkGroundCollision(projectile.y)) {
        projectile.active = false;
        toRemove.push(projectile.id);
        return;
      }
    });

    toRemove.forEach((id) => {
      this.state.projectiles = this.state.projectiles.filter((p) => p.id !== id);
      this.projectileTimers.delete(id);
    });
  }

  private handleWallHit(projectile: Projectile, segmentIndex: number, catapult: Catapult): void {
    const config = CATAPULT_CONFIGS[catapult.type];
    const ammoConfig = AMMO_CONFIGS[projectile.type];
    const damage = Math.floor(config.damage * ammoConfig.damageMultiplier);

    this.state.wall.durability = Math.max(0, this.state.wall.durability - damage);
    this.state.wall.morale = calculateMorale(
      this.state.wall.durability,
      this.state.wall.maxDurability
    );

    if (this.state.wall.crackLevel[segmentIndex] < 3) {
      this.state.wall.crackLevel[segmentIndex] = Math.min(
        3,
        this.state.wall.crackLevel[segmentIndex] + 1
      );
    }

    this.createExplosionParticles(projectile.x, projectile.y, projectile.type);
    playHitSound(projectile.type === 'fire');

    this.checkVictory();
  }

  private createExplosionParticles(x: number, y: number, type: AmmoType): void {
    const config = AMMO_CONFIGS[type];
    const count = config.particleCount;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      const particle: Particle = {
        id: `particle-${Date.now()}-${i}`,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        type: type,
        life: 0.6,
        maxLife: 0.6,
        size: type === 'fire' ? 4 + Math.random() * 4 : 3 + Math.random() * 3,
      };
      this.state.particles.push(particle);
    }

    if (this.state.particles.length > MAX_PARTICLES) {
      this.state.particles = this.state.particles.slice(-MAX_PARTICLES);
    }
  }

  private updateParticles(): void {
    const deltaTime = 1 / 60;
    const toRemove: string[] = [];

    this.state.particles.forEach((particle) => {
      particle.life -= deltaTime;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.3;

      if (particle.life <= 0 || particle.y >= GROUND_Y) {
        toRemove.push(particle.id);
      }
    });

    this.state.particles = this.state.particles.filter((p) => !toRemove.includes(p.id));
  }

  public setAmmoType(catapultId: string, ammoType: AmmoType): void {
    const catapult = this.state.catapults.find((c) => c.id === catapultId);
    if (!catapult) return;
    catapult.ammoType = ammoType;
    this.emitStateChange();
  }

  public repairCatapult(catapultId: string): void {
    const catapult = this.state.catapults.find((c) => c.id === catapultId);
    if (!catapult || !catapult.isDamaged) return;
    catapult.isDamaged = false;
    catapult.health = catapult.maxHealth;
    this.emitStateChange();
  }

  private checkPlayerTurnComplete(): void {
    const deployedCatapults = this.state.catapults.filter(
      (c) => c.slotIndex !== null && !c.isDamaged
    );
    const allFired = deployedCatapults.every((c) => c.hasFired);

    if (allFired && deployedCatapults.length > 0) {
      setTimeout(() => this.startEnemyTurn(), 500);
    }
  }

  private startEnemyTurn(): void {
    if (this.state.phase !== 'playerTurn') return;

    this.state.phase = 'enemyTurn';
    this.emitStateChange();

    setTimeout(() => {
      this.executeEnemyAttack();
    }, 500);
  }

  private executeEnemyAttack(): void {
    if (this.state.wall.morale <= 30) {
      this.endEnemyTurn();
      return;
    }

    playArrowSound();

    const deployedCatapults = this.state.catapults.filter((c) => c.slotIndex !== null);

    deployedCatapults.forEach((catapult, index) => {
      setTimeout(() => {
        this.createArrowRain(catapult.position.x, catapult.position.y);
        const damageProb = calculateDamageProbability(catapult.health, catapult.maxHealth);

        if (Math.random() < damageProb && !catapult.isDamaged) {
          const damage = 15 + Math.floor(Math.random() * 20);
          catapult.health = Math.max(0, catapult.health - damage);

          if (catapult.health <= 0) {
            catapult.isDamaged = true;
          }
        }
      }, index * 300);
    });

    setTimeout(() => {
      this.endEnemyTurn();
    }, deployedCatapults.length * 300 + 500);
  }

  private createArrowRain(x: number, y: number): void {
    for (let i = 0; i < 15; i++) {
      const particle: Particle = {
        id: `arrow-${Date.now()}-${i}`,
        x: x - 50 + Math.random() * 100,
        y: -20,
        vx: -2 + Math.random() * 4,
        vy: 8 + Math.random() * 4,
        type: 'arrow',
        life: 1,
        maxLife: 1,
        size: 8,
      };
      this.state.particles.push(particle);
    }

    if (this.state.particles.length > MAX_PARTICLES) {
      this.state.particles = this.state.particles.slice(-MAX_PARTICLES);
    }
  }

  private endEnemyTurn(): void {
    this.checkDefeat();

    if (this.state.phase === 'enemyTurn') {
      this.state.turn++;
      this.state.phase = 'playerTurn';
      this.state.catapults.forEach((c) => {
        if (!c.isDamaged) {
          c.hasFired = false;
        }
      });
    }

    this.emitStateChange();
  }

  private checkVictory(): void {
    if (this.state.wall.durability <= 0 && this.state.wall.morale <= 0) {
      this.state.phase = 'victory';
      playVictorySound();
      this.callbacks.onVictory();
      this.stopGame();
    }
  }

  private checkDefeat(): void {
    const deployedCatapults = this.state.catapults.filter((c) => c.slotIndex !== null);
    const allDestroyed = deployedCatapults.every((c) => c.isDamaged);
    const wallStanding = this.state.wall.durability > 0;

    if (allDestroyed && wallStanding && deployedCatapults.length > 0) {
      this.state.phase = 'defeat';
      playDefeatSound();
      this.callbacks.onDefeat();
      this.stopGame();
    }
  }

  public endPlayerTurn(): void {
    if (this.state.phase !== 'playerTurn') return;
    this.checkPlayerTurnComplete();
  }

  public restartGame(): void {
    this.stopGame();
    this.startGame();
  }
}
