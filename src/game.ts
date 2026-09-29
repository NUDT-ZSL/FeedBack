import { Player } from './player';
import { Asteroid } from './asteroid';
import type { AsteroidType } from './asteroid';
import { UIManager } from './ui';
import type { UpgradeType } from './ui';
import { drawBackground, drawHUD, generateStars } from './hud';
import type { Star } from './hud';

const CANVAS_SIZE = 400;
const SHIP_RADIUS = 15;
const MAX_ASTEROIDS = 15;
const INITIAL_ASTEROIDS = 5;
const ASTEROID_SPAWN_INTERVAL = 5000;
const MAX_PARTICLES = 60;
const PARTICLE_LIFE = 0.3;
const EXPLOSION_PARTICLES = 8;
const UPGRADE_SCORE_THRESHOLD = 100;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  active: boolean;
}

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: Player;
  private asteroids: Asteroid[];
  private particles: Particle[];
  private stars: Star[];
  private ui: UIManager;
  private running: boolean;
  private lastTime: number;
  private lastSpawnTime: number;
  private lastUpgradeScore: number;
  private animationId: number | null;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;

    this.player = new Player();
    this.asteroids = [];
    this.particles = [];
    this.stars = generateStars(80);
    this.ui = new UIManager();
    this.running = false;
    this.lastTime = 0;
    this.lastSpawnTime = 0;
    this.lastUpgradeScore = 0;
    this.animationId = null;

    this.setupInput();
    this.setupUI();
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      this.player.setKey(e.code, true);
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.player.setKey(e.code, false);
    });
  }

  private setupUI(): void {
    this.ui.onStart(() => this.start());
    this.ui.onRestart(() => this.restart());
    this.ui.onUpgrade((type: UpgradeType) => this.handleUpgrade(type));
  }

  private handleUpgrade(type: UpgradeType): void {
    let success = false;
    if (type === 'shield') {
      success = this.player.upgradeShield();
    } else if (type === 'fuel') {
      success = this.player.upgradeFuel();
    }
    if (success) {
      this.lastUpgradeScore = this.player.score;
      this.ui.hideUpgradePanel();
    }
  }

  private start(): void {
    this.ui.hideStartScreen();
    this.initGame();
    this.running = true;
    this.lastTime = performance.now();
    this.lastSpawnTime = this.lastTime;
    this.loop(this.lastTime);
  }

  private restart(): void {
    this.ui.reset();
    this.initGame();
    this.running = true;
    this.lastTime = performance.now();
    this.lastSpawnTime = this.lastTime;
    this.loop(this.lastTime);
  }

  private initGame(): void {
    this.player = new Player();
    this.asteroids = [];
    this.particles = [];
    this.lastUpgradeScore = 0;

    for (let i = 0; i < INITIAL_ASTEROIDS; i++) {
      this.asteroids.push(new Asteroid());
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        color: '',
        size: 0,
        active: false
      });
    }
  }

  private loop(currentTime: number): void {
    if (!this.running) return;

    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.update(deltaTime, currentTime);
    this.render();

    this.animationId = requestAnimationFrame((t) => this.loop(t));
  }

  private update(deltaTime: number, currentTime: number): void {
    this.player.update();

    if (this.asteroids.length < MAX_ASTEROIDS && currentTime - this.lastSpawnTime > ASTEROID_SPAWN_INTERVAL) {
      this.asteroids.push(new Asteroid());
      this.lastSpawnTime = currentTime;
    }

    for (const asteroid of this.asteroids) {
      asteroid.update();
    }

    this.asteroids = this.asteroids.filter((a) => !a.isOffscreen());

    this.updateParticles(deltaTime);

    this.checkCollisions();

    if (this.player.score >= UPGRADE_SCORE_THRESHOLD && this.player.score >= this.lastUpgradeScore + UPGRADE_SCORE_THRESHOLD) {
      this.ui.showUpgradePanel();
    }
    this.ui.updateUpgradeButtons(this.player);

    if (this.player.health <= 0) {
      this.gameOver();
    }
  }

  private updateParticles(deltaTime: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= deltaTime;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  private spawnExplosion(x: number, y: number, type: AsteroidType): void {
    let color: string;
    switch (type) {
      case 'obstacle':
        color = '#9CA3AF';
        break;
      case 'resource':
        color = '#34D399';
        break;
      case 'fast':
        color = '#F87171';
        break;
    }

    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= EXPLOSION_PARTICLES) break;
      if (p.active) continue;

      const angle = (spawned / EXPLOSION_PARTICLES) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 1.5 + Math.random() * 2;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = PARTICLE_LIFE;
      p.maxLife = PARTICLE_LIFE;
      p.color = color;
      p.size = 2 + Math.random() * 2;
      p.active = true;
      spawned++;
    }
  }

  private checkCollisions(): void {
    for (let i = this.asteroids.length - 1; i >= 0; i--) {
      const asteroid = this.asteroids[i];

      const dx = this.player.x - asteroid.x;
      const dy = this.player.y - asteroid.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < SHIP_RADIUS + asteroid.radius) {
        this.spawnExplosion(asteroid.x, asteroid.y, asteroid.type);
        this.asteroids.splice(i, 1);

        let damage = 1;
        if (asteroid.type === 'fast') damage = 2;
        this.player.takeDamage(damage);
        continue;
      }

      if (this.player.laser?.active) {
        const ldx = this.player.laser.x - asteroid.x;
        const ldy = this.player.laser.y - asteroid.y;
        const ldist = Math.sqrt(ldx * ldx + ldy * ldy);

        if (ldist < asteroid.radius + 4) {
          this.player.laser.active = false;
          this.spawnExplosion(asteroid.x, asteroid.y, asteroid.type);

          if (asteroid.type === 'resource') {
            this.player.addScore(10);
          }

          this.asteroids.splice(i, 1);
        }
      }
    }
  }

  private render(): void {
    drawBackground(this.ctx, this.stars);

    for (const asteroid of this.asteroids) {
      asteroid.draw(this.ctx);
    }

    for (const p of this.particles) {
      if (!p.active) continue;
      const alpha = p.life / p.maxLife;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fillStyle = p.color.replace(')', `, ${alpha})`).replace('rgb', 'rgba');
      if (!this.ctx.fillStyle.includes('rgba')) {
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = p.color;
      }
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
    }

    this.player.draw(this.ctx);

    drawHUD(this.ctx, this.player);
  }

  private gameOver(): void {
    this.running = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.ui.showGameOver(this.player.score);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
