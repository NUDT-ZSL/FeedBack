import { Ball } from './ball.js';
import { BrickManager, Particle } from './brick.js';
import { Paddle } from './paddle.js';
import { RandomSource } from './rng.js';

export interface GameStatus {
  score: number;
  lives: number;
  level: number;
  isPlaying: boolean;
  isGameOver: boolean;
  ballLaunched: boolean;
  comboCount: number;
  progress: number;
  shakeTime: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
}

export interface UpdateResult {
  ballFell: boolean;
  brickHit: boolean;
  comboChain: number;
  particles: Particle[];
  levelCompleted: boolean;
  gameOver: boolean;
}

const emptyResult = (): UpdateResult => ({
  ballFell: false,
  brickHit: false,
  comboChain: 0,
  particles: [],
  levelCompleted: false,
  gameOver: false
});

export class GameEngine {
  readonly ball: Ball;
  readonly brickManager: BrickManager;
  readonly paddle: Paddle;
  canvasWidth: number;
  canvasHeight: number;

  score = 0;
  lives = 3;
  level = 1;
  isPlaying = false;
  isGameOver = false;
  ballLaunched = false;
  comboCount = 0;
  shakeTime = 0;
  shakeOffsetX = 0;
  shakeOffsetY = 0;

  constructor(
    width = 800,
    height = 600,
    private random: RandomSource = Math.random
  ) {
    this.canvasWidth = width;
    this.canvasHeight = height;

    const paddleWidth = 100;
    const paddleHeight = 15;
    const paddleY = height - paddleHeight - 20;
    const paddleX = (width - paddleWidth) / 2;

    this.paddle = new Paddle(paddleX, paddleY, paddleWidth, paddleHeight);
    this.paddle.setCanvasWidth(width);
    this.ball = new Ball(this.paddle.getCenterX(), paddleY - 10, 8, random);
    this.brickManager = new BrickManager(width, height, random);
  }

  initialize(): void {
    this.brickManager.generateHoneycombLayout();
  }

  resize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.paddle.setCanvasWidth(width);
    this.paddle.y = height - this.paddle.height - 20;
    this.brickManager.resize(width, height);
    this.brickManager.clear();
    this.brickManager.generateHoneycombLayout();
    if (!this.ballLaunched) this.resetBall();
  }

  launchBall(angle = -Math.PI / 2 + (this.random() - 0.5) * 0.5): void {
    if (this.ballLaunched || this.isGameOver) return;
    this.ball.launch(angle);
    this.ballLaunched = true;
    this.isPlaying = true;
  }

  update(deltaTime: number): UpdateResult {
    const result = emptyResult();
    if (this.isGameOver) return result;

    this.paddle.update();
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - deltaTime);
      if (this.shakeTime === 0) {
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }
    }

    if (!this.ballLaunched) {
      this.ball.x = this.paddle.getCenterX();
      this.ball.y = this.paddle.y - this.ball.radius - 2;
      return result;
    }

    result.ballFell = this.ball.update(this.canvasWidth, this.canvasHeight);
    if (result.ballFell) {
      this.lives--;
      if (this.lives <= 0) {
        this.endGame();
        result.gameOver = true;
      } else {
        this.resetBall();
      }
      return result;
    }

    this.ball.checkPaddleCollision(
      this.paddle.x,
      this.paddle.y,
      this.paddle.width,
      this.paddle.height
    );

    const collision = this.brickManager.checkCollision(
      this.ball.x,
      this.ball.y,
      this.ball.radius
    );
    if (collision.hit) {
      this.ball.reflectVertical();
      this.ball.addRandomAngleOffset();
      this.score +=
        10 + (collision.comboChain > 1 ? (collision.comboChain - 1) * 5 : 0);
      this.comboCount = collision.comboChain;
      this.triggerShake();

      result.brickHit = true;
      result.comboChain = collision.comboChain;
      result.particles = collision.particles;
      if (this.brickManager.getProgress() >= 1) {
        this.nextLevel();
        result.levelCompleted = true;
      }
    }
    this.brickManager.updateParticles(deltaTime);
    return result;
  }

  getProgress(): number {
    return this.brickManager.getProgress();
  }

  getStatus(): GameStatus {
    return {
      score: this.score,
      lives: this.lives,
      level: this.level,
      isPlaying: this.isPlaying,
      isGameOver: this.isGameOver,
      ballLaunched: this.ballLaunched,
      comboCount: this.comboCount,
      progress: this.getProgress(),
      shakeTime: this.shakeTime,
      shakeOffsetX: this.shakeOffsetX,
      shakeOffsetY: this.shakeOffsetY
    };
  }

  resetBall(): void {
    this.ballLaunched = false;
    this.isPlaying = false;
    this.comboCount = 0;
    this.paddle.reset((this.canvasWidth - this.paddle.width) / 2, this.paddle.y);
    this.ball.reset(this.paddle.getCenterX(), this.paddle.y - this.ball.radius - 2);
  }

  nextLevel(): void {
    this.level++;
    this.ball.increaseSpeed(1.05);
    this.brickManager.clear();
    this.brickManager.generateHoneycombLayout();
    this.resetBall();
  }

  restart(): void {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.isPlaying = false;
    this.isGameOver = false;
    this.ballLaunched = false;
    this.comboCount = 0;
    this.shakeTime = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.paddle.reset((this.canvasWidth - this.paddle.width) / 2, this.paddle.y);
    this.ball.reset(this.paddle.getCenterX(), this.paddle.y - 10);
    this.brickManager.clear();
    this.brickManager.generateHoneycombLayout();
  }

  private endGame(): void {
    this.isGameOver = true;
    this.isPlaying = false;
  }

  private triggerShake(): void {
    this.shakeTime = 100;
    const amount = 3;
    this.shakeOffsetX = (this.random() - 0.5) * amount;
    this.shakeOffsetY = (this.random() - 0.5) * amount;
  }
}
