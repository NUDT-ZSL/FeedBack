import { GameEngine } from './engine.js';

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private engine: GameEngine;
  private lastTime = 0;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    const { width, height } = this.setupCanvas();
    this.engine = new GameEngine(width, height);
    this.setupEventListeners();
    this.engine.initialize();
    this.hideLoading();
    this.gameLoop(0);
  }

  private setupCanvas(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousedown', (event) => {
      if (!this.engine.ballLaunched && !this.engine.isGameOver) this.engine.launchBall();
      else this.engine.paddle.handleMouseDown(event.clientX, this.canvas.getBoundingClientRect());
    });
    this.canvas.addEventListener('mousemove', (event) =>
      this.engine.paddle.handleMouseMove(event.clientX, this.canvas.getBoundingClientRect())
    );
    this.canvas.addEventListener('mouseup', () => this.engine.paddle.handleMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.engine.paddle.handleMouseUp());

    this.canvas.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const touch = event.touches[0];
      if (!this.engine.ballLaunched && !this.engine.isGameOver) this.engine.launchBall();
      else this.engine.paddle.handleTouchStart(touch, this.canvas.getBoundingClientRect());
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (event) => {
      event.preventDefault();
      this.engine.paddle.handleTouchMove(event.touches[0], this.canvas.getBoundingClientRect());
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => this.engine.paddle.handleTouchEnd());

    document.getElementById('restart-btn')?.addEventListener('click', () => {
      this.engine.restart();
      document.getElementById('game-over')?.classList.remove('visible');
    });
    window.addEventListener('resize', () => {
      const { width, height } = this.setupCanvas();
      this.engine.resize(width, height);
    });
  }

  private hideLoading(): void {
    document.getElementById('loading')?.classList.add('hidden');
  }

  private gameLoop(currentTime: number): void {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    const result = this.engine.update(deltaTime);
    this.render();
    if (result.gameOver) this.showGameOver();
    requestAnimationFrame((time) => this.gameLoop(time));
  }

  private showGameOver(): void {
    const score = document.getElementById('final-score-value');
    if (score) score.textContent = this.engine.score.toString();
    document.getElementById('game-over')?.classList.add('visible');
  }

  private render(): void {
    const { canvasWidth, canvasHeight } = this.engine;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.engine.shakeOffsetX, this.engine.shakeOffsetY);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    this.drawBorder();
    this.engine.brickManager.drawBricks(ctx);
    this.engine.brickManager.drawParticles(ctx);
    this.engine.paddle.draw(ctx);
    this.engine.ball.draw(ctx);
    this.drawHud();
    ctx.restore();
  }

  private drawBorder(): void {
    const ctx = this.ctx;
    const { canvasWidth, canvasHeight } = this.engine;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 210, 255, 0.5)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    ctx.shadowBlur = 10;

    const radius = 16;
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(canvasWidth - radius, 0);
    ctx.quadraticCurveTo(canvasWidth, 0, canvasWidth, radius);
    ctx.lineTo(canvasWidth, canvasHeight - radius);
    ctx.quadraticCurveTo(canvasWidth, canvasHeight, canvasWidth - radius, canvasHeight);
    ctx.lineTo(radius, canvasHeight);
    ctx.quadraticCurveTo(0, canvasHeight, 0, canvasHeight - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const status = this.engine.getStatus();
    ctx.save();
    ctx.font = 'bold 20px "Segoe UI", monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 10;
    ctx.textAlign = 'right';
    ctx.fillText(`得分: ${status.score}`, this.engine.canvasWidth - 20, 20);

    ctx.textAlign = 'left';
    ctx.shadowBlur = 8;
    for (let index = 0; index < status.lives; index++) {
      this.drawHeart(25 + index * 30, 28, 10);
    }

    ctx.fillStyle = '#00d2ff';
    ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    ctx.shadowBlur = 10;
    ctx.fillText(`关卡 ${status.level}`, 20, 55);
    this.drawProgressBar(this.engine.canvasWidth - 150, 55, 130, 12, status.progress);

    if (status.comboCount > 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd32a';
      ctx.shadowColor = 'rgba(255, 211, 42, 0.8)';
      ctx.shadowBlur = 15;
      ctx.font = 'bold 28px "Segoe UI", sans-serif';
      ctx.fillText(`${status.comboCount}x 连击!`, this.engine.canvasWidth / 2, 250);
    }

    if (!status.ballLaunched && !status.isGameOver) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#00d2ff';
      ctx.shadowColor = 'rgba(0, 210, 255, 0.8)';
      ctx.shadowBlur = 15;
      ctx.font = 'bold 24px "Segoe UI", sans-serif';
      ctx.fillText('点击屏幕发射小球', this.engine.canvasWidth / 2, this.engine.canvasHeight / 2);
    }
    ctx.restore();
  }

  private drawHeart(x: number, y: number, size: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#ff4757';
    ctx.shadowColor = 'rgba(255, 71, 87, 0.8)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x, y + size / 4);
    ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + size / 4);
    ctx.bezierCurveTo(x - size / 2, y + size / 2, x, y + size * 0.75, x, y + size);
    ctx.bezierCurveTo(x, y + size * 0.75, x + size / 2, y + size / 2, x + size / 2, y + size / 4);
    ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + size / 4);
    ctx.fill();
    ctx.restore();
  }

  private drawProgressBar(x: number, y: number, width: number, height: number, progress: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();

    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#00d2ff');
    gradient.addColorStop(1, '#3a7bd5');
    ctx.fillStyle = gradient;
    ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(x, y, width * progress, height, height / 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(`${Math.round(progress * 100)}%`, x + width / 2, y + height / 2);
    ctx.restore();
  }
}

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) {
    if (width < 2 * radius) radius = width / 2;
    if (height < 2 * radius) radius = height / 2;
    this.beginPath();
    this.moveTo(x + radius, y);
    this.arcTo(x + width, y, x + width, y + height, radius);
    this.arcTo(x + width, y + height, x, y + height, radius);
    this.arcTo(x, y + height, x, y, radius);
    this.arcTo(x, y, x + width, y, radius);
    this.closePath();
    return this;
  };
}

window.addEventListener('load', () => {
  new Game();
});
