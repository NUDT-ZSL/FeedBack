import { Scene } from 'phaser';
import { EnemyTemplate, EnemyBehavior } from '../configs/enemyTemplates';

export interface EnemyRuntimeData extends EnemyTemplate {
  instanceId: string;
}

export type OnHitCallback = (damage: number, fromEnemy: Enemy) => void;

export class Enemy extends Phaser.GameObjects.Container {
  private enemyData: EnemyRuntimeData;
  private currentHealth: number;
  private maxHealth: number;
  private isAlive: boolean = true;
  private lastAttackTime: number = 0;
  private healthBar!: Phaser.GameObjects.Graphics;
  private bodyVisual!: Phaser.GameObjects.Arc;
  private eyeVisual!: Phaser.GameObjects.Arc;
  private isHitFlashing: boolean = false;
  private hitFlashTimer: Phaser.Time.TimerEvent | null = null;
  private onDeathCallback: (() => void) | null = null;
  private onHitPlayerCallback: OnHitCallback | null = null;
  private bullets: Phaser.Physics.Arcade.Group | null = null;
  private targetAngle: number = 0;
  private currentAngle: number = 0;
  private explosionTriggered: boolean = false;
  private physicsBody: Phaser.Physics.Arcade.Body | null = null;
  private particleSystems: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Scene, x: number, y: number, data: EnemyRuntimeData) {
    super(scene, x, y);
    this.enemyData = data;
    this.currentHealth = data.health;
    this.maxHealth = data.health;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.physicsBody = this.body as Phaser.Physics.Arcade.Body;
    if (this.physicsBody) {
      this.physicsBody.setCollideWorldBounds(true);
      this.physicsBody.setCircle(data.size);
      this.physicsBody.setBounce(0.2, 0.2);
    }

    this.setSize(data.size * 2, data.size * 2);
    this.createVisuals();
    this.bullets = scene.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 10,
      runChildUpdate: true
    });
  }

  private createVisuals(): void {
    const size = this.enemyData.size;
    const type = this.enemyData.type;

    this.bodyVisual = this.scene.add.circle(0, 0, size, this.enemyData.color, 1);
    this.bodyVisual.setStrokeStyle(2, this.darkenColor(this.enemyData.color, 0.6));
    this.add(this.bodyVisual);

    this.eyeVisual = this.scene.add.circle(size * 0.3, -size * 0.2, size * 0.15, 0xffffff, 1);
    this.add(this.eyeVisual);

    if (type === 'melee') {
      const spikeL = this.scene.add.triangle(-size * 0.6, -size * 0.5, -size * 0.4, -size * 0.2, -size * 0.8, -size * 0.2, -size * 0.6, -size * 0.9, this.darkenColor(this.enemyData.color, 0.5), 1);
      const spikeR = this.scene.add.triangle(size * 0.6, -size * 0.5, size * 0.4, -size * 0.2, size * 0.8, -size * 0.2, size * 0.6, -size * 0.9, this.darkenColor(this.enemyData.color, 0.5), 1);
      this.add([spikeL, spikeR]);
    } else if (type === 'ranged') {
      const hood = this.scene.add.triangle(0, -size * 0.7, -size * 0.8, -size * 0.3, 0, -size * 1.3, size * 0.8, -size * 0.3, this.darkenColor(this.enemyData.color, 0.7), 1);
      this.add(hood);
    } else if (type === 'suicide') {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const spike = this.scene.add.triangle(
          Math.cos(angle) * size, Math.sin(angle) * size,
          Math.cos(angle - 0.15) * size, Math.sin(angle - 0.15) * size,
          Math.cos(angle) * size * 1.6, Math.sin(angle) * size * 1.6,
          this.darkenColor(this.enemyData.color, 0.7), 1
        );
        this.add(spike);
      }
      const warn = this.scene.add.text(0, 0, '!', {
        fontSize: `${size}px`,
        color: '#ffff00',
        fontFamily: 'Arial Black',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      this.add(warn);
    }

    this.healthBar = this.scene.add.graphics();
    this.healthBar.y = -size - 10;
    this.add(this.healthBar);
    this.updateHealthBar();
  }

  private darkenColor(color: number, factor: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * factor);
    const g = Math.floor(((color >> 8) & 0xff) * factor);
    const b = Math.floor((color & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  }

  private updateHealthBar(): void {
    const barWidth = this.enemyData.size * 2;
    const barHeight = 4;
    const ratio = Math.max(0, this.currentHealth / this.maxHealth);

    this.healthBar.clear();
    this.healthBar.fillStyle(0x000000, 0.6);
    this.healthBar.fillRoundedRect(-barWidth / 2, -barHeight, barWidth, barHeight, 2);

    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      new Phaser.Display.Color(255, 0, 0),
      new Phaser.Display.Color(0, 255, 100),
      100,
      Math.floor(ratio * 100)
    );
    const ci = (c.r << 16) | (c.g << 8) | c.b;
    this.healthBar.fillStyle(ci, 1);
    this.healthBar.fillRoundedRect(-barWidth / 2, -barHeight, barWidth * ratio, barHeight, 2);
  }

  update(time: number, delta: number, playerX: number, playerY: number): void {
    if (!this.isAlive) return;

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distance = Math.hypot(dx, dy);

    this.targetAngle = Math.atan2(dy, dx);
    this.currentAngle = Phaser.Math.Angle.RotateTo(this.currentAngle, this.targetAngle, 0.12);
    this.rotation = this.currentAngle + Math.PI / 2;

    const type: EnemyBehavior = this.enemyData.type;
    switch (type) {
      case 'melee':
        this.updateMelee(dx, dy, distance);
        break;
      case 'ranged':
        this.updateRanged(dx, dy, distance, time);
        break;
      case 'suicide':
        this.updateSuicide(dx, dy, distance);
        break;
    }

    if (this.physicsBody) {
      this.physicsBody.velocity.x = Phaser.Math.Clamp(
        this.physicsBody.velocity.x,
        -this.enemyData.speed,
        this.enemyData.speed
      );
      this.physicsBody.velocity.y = Phaser.Math.Clamp(
        this.physicsBody.velocity.y,
        -this.enemyData.speed,
        this.enemyData.speed
      );
    }
  }

  private updateMelee(dx: number, dy: number, distance: number): void {
    const speed = this.enemyData.speed;
    if (distance > this.enemyData.attackRange) {
      const nx = dx / (distance || 1);
      const ny = dy / (distance || 1);
      if (this.physicsBody) {
        this.physicsBody.velocity.x = nx * speed;
        this.physicsBody.velocity.y = ny * speed;
      }
    } else {
      if (this.physicsBody) {
        this.physicsBody.velocity.x *= 0.5;
        this.physicsBody.velocity.y *= 0.5;
      }
      const now = Date.now();
      if (now - this.lastAttackTime >= this.enemyData.attackCooldown) {
        this.attackPlayer();
        this.lastAttackTime = now;
      }
    }
  }

  private updateRanged(dx: number, dy: number, distance: number, time: number): void {
    const speed = this.enemyData.speed;
    const idealMin = this.enemyData.attackRange * 0.55;
    const idealMax = this.enemyData.attackRange * 0.85;

    if (distance < idealMin) {
      const nx = -dx / (distance || 1);
      const ny = -dy / (distance || 1);
      if (this.physicsBody) {
        this.physicsBody.velocity.x = nx * speed;
        this.physicsBody.velocity.y = ny * speed;
      }
    } else if (distance > idealMax) {
      const nx = dx / (distance || 1);
      const ny = dy / (distance || 1);
      if (this.physicsBody) {
        this.physicsBody.velocity.x = nx * speed;
        this.physicsBody.velocity.y = ny * speed;
      }
    } else {
      const perpX = -dy / (distance || 1);
      const perpY = dx / (distance || 1);
      const dir = Math.floor(time / 2000) % 2 === 0 ? 1 : -1;
      if (this.physicsBody) {
        this.physicsBody.velocity.x = perpX * speed * 0.5 * dir;
        this.physicsBody.velocity.y = perpY * speed * 0.5 * dir;
      }
    }

    if (distance <= this.enemyData.attackRange) {
      const now = Date.now();
      if (now - this.lastAttackTime >= this.enemyData.attackCooldown) {
        this.fireBullet(dx, dy, distance);
        this.lastAttackTime = now;
      }
    }
  }

  private updateSuicide(dx: number, dy: number, distance: number): void {
    const speed = this.enemyData.speed;
    if (distance > this.enemyData.attackRange * 0.75) {
      const nx = dx / (distance || 1);
      const ny = dy / (distance || 1);
      if (this.physicsBody) {
        this.physicsBody.velocity.x = nx * speed;
        this.physicsBody.velocity.y = ny * speed;
      }
    } else {
      this.explode();
    }
  }

  private attackPlayer(): void {
    if (this.onHitPlayerCallback) {
      this.onHitPlayerCallback(this.enemyData.attack, this);
    }
  }

  private fireBullet(dx: number, dy: number, distance: number): void {
    if (!this.bullets) return;
    const bullet = this.bullets.get(this.x, this.y, 'enemy_bullet') as Phaser.Physics.Arcade.Image;
    if (!bullet) return;

    bullet.setActive(true);
    bullet.setVisible(true);
    const bb = bullet.body as Phaser.Physics.Arcade.Body;
    bb.reset(this.x, this.y);

    const nx = dx / (distance || 1);
    const ny = dy / (distance || 1);
    const bs = this.enemyData.bulletSpeed || 200;
    bb.velocity.x = nx * bs;
    bb.velocity.y = ny * bs;

    this.scene.time.delayedCall(3000, () => {
      bullet.setActive(false);
      bullet.setVisible(false);
    });
  }

  private explode(): void {
    if (this.explosionTriggered) return;
    this.explosionTriggered = true;
    if (this.onHitPlayerCallback) {
      this.onHitPlayerCallback(this.enemyData.attack, this);
    }
    this.createExplosionEffect();
    this.takeDamage(this.currentHealth);
  }

  /**
   * 敌人受到伤害 - 触发受击闪烁
   */
  takeDamage(amount: number): boolean {
    if (!this.isAlive) return false;

    this.currentHealth -= amount;
    this.updateHealthBar();
    this.playHitFlashEffect();

    if (this.currentHealth <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  /**
   * 受击闪烁效果 - 变红0.2秒后恢复原色
   */
  private playHitFlashEffect(): void {
    if (this.isHitFlashing && this.hitFlashTimer) {
      this.hitFlashTimer.destroy();
    }

    this.isHitFlashing = true;

    this.bodyVisual.setFillStyle(0xff0000, 1);
    this.bodyVisual.setStrokeStyle(3, 0xffff00, 1);

    this.scene.tweens.add({
      targets: this.bodyVisual,
      scaleX: { from: 1.15, to: 1 },
      scaleY: { from: 1.15, to: 1 },
      duration: 150,
      ease: 'Cubic.easeOut'
    });

    this.hitFlashTimer = this.scene.time.delayedCall(200, () => {
      this.bodyVisual.setFillStyle(this.enemyData.color, 1);
      this.bodyVisual.setStrokeStyle(2, this.darkenColor(this.enemyData.color, 0.6), 1);
      this.isHitFlashing = false;
    });
  }

  /**
   * 敌人死亡 - 触发死亡粒子效果
   */
  private die(): void {
    if (!this.isAlive) return;
    this.isAlive = false;

    this.playDeathParticles();

    this.scene.tweens.add({
      targets: this,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: 150,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        if (this.onDeathCallback) this.onDeathCallback();
        this.destroyEnemy();
      }
    });
  }

  /**
   * 死亡粒子效果 - 至少8个颜色粒子向四周飞散
   */
  private playDeathParticles(): void {
    const particleColors = [0xff6b35, 0xffd93d, 0xffffff, 0xff0000, 0x00ff88, 0x4682B4];
    const particleCount = 12;

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const colorIdx = Math.floor(Math.random() * particleColors.length);
      const color = particleColors[colorIdx];
      const size = 3 + Math.random() * 4;
      const travelDist = 45 + Math.random() * 70;
      const lifespan = 450 + Math.random() * 400;

      const particle = this.scene.add.circle(
        this.x,
        this.y,
        size,
        color,
        1
      );
      particle.setDepth(this.depth + 10);
      this.particleSystems.push(particle);

      this.scene.tweens.add({
        targets: particle,
        x: this.x + Math.cos(angle) * travelDist,
        y: this.y + Math.sin(angle) * travelDist,
        alpha: { from: 1, to: 0 },
        scale: { from: 1, to: 0.3 },
        duration: lifespan,
        ease: 'Power2.easeOut',
        onComplete: () => {
          const idx = this.particleSystems.indexOf(particle);
          if (idx !== -1) this.particleSystems.splice(idx, 1);
          particle.destroy();
        }
      });
    }
  }

  /**
   * 自爆爆炸效果 - 环形冲击波+15个粒子
   */
  private createExplosionEffect(): void {
    const radius = this.enemyData.explosionRadius || 100;

    const ring = this.scene.add.circle(this.x, this.y, 5, 0xff6b35, 0.8);
    ring.setDepth(this.depth + 15);
    this.particleSystems.push(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: radius / 5,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        const idx = this.particleSystems.indexOf(ring);
        if (idx !== -1) this.particleSystems.splice(idx, 1);
        ring.destroy();
      }
    });

    for (let i = 0; i < 15; i++) {
      const angle = (i / 15) * Math.PI * 2;
      const c = i % 2 === 0 ? 0xff6b35 : 0xffd93d;
      const p = this.scene.add.circle(this.x, this.y, 4 + Math.random() * 4, c, 1);
      p.setDepth(this.depth + 12);
      this.particleSystems.push(p);
      this.scene.tweens.add({
        targets: p,
        x: this.x + Math.cos(angle) * radius,
        y: this.y + Math.sin(angle) * radius,
        alpha: 0,
        duration: 450,
        ease: 'Power2.easeOut',
        onComplete: () => {
          const idx = this.particleSystems.indexOf(p);
          if (idx !== -1) this.particleSystems.splice(idx, 1);
          p.destroy();
        }
      });
    }

    this.scene.cameras.main.shake(200, 0.008);
  }

  setOnDeathCallback(callback: () => void): void {
    this.onDeathCallback = callback;
  }

  setOnHitPlayerCallback(callback: OnHitCallback): void {
    this.onHitPlayerCallback = callback;
  }

  isActive(): boolean {
    return this.isAlive && this.active;
  }

  getType(): EnemyBehavior {
    return this.enemyData.type;
  }

  getAttackRange(): number {
    return this.enemyData.attackRange;
  }

  getExplosionRadius(): number {
    return this.enemyData.explosionRadius || 0;
  }

  getAttack(): number {
    return this.enemyData.attack;
  }

  getBullets(): Phaser.Physics.Arcade.Group | null {
    return this.bullets;
  }

  private destroyEnemy(): void {
    if (this.bullets) {
      this.bullets.clear(true, true);
    }
    if (this.hitFlashTimer) {
      this.hitFlashTimer.destroy();
    }
    for (const p of this.particleSystems) {
      if (p && p.active) p.destroy();
    }
    this.particleSystems = [];
    super.destroy();
  }

  destroy(): void {
    this.destroyEnemy();
  }
}
