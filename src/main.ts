import { Vector2 } from './ball.ts';
import { UI } from './ui.ts';
import { ParticleSystem } from './particles.ts';
import { GameSession } from './session.ts';

class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  private session: GameSession;
  private ui: UI;
  private particles: ParticleSystem;

  private tiltAngle: number;

  private isCharging: boolean;
  private chargeStartTime: number;
  private maxChargeTime: number;
  private mousePosition: Vector2;

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

    this.session = new GameSession({ width: this.width, height: this.height, maxStrokes: 10 });
    this.ui = new UI(this.width, this.height);
    this.particles = new ParticleSystem(200);

    this.isCharging = false;
    this.chargeStartTime = 0;
    this.maxChargeTime = 2000;
    this.mousePosition = { x: 0, y: 0 };

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

      if (this.session.beginCharge()) {
        this.isCharging = true;
        this.chargeStartTime = performance.now();
        this.ui.setCharging(true);
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.releaseStroke();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.releaseStroke();
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private releaseStroke(): void {
    if (!this.isCharging) return;

    const chargeTime = performance.now() - this.chargeStartTime;
    const power = Math.min(chargeTime / this.maxChargeTime, 1) * 12 + 2;

    const direction: Vector2 = {
      x: this.mousePosition.x - this.session.ball.position.x,
      y: this.mousePosition.y - this.session.ball.position.y
    };

    if (this.session.strike(direction, power)) {
      this.ui.setStrokeCount(this.session.strokeCount);
    }

    this.isCharging = false;
    this.ui.setCharging(false);
  }

  private setupButtonCallbacks(): void {
    this.ui.resetButton.onClick = () => this.resetLevel();
    this.ui.nextLevelButton.onClick = () => this.nextLevel();
  }

  private updateAimDirection(): void {
    if (!this.session.canStrike) {
      this.ui.setAimDirection(null, null);
      return;
    }

    const direction: Vector2 = {
      x: this.mousePosition.x - this.session.ball.position.x,
      y: this.mousePosition.y - this.session.ball.position.y
    };

    const length = Math.hypot(direction.x, direction.y);
    if (length > 0) {
      direction.x /= length;
      direction.y /= length;
    }

    this.ui.setAimDirection(direction, this.session.ball.position);
  }

  private resetLevel(): void {
    this.session.resetLevel();
    this.afterLevelUiReset();
  }

  private nextLevel(): void {
    this.session.nextLevel();
    this.afterLevelUiReset();
  }

  private afterLevelUiReset(): void {
    this.particles.clear();
    this.isCharging = false;
    this.ui.setStrokeCount(0);
    this.ui.setCharging(false);
    this.ui.showWin(false);
    this.ui.showFail(false);
    this.ui.nextLevelButton.visible = false;
    this.updateAimDirection();
  }

  private handleResize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.session.resize(this.width, this.height);
    this.ui.resize(this.width, this.height);
  }

  private update(deltaTime: number): void {
    if (this.isCharging) {
      const chargeTime = performance.now() - this.chargeStartTime;
      const power = Math.min(chargeTime / this.maxChargeTime, 1);
      this.ui.setPower(power);
    }

    this.session.course.update(deltaTime);
    this.ui.update(deltaTime);
    this.particles.update(deltaTime);

    const previousState = this.session.state;
    this.session.update(deltaTime);
    this.session.ball.updateVisual(deltaTime);

    if (this.session.state !== previousState) {
      this.handleStateChange(previousState, this.session.state);
    }
  }

  private handleStateChange(_previous: string, current: string): void {
    const course = this.session.course;
    if (current === 'win') {
      this.particles.emitHoleEffect(course.holePosition);
      this.ui.showWin(true);
      this.ui.nextLevelButton.visible = true;
    } else if (current === 'fail') {
      this.particles.emitFailEffect(this.session.ball.position);
      this.ui.showFail(true);
    } else if (current === 'aiming') {
      this.ui.setAimDirection(null, null);
    }
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.session.course.render(this.ctx, this.tiltAngle);
    this.particles.render(this.ctx, this.tiltAngle);
    this.session.ball.render(this.ctx, this.tiltAngle);
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
