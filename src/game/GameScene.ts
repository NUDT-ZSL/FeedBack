import Phaser from 'phaser';
import { ResourceLoader } from '../utils/ResourceLoader';
import { DifficultyManager } from '../ai/DifficultyManager';
import { EnemySpawner } from '../ai/EnemySpawner';
import { Enemy } from './Enemy';

export class GameScene extends Phaser.Scene {
  private resourceLoader!: ResourceLoader;
  private difficultyManager!: DifficultyManager;
  private enemySpawner!: EnemySpawner;

  private player!: Phaser.Physics.Arcade.Image;
  private playerBody!: Phaser.GameObjects.Arc;
  private playerDirectionIndicator!: Phaser.GameObjects.Arc;
  private playerHealth: number = 100;
  private playerMaxHealth: number = 100;
  private playerSpeed: number = 180;
  private playerFacingAngle: number = -Math.PI / 2;

  private attackCooldown: number = 300;
  private lastAttackTime: number = 0;
  private attackRange: number = 70;
  private attackDamage: number = 25;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private keysW: Phaser.Input.Keyboard.Key | null = null;
  private keysA: Phaser.Input.Keyboard.Key | null = null;
  private keysS: Phaser.Input.Keyboard.Key | null = null;
  private keysD: Phaser.Input.Keyboard.Key | null = null;

  private killCount: number = 0;
  private levelStartTime: number = 0;

  private healthBar!: Phaser.GameObjects.Graphics;
  private healthBarBg!: Phaser.GameObjects.Graphics;
  private scoreText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private difficultyStarsContainer!: Phaser.GameObjects.Container;
  private cooldownCircle!: Phaser.GameObjects.Graphics;
  private difficultyFlashRect!: Phaser.GameObjects.Rectangle;

  private isMobile: boolean = false;
  private scaleFactor: number = 1;
  private touchJoystick: { active: boolean; x: number; y: number } = { active: false, x: 0, y: 0 };
  private touchAttackButton: Phaser.GameObjects.Arc | null = null;
  private touchJoystickBase: Phaser.GameObjects.Arc | null = null;
  private touchJoystickKnob: Phaser.GameObjects.Arc | null = null;

  private gameOver: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    this.resourceLoader = new ResourceLoader(this);
  }

  async create(): Promise<void> {
    await this.resourceLoader.loadResources();
    this.gameOver = false;

    this.isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.scale.width < 800;
    this.scaleFactor = this.isMobile ? 0.75 : 1.0;

    this.difficultyManager = new DifficultyManager();
    this.enemySpawner = new EnemySpawner(this, this.difficultyManager);

    this.setupInput();
    this.createBackground();
    this.createPlayer();
    this.createUI();
    this.setupCollisions();

    this.difficultyManager.setOnDifficultyChange((level) => {
      this.onDifficultyChanged(level);
    });

    this.enemySpawner.start();
    this.levelStartTime = Date.now();
  }

  private setupInput(): void {
    if (!this.input.keyboard) return;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keysW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keysA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keysS = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keysD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

    if (this.isMobile) {
      this.setupTouchControls();
    }
  }

  private setupTouchControls(): void {
    const { width, height } = this.scale;
    const joystickRadius = 50;
    const knobRadius = 25;
    const margin = 80;

    this.touchJoystickBase = this.add.circle(margin, height - margin, joystickRadius, 0x3c5a3c, 0.5)
      .setScrollFactor(0).setDepth(1000).setStrokeStyle(2, 0x1a2a1a, 1);

    this.touchJoystickKnob = this.add.circle(margin, height - margin, knobRadius, 0xe67300, 0.8)
      .setScrollFactor(0).setDepth(1001);

    this.touchAttackButton = this.add.circle(width - margin, height - margin, 40, 0xe67300, 0.7)
      .setScrollFactor(0).setDepth(1000).setStrokeStyle(3, 0x1a2a1a, 1);

    this.add.text(width - margin, height - margin, 'ATK', {
      fontSize: '14px', fontFamily: 'Courier New', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    let joyPtrId: number | null = null;
    let atkPtrId: number | null = null;

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (joyPtrId === null) {
        const d = Phaser.Math.Distance.Between(ptr.x, ptr.y, margin, height - margin);
        if (d < joystickRadius * 2.5) {
          joyPtrId = ptr.id;
          this.touchJoystick.active = true;
        }
      }
      if (atkPtrId === null && this.touchAttackButton) {
        const d = Phaser.Math.Distance.Between(ptr.x, ptr.y, width - margin, height - margin);
        if (d < 60) {
          atkPtrId = ptr.id;
          this.performAttack();
        }
      }
    });

    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (ptr.id === joyPtrId && this.touchJoystickBase && this.touchJoystickKnob) {
        let dx = ptr.x - margin;
        let dy = ptr.y - (height - margin);
        const dist = Math.hypot(dx, dy);
        const max = joystickRadius - knobRadius;
        if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
        this.touchJoystickKnob.x = margin + dx;
        this.touchJoystickKnob.y = height - margin + dy;
        this.touchJoystick.x = dx / max;
        this.touchJoystick.y = dy / max;
      }
    });

    const resetJoy = () => {
      if (this.touchJoystickKnob) {
        this.touchJoystickKnob.x = margin;
        this.touchJoystickKnob.y = height - margin;
      }
      this.touchJoystick.active = false;
      this.touchJoystick.x = 0;
      this.touchJoystick.y = 0;
    };

    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => {
      if (ptr.id === joyPtrId) { joyPtrId = null; resetJoy(); }
      if (ptr.id === atkPtrId) { atkPtrId = null; }
    });
    this.input.on('pointerupoutside', (ptr: Phaser.Input.Pointer) => {
      if (ptr.id === joyPtrId) { joyPtrId = null; resetJoy(); }
      if (ptr.id === atkPtrId) { atkPtrId = null; }
    });
  }

  private createBackground(): void {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    g.fillStyle(0x1a2a1a, 1);
    g.fillRect(0, 0, width, height);

    const count = Math.floor((width * height) / 35000);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const s = 14 + Math.random() * 28;
      const shade = 0x2a4a2a + Math.floor(Math.random() * 0x0f1f0f);
      this.add.circle(x, y, s, shade, 0.35).setDepth(-10);
      this.add.circle(x, y, s * 0.65, 0x1a3a1a, 0.3).setDepth(-11);
    }
    for (let i = 0; i < 40; i++) {
      this.add.circle(Math.random() * width, Math.random() * height, 2 + Math.random() * 3, 0x4a6a4a, 0.3).setDepth(-5);
    }
  }

  private createPlayer(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const s = this.scaleFactor;

    this.playerBody = this.add.circle(0, 0, 16 * s, 0x4a7a4a, 1).setStrokeStyle(3, 0x2a4a2a, 1);
    this.playerDirectionIndicator = this.add.circle(0, -10 * s, 5 * s, 0xe67300, 1);

    const c = this.add.container(cx, cy, [this.playerBody, this.playerDirectionIndicator]);
    c.setSize(32 * s, 32 * s);
    this.physics.add.existing(c);
    this.player = c as unknown as Phaser.Physics.Arcade.Image;

    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    pb.setCircle(16 * s);
    pb.setCollideWorldBounds(true);
    pb.setDamping(true);
    pb.setDrag(0.92, 0.92);
  }

  private createUI(): void {
    const { width, height } = this.scale;
    const s = this.scaleFactor;

    this.difficultyFlashRect = this.add.rectangle(width / 2, height / 2, width, height, 0xffffff, 0)
      .setScrollFactor(0).setDepth(100);

    this.healthBarBg = this.add.graphics().setScrollFactor(0).setDepth(50);
    this.healthBar = this.add.graphics().setScrollFactor(0).setDepth(51);

    this.scoreText = this.add.text(20 * s, 55 * s, '', {
      fontSize: `${16 * s}px`, fontFamily: 'Courier New', color: '#e67300', fontStyle: 'bold',
      backgroundColor: 'rgba(26, 42, 26, 0.75)', padding: { x: 10, y: 6 }
    }).setScrollFactor(0).setDepth(52);

    this.timeText = this.add.text(20 * s, 90 * s, '', {
      fontSize: `${12 * s}px`, fontFamily: 'Courier New', color: '#a0c0a0', fontStyle: 'bold',
      backgroundColor: 'rgba(26, 42, 26, 0.75)', padding: { x: 8, y: 5 }
    }).setScrollFactor(0).setDepth(52);

    this.difficultyStarsContainer = this.add.container(20 * s, height - 40 * s)
      .setScrollFactor(0).setDepth(52);

    this.cooldownCircle = this.add.graphics().setScrollFactor(0).setDepth(52);

    this.updateUI();
  }

  private updateUI(): void {
    if (!this.healthBarBg || !this.healthBar || !this.scoreText || !this.timeText || !this.difficultyStarsContainer || !this.cooldownCircle) return;

    const { width, height } = this.scale;
    const s = this.scaleFactor;

    const hbw = 200 * s;
    const hbh = 18 * s;
    const hbx = 20 * s;
    const hby = 20 * s;

    this.healthBarBg.clear();
    this.healthBarBg.fillStyle(0x0a1a0a, 0.8);
    this.healthBarBg.fillRoundedRect(hbx, hby, hbw, hbh, 6 * s);
    this.healthBarBg.lineStyle(2, 0x3c5a3c, 1);
    this.healthBarBg.strokeRoundedRect(hbx, hby, hbw, hbh, 6 * s);

    const ratio = Math.max(0, this.playerHealth / this.playerMaxHealth);
    const hc = ratio > 0.5
      ? Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(255, 0, 0), new Phaser.Display.Color(0, 200, 100), 100, Math.floor(ratio * 100))
      : ratio > 0.25
      ? Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(255, 0, 0), new Phaser.Display.Color(255, 200, 0), 100, Math.floor(ratio * 200))
      : new Phaser.Display.Color(255, 50, 50);
    const hcObj = hc as Phaser.Types.Display.ColorObject;
    const hci = (hcObj.r << 16) | (hcObj.g << 8) | hcObj.b;

    this.healthBar.clear();
    this.healthBar.fillGradientStyle(hci, hci, this.darken(hci, 0.7), this.darken(hci, 0.7), 1);
    this.healthBar.fillRoundedRect(hbx + 2, hby + 2, (hbw - 4) * ratio, hbh - 4, 4 * s);

    const ht = this.add.text(hbx + hbw / 2, hby + hbh / 2, `${Math.ceil(this.playerHealth)}/${this.playerMaxHealth}`, {
      fontSize: `${12 * s}px`, fontFamily: 'Courier New', color: '#ffffff', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(53);
    this.time.delayedCall(16, () => ht.destroy());

    this.scoreText.setText(`击杀: ${this.killCount}`);
    const elapsedSec = Math.floor((Date.now() - this.levelStartTime) / 1000);
    const mm = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const ss = (elapsedSec % 60).toString().padStart(2, '0');
    this.timeText.setText(`时间: ${mm}:${ss}`);

    this.difficultyStarsContainer.removeAll(true);
    const level = this.difficultyManager.getCurrentLevel();
    const bg = this.add.rectangle(0, 0, 150 * s, 34 * s, 0x1a2a1a, 0.75)
      .setStrokeStyle(2, 0x3c5a3c, 1).setOrigin(0, 0.5);
    this.difficultyStarsContainer.add(bg);

    const diffLabel = this.add.text(8 * s, 0, '难度:', {
      fontSize: `${12 * s}px`, fontFamily: 'Courier New', color: '#a0c0a0', fontStyle: 'bold'
    }).setOrigin(0, 0.5);
    this.difficultyStarsContainer.add(diffLabel);

    for (let i = 0; i < 5; i++) {
      const sx = 60 * s + i * 16 * s;
      const col = i < level ? 0xe67300 : 0x3c5a3c;
      this.difficultyStarsContainer.add(this.makeStar(sx, 0, 7 * s, col));
    }

    this.updateCooldownUI();
  }

  private updateCooldownUI(): void {
    const { width, height } = this.scale;
    const s = this.scaleFactor;
    const cx = width - 50 * s;
    const cy = height - 50 * s;
    const r = 35 * s;

    this.cooldownCircle.clear();
    this.cooldownCircle.lineStyle(1, 0x3c5a3c, 1);
    this.cooldownCircle.strokeCircle(cx, cy, r);
    this.cooldownCircle.fillStyle(0x1a2a1a, 0.75);
    this.cooldownCircle.fillCircle(cx, cy, r - 2);

    const now = Date.now();
    const progress = Math.min(1, (now - this.lastAttackTime) / this.attackCooldown);
    this.cooldownCircle.lineStyle(5, 0xe67300, 1);
    this.cooldownCircle.beginPath();
    this.cooldownCircle.arc(cx, cy, r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, false);
    this.cooldownCircle.strokePath();

    const ct = this.add.text(cx, cy, 'ATK', {
      fontSize: `${12 * s}px`, fontFamily: 'Courier New', color: progress >= 1 ? '#00ff88' : '#666666', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(53);
    this.time.delayedCall(16, () => ct.destroy());
  }

  private darken(color: number, f: number): number {
    const r = Math.floor(((color >> 16) & 0xff) * f);
    const g = Math.floor(((color >> 8) & 0xff) * f);
    const b = Math.floor((color & 0xff) * f);
    return (r << 16) | (g << 8) | b;
  }

  private makeStar(x: number, y: number, r: number, color: number): Phaser.GameObjects.Polygon {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.45;
      pts.push(x + Math.cos(a) * rr);
      pts.push(y + Math.sin(a) * rr);
    }
    return this.add.polygon(0, 0, pts, color, 1).setStrokeStyle(1, 0x1a2a1a, 1);
  }

  private setupCollisions(): void {
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.updatePlayerMovement(delta);
    this.checkAttackInput();

    const enemies = this.enemySpawner.getAllEnemies();
    for (const enemy of enemies) {
      if (!enemy.isActive()) continue;
      enemy.setOnHitPlayerCallback((dmg, src) => this.onEnemyHitPlayer(dmg, src));
      this.checkEnemyBulletCollisions(enemy);
    }

    this.enemySpawner.update(time, delta, this.player.x, this.player.y);
    this.updateUI();

    this.difficultyManager.updateMetrics({
      playerHealth: this.playerHealth,
      killCount: this.killCount,
      levelTime: (Date.now() - this.levelStartTime) / 1000
    });
  }

  private updatePlayerMovement(delta: number): void {
    let mx = 0, my = 0;
    if (this.cursors.left.isDown || (this.keysA && this.keysA.isDown)) mx -= 1;
    if (this.cursors.right.isDown || (this.keysD && this.keysD.isDown)) mx += 1;
    if (this.cursors.up.isDown || (this.keysW && this.keysW.isDown)) my -= 1;
    if (this.cursors.down.isDown || (this.keysS && this.keysS.isDown)) my += 1;
    if (this.touchJoystick.active) { mx += this.touchJoystick.x; my += this.touchJoystick.y; }

    const mag = Math.hypot(mx, my);
    if (mag > 0) {
      mx /= mag; my /= mag;
      const target = Math.atan2(my, mx);
      this.playerFacingAngle = Phaser.Math.Angle.RotateTo(this.playerFacingAngle, target, 0.25);
      this.playerBody.rotation = this.playerFacingAngle + Math.PI / 2;
      this.playerDirectionIndicator.x = Math.cos(this.playerFacingAngle) * 10 * this.scaleFactor;
      this.playerDirectionIndicator.y = Math.sin(this.playerFacingAngle) * 10 * this.scaleFactor;
      const pb = this.player.body as Phaser.Physics.Arcade.Body;
      pb.velocity.x = mx * this.playerSpeed;
      pb.velocity.y = my * this.playerSpeed;
    } else {
      const pb = this.player.body as Phaser.Physics.Arcade.Body;
      pb.velocity.x *= 0.85;
      pb.velocity.y *= 0.85;
    }
  }

  private checkAttackInput(): void {
    if (this.input.keyboard && Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.performAttack();
    }
  }

  private performAttack(): void {
    const now = Date.now();
    if (now - this.lastAttackTime < this.attackCooldown) return;
    this.lastAttackTime = now;

    const angle = this.playerFacingAngle;
    const spread = Math.PI / 3;
    const half = spread / 2;
    this.createAttackVisual(angle, spread);

    const enemies = this.enemySpawner.getActiveEnemies();
    for (const enemy of enemies) {
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= this.attackRange) {
        const ea = Math.atan2(dy, dx);
        let diff = Math.abs(ea - angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff <= half) {
          const killed = enemy.takeDamage(this.attackDamage);
          if (killed) this.killCount++;
        }
      }
    }
  }

  private createAttackVisual(angle: number, spread: number): void {
    const g = this.add.graphics();
    const half = spread / 2;
    const segs = 12;
    g.lineStyle(3, 0x00ffff, 0.8);
    g.fillStyle(0x00ffff, 0.25);
    g.beginPath();
    g.moveTo(this.player.x, this.player.y);
    for (let i = 0; i <= segs; i++) {
      const a = angle - half + spread * (i / segs);
      g.lineTo(this.player.x + Math.cos(a) * this.attackRange, this.player.y + Math.sin(a) * this.attackRange);
    }
    g.closePath();
    g.fillPath();
    g.strokePath();
    this.tweens.add({
      targets: g, alpha: 0, scale: 1.15, duration: 200, ease: 'Cubic.easeOut',
      onComplete: () => g.destroy()
    });
  }

  private checkEnemyBulletCollisions(enemy: Enemy): void {
    const bullets = enemy.getBullets();
    if (!bullets) return;
    const pb = this.player.body as Phaser.Physics.Arcade.Body;

    bullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      const bb = b.body as Phaser.Physics.Arcade.Body;
      const d = Phaser.Math.Distance.Between(bb.x, bb.y, pb.x, pb.y);
      if (d < 22) {
        b.setActive(false);
        b.setVisible(false);
        this.damagePlayer(enemy.getAttack());
      }
    });
  }

  private onEnemyHitPlayer(damage: number, _enemy: Enemy): void {
    this.damagePlayer(damage);
    this.difficultyManager.recordPlayerHit();
  }

  private damagePlayer(amount: number): void {
    if (this.gameOver) return;
    this.playerHealth = Math.max(0, this.playerHealth - amount);
    this.cameras.main.shake(150, 0.004 * amount);

    const flash = this.add.rectangle(this.player.x, this.player.y, 60, 60, 0xff0000, 0.4);
    this.tweens.add({ targets: flash, alpha: 0, scale: 2, duration: 250, onComplete: () => flash.destroy() });

    if (this.playerHealth <= 0) this.onPlayerDeath();
  }

  private onPlayerDeath(): void {
    this.gameOver = true;
    this.enemySpawner.stop();
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setScrollFactor(0).setDepth(190);

    this.add.text(width / 2, height / 2 - 20, '你被击败了！', {
      fontSize: '48px', fontFamily: 'Courier New', color: '#ff4444', fontStyle: 'bold',
      backgroundColor: 'rgba(0,0,0,0.75)', padding: { x: 30, y: 20 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);

    const elapsedSec = Math.floor((Date.now() - this.levelStartTime) / 1000);
    const mm = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const ss = (elapsedSec % 60).toString().padStart(2, '0');
    const level = this.difficultyManager.getCurrentLevel();

    this.add.text(width / 2, height / 2 + 70,
      `击杀数: ${this.killCount}  存活时间: ${mm}:${ss}  最高难度: ${level}星`, {
      fontSize: '18px', fontFamily: 'Courier New', color: '#e67300'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.add.text(width / 2, height / 2 + 110, '点击屏幕或按任意键重新开始', {
      fontSize: '16px', fontFamily: 'Courier New', color: '#a0c0a0'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(201);

    this.input.once('pointerdown', () => this.restartGame());
    this.input.keyboard?.once('keydown', () => this.restartGame());
  }

  private restartGame(): void {
    this.enemySpawner.destroy();
    this.killCount = 0;
    this.playerHealth = this.playerMaxHealth;
    this.difficultyManager.reset();
    this.levelStartTime = Date.now();
    this.gameOver = false;

    const { width, height } = this.scale;
    this.player.x = width / 2;
    this.player.y = height / 2;
    (this.player.body as Phaser.Physics.Arcade.Body).velocity.set(0, 0);

    this.enemySpawner = new EnemySpawner(this, this.difficultyManager);
    this.difficultyManager.setOnDifficultyChange((level) => this.onDifficultyChanged(level));
    this.enemySpawner.start();
  }

  private onDifficultyChanged(newLevel: number): void {
    this.enemySpawner.onDifficultyChanged();
    this.tweens.add({
      targets: this.difficultyFlashRect,
      alpha: { from: 0, to: 0.35, duration: 100 },
      yoyo: true, hold: 150, duration: 500, ease: 'Linear'
    });

    const { width, height } = this.scale;
    const t = this.add.text(width / 2, 100, `难度 Lv.${newLevel}!`, {
      fontSize: '28px', fontFamily: 'Courier New', color: '#e67300', fontStyle: 'bold',
      stroke: '#1a2a1a', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(150);

    this.tweens.add({
      targets: t, y: 180, alpha: 0, duration: 1800, ease: 'Cubic.easeIn',
      onComplete: () => t.destroy()
    });
  }
}
