// Headless game core: the same physics and state transitions as the
// browser Game class in main.ts, but without any DOM/canvas dependency.
// Used by the offline verification suite in verify/.

import { Ball } from './ball.ts';
import type { Vector2 } from './ball.ts';
import { Course } from './course.ts';
import { mulberry32 } from './rng.ts';
import { MAX_STROKES, chargePower } from './rules.ts';

export type HeadlessState = 'aiming' | 'rolling' | 'win' | 'fail';

export interface Snapshot {
  state: HeadlessState;
  strokeCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isInHole: boolean;
  isMoving: boolean;
}

export class HeadlessGame {
  readonly course: Course;
  readonly ball: Ball;
  readonly maxStrokes: number;
  strokeCount: number;
  state: HeadlessState;

  constructor(
    width: number,
    height: number,
    seed: number,
    maxStrokes: number = MAX_STROKES
  ) {
    // Two independent streams so terrain layout and slope deviation
    // randomness do not interfere with each other.
    this.course = new Course(width, height, mulberry32(seed));
    this.ball = new Ball(
      this.course.teePosition.x,
      this.course.teePosition.y,
      mulberry32(seed ^ 0x9e3779b9)
    );
    this.maxStrokes = maxStrokes;
    this.strokeCount = 0;
    this.state = 'aiming';
  }

  // Mirrors Game.strike() in main.ts.
  strike(direction: Vector2, chargeMs: number): void {
    if (this.state !== 'aiming') {
      throw new Error(`cannot strike while state is '${this.state}'`);
    }
    this.ball.applyForce(direction, chargePower(chargeMs));
    this.strokeCount++;
    this.state = 'rolling';
  }

  // Mirrors the 'rolling' branch of Game.update() plus
  // handleWin()/handleBallStopped() in main.ts.
  step(deltaTime: number = 1 / 60): void {
    if (this.state !== 'rolling') return;

    this.ball.update(
      deltaTime,
      this.course.terrainZones,
      this.course.fences,
      this.course.holePosition,
      this.course.holeRadius
    );

    if (this.ball.isInHole) {
      this.state = 'win';
    } else if (!this.ball.isMoving) {
      this.state = this.strokeCount >= this.maxStrokes ? 'fail' : 'aiming';
    }
  }

  runUntilSettled(maxSteps: number = 20000): HeadlessState {
    let steps = 0;
    while (this.state === 'rolling') {
      if (++steps > maxSteps) {
        throw new Error('ball did not settle within maxSteps');
      }
      this.step();
    }
    return this.state;
  }

  snapshot(): Snapshot {
    return {
      state: this.state,
      strokeCount: this.strokeCount,
      x: this.ball.position.x,
      y: this.ball.position.y,
      vx: this.ball.velocity.x,
      vy: this.ball.velocity.y,
      isInHole: this.ball.isInHole,
      isMoving: this.ball.isMoving
    };
  }
}
