import { Ball, Vector2 } from './ball';
import { Course } from './course';
import { UI } from './ui';
import { ParticleSystem } from './particles';

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  private ball: Ball;
  private course: Course;
  private ui: UI;
  private particles: ParticleSystem;

  private tiltAngle: number;

  private isCharging: boolean;
  private chargeStartTime: number;
  private maxChargeTime: number;
  private mousePosition: Vector2;

  private strokeCount: number;
  private maxStrokes: number;

  private gameState: 'aiming' | 'charging' | 'rolling' | 'win' | 'fail';

  private lastTime: number;
  private animationId: number | null;

  constructor() {
    this.canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    this.ctx = ctx;

    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.tiltAngle = 15 * Math.PI / 180;

    this.course = new Course(this.width, this.height);
    this.ball = new Ball(this.course.teePosition.x, this.course.teePosition.y);
    this.ui = new UI(this.width, this.height);
    this.particles = new ParticleSystem(200);

    this.isCharging = false;
    this.chargeStartTime = 0;
    this.maxChargeTime = 2000;
    this.mousePosition = { x: 0, y: 0 };

    this.strokeCount = 0;
    this.maxStrokes = 10;

    this.gameState = 'aiming';
    this.lastTime = performance.now();
    this.animationId = null;

    this.setupEventListeners();
    this.setupButtonCallbacks();
    this.gameLoop();
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.handleResize());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePosition = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      this.ui.checkButtonHover(this.mousePosition.x, this.mousePosition.y);
      this.updateAimDirection();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      if (this.ui.checkButtonClick(clickX, clickY)) {
        return;
      }

      if (this.gameState === 'aiming') {
        this.startCharging();
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;

      if (this.gameState === 'charging') {
        this.strike();
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.gameState === 'charging') {
        this.strike();
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setupButtonCallbacks(): void {
    this.ui.resetButton.onClick = () => this.resetLevel();
    this.ui.nextLevelButton.onClick = () => this.nextLevel();
  }

  private updateAimDirection(): void {
    if (this.gameState !== 'aiming' && this.gameState !== 'charging') {
      this.ui.setAimDirection(null, null);
      return;
    }

    const direction: Vector2 = {
      x: this.mousePosition.x - this.ball.position.x,
      y: this.mousePosition.y - this.ball.position.y
    };

    const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (length > 0) {
      direction.x /= length;
      direction.y /= length;
    }

    this.ui.setAimDirection(direction, this.ball.position);
  }

  private startCharging(): void {
    this.isCharging = true;
    this.chargeStartTime = performance.now();
    this.gameState = 'charging';
    this.ui.setCharging(true);
  }

  private strike(): void {
    if (!this.isCharging) return;

    const chargeTime = performance.now() - this.chargeStartTime;
    const power = Math.min(chargeTime / this.maxChargeTime, 1) * 12 + 2;

    const direction: Vector2 = {
      x: this.mousePosition.x - this.ball.position.x,
      y: this.mousePosition.y - this.ball.position.y
    };

    this.ball.applyForce(direction, power);

    this.strokeCount++;
    this.ui.setStrokeCount(this.strokeCount);
    this.ui.setCharging(false);

    this.isCharging = false;
    this.gameState = 'rolling';
  }

  private resetLevel(): void {
    this.course.generate();
    this.ball.reset(this.course.teePosition.x, this.course.teePosition.y);
    this.particles.clear();

    this.strokeCount = 0;
    this.ui.setStrokeCount(this.strokeCount);
    this.ui.showWin(false);
    this.ui.showFail(false);
    this.ui.nextLevelButton.visible = false;

    this.gameState = 'aiming';
    this.isCharging = false;
  }

  private nextLevel(): void {
    this.course.generate();
    this.ball.reset(this.course.teePosition.x, this.course.teePosition.y);
    this.particles.clear();

    this.strokeCount = 0;
    this.ui.setStrokeCount(this.strokeCount);
    this.ui.showWin(false);
    this.ui.nextLevelButton.visible = false;

    this.gameState = 'aiming';
    this.isCharging = false;
  }

  private handleResize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.course.resize(this.width, this.height);
    this.ball.reset(this.course.teePosition.x, this.course.teePosition.y);
    this.ui.resize(this.width, this.height);
  }

  private update(deltaTime: number): void {
    if (this.isCharging) {
      const chargeTime = performance.now() - this.chargeStartTime;
      const power = Math.min(chargeTime / this.maxChargeTime, 1);
      this.ui.setPower(power);
    }

    this.course.update(deltaTime);
    this.ui.update(deltaTime);
    this.particles.update(deltaTime);

    if (this.gameState === 'rolling') {
      this.ball.update(
        deltaTime,
        this.course.terrainZones,
        this.course.fences,
        this.course.holePosition,
        this.course.holeRadius
      );

      if (this.ball.isInHole) {
        this.handleWin();
      } else if (!this.ball.isMoving) {
        this.handleBallStopped();
      }
    }
  }

  private handleWin(): void {
    this.gameState = 'win';
    this.particles.emitHoleEffect(this.course.holePosition);
    this.ui.showWin(true);
    this.ui.nextLevelButton.visible = true;
  }

  private handleBallStopped(): void {
    if (this.strokeCount >= this.maxStrokes) {
      this.gameState = 'fail';
      this.particles.emitFailEffect(this.ball.position);
      this.ui.showFail(true);
    } else {
      this.gameState = 'aiming';
      this.ui.setAimDirection(null, null);
    }
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.course.render(this.ctx, this.tiltAngle);
    this.particles.render(this.ctx, this.tiltAngle);
    this.ball.render(this.ctx, this.tiltAngle);
    this.ui.render(this.ctx);
  }

  private gameLoop = (): void => {
    const currentTime = performance.now();
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.05);
    this.lastTime = currentTime;

    this.update(deltaTime);
    this.render();

    this.animationId = requestAnimationFrame(this.gameLoop);
  };

  public destroy(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
