import { Ball, PHYSICS } from './ball.ts';
import type { Vector2 } from './ball.ts';
import { Course } from './course.ts';
import { mulberry32 } from './rng.ts';
import type { Rng } from './rng.ts';

export type GameState = 'aiming' | 'charging' | 'rolling' | 'win' | 'fail';

export interface SessionOptions {
  width: number;
  height: number;
  maxStrokes?: number;
  seed?: number;
  rngFactory?: () => Rng;
}

export class GameSession {
  readonly course: Course;
  readonly ball: Ball;
  readonly maxStrokes: number;

  state: GameState;
  strokeCount: number;
  level: number;

  private layoutSeed: number;
  private physicsRng: Rng;
  private rngFactory: () => Rng;
  private accumulator: number;

  constructor(options: SessionOptions) {
    this.maxStrokes = options.maxStrokes ?? 10;
    this.layoutSeed = options.seed === undefined
      ? Math.floor(Math.random() * 0xffffffff)
      : options.seed >>> 0;
    this.rngFactory = options.rngFactory ?? (() => mulberry32((this.layoutSeed ^ 0x9e3779b9) >>> 0));
    this.physicsRng = this.rngFactory();

    this.course = new Course(options.width, options.height, this.layoutSeed);
    this.ball = new Ball(this.course.teePosition.x, this.course.teePosition.y);

    this.state = 'aiming';
    this.strokeCount = 0;
    this.level = 1;
    this.accumulator = 0;
  }

  get canStrike(): boolean {
    return this.state === 'aiming' || this.state === 'charging';
  }

  beginCharge(): boolean {
    if (this.state !== 'aiming') return false;
    this.state = 'charging';
    return true;
  }

  cancelCharge(): void {
    if (this.state === 'charging') this.state = 'aiming';
  }

  strike(direction: Vector2, power: number): boolean {
    if (!this.canStrike) return false;
    if (this.strokeCount >= this.maxStrokes) return false;

    this.ball.applyForce(direction, power);
    if (!this.ball.isMoving) {
      this.state = 'aiming';
      return false;
    }

    this.strokeCount++;
    this.state = 'rolling';
    return true;
  }

  update(deltaTime: number): void {
    if (this.state !== 'rolling') return;

    this.accumulator += Math.min(deltaTime, 0.25);
    while (this.accumulator >= PHYSICS.FIXED_STEP) {
      this.accumulator -= PHYSICS.FIXED_STEP;
      this.ball.stepFixed(
        this.course.terrainZones,
        this.course.fences,
        this.course.holePosition,
        this.course.holeRadius,
        this.physicsRng
      );

      if (this.ball.isInHole) {
        this.state = 'win';
        this.accumulator = 0;
        return;
      }
      if (!this.ball.isMoving) {
        this.accumulator = 0;
        this.state = this.strokeCount >= this.maxStrokes ? 'fail' : 'aiming';
        return;
      }
    }
  }

  resetLevel(): void {
    this.course.regenerate();
    this.afterLevelLoad();
  }

  nextLevel(): void {
    this.level++;
    this.layoutSeed = (this.layoutSeed * 1664525 + 1013904223) >>> 0;
    this.course.generate(this.layoutSeed);
    this.afterLevelLoad();
  }

  resize(width: number, height: number): void {
    this.course.resize(width, height);
    this.ball.reset(this.course.teePosition.x, this.course.teePosition.y);
    if (this.state === 'rolling' || this.state === 'charging') {
      this.state = 'aiming';
    }
    this.accumulator = 0;
  }

  private afterLevelLoad(): void {
    this.ball.reset(this.course.teePosition.x, this.course.teePosition.y);
    this.strokeCount = 0;
    this.state = 'aiming';
    this.accumulator = 0;
    this.physicsRng = this.rngFactory();
  }
}
