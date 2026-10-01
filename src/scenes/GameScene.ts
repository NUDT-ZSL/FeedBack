import Phaser from 'phaser';
import { TradeManager, MINERALS, Mineral } from '../managers/TradeManager';

const GAME_WIDTH = 1280;
const GAME_HEIGHT = 720;

interface Star {
  sprite: Phaser.GameObjects.Rectangle;
  phase: number;
  period: number;
}

interface Asteroid {
  container: Phaser.GameObjects.Container;
  shape: Phaser.GameObjects.Polygon;
  label: Phaser.GameObjects.Text;
  miningRing: Phaser.GameObjects.Graphics;
  mineral: Mineral;
  reserves: number;
  maxReserves: number;
  brightness: number;
  size: number;
  miningAngle: number;
}

interface Station {
  container: Phaser.GameObjects.Container;
  rect: Phaser.GameObjects.Rectangle;
  beam: Phaser.GameObjects.Rectangle;
  id: string;
  name: string;
  beamPhase: number;
}

interface Particle {
  rect: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

interface Pirate {
  triangle: Phaser.GameObjects.Polygon;
  vx: number;
  vy: number;
  state: 'approaching' | 'fighting' | 'turning' | 'leaving';
  turnTimer: number;
  targetAngle: number;
  currentAngle: number;
}

interface AsteroidFragment {
  rect: Phaser.GameObjects.Rectangle;
  vx: number;
  vy: number;
  life: number;
  rotation: number;
  rotationSpeed: number;
}

export class GameScene extends Phaser.Scene {
  private tradeManager!: TradeManager;
  private keys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };

  private player!: Phaser.GameObjects.Polygon;
  private playerVx = 0;
  private playerVy = 0;
  private playerAngle = -Math.PI / 2;
  private playerSpeed = 150;

  private stars: Star[] = [];
  private asteroids: Asteroid[] = [];
  private stations: Station[] = [];
  private particles: Particle[] = [];
  private fragments: AsteroidFragment[] = [];
  private pirates: Pirate[] = [];

  private energy = 100;
  private maxEnergy = 100;
  private isMining = false;
  private miningTarget: Asteroid | null = null;
  private miningTimer = 0;
  private miningDimmingTimer = 0;

  private hudBg!: Phaser.GameObjects.Rectangle;
  private energyBar!: Phaser.GameObjects.Graphics;
  private valueText!: Phaser.GameObjects.Text;
  private minedText!: Phaser.GameObjects.Text;
  private dangerText!: Phaser.GameObjects.Text;
  private cargoText!: Phaser.GameObjects.Text;

  private eventTimer = 0;
  private dangerCount = 0;
  private piratesAvoided = 0;
  private startTime = 0;

  private tradePanel: Phaser.GameObjects.Container | null = null;
  private activeStationId: string | null = null;
  private isTrading = false;

  private warningFlash!: Phaser.GameObjects.Graphics;
  private warningTimer = 0;
  private shakeTimer = 0;
  private shakeIntensity = 0;
  private tradeRing!: Phaser.GameObjects.Graphics;
  private tradeRingTimer = 0;
  private hitFlash!: Phaser.GameObjects.Rectangle;
  private hitFlashTimer = 0;

  private victoryPanel: Phaser.GameObjects.Container | null = null;
  private victoryGlow!: Phaser.GameObjects.Graphics;
  private victoryGlowScale = 0;
  private victoryGlowTimer = 0;
  private isVictory = false;
  private victoryFloatPhase = 0;

  private chargingStationId: string | null = null;
  private chargeTimer = 0;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.tradeManager = new TradeManager();
    this.startTime = Date.now();

    const { W, A, S, D, SPACE } = this.input.keyboard!.addKeys('W,A,S,D,SPACE') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key; SPACE: Phaser.Input.Keyboard.Key };
    this.keys = { W, A, S, D, SPACE };

    this.createStars();
    this.createPlayer();
    this.createAsteroids();
    this.createStations();
    this.createHUD();
    this.createEffects();

    this.scale.on('resize', this.handleResize, this);
    this.handleResize();
  }

  private handleResize(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const scaleX = w / GAME_WIDTH;
    const scaleY = h / GAME_HEIGHT;
    const scale = Math.min(scaleX, scaleY);
    this.cameras.main.setZoom(scale);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
  }

  private createStars(): void {
    for (let i = 0; i < 150; i++) {
      const size = Phaser.Math.Between(1, 3);
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(0, GAME_HEIGHT);
      const rect = this.add.rectangle(x, y, size, size, 0xffffff);
      const period = Phaser.Math.FloatBetween(1, 3);
      this.stars.push({
        sprite: rect,
        phase: Phaser.Math.FloatBetween(0, Math.PI * 2),
        period
      });
    }
  }

  private createPlayer(): void {
    const points: Phaser.Geom.Point[] = [
      new Phaser.Geom.Point(0, -12),
      new Phaser.Geom.Point(-8, 10),
      new Phaser.Geom.Point(0, 6),
      new Phaser.Geom.Point(8, 10)
    ];
    this.player = this.add.polygon(GAME_WIDTH / 2, GAME_HEIGHT / 2, points, 0xc0c0c0);
    this.player.setStrokeStyle(2, 0x808080);
    this.player.setRotation(this.playerAngle);
  }

  private createAsteroids(): void {
    for (let i = 0; i < 20; i++) {
      const x = Phaser.Math.Between(80, GAME_WIDTH - 80);
      const y = Phaser.Math.Between(100, GAME_HEIGHT - 80);
      const dx = x - GAME_WIDTH / 2;
      const dy = y - GAME_HEIGHT / 2;
      if (Math.sqrt(dx * dx + dy * dy) < 100) {
        i--;
        continue;
      }
      this.createAsteroidAt(x, y);
    }
  }

  private createAsteroidAt(x: number, y: number): void {
    const size = Phaser.Math.Between(30, 60);
    const container = this.add.container(x, y);

    const hexPoints: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.15, 0.15);
      const r = size * Phaser.Math.FloatBetween(0.75, 1.0);
      hexPoints.push(new Phaser.Geom.Point(Math.cos(angle) * r, Math.sin(angle) * r));
    }

    const t = Math.random();
    const gray = Math.floor(128 * (1 - t));
    const brownR = Math.floor(74 * t);
    const brownG = Math.floor(55 * t);
    const brownB = Math.floor(40 * t);
    const color = Phaser.Display.Color.GetColor(gray + brownR, gray + brownG, gray + brownB);

    const shape = this.add.polygon(0, 0, hexPoints, color);
    shape.setStrokeStyle(2, 0x333333);

    const craterCount = Phaser.Math.Between(2, 5);
    for (let c = 0; c < craterCount; c++) {
      const cx = Phaser.Math.FloatBetween(-size * 0.5, size * 0.5);
      const cy = Phaser.Math.FloatBetween(-size * 0.5, size * 0.5);
      const cs = Phaser.Math.FloatBetween(size * 0.08, size * 0.2);
      const crater = this.add.ellipse(cx, cy, cs, cs * 0.8, 0x222222, 0.6);
      container.add(crater);
    }

    container.add(shape);

    const mineral = MINERALS[Phaser.Math.Between(0, MINERALS.length - 1)];
    const reserves = Phaser.Math.Between(50, 200);

    const label = this.add.text(0, -size - 15, `${mineral.name} ${reserves}`, {
      fontSize: '10px',
      color: '#ffffff',
      fontFamily: 'monospace'
    }).setOrigin(0.5);
    container.add(label);

    const miningRing = this.add.graphics();
    miningRing.setVisible(false);
    container.add(miningRing);

    this.asteroids.push({
      container,
      shape,
      label,
      miningRing,
      mineral,
      reserves,
      maxReserves: reserves,
      brightness: 1,
      size,
      miningAngle: 0
    });
  }

  private createStations(): void {
    const stationNames = ['阿尔法站', '贝塔站', '伽马站'];
    const positions = [
      { x: 80, y: GAME_HEIGHT / 2 },
      { x: GAME_WIDTH - 80, y: GAME_HEIGHT / 2 },
      { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 60 }
    ];

    positions.forEach((pos, i) => {
      const id = `station_${i}`;
      const container = this.add.container(pos.x, pos.y);

      const rect = this.add.rectangle(0, 0, 50, 30, 0x00cc66);
      rect.setStrokeStyle(3, 0x008844);
      container.add(rect);

      const beam = this.add.rectangle(0, 30, 20, 60, 0x00ff88, 0.5);
      container.add(beam);

      const nameText = this.add.text(0, -25, stationNames[i], {
        fontSize: '12px',
        color: '#00ff88',
        fontFamily: 'monospace'
      }).setOrigin(0.5);
      container.add(nameText);

      this.tradeManager.registerStation(id, stationNames[i]);

      this.stations.push({
        container,
        rect,
        beam,
        id,
        name: stationNames[i],
        beamPhase: Math.random() * Math.PI * 2
      });
    });
  }

  private createHUD(): void {
    this.hudBg = this.add.rectangle(0, 0, GAME_WIDTH, 50, 0x000000, 0.5).setOrigin(0, 0).setScrollFactor(0);
    this.hudBg.setDepth(100);

    this.add.text(15, 10, '能量:', { fontSize: '12px', color: '#ffffff', fontFamily: 'monospace' }).setScrollFactor(0).setDepth(101);

    this.add.rectangle(70, 19, 200, 12, 0x333333, 1).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);

    this.energyBar = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.updateEnergyBar();

    this.valueText = this.add.text(300, 16, '价值: 0', {
      fontSize: '16px',
      color: '#ffd700',
      fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(101);
    this.valueText.setShadow(0, 0, '#ffd700', 4, false, true);

    this.minedText = this.add.text(480, 18, '采矿: 0', {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(101);

    this.dangerText = this.add.text(620, 18, '危险: 0', {
      fontSize: '14px',
      color: '#ff4444',
      fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(101);

    this.cargoText = this.add.text(760, 18, '货舱: 0/200', {
      fontSize: '14px',
      color: '#ffffff',
      fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(101);
  }

  private updateEnergyBar(): void {
    this.energyBar.clear();
    const ratio = this.energy / this.maxEnergy;
    const width = 200 * ratio;
    const x = 70;
    const y = 13;
    this.energyBar.fillGradientStyle(0x00ff00, 0x00cc00, 0x00ff00, 0x00cc00, 1);
    this.energyBar.fillRect(x, y, width, 12);
    this.energyBar.lineStyle(1, 0x004400, 0.8);
    this.energyBar.strokeRect(x, y, 200, 12);
  }

  private createEffects(): void {
    this.warningFlash = this.add.graphics().setScrollFactor(0).setDepth(200);
    this.warningFlash.setVisible(false);

    this.tradeRing = this.add.graphics().setScrollFactor(0).setDepth(200);
    this.tradeRing.setVisible(false);

    this.hitFlash = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xff0000, 0).setScrollFactor(0).setDepth(199);

    this.victoryGlow = this.add.graphics().setScrollFactor(0).setDepth(250);
    this.victoryGlow.setVisible(false);
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;

    if (this.isVictory) {
      this.updateVictory(dt);
      return;
    }

    this.updateStars(dt);
    this.updatePlayer(dt);
    this.updateParticles(dt);
    this.updateAsteroids(dt);
    this.updateStations(dt);
    this.updatePirates(dt);
    this.updateFragments(dt);
    this.updateHUD(dt);
    this.updateEvents(dt);
    this.updateEffects(dt);
    this.checkVictory();
  }

  private updateStars(dt: number): void {
    this.stars.forEach(star => {
      star.phase += dt * (Math.PI * 2 / star.period);
      const alpha = 0.3 + Math.sin(star.phase) * 0.3 + 0.4;
      star.sprite.setAlpha(Phaser.Math.Clamp(alpha, 0.2, 1));
    });
  }

  private updatePlayer(dt: number): void {
    if (this.isTrading) return;

    let moving = false;
    let moveX = 0;
    let moveY = 0;

    if (this.energy > 0) {
      if (this.keys.W.isDown) { moveY -= 1; moving = true; }
      if (this.keys.S.isDown) { moveY += 1; moving = true; }
      if (this.keys.A.isDown) { moveX -= 1; moving = true; }
      if (this.keys.D.isDown) { moveX += 1; moving = true; }
    }

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.sqrt(moveX * moveX + moveY * moveY);
      moveX /= len;
      moveY /= len;
      this.playerAngle = Math.atan2(moveY, moveX) + Math.PI / 2;
      this.player.setRotation(this.playerAngle);
      this.playerVx = moveX * this.playerSpeed;
      this.playerVy = moveY * this.playerSpeed;

      if (this.energy > 0) {
        this.energy = Math.max(0, this.energy - 0.5 * dt);
      }
    } else {
      this.playerVx *= 0.9;
      this.playerVy *= 0.9;
    }

    const newX = Phaser.Math.Clamp(this.player.x + this.playerVx * dt, 20, GAME_WIDTH - 20);
    const newY = Phaser.Math.Clamp(this.player.y + this.playerVy * dt, 60, GAME_HEIGHT - 20);
    this.player.setPosition(newX, newY);

    if (moving && this.energy > 0) {
      this.emitThrusterParticles();
    }

    this.checkMining(dt);
    this.checkStations(dt);
  }

  private emitThrusterParticles(): void {
    for (let i = 0; i < 3; i++) {
      if (this.particles.length >= 100) break;
      const backAngle = this.playerAngle + Math.PI;
      const offsetX = Phaser.Math.FloatBetween(2, 4) * (Math.random() > 0.5 ? 1 : -1);
      const offsetY = Phaser.Math.FloatBetween(2, 4) * (Math.random() > 0.5 ? 1 : -1);

      const px = this.player.x + Math.cos(backAngle - Math.PI / 2) * 10 + offsetX;
      const py = this.player.y + Math.sin(backAngle - Math.PI / 2) * 10 + offsetY;

      const rect = this.add.rectangle(px, py, 3, 3, 0xffff00);
      this.particles.push({
        rect,
        vx: Math.cos(backAngle - Math.PI / 2) * 50 + Phaser.Math.FloatBetween(-20, 20),
        vy: Math.sin(backAngle - Math.PI / 2) * 50 + Phaser.Math.FloatBetween(-20, 20),
        life: 0.3,
        maxLife: 0.3
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.rect.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.rect.x += p.vx * dt;
      p.rect.y += p.vy * dt;
      p.rect.setAlpha(p.life / p.maxLife);
    }
  }

  private updateFragments(dt: number): void {
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.rect.destroy();
        this.fragments.splice(i, 1);
        continue;
      }
      f.rect.x += f.vx * dt;
      f.rect.y += f.vy * dt;
      f.rotation += f.rotationSpeed * dt;
      f.rect.setRotation(f.rotation);
      f.rect.setAlpha(f.life / 0.4);
    }
  }

  private checkMining(dt: number): void {
    if (this.isTrading) {
      this.isMining = false;
      this.miningTarget = null;
      return;
    }

    let nearestAsteroid: Asteroid | null = null;
    let nearestDist = Infinity;

    for (const a of this.asteroids) {
      const dx = a.container.x - this.player.x;
      const dy = a.container.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 40 + a.size * 0.5 && dist < nearestDist) {
        nearestDist = dist;
        nearestAsteroid = a;
      }
    }

    if (this.keys.SPACE.isDown && nearestAsteroid && this.energy > 0) {
      this.isMining = true;
      this.miningTarget = nearestAsteroid;
    } else {
      this.isMining = false;
      if (this.miningTarget) {
        this.miningTarget.miningRing.setVisible(false);
        this.miningTarget = null;
      }
    }

    if (this.isMining && this.miningTarget && this.energy > 0) {
      this.energy = Math.max(0, this.energy - 1 * dt);

      this.miningTimer += dt;
      this.miningDimmingTimer += dt;
      this.miningTarget.miningAngle += dt * (Math.PI * 2 / 6);

      this.drawMiningRing(this.miningTarget);

      if (this.miningDimmingTimer >= 0.5) {
        this.miningDimmingTimer = 0;
        this.miningTarget.brightness = Math.max(0.2, this.miningTarget.brightness - 0.05);
        const origColor = this.miningTarget.shape.fillColor;
        const r = Math.floor(((origColor >> 16) & 0xff) * this.miningTarget.brightness);
        const g = Math.floor(((origColor >> 8) & 0xff) * this.miningTarget.brightness);
        const b = Math.floor((origColor & 0xff) * this.miningTarget.brightness);
        this.miningTarget.shape.setFillStyle(Phaser.Display.Color.GetColor(r, g, b));
      }

      if (this.miningTimer >= 0.5) {
        this.miningTimer = 0;
        const spaceLeft = this.tradeManager.getCargoCapacity() - this.tradeManager.getTotalCargo();
        if (spaceLeft > 0) {
          const mined = Math.min(10, spaceLeft, this.miningTarget.reserves);
          this.tradeManager.addMineral(this.miningTarget.mineral.id, mined);
          this.miningTarget.reserves -= mined;
          this.miningTarget.label.setText(`${this.miningTarget.mineral.name} ${this.miningTarget.reserves}`);
          this.triggerShake(3, 0.1);

          if (this.miningTarget.reserves <= 0) {
            this.destroyAsteroid(this.miningTarget);
          }
        }
      }
    } else {
      this.miningTimer = 0;
      this.miningDimmingTimer = 0;
    }
  }

  private drawMiningRing(asteroid: Asteroid): void {
    const g = asteroid.miningRing;
    g.setVisible(true);
    g.clear();
    g.lineStyle(2, 0xffffff, 0.8);
    const radius = 40;
    const segments = 16;
    for (let i = 0; i < segments; i += 2) {
      const a1 = asteroid.miningAngle + (i / segments) * Math.PI * 2;
      const a2 = asteroid.miningAngle + ((i + 1) / segments) * Math.PI * 2;
      g.beginPath();
      g.arc(0, 0, radius, a1, a2, false);
      g.strokePath();
    }
  }

  private destroyAsteroid(asteroid: Asteroid): void {
    const idx = this.asteroids.indexOf(asteroid);
    if (idx !== -1) this.asteroids.splice(idx, 1);

    const ax = asteroid.container.x;
    const ay = asteroid.container.y;
    const color = asteroid.shape.fillColor;

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.3, 0.3);
      const speed = Phaser.Math.FloatBetween(80, 160);
      const size = Phaser.Math.FloatBetween(4, 10);
      const rect = this.add.rectangle(
        ax + Phaser.Math.FloatBetween(-10, 10),
        ay + Phaser.Math.FloatBetween(-10, 10),
        size,
        size,
        color
      );
      this.fragments.push({
        rect,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4,
        rotation: 0,
        rotationSpeed: Phaser.Math.FloatBetween(-8, 8)
      });
    }

    asteroid.label.destroy();
    asteroid.shape.destroy();
    asteroid.miningRing.destroy();
    asteroid.container.destroy();
  }

  private updateAsteroids(_dt: number): void {
    // asteroids are static for now
  }

  private updateStations(dt: number): void {
    this.stations.forEach(station => {
      station.beamPhase += dt * (Math.PI * 2 / 0.8);
      const alpha = 0.3 + (Math.sin(station.beamPhase) * 0.5 + 0.5) * 0.5;
      station.beam.setAlpha(alpha);
    });
  }

  private checkStations(dt: number): void {
    let nearestStation: Station | null = null;
    let nearestDist = Infinity;

    for (const s of this.stations) {
      const dx = s.container.x - this.player.x;
      const dy = s.container.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80 && dist < nearestDist) {
        nearestDist = dist;
        nearestStation = s;
      }
    }

    if (nearestStation) {
      if (this.energy < this.maxEnergy && this.chargingStationId !== nearestStation.id) {
        this.chargingStationId = nearestStation.id;
        this.chargeTimer = 0;
      }

      if (this.chargingStationId === nearestStation.id) {
        this.chargeTimer += dt;
        if (this.chargeTimer >= 5) {
          this.energy = this.maxEnergy;
          this.updateEnergyBar();
          this.chargeTimer = 0;
        }
      }
    } else {
      this.chargingStationId = null;
      this.chargeTimer = 0;
    }

    let nearTradeStation: Station | null = null;
    let nearDist = Infinity;
    for (const s of this.stations) {
      const dx = s.container.x - this.player.x;
      const dy = s.container.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 50 && dist < nearDist) {
        nearDist = dist;
        nearTradeStation = s;
      }
    }

    if (nearTradeStation && !this.isTrading) {
      this.openTradePanel(nearTradeStation.id);
    } else if (!nearTradeStation && this.isTrading) {
      this.closeTradePanel();
    }
  }

  private openTradePanel(stationId: string): void {
    this.isTrading = true;
    this.activeStationId = stationId;
    this.buildTradePanel(stationId);
  }

  private closeTradePanel(): void {
    this.isTrading = false;
    this.activeStationId = null;
    if (this.tradePanel) {
      this.tradePanel.destroy();
      this.tradePanel = null;
    }
  }

  private buildTradePanel(stationId: string): void {
    if (this.tradePanel) this.tradePanel.destroy();

    const panel = this.add.container(0, 0).setDepth(150).setScrollFactor(0);
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7);
    panel.add(bg);

    const panelWidth = 700;
    const panelHeight = 500;
    const panelX = GAME_WIDTH / 2 - panelWidth / 2;
    const panelY = GAME_HEIGHT / 2 - panelHeight / 2;

    const panelBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, panelWidth, panelHeight, 0x1a1a3e, 0.95);
    panelBg.setStrokeStyle(3, 0x00cc66);
    panel.add(panelBg);

    const stationName = this.tradeManager.getStationName(stationId) || '未知空间站';
    const title = this.add.text(GAME_WIDTH / 2, panelY + 25, `🚀 ${stationName} - 交易界面`, {
      fontSize: '22px',
      color: '#00ff88',
      fontFamily: 'monospace'
    }).setOrigin(0.5);
    panel.add(title);

    const leftX = panelX + 30;
    const rightX = panelX + panelWidth / 2 + 30;
    const colY = panelY + 70;

    const invTitle = this.add.text(leftX, colY, '你的背包:', { fontSize: '16px', color: '#ffd700', fontFamily: 'monospace' });
    panel.add(invTitle);

    const stationTitle = this.add.text(rightX, colY, '空间站收购:', { fontSize: '16px', color: '#ffd700', fontFamily: 'monospace' });
    panel.add(stationTitle);

    const inventory = this.tradeManager.getPlayerInventory();
    const prices = this.tradeManager.getStationPrices(stationId) || {};
    const stationInv = this.tradeManager.getStationInventory(stationId) || {};

    let yOffset = 30;
    MINERALS.forEach(m => {
      const amt = inventory[m.id] || 0;
      const invText = this.add.text(leftX, colY + yOffset, `${m.name}: ${amt}`, {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'monospace'
      });
      panel.add(invText);

      const price = prices[m.id] || 0;
      const stk = stationInv[m.id] || 0;
      const priceText = this.add.text(rightX, colY + yOffset, `${m.name}: ${price}💰 库存:${stk}`, {
        fontSize: '14px',
        color: '#ffffff',
        fontFamily: 'monospace'
      });
      panel.add(priceText);

      const buyBtn = this.add.text(rightX + 230, colY + yOffset - 2, ' [买入10] ', {
        fontSize: '13px',
        color: '#ffffff',
        backgroundColor: '#006644',
        fontFamily: 'monospace'
      }).setInteractive({ useHandCursor: true });
      buyBtn.on('pointerover', () => buyBtn.setBackgroundColor('#008866'));
      buyBtn.on('pointerout', () => buyBtn.setBackgroundColor('#006644'));
      buyBtn.on('pointerdown', () => {
        const cost = this.tradeManager.buyMineral(stationId, m.id, 10);
        if (cost > 0) {
          this.triggerTradeSuccess();
          this.refreshTradePanel();
        }
      });
      panel.add(buyBtn);

      yOffset += 26;
    });

    const sellBtn = this.add.text(GAME_WIDTH / 2 - 80, panelY + panelHeight - 70, ' 💰 卖出全部 ', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#cc8800',
      fontFamily: 'monospace'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    sellBtn.on('pointerover', () => sellBtn.setBackgroundColor('#ffaa00'));
    sellBtn.on('pointerout', () => sellBtn.setBackgroundColor('#cc8800'));
    sellBtn.on('pointerdown', () => {
      const earned = this.tradeManager.sellAll(stationId);
      if (earned > 0) {
        this.triggerTradeSuccess();
        this.refreshTradePanel();
      }
    });
    panel.add(sellBtn);

    const closeBtn = this.add.text(GAME_WIDTH / 2 + 80, panelY + panelHeight - 70, ' ✖ 离开 ', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#662222',
      fontFamily: 'monospace'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setBackgroundColor('#aa3333'));
    closeBtn.on('pointerout', () => closeBtn.setBackgroundColor('#662222'));
    closeBtn.on('pointerdown', () => {
      // Player must move away, this just hints
    });
    panel.add(closeBtn);

    const historyTitle = this.add.text(panelX + 30, panelY + panelHeight - 230, '交易历史 (最近10条):', {
      fontSize: '14px',
      color: '#c0c0c0',
      fontFamily: 'monospace'
    });
    panel.add(historyTitle);

    const historyBg = this.add.rectangle(GAME_WIDTH / 2, panelY + panelHeight - 120, panelWidth - 60, 160, 0x0a0a1a, 0.8);
    historyBg.setStrokeStyle(1, 0x444466);
    panel.add(historyBg);

    const history = this.tradeManager.getTradeHistory();
    const historyStartX = panelX + 50;
    let hy = panelY + panelHeight - 195;
    history.slice(0, 8).forEach(record => {
      const prefix = record.type === 'sell' ? '卖出' : '买入';
      const text = this.add.text(historyStartX, hy, `${prefix} ${record.quantity}x ${record.mineralName} @${record.pricePerUnit}💰 = ${record.totalValue} (${record.stationName})`, {
        fontSize: '11px',
        color: record.type === 'sell' ? '#88ff88' : '#ffcc88',
        fontFamily: 'monospace'
      });
      panel.add(text);
      hy += 18;
    });

    this.tradePanel = panel;
  }

  private refreshTradePanel(): void {
    if (this.activeStationId && this.tradePanel) {
      this.buildTradePanel(this.activeStationId);
    }
  }

  private triggerTradeSuccess(): void {
    this.tradeRingTimer = 0.3;
    this.tradeRing.setVisible(true);
  }

  private updateEvents(dt: number): void {
    this.eventTimer += dt;
    if (this.eventTimer >= 30) {
      this.eventTimer = 0;
      this.tradeManager.fluctuatePrices();
      if (Math.random() < 0.3) {
        this.spawnPirate();
      }
    }
  }

  private spawnPirate(): void {
    this.dangerCount++;
    this.warningTimer = 0.5;
    this.warningFlash.setVisible(true);

    const side = Phaser.Math.Between(0, 3);
    let x = 0, y = 0;
    if (side === 0) { x = -30; y = Phaser.Math.Between(60, GAME_HEIGHT - 30); }
    else if (side === 1) { x = GAME_WIDTH + 30; y = Phaser.Math.Between(60, GAME_HEIGHT - 30); }
    else if (side === 2) { x = Phaser.Math.Between(30, GAME_WIDTH - 30); y = 30; }
    else { x = Phaser.Math.Between(30, GAME_WIDTH - 30); y = GAME_HEIGHT + 30; }

    const points: Phaser.Geom.Point[] = [
      new Phaser.Geom.Point(0, -18),
      new Phaser.Geom.Point(-12, 15),
      new Phaser.Geom.Point(0, 9),
      new Phaser.Geom.Point(12, 15)
    ];
    const tri = this.add.polygon(x, y, points, 0xff2222);
    tri.setStrokeStyle(2, 0xaa0000);

    const dx = this.player.x - x;
    const dy = this.player.y - y;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    tri.setRotation(angle);

    const speed = 60;
    const vx = (dx / Math.sqrt(dx * dx + dy * dy)) * speed;
    const vy = (dy / Math.sqrt(dx * dx + dy * dy)) * speed;

    this.pirates.push({
      triangle: tri,
      vx,
      vy,
      state: 'approaching',
      turnTimer: 0,
      targetAngle: angle,
      currentAngle: angle
    });
  }

  private updatePirates(dt: number): void {
    for (let i = this.pirates.length - 1; i >= 0; i--) {
      const p = this.pirates[i];

      let nearStation = false;
      for (const s of this.stations) {
        const dx = s.container.x - p.triangle.x;
        const dy = s.container.y - p.triangle.y;
        if (Math.sqrt(dx * dx + dy * dy) < 80) {
          nearStation = true;
          break;
        }
      }

      if (p.state === 'approaching') {
        if (nearStation) {
          this.piratesAvoided++;
          this.startPirateLeaving(p);
        } else {
          const dx = this.player.x - p.triangle.x;
          const dy = this.player.y - p.triangle.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 20) {
            this.pirateHitPlayer(p);
          } else {
            const speed = 60;
            p.vx = (dx / dist) * speed;
            p.vy = (dy / dist) * speed;
            p.triangle.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
          }
        }
      }

      if (p.state === 'fighting') {
        p.turnTimer += dt;
        if (p.turnTimer >= 0.5) {
          this.startPirateLeaving(p);
        }
      }

      if (p.state === 'turning') {
        p.turnTimer += dt;
        const t = Math.min(1, p.turnTimer / 0.3);
        const current = p.triangle.rotation;
        const target = p.targetAngle;
        let delta = target - current;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        p.triangle.setRotation(current + delta * t);
        if (p.turnTimer >= 0.3) {
          p.state = 'leaving';
          p.turnTimer = 0;
        }
      }

      if (p.state === 'leaving') {
        const accel = 80;
        p.vx += Math.cos(p.triangle.rotation - Math.PI / 2) * accel * dt;
        p.vy += Math.sin(p.triangle.rotation - Math.PI / 2) * accel * dt;
      }

      p.triangle.x += p.vx * dt;
      p.triangle.y += p.vy * dt;

      if (p.triangle.x < -100 || p.triangle.x > GAME_WIDTH + 100 ||
          p.triangle.y < -100 || p.triangle.y > GAME_HEIGHT + 100) {
        p.triangle.destroy();
        this.pirates.splice(i, 1);
      }
    }
  }

  private pirateHitPlayer(pirate: Pirate): void {
    pirate.state = 'fighting';
    pirate.turnTimer = 0;

    this.hitFlashTimer = 0.2;
    this.hitFlash.setAlpha(0.5);

    const best = this.tradeManager.getMostValuableMineral();
    if (best) {
      const ratio = Phaser.Math.FloatBetween(0.2, 0.5);
      this.tradeManager.losePartialMineral(best.mineralId, ratio);
    }
  }

  private startPirateLeaving(pirate: Pirate): void {
    pirate.state = 'turning';
    pirate.turnTimer = 0;
    const dx = pirate.triangle.x - this.player.x;
    const dy = pirate.triangle.y - this.player.y;
    pirate.targetAngle = Math.atan2(dy, dx) + Math.PI / 2;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    pirate.vx = (dx / dist) * 60;
    pirate.vy = (dy / dist) * 60;
  }

  private updateHUD(_dt: number): void {
    this.updateEnergyBar();
    const totalValue = this.tradeManager.getTotalValue() + this.tradeManager.getInventoryValue();
    this.valueText.setText(`价值: ${totalValue}`);
    this.minedText.setText(`采矿: ${this.tradeManager.getTotalMined()}`);
    this.dangerText.setText(`危险: ${this.dangerCount}`);
    const cargo = this.tradeManager.getTotalCargo();
    const cap = this.tradeManager.getCargoCapacity();
    this.cargoText.setText(`货舱: ${cargo}/${cap}`);
  }

  private updateEffects(dt: number): void {
    if (this.warningTimer > 0) {
      this.warningTimer -= dt;
      this.drawWarningFlash();
      if (this.warningTimer <= 0) {
        this.warningFlash.setVisible(false);
      }
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      if (this.shakeTimer <= 0) {
        this.cameras.main.setScroll(0, 0);
      } else {
        this.cameras.main.setScroll(
          Phaser.Math.FloatBetween(-this.shakeIntensity, this.shakeIntensity),
          Phaser.Math.FloatBetween(-this.shakeIntensity, this.shakeIntensity)
        );
      }
    }

    if (this.tradeRingTimer > 0) {
      this.tradeRingTimer -= dt;
      this.drawTradeRing();
      if (this.tradeRingTimer <= 0) {
        this.tradeRing.setVisible(false);
      }
    }

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      this.hitFlash.setAlpha((this.hitFlashTimer / 0.2) * 0.5);
      if (this.hitFlashTimer <= 0) {
        this.hitFlash.setAlpha(0);
      }
    }
  }

  private drawWarningFlash(): void {
    this.warningFlash.clear();
    this.warningFlash.lineStyle(6, 0xff0000, 0.6);
    this.warningFlash.strokeRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }

  private drawTradeRing(): void {
    this.tradeRing.clear();
    const alpha = this.tradeRingTimer / 0.3;
    this.tradeRing.lineStyle(3, 0x00ff00, alpha);
    const r = 20 + (1 - alpha) * 30;
    this.tradeRing.strokeCircle(GAME_WIDTH / 2, GAME_HEIGHT / 2, r);
  }

  private triggerShake(intensity: number, duration: number): void {
    this.shakeIntensity = intensity;
    this.shakeTimer = duration;
  }

  private checkVictory(): void {
    const totalValue = this.tradeManager.getTotalValue() + this.tradeManager.getInventoryValue();
    if (totalValue >= 10000 && !this.isVictory) {
      this.startVictory();
    }
  }

  private startVictory(): void {
    this.isVictory = true;
    this.victoryGlowTimer = 0;
    this.victoryGlowScale = 0;
    this.victoryGlow.setVisible(true);
    this.isTrading = false;
    this.closeTradePanel();
  }

  private updateVictory(dt: number): void {
    this.victoryGlowTimer += dt;
    if (this.victoryGlowTimer < 1.5) {
      this.victoryGlowScale = this.victoryGlowTimer / 1.5;
      this.drawVictoryGlow();
    } else {
      this.victoryGlowScale = 1;
      this.drawVictoryGlow();
      if (!this.victoryPanel) {
        this.buildVictoryPanel();
      }
      this.victoryFloatPhase += dt * (Math.PI * 2);
      if (this.victoryPanel) {
        const text = this.victoryPanel.getAt(2) as Phaser.GameObjects.Text;
        if (text) {
          text.setY(GAME_HEIGHT / 2 - 180 + Math.sin(this.victoryFloatPhase) * 5);
        }
      }
    }
  }

  private drawVictoryGlow(): void {
    this.victoryGlow.clear();
    const r = GAME_WIDTH * this.victoryGlowScale;
    const alpha = this.victoryGlowScale * 0.7;
    this.victoryGlow.fillStyle(0xffd700, alpha);
    this.victoryGlow.fillCircle(GAME_WIDTH / 2, GAME_HEIGHT / 2, r);
  }

  private buildVictoryPanel(): void {
    const panel = this.add.container(0, 0).setDepth(300).setScrollFactor(0);

    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.5);
    panel.add(bg);

    const congrats = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 180, '恭喜完成首次太空贸易！', {
      fontSize: '40px',
      color: '#ffffff',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    congrats.setShadow(0, 0, '#ffd700', 10, false, true);
    panel.add(congrats);

    const panelW = 400;
    const panelH = 250;
    const statsBg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, panelW, panelH, 0x1a1a3e, 0.95);
    statsBg.setStrokeStyle(3, 0xffd700);
    panel.add(statsBg);

    const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
    const mm = Math.floor(elapsedSec / 60);
    const ss = elapsedSec % 60;

    const statsLines = [
      `🏆 最终统计`,
      ``,
      `⏱ 耗时: ${mm}分${ss}秒`,
      `⛏ 采矿总量: ${this.tradeManager.getTotalMined()} 单位`,
      `💹 交易次数: ${this.tradeManager.getTradeCount()} 次`,
      `🛡 躲避海盗: ${this.piratesAvoided} 次`
    ];

    statsLines.forEach((line, i) => {
      const isTitle = i === 0;
      const t = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100 + i * 35, line, {
        fontSize: isTitle ? '22px' : '18px',
        color: isTitle ? '#ffd700' : '#ffffff',
        fontFamily: 'monospace'
      }).setOrigin(0.5);
      panel.add(t);
    });

    const restartBtn = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 200, ' 🎮 再来一局 ', {
      fontSize: '22px',
      color: '#000000',
      backgroundColor: '#ffd700',
      fontFamily: 'monospace',
      fontStyle: 'bold'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    restartBtn.on('pointerover', () => restartBtn.setBackgroundColor('#ffee66'));
    restartBtn.on('pointerout', () => restartBtn.setBackgroundColor('#ffd700'));
    restartBtn.on('pointerdown', () => {
      this.resetGame();
    });
    panel.add(restartBtn);

    this.victoryPanel = panel;
  }

  private resetGame(): void {
    this.asteroids.forEach(a => {
      a.label.destroy();
      a.shape.destroy();
      a.miningRing.destroy();
      a.container.destroy();
    });
    this.asteroids = [];

    this.particles.forEach(p => p.rect.destroy());
    this.particles = [];

    this.fragments.forEach(f => f.rect.destroy());
    this.fragments = [];

    this.pirates.forEach(p => p.triangle.destroy());
    this.pirates = [];

    if (this.victoryPanel) {
      this.victoryPanel.destroy();
      this.victoryPanel = null;
    }

    this.player.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    this.playerVx = 0;
    this.playerVy = 0;
    this.energy = this.maxEnergy;
    this.dangerCount = 0;
    this.piratesAvoided = 0;
    this.eventTimer = 0;
    this.isVictory = false;
    this.victoryGlow.setVisible(false);
    this.tradeManager.reset();
    this.startTime = Date.now();
    this.victoryFloatPhase = 0;
    this.playerAngle = -Math.PI / 2;
    this.player.setRotation(this.playerAngle);

    this.createAsteroids();
    this.isTrading = false;
    this.activeStationId = null;
    this.chargingStationId = null;
    this.chargeTimer = 0;
    this.isMining = false;
    this.miningTarget = null;
    this.miningTimer = 0;
    this.miningDimmingTimer = 0;
  }
}
