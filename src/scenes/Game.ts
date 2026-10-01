import Phaser from 'phaser';
import {
  createRandomPattern,
  EnemyBulletConfig,
  clearBulletTextureCache
} from '../gameobjects/BulletPatterns';

interface EnemyData {
  hp: number;
  isArmor: boolean;
  baseX: number;
  baseSpeed: number;
  age: number;
  berserk: boolean;
  lastShot: number;
}

export class Game extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;

  private playerLives: number = 3;
  private isInvincible: boolean = false;
  private invincibleTimer: number = 0;
  private blinkTimer: number = 0;

  private playerBullets!: Phaser.Physics.Arcade.Group;
  private lastFireTime: number = 0;
  private fireRate: number = 125;

  private enemies!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;

  private currentWave: number = 0;
  private waveTimer: number = 0;
  private waveDuration: number = 30000;
  private waveEnemiesSpawned: number = 0;
  private spawnTimer: number = 0;
  private spawnInterval: number = 1500;

  private score: number = 0;
  private displayScore: number = 0;
  private energy: number = 0;
  private maxEnergy: number = 100;
  private killCount: number = 0;
  private survivalTime: number = 0;
  private isGameOver: boolean = false;

  private scoreText!: Phaser.GameObjects.Text;
  private energyBarBg!: Phaser.GameObjects.Graphics;
  private energyBar!: Phaser.GameObjects.Graphics;
  private livesContainer!: Phaser.GameObjects.Container;
  private nukeIcon!: Phaser.GameObjects.Image;
  private nukeGlow!: Phaser.GameObjects.Image;
  private nukeGlowTween: Phaser.Tweens.Tween | null = null;
  private nukeReady: boolean = false;

  private trailParticles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private gameWidth: number = 800;
  private gameHeight: number = 600;

  private gameOverOverlay!: Phaser.GameObjects.Graphics;
  private gameOverPanel!: Phaser.GameObjects.Container;

  private shockwave!: Phaser.GameObjects.Graphics;
  private whiteFlash!: Phaser.GameObjects.Graphics;

  private enemyBulletColor: number = 0xf0e68c;
  private enemyBulletSpeed: number = 140;
  private spiralTimeOffset: number = 0;

  private starfield!: Phaser.GameObjects.Graphics;
  private stars: { x: number; y: number; speed: number; size: number }[] = [];

  constructor() {
    super({ key: 'Game' });
  }

  init(): void {
    this.playerLives = 3;
    this.isInvincible = false;
    this.invincibleTimer = 0;
    this.blinkTimer = 0;
    this.lastFireTime = 0;
    this.currentWave = 0;
    this.waveTimer = 0;
    this.waveEnemiesSpawned = 0;
    this.spawnTimer = 0;
    this.score = 0;
    this.displayScore = 0;
    this.energy = 0;
    this.killCount = 0;
    this.survivalTime = 0;
    this.isGameOver = false;
    this.nukeReady = false;
    this.enemyBulletColor = 0xf0e68c;
    this.spiralTimeOffset = 0;
    clearBulletTextureCache();
  }

  create(): void {
    this.gameWidth = this.scale.width;
    this.gameHeight = this.scale.height;

    this.createStarfield();
    this.createPlayer();
    this.setupInput();
    this.setupGroups();
    this.setupCollisions();
    this.createUI();
    this.startNextWave();

    this.scale.on('resize', this.handleResize, this);
  }

  createStarfield(): void {
    this.starfield = this.add.graphics();
    this.starfield.setDepth(-100);
    this.stars = [];
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        x: Phaser.Math.Between(0, this.gameWidth),
        y: Phaser.Math.Between(0, this.gameHeight),
        speed: Phaser.Math.Between(20, 80),
        size: Phaser.Math.Between(1, 2)
      });
    }
    this.drawStars();
  }

  drawStars(): void {
    this.starfield.clear();
    this.stars.forEach(s => {
      this.starfield.fillStyle(0xffffff, Phaser.Math.Clamp(s.speed / 80, 0.3, 1));
      this.starfield.fillRect(s.x, s.y, s.size, s.size);
    });
  }

  createPlayer(): void {
    this.player = this.physics.add.sprite(this.gameWidth / 2, this.gameHeight - 80, 'player_ship');
    this.player.setCollideWorldBounds(true);
    this.player.setCircle(6);
    this.player.body!.setOffset(2, 4);
    this.player.setDepth(10);

    this.trailParticles = this.add.particles(0, 0, 'particle_blue', {
      x: this.player.x,
      y: this.player.y + 10,
      lifespan: 300,
      speedY: { min: 30, max: 80 },
      scale: { start: 1, end: 0 },
      alpha: { start: 0.6, end: 0 },
      blendMode: 'ADD',
      frequency: 50,
      depth: 9
    });
  }

  setupInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  }

  setupGroups(): void {
    this.playerBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      maxSize: 100,
      runChildUpdate: true
    });

    this.enemies = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      maxSize: 200,
      runChildUpdate: true
    });

    this.enemyBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      maxSize: 500,
      runChildUpdate: true
    });
  }

  setupCollisions(): void {
    this.physics.add.overlap(
      this.playerBullets,
      this.enemies,
      this.handlePlayerBulletHitEnemy,
      undefined,
      this
    );

    this.physics.add.overlap(
      this.player,
      this.enemies,
      this.handlePlayerHitEnemy,
      () => !this.isInvincible,
      this
    );

    this.physics.add.overlap(
      this.player,
      this.enemyBullets,
      this.handlePlayerHitBullet,
      () => !this.isInvincible,
      this
    );
  }

  createUI(): void {
    this.scoreText = this.add.text(16, 16, '0', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '16px',
      color: '#ffffff'
    });
    this.scoreText.setDepth(100);
    this.scoreText.setScrollFactor(0);

    this.energyBarBg = this.add.graphics();
    this.energyBarBg.fillStyle(0x333333, 0.8);
    this.energyBarBg.fillRect(16, 44, 200, 16);
    this.energyBarBg.setDepth(100);
    this.energyBarBg.setScrollFactor(0);

    this.energyBar = this.add.graphics();
    this.updateEnergyBar();
    this.energyBar.setDepth(101);
    this.energyBar.setScrollFactor(0);

    const energyLabel = this.add.text(16, 64, 'ENERGY', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '8px',
      color: '#888888'
    });
    energyLabel.setDepth(100);
    energyLabel.setScrollFactor(0);

    this.livesContainer = this.add.container(16, 84);
    this.livesContainer.setDepth(100);
    this.livesContainer.setScrollFactor(0);
    this.updateLivesUI();

    this.nukeIcon = this.add.image(this.gameWidth - 40, this.gameHeight - 40, 'nuke_icon');
    this.nukeIcon.setDepth(100);
    this.nukeIcon.setScrollFactor(0);
    this.nukeIcon.setAlpha(0.3);
    this.nukeIcon.setScale(1.2);

    this.nukeGlow = this.add.image(this.gameWidth - 40, this.gameHeight - 40, 'nuke_icon');
    this.nukeGlow.setDepth(99);
    this.nukeGlow.setScrollFactor(0);
    this.nukeGlow.setAlpha(0);
    this.nukeGlow.setScale(1.4);
    this.nukeGlow.setTint(0xffffff);
  }

  updateLivesUI(): void {
    this.livesContainer.removeAll(true);
    for (let i = 0; i < this.playerLives; i++) {
      const heart = this.add.image(i * 28, 0, 'heart_icon');
      heart.setScale(2);
      heart.setOrigin(0, 0);
      this.livesContainer.add(heart);
    }
  }

  updateEnergyBar(): void {
    this.energyBar.clear();
    const ratio = Math.min(this.energy / this.maxEnergy, 1);
    const width = 200 * ratio;
    const color1 = 0x00ff00;
    const color2 = 0x88ff88;
    this.energyBar.fillGradientStyle(color2, color2, color1, color1, 1);
    this.energyBar.fillRect(16, 44, width, 16);
  }

  startNextWave(): void {
    this.currentWave++;
    this.waveEnemiesSpawned = 0;
    this.spawnTimer = 0;

    if (this.currentWave === 1) {
      this.enemyBulletColor = 0xf0e68c;
    } else if (this.currentWave === 2) {
      this.enemyBulletColor = 0xff6347;
    } else {
      this.enemyBulletColor = 0xee82ee;
    }
  }

  getWaveEnemyCount(): number {
    if (this.currentWave === 1) return 15;
    if (this.currentWave === 2) return 20;
    return 15 + (this.currentWave - 1) * 5;
  }

  spawnEnemy(): void {
    const x = Phaser.Math.Between(40, this.gameWidth - 40);
    const y = -30;
    const isArmor = this.currentWave >= 2 && Math.random() < 0.3;
    const texture = isArmor ? 'enemy_armor' : 'enemy_normal';

    const enemy = this.enemies.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
    if (!enemy) return;

    enemy.setActive(true);
    enemy.setVisible(true);
    enemy.body.reset(x, y);
    enemy.setScale(isArmor ? 1.5 : 1);
    enemy.setDepth(5);

    if (isArmor) {
      enemy.setCircle(10);
      enemy.body.setOffset(2, 2);
    } else {
      enemy.setCircle(6);
      enemy.body.setOffset(2, 2);
    }

    const data: EnemyData = {
      hp: isArmor ? 3 : 1,
      isArmor,
      baseX: x,
      baseSpeed: isArmor ? 50 : 80,
      age: 0,
      berserk: false,
      lastShot: 0
    };
    enemy.setData('enemyData', data);

    this.waveEnemiesSpawned++;

    this.createEnemyAfterimage(enemy);
  }

  createEnemyAfterimage(enemy: Phaser.Physics.Arcade.Sprite): void {
    const afterimage = this.add.image(enemy.x, enemy.y, enemy.texture.key);
    afterimage.setScale(enemy.scale);
    afterimage.setAlpha(0.5);
    afterimage.setDepth(4);
    afterimage.setTint(0x8888ff);
    this.tweens.add({
      targets: afterimage,
      alpha: 0,
      duration: 150,
      ease: 'Linear',
      onComplete: () => afterimage.destroy()
    });
  }

  handleResize(gameSize: Phaser.Structs.Size): void {
    this.gameWidth = gameSize.width;
    this.gameHeight = gameSize.height;

    if (this.player) {
      this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.gameWidth - 20);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.gameHeight - 20);
    }

    if (this.nukeIcon) {
      this.nukeIcon.setPosition(this.gameWidth - 40, this.gameHeight - 40);
    }
    if (this.nukeGlow) {
      this.nukeGlow.setPosition(this.gameWidth - 40, this.gameHeight - 40);
    }
  }

  update(time: number, delta: number): void {
    if (this.isGameOver) return;

    const dt = delta / 1000;
    this.survivalTime += dt;
    this.spiralTimeOffset += dt * 2;

    this.updateStars(dt);
    this.updatePlayer(dt, time);
    this.updateEnemies(dt, time);
    this.updateBullets();
    this.updateWave(dt, time);
    this.updateScore(dt);
    this.checkNuke();
  }

  updateStars(dt: number): void {
    this.stars.forEach(s => {
      s.y += s.speed * dt;
      if (s.y > this.gameHeight) {
        s.y = 0;
        s.x = Phaser.Math.Between(0, this.gameWidth);
      }
    });
    this.drawStars();
  }

  updatePlayer(_dt: number, time: number): void {
    const speed = 260;
    let vx = 0;
    let vy = 0;
    let dirX = 0;

    if (this.cursors.left.isDown || this.keyA.isDown) {
      vx = -speed;
      dirX = -1;
    }
    if (this.cursors.right.isDown || this.keyD.isDown) {
      vx = speed;
      dirX = 1;
    }
    if (this.cursors.up.isDown || this.keyW.isDown) {
      vy = -speed;
    }
    if (this.cursors.down.isDown || this.keyS.isDown) {
      vy = speed;
    }

    this.player.setVelocity(vx, vy);

    if (dirX < 0) {
      this.player.setTexture('player_left');
    } else if (dirX > 0) {
      this.player.setTexture('player_right');
    } else {
      this.player.setTexture('player_ship');
    }

    this.trailParticles.setPosition(this.player.x, this.player.y + 10);

    if (this.isInvincible) {
      this.invincibleTimer -= delta;
      this.blinkTimer += delta;
      if (this.blinkTimer >= 100) {
        this.blinkTimer = 0;
        this.player.alpha = this.player.alpha <= 0.3 ? 1 : 0.2;
      }
      if (this.invincibleTimer <= 0) {
        this.isInvincible = false;
        this.player.alpha = 1;
      }
    }

    if (this.keySpace.isDown && time - this.lastFireTime >= this.fireRate) {
      this.firePlayerBullet();
      this.lastFireTime = time;
    }

    if (this.keyE.isDown && this.nukeReady && this.energy >= this.maxEnergy) {
      this.triggerNuke();
    }
  }

  firePlayerBullet(): void {
    const bullet = this.playerBullets.get(this.player.x, this.player.y - 12, 'player_bullet') as Phaser.Physics.Arcade.Sprite;
    if (!bullet) return;
    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.body.reset(this.player.x, this.player.y - 12);
    bullet.setVelocity(0, -600);
    bullet.setDepth(8);
    bullet.body.setCircle(2);
  }

  updateEnemies(dt: number, time: number): void {
    this.enemies.getChildren().forEach(child => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return;
      const data = enemy.getData('enemyData') as EnemyData;
      data.age += dt;

      const waveX = Math.sin(data.age * 3 + data.baseX * 0.01) * 50;
      enemy.x = data.baseX + waveX;
      enemy.y += data.baseSpeed * dt;

      const aliveCount = this.enemies.countActive();
      if (!data.berserk && aliveCount < 5) {
        data.berserk = true;
        enemy.setTint(0xff4444);
      }

      if (data.berserk && time - data.lastShot > 800) {
        this.enemyFire(enemy, data);
        data.lastShot = time;
      }

      if (enemy.y > this.gameHeight + 40) {
        enemy.setActive(false);
        enemy.setVisible(false);
      }
    });
  }

  enemyFire(enemy: Phaser.Physics.Arcade.Sprite, data: EnemyData): void {
    const config: EnemyBulletConfig = {
      x: enemy.x,
      y: enemy.y + 10,
      color: this.enemyBulletColor,
      speed: this.enemyBulletSpeed,
      scene: this,
      pool: this.enemyBullets
    };
    createRandomPattern(config, this.spiralTimeOffset + data.baseX);
  }

  updateBullets(): void {
    this.playerBullets.getChildren().forEach(child => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b.active && (b.y < -20 || b.y > this.gameHeight + 20 || b.x < -20 || b.x > this.gameWidth + 20)) {
        b.setActive(false);
        b.setVisible(false);
      }
    });

    this.enemyBullets.getChildren().forEach(child => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b.active && (b.y < -20 || b.y > this.gameHeight + 20 || b.x < -20 || b.x > this.gameWidth + 20)) {
        b.setActive(false);
        b.setVisible(false);
      }
    });
  }

  updateWave(dt: number, _time: number): void {
    this.waveTimer += dt * 1000;
    const totalEnemies = this.getWaveEnemyCount();

    if (this.waveEnemiesSpawned < totalEnemies) {
      this.spawnTimer += dt * 1000;
      if (this.spawnTimer >= this.spawnInterval) {
        this.spawnEnemy();
        this.spawnTimer = 0;
      }
    }

    if (this.waveTimer >= this.waveDuration && this.enemies.countActive() === 0 && this.waveEnemiesSpawned >= totalEnemies) {
      this.waveTimer = 0;
      this.startNextWave();
    }
  }

  updateScore(dt: number): void {
    if (this.displayScore < this.score) {
      const diff = this.score - this.displayScore;
      const inc = Math.max(1, Math.ceil(diff * dt * 8));
      this.displayScore = Math.min(this.displayScore + inc, this.score);
      this.scoreText.setText(String(this.displayScore));
    }
  }

  checkNuke(): void {
    const shouldReady = this.energy >= this.maxEnergy;
    if (shouldReady && !this.nukeReady) {
      this.nukeReady = true;
      this.nukeIcon.setAlpha(1);
      this.nukeGlowTween = this.tweens.add({
        targets: this.nukeGlow,
        alpha: { from: 0, to: 0.8 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    } else if (!shouldReady && this.nukeReady) {
      this.nukeReady = false;
      if (this.nukeGlowTween) {
        this.nukeGlowTween.stop();
        this.nukeGlowTween = null;
      }
      this.tweens.add({
        targets: [this.nukeIcon, this.nukeGlow],
        alpha: 0.3,
        duration: 300,
        ease: 'Linear'
      });
      this.nukeGlow.setAlpha(0);
    }
  }

  triggerNuke(): void {
    this.energy = 0;
    this.updateEnergyBar();

    this.whiteFlash = this.add.graphics();
    this.whiteFlash.fillStyle(0xffffff, 1);
    this.whiteFlash.fillRect(0, 0, this.gameWidth, this.gameHeight);
    this.whiteFlash.setDepth(200);
    this.whiteFlash.setScrollFactor(0);
    this.tweens.add({
      targets: this.whiteFlash,
      alpha: 0,
      duration: 200,
      onComplete: () => this.whiteFlash.destroy()
    });

    this.enemies.getChildren().forEach(child => {
      const enemy = child as Phaser.Physics.Arcade.Sprite;
      if (enemy.active) {
        this.createExplosion(enemy.x, enemy.y, false);
        const data = enemy.getData('enemyData') as EnemyData;
        if (data) {
          this.addScore(data.isArmor ? 30 : 10);
          this.addEnergy(data.isArmor ? 15 : 5);
          this.killCount++;
        }
        enemy.setActive(false);
        enemy.setVisible(false);
      }
    });

    this.enemyBullets.clear(true, true);

    this.shockwave = this.add.graphics();
    this.shockwave.lineStyle(8, 0x888888, 1);
    this.shockwave.setDepth(199);
    this.shockwave.setScrollFactor(0);
    let waveY = this.gameHeight;
    this.tweens.addCounter({
      from: this.gameHeight,
      to: -50,
      duration: 800,
      ease: 'Linear',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        waveY = tween.getValue();
        this.shockwave.clear();
        this.shockwave.lineStyle(8, 0xcccccc, 1 - (waveY / this.gameHeight));
        this.shockwave.beginPath();
        this.shockwave.moveTo(0, waveY);
        this.shockwave.lineTo(this.gameWidth, waveY);
        this.shockwave.strokePath();
      },
      onComplete: () => this.shockwave.destroy()
    });
  }

  handlePlayerBulletHitEnemy(
    bulletObj: Phaser.GameObjects.GameObject,
    enemyObj: Phaser.GameObjects.GameObject
  ): void {
    const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
    const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;

    bullet.setActive(false);
    bullet.setVisible(false);

    const data = enemy.getData('enemyData') as EnemyData;
    if (!data) return;
    data.hp--;

    this.createHitParticles(bullet.x, bullet.y);

    if (data.hp <= 0) {
      this.createExplosion(enemy.x, enemy.y, data.isArmor);
      this.addScore(data.isArmor ? 30 : 10);
      this.addEnergy(data.isArmor ? 15 : 5);
      this.killCount++;
      enemy.setActive(false);
      enemy.setVisible(false);
    }
  }

  handlePlayerHitEnemy(
    _playerObj: Phaser.GameObjects.GameObject,
    _enemyObj: Phaser.GameObjects.GameObject
  ): void {
    this.playerHit();
  }

  handlePlayerHitBullet(
    _playerObj: Phaser.GameObjects.GameObject,
    bulletObj: Phaser.GameObjects.GameObject
  ): void {
    const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
    bullet.setActive(false);
    bullet.setVisible(false);
    this.playerHit();
  }

  playerHit(): void {
    this.createExplosion(this.player.x, this.player.y, false, true);
    this.playerLives--;
    this.updateLivesUI();
    this.isInvincible = true;
    this.invincibleTimer = 1500;
    this.blinkTimer = 0;

    if (this.playerLives <= 0) {
      this.gameOver();
    }
  }

  createHitParticles(x: number, y: number): void {
    const emitter = this.add.particles(x, y, 'particle_hit', {
      lifespan: 300,
      speed: { min: 50, max: 150 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      quantity: 4,
      depth: 20
    });
    this.time.delayedCall(350, () => emitter.destroy());
  }

  createExplosion(x: number, y: number, isArmor: boolean, isPlayer: boolean = false): void {
    const color = isPlayer ? 0xff6e40 : (isArmor ? 0x90a4ae : 0xff5252);
    const texture = isPlayer ? 'particle_hit' : 'particle_enemy';
    const count = isPlayer ? 8 : 8;

    const emitter = this.add.particles(x, y, texture, {
      lifespan: 400,
      speed: { min: 60, max: 200 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      quantity: count,
      tint: color,
      depth: 20
    });
    this.time.delayedCall(450, () => emitter.destroy());
  }

  addScore(points: number): void {
    this.score += points;
  }

  addEnergy(amount: number): void {
    this.energy = Math.min(this.energy + amount, this.maxEnergy);
    this.updateEnergyBar();
  }

  gameOver(): void {
    this.isGameOver = true;
    this.player.setActive(false);
    this.player.setVisible(false);
    this.trailParticles.stop();

    this.gameOverOverlay = this.add.graphics();
    this.gameOverOverlay.fillStyle(0x000000, 0);
    this.gameOverOverlay.fillRect(0, 0, this.gameWidth, this.gameHeight);
    this.gameOverOverlay.setDepth(300);
    this.gameOverOverlay.setScrollFactor(0);

    this.tweens.add({
      targets: this.gameOverOverlay,
      alpha: 0.7,
      duration: 500,
      ease: 'Linear',
      onComplete: () => this.showGameOverPanel()
    });
  }

  showGameOverPanel(): void {
    this.gameOverPanel = this.add.container(this.gameWidth / 2, this.gameHeight / 2);
    this.gameOverPanel.setDepth(301);
    this.gameOverPanel.setScrollFactor(0);

    const panelWidth = 360;
    const panelHeight = 320;

    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 0.95);
    bg.fillRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight);
    bg.lineStyle(3, 0x4fc3f7, 1);
    bg.strokeRect(-panelWidth / 2, -panelHeight / 2, panelWidth, panelHeight);

    const title = this.add.text(0, -120, 'GAME OVER', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '24px',
      color: '#ff1744'
    });
    title.setOrigin(0.5);

    const scoreLabel = this.add.text(0, -50, `SCORE: ${this.score}`, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#ffffff'
    });
    scoreLabel.setOrigin(0.5);

    const killsLabel = this.add.text(0, -10, `KILLS: ${this.killCount}`, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#ffffff'
    });
    killsLabel.setOrigin(0.5);

    const timeLabel = this.add.text(0, 30, `TIME: ${Math.floor(this.survivalTime)}s`, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#ffffff'
    });
    timeLabel.setOrigin(0.5);

    const btnBg = this.add.graphics();
    btnBg.fillStyle(0x29b6f6, 1);
    btnBg.fillRect(-80, 80, 160, 50);

    const btnText = this.add.text(0, 105, 'RESTART', {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: '14px',
      color: '#ffffff'
    });
    btnText.setOrigin(0.5);

    const restartBtn = this.add.container(0, 0, [btnBg, btnText]);
    restartBtn.setSize(160, 50);
    restartBtn.setInteractive(new Phaser.Geom.Rectangle(-80, 80, 160, 50), Phaser.Geom.Rectangle.Contains);

    restartBtn.on('pointerover', () => {
      restartBtn.setScale(1.1);
      btnBg.clear();
      btnBg.fillStyle(0xffd700, 1);
      btnBg.fillRect(-80, 80, 160, 50);
    });

    restartBtn.on('pointerout', () => {
      restartBtn.setScale(1);
      btnBg.clear();
      btnBg.fillStyle(0x29b6f6, 1);
      btnBg.fillRect(-80, 80, 160, 50);
    });

    restartBtn.on('pointerdown', () => {
      this.scale.off('resize', this.handleResize, this);
      this.scene.restart();
    });

    this.gameOverPanel.add([bg, title, scoreLabel, killsLabel, timeLabel, restartBtn]);
  }
}
