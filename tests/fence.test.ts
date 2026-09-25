// Chain: fence collision / reflection / boundary containment.
// Verifies the ball bounces off fences with a sane position and velocity
// and can never be pushed outside the course boundaries.

import { describe, it, expect, afterEach } from 'vitest';
import { Ball, Fence, Vector2 } from '../src/ball';
import { Course } from '../src/course';
import { seedRandom, resetRandomSource } from '../src/rng';

const DT = 1 / 60;
const FAR_HOLE: Vector2 = { x: -100000, y: -100000 };

afterEach(() => resetRandomSource());

describe('fence collision chain', () => {
  // Vertical fence at x=600, normal pointing back toward the ball (-x).
  const fence: Fence = {
    start: { x: 600, y: 0 },
    end: { x: 600, y: 1000 },
    normal: { x: -1, y: 0 }
  };

  it('reflects the velocity component along the fence normal', () => {
    const ball = new Ball(500, 500);
    ball.velocity = { x: 6, y: 0 };
    ball.isMoving = true;

    let bounced = false;
    for (let i = 0; i < 1000 && ball.isMoving; i++) {
      const prevVx = ball.velocity.x;
      ball.update(DT, [], [fence], FAR_HOLE, 18);
      if (prevVx > 0 && ball.velocity.x < 0) {
        bounced = true;
        // Moving away from the fence along its normal after the bounce.
        const dot = ball.velocity.x * fence.normal.x + ball.velocity.y * fence.normal.y;
        expect(dot).toBeGreaterThan(0);
        // One update applies grass friction (0.985) and then the bounce
        // keeps 70% of the incoming speed.
        expect(Math.abs(ball.velocity.x)).toBeCloseTo(Math.abs(prevVx) * 0.985 * 0.7, 5);
        break;
      }
    }
    expect(bounced).toBe(true);
  });

  it('pushes the ball back out so it never overlaps the fence', () => {
    const ball = new Ball(500, 500);
    ball.velocity = { x: 6, y: 0 };
    ball.isMoving = true;

    for (let i = 0; i < 1000 && ball.isMoving; i++) {
      ball.update(DT, [], [fence], FAR_HOLE, 18);
      // Ball approaches from the left: its center must stay left of the
      // fence line (within push-out tolerance of 1px).
      expect(ball.position.x).toBeLessThanOrEqual(600 - ball.radius + 1.001);
    }
  });

  it('loses energy on every bounce (post-bounce speed < pre-bounce speed)', () => {
    const ball = new Ball(500, 500);
    ball.velocity = { x: 6, y: 1 };
    ball.isMoving = true;

    for (let i = 0; i < 1000 && ball.isMoving; i++) {
      const prevSpeed = Math.hypot(ball.velocity.x, ball.velocity.y);
      ball.update(DT, [], [fence], FAR_HOLE, 18);
      const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
      // Friction alone loses <= 1.5%/step; a bounce loses 30%.
      if (speed < prevSpeed * 0.9) {
        expect(speed).toBeGreaterThan(prevSpeed * 0.6);
        return;
      }
    }
    throw new Error('ball never bounced off the fence');
  });

  it('never lets the ball escape the course boundaries', () => {
    const width = 1280;
    const height = 720;
    seedRandom(555);
    const course = new Course(width, height);

    // Fire the ball at the walls from the tee in many directions at max
    // power; after every single step it must remain inside the canvas.
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      const ball = new Ball(course.teePosition.x, course.teePosition.y);
      ball.applyForce({ x: Math.cos(angle), y: Math.sin(angle) }, 14);

      let steps = 0;
      while (ball.isMoving && steps < 20000) {
        ball.update(DT, course.terrainZones, course.fences, FAR_HOLE, 18);
        steps++;
        expect(ball.position.x).toBeGreaterThanOrEqual(0);
        expect(ball.position.x).toBeLessThanOrEqual(width);
        expect(ball.position.y).toBeGreaterThanOrEqual(0);
        expect(ball.position.y).toBeLessThanOrEqual(height);
        // Fences sit at margin 80 (+/-20 wave); the ball center should
        // never get past them by more than its own radius + push-out.
        expect(ball.position.x).toBeGreaterThan(80 - 20 - ball.radius - 2);
        expect(ball.position.x).toBeLessThan(width - 80 + 20 + ball.radius + 2);
        expect(ball.position.y).toBeGreaterThan(80 - 20 - ball.radius - 2);
        expect(ball.position.y).toBeLessThan(height - 80 + 20 + ball.radius + 2);
      }
      expect(steps).toBeLessThan(20000);
    }
  });
});
