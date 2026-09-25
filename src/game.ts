import { Ball } from './ball';
import { BrickManager, Particle } from './brick';
import { Paddle } from './paddle';

interface GameState {
  score: number;
  lives: number;
  level: number;
  isPlaying: boolean;
  isGameOver: boolean;
  comboCount: number;
}

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ball: Ball;
  private brickManager: BrickManager;
  private paddle: Paddle;
  private state: GameState;
  private lastTime: number = 0;
  private particles: Particle[] = [];
  private shakeOffsetX: number = 0;
  private shakeOffsetY: number = 0;
  private shakeTime: number = 0;
  private ballLaunched: boolean = false;
  private canvasWidth: number = 800;
  private canvasHeight: number = 600;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    this.setupCanvas();

    const paddleWidth = 100;
    const paddleHeight = 15;
    const paddleY = this.canvasHeight - paddleHeight - 20;
    const paddleX = (this.canvasWidth - paddleWidth) / 2;

    this.ball = new Ball(
      paddleX + paddleWidth / 2,
      paddleY - 10
    );

    this.brickManager = new BrickManager(this.canvasWidth, this.canvasHeight);
    this.paddle = new Paddle(paddleX, paddleY, paddleWidth, paddleHeight);
    this.paddle.setCanvasWidth(this.canvasWidth);

    this.state = {
      score: 0,
      lives: 3,
      level: 1,
      isPlaying: false,
      isGameOver: false,
      comboCount: 0
    };

    this.setupEventListeners();
    this.init();
  }

  private setupCanvas(): void {
    const container = document.getElementById('game-container');
    if (container) {
      const rect = container.getBoundingClientRect();
      this.canvasWidth = Math.min(800, rect.width);
      this.canvasHeight = (this.canvasWidth * 3) / 4;
    }

    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.canvasWidth = rect.width;
    this.canvasHeight = rect.height;
  }

  private setupEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.canvas.addEventListener('mouseleave', this.handleMouseUp.bind(this));

    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this));

    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.addEventListener('click', this.restart.bind(this));
    }

    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private handleMouseDown(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!this.ballLaunched && !this.state.isGameOver) {
      this.launchBall();
    } else {
      this.paddle.handleMouseDown(e.clientX, rect);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.paddle.handleMouseMove(e.clientX, rect);
  }

  private handleMouseUp(): void {
    this.paddle.handleMouseUp();
  }

  private handleTouchStart(e: TouchEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const touch = e.touches[0];

    if (!this.ballLaunched && !this.state.isGameOver) {
      this.launchBall();
    } else {
      this.paddle.handleTouchStart(touch, rect);
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const touch = e.touches[0];
    this.paddle.handleTouchMove(touch, rect);
  }

  private handleTouchEnd(): void {
    this.paddle.handleTouchEnd();
  }

  private handleResize(): void {
    this.setupCanvas();
    this.paddle.setCanvasWidth(this.canvasWidth);
    this.brickManager = new BrickManager(this.canvasWidth, this.canvasHeight);
    this.brickManager.generateHoneycombLayout();
  }

  private launchBall(): void {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.5;
    this.ball.launch(angle);
    this.ballLaunched = true;
    this.state.isPlaying = true;
  }

  private init(): void {
    this.brickManager.generateHoneycombLayout();
    this.hideLoading();
    this.gameLoop(0);
  }

  private hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('hidden');
    }
  }

  private gameLoop(currentTime: number): void {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame(this.gameLoop.bind(this));
  }

  private update(deltaTime: number): void {
    if (this.state.isGameOver) return;

    this.paddle.update();

    if (this.shakeTime > 0) {
      this.shakeTime -= deltaTime;
      if (this.shakeTime <= 0) {
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }
    }

    if (!this.ballLaunched) {
      this.ball.x = this.paddle.getCenterX();
      this.ball.y = this.paddle.y - this.ball.radius - 2;
      return;
    }

    const ballFell = this.ball.update(this.canvasWidth, this.canvasHeight);

    if (ballFell) {
      this.state.lives--;
      if (this.state.lives <= 0) {
        this.endGame();
      } else {
        this.resetBall();
      }
      return;
    }

    this.ball.checkPaddleCollision(
      this.paddle.x,
      this.paddle.y,
      this.paddle.width,
      this.paddle.height
    );

    const collisionResult = this.brickManager.checkCollision(
      this.ball.x,
      this.ball.y,
      this.ball.radius
    );

    if (collisionResult.hit) {
      this.ball.reflectVertical();
      this.ball.addRandomAngleOffset();

      const baseScore = 10;
      const comboBonus = collisionResult.comboChain > 1 ? (collisionResult.comboChain - 1) * 5 : 0;
      this.state.score += baseScore + comboBonus;
      this.state.comboCount = collisionResult.comboChain;

      this.triggerShake();

      this.particles.push(...collisionResult.particles);
      if (this.particles.length > 200) {
        this.particles = this.particles.slice(-200);
      }

      const progress = this.brickManager.getProgress();
      if (progress >= 1) {
        this.nextLevel();
      }
    }

    this.brickManager.updateParticles(deltaTime);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= deltaTime;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private triggerShake(): void {
    this.shakeTime = 100;
    const shakeAmount = 2 + Math.random() * 1;
    this.shakeOffsetX = (Math.random() - 0.5) * shakeAmount * 2;
    this.shakeOffsetY = (Math.random() - 0.5) * shakeAmount * 2;
  }

  private resetBall(): void {
    this.ballLaunched = false;
    this.state.isPlaying = false;
    this.state.comboCount = 0;
    const paddleX = (this.canvasWidth - this.paddle.width) / 2;
    this.paddle.reset(paddleX, this.paddle.y);
    this.ball.reset(
      this.paddle.getCenterX(),
      this.paddle.y - this.ball.radius - 2
    );
  }

  private nextLevel(): void {
    this.state.level++;
    this.ball.increaseSpeed(1.05);
    this.brickManager.clear();
    this.brickManager.generateHoneycombLayout();
    this.resetBall();
  }

  private endGame(): void {
    this.state.isGameOver = true;
    this.state.isPlaying = false;

    const finalScoreEl = document.getElementById('final-score-value');
    if (finalScoreEl) {
      finalScoreEl.textContent = this.state.score.toString();
    }

    const gameOverEl = document.getElementById('game-over');
    if (gameOverEl) {
      gameOverEl.classList.add('visible');
    }
  }

  private restart(): void {
    this.state = {
      score: 0,
      lives: 3,
      level: 1,
      isPlaying: false,
      isGameOver: false,
      comboCount: 0
    };

    this.ball = new Ball(
      this.paddle.x + this.paddle.width / 2,
      this.paddle.y - 10
    );

    this.brickManager.clear();
    this.brickManager.generateHoneycombLayout();

    const paddleX = (this.canvasWidth - this.paddle.width) / 2;
    this.paddle.reset(paddleX, this.paddle.y);

    this.ballLaunched = false;
    this.particles = [];

    const gameOverEl = document.getElementById('game-over');
    if (gameOverEl) {
      gameOverEl.classList.remove('visible');
    }
  }

  private render(): void {
    this.ctx.save();
    this.ctx.translate(this.shakeOffsetX, this.shakeOffsetY);

    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    this.drawBorder();
    this.brickManager.drawBricks(this.ctx);
    this.brickManager.drawParticles(this.ctx);
    this.drawParticles();
    this.paddle.draw(this.ctx);
    this.ball.draw(this.ctx);
    this.drawHUD();

    this.ctx.restore();
  }

  private drawBorder(): void {
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(0, 210, 255, 0.5)';
    this.ctx.lineWidth = 3;
    this.ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    this.ctx.shadowBlur = 10;

    const radius = 16;
    this.ctx.beginPath();
    this.ctx.moveTo(radius, 0);
    this.ctx.lineTo(this.canvasWidth - radius, 0);
    this.ctx.quadraticCurveTo(this.canvasWidth, 0, this.canvasWidth, radius);
    this.ctx.lineTo(this.canvasWidth, this.canvasHeight - radius);
    this.ctx.quadraticCurveTo(
      this.canvasWidth,
      this.canvasHeight,
      this.canvasWidth - radius,
      this.canvasHeight
    );
    this.ctx.lineTo(radius, this.canvasHeight);
    this.ctx.quadraticCurveTo(0, this.canvasHeight, 0, this.canvasHeight - radius);
    this.ctx.lineTo(0, radius);
    this.ctx.quadraticCurveTo(0, 0, radius, 0);
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawParticles(): void {
    for (const p of this.particles) {
      this.ctx.save();
      this.ctx.globalAlpha = p.alpha;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, 2 + p.alpha * 2, 0, Math.PI * 2);
      this.ctx.fillStyle = p.color;
      this.ctx.shadowColor = p.color;
      this.ctx.shadowBlur = 5;
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  private drawHUD(): void {
    this.ctx.save();
    this.ctx.font = 'bold 20px "Segoe UI", monospace';
    this.ctx.textBaseline = 'top';

    const scoreText = `得分: ${this.state.score}`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    this.ctx.shadowBlur = 10;
    this.ctx.textAlign = 'right';
    this.ctx.fillText(scoreText, this.canvasWidth - 20, 20);

    this.ctx.textAlign = 'left';
    this.ctx.shadowBlur = 8;
    for (let i = 0; i < this.state.lives; i++) {
      this.drawHeart(25 + i * 30, 28, 10);
    }

    this.ctx.textAlign = 'left';
    this.ctx.fillStyle = '#00d2ff';
    this.ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    this.ctx.shadowBlur = 10;
    this.ctx.fillText(`关卡 ${this.state.level}`, 20, 55);

    const progress = this.brickManager.getProgress();
    this.drawProgressBar(this.canvasWidth - 150, 55, 130, 12, progress);

    if (this.state.comboCount > 1) {
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#ffd32a';
      this.ctx.shadowColor = 'rgba(255, 211, 42, 0.8)';
      this.ctx.shadowBlur = 15;
      this.ctx.font = 'bold 28px "Segoe UI", sans-serif';
      this.ctx.fillText(
        `${this.state.comboCount}x 连击!`,
        this.canvasWidth / 2,
        this.canvasHeight / 2 - 50
      );
    }

    if (!this.ballLaunched && !this.state.isGameOver) {
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#00d2ff';
      this.ctx.shadowColor = 'rgba(0, 210, 255, 0.8)';
      this.ctx.shadowBlur = 15;
      this.ctx.font = 'bold 24px "Segoe UI", sans-serif';
      this.ctx.fillText(
        '点击屏幕发射小球',
        this.canvasWidth / 2,
        this.canvasHeight / 2
      );
    }

    this.ctx.restore();
  }

  private drawHeart(x: number, y: number, size: number): void {
    this.ctx.save();
    this.ctx.fillStyle = '#ff4757';
    this.ctx.shadowColor = 'rgba(255, 71, 87, 0.8)';
    this.ctx.shadowBlur = 8;

    this.ctx.beginPath();
    this.ctx.moveTo(x, y + size / 4);
    this.ctx.bezierCurveTo(x, y, x - size / 2, y, x - size / 2, y + size / 4);
    this.ctx.bezierCurveTo(
      x - size / 2,
      y + size / 2,
      x,
      y + size * 0.75,
      x,
      y + size
    );
    this.ctx.bezierCurveTo(
      x,
      y + size * 0.75,
      x + size / 2,
      y + size / 2,
      x + size / 2,
      y + size / 4
    );
    this.ctx.bezierCurveTo(x + size / 2, y, x, y, x, y + size / 4);
    this.ctx.fill();
    this.ctx.restore();
  }

  private drawProgressBar(
    x: number,
    y: number,
    width: number,
    height: number,
    progress: number
  ): void {
    this.ctx.save();

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width, height, height / 2);
    this.ctx.fill();

    const gradient = this.ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#00d2ff');
    gradient.addColorStop(1, '#3a7bd5');

    this.ctx.fillStyle = gradient;
    this.ctx.shadowColor = 'rgba(0, 210, 255, 0.6)';
    this.ctx.shadowBlur = 8;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width * progress, height, height / 2);
    this.ctx.fill();

    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 10px "Segoe UI", sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.shadowBlur = 0;
    this.ctx.fillText(
      `${Math.round(progress * 100)}%`,
      x + width / 2,
      y + height / 2
    );

    this.ctx.restore();
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
