export interface BallState {
  angle: number;
  angularVelocity: number;
  mass: number;
  x: number;
  y: number;
  pivotX: number;
  pivotY: number;
  ropeLength: number;
  radius: number;
  flashTime: number;
  trail: { x: number; y: number }[];
  targetAngle: number;
  isResetting: boolean;
  resetProgress: number;
}

export const GRAVITY = 9.8 * 60;

export function updateBallPhysics(
  ball: BallState,
  dt: number,
  damping: number,
  maxTrailLength: number
): void {
  if (ball.isResetting) {
    ball.resetProgress += dt / 0.1;
    if (ball.resetProgress >= 1) {
      ball.angle = 0;
      ball.angularVelocity = 0;
      ball.isResetting = false;
      ball.resetProgress = 0;
      ball.trail = [];
    } else {
      const t = easeOutCubic(ball.resetProgress);
      ball.angle = ball.angle * (1 - t) + ball.targetAngle * t;
      ball.angularVelocity *= 1 - t;
    }
  } else {
    const angularAcceleration = -(GRAVITY / ball.ropeLength) * Math.sin(ball.angle);
    ball.angularVelocity += angularAcceleration * dt;
    ball.angularVelocity *= 1 - damping;
    ball.angle += ball.angularVelocity * dt;
  }

  ball.x = ball.pivotX + Math.sin(ball.angle) * ball.ropeLength;
  ball.y = ball.pivotY + Math.cos(ball.angle) * ball.ropeLength;

  if (ball.flashTime > 0) {
    ball.flashTime = Math.max(0, ball.flashTime - dt);
  }

  ball.trail.push({ x: ball.x, y: ball.y + ball.radius });
  if (ball.trail.length > maxTrailLength) {
    ball.trail.splice(0, ball.trail.length - maxTrailLength);
  }
}

export function handleElasticCollision(ball1: BallState, ball2: BallState): boolean {
  const dx = ball2.x - ball1.x;
  const dy = ball2.y - ball1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = ball1.radius + ball2.radius;

  if (dist >= minDist || dist === 0) return false;

  const v1 = ball1.angularVelocity;
  const v2 = ball2.angularVelocity;
  const m1 = ball1.mass;
  const m2 = ball2.mass;

  const relativeV = v1 - v2;
  if (relativeV <= 0) return false;

  const newV1 = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2);
  const newV2 = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2);

  ball1.angularVelocity = newV1;
  ball2.angularVelocity = newV2;

  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  const totalMass = m1 + m2;
  ball1.x -= nx * overlap * (m2 / totalMass);
  ball1.y -= ny * overlap * (m2 / totalMass);
  ball2.x += nx * overlap * (m1 / totalMass);
  ball2.y += ny * overlap * (m1 / totalMass);

  ball1.angle = Math.atan2(ball1.x - ball1.pivotX, ball1.y - ball1.pivotY);
  ball2.angle = Math.atan2(ball2.x - ball2.pivotX, ball2.y - ball2.pivotY);

  ball1.flashTime = 0.2;
  ball2.flashTime = 0.2;

  return true;
}

export function calculateTotalMomentum(balls: BallState[]): number {
  let total = 0;
  for (const ball of balls) {
    const v = ball.angularVelocity * ball.ropeLength;
    total += ball.mass * v;
  }
  return total;
}

export function calculateTotalKineticEnergy(balls: BallState[]): number {
  let total = 0;
  for (const ball of balls) {
    const v = ball.angularVelocity * ball.ropeLength;
    total += 0.5 * ball.mass * v * v;
  }
  return total;
}

export function getBallRadius(mass: number): number {
  return 20 + mass * 5;
}

export function interpolateColor(t: number): string {
  const r1 = 79, g1 = 195, b1 = 247;
  const r2 = 255, g2 = 112, b2 = 67;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
