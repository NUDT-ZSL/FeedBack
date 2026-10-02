import { GRAVITY, GROUND_Y, WALL_X, WALL_WIDTH, WALL_HEIGHT, WALL_SEGMENTS } from './constants';

export function calculateTrajectory(
  startX: number,
  startY: number,
  angleDeg: number,
  velocity: number,
  steps: number = 30
): { x: number; y: number }[] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const points: { x: number; y: number }[] = [];
  const vx = velocity * Math.cos(angleRad);
  const vy = -velocity * Math.sin(angleRad);

  const maxTime = (2 * Math.abs(vy)) / GRAVITY + 2;

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxTime;
    const x = startX + vx * t;
    const y = startY + vy * t + 0.5 * GRAVITY * t * t;
    points.push({ x, y });
    if (y >= GROUND_Y) break;
  }
  return points;
}

export function getProjectilePositionAtTime(
  startX: number,
  startY: number,
  angleDeg: number,
  velocity: number,
  time: number
): { x: number; y: number; vx: number; vy: number } {
  const angleRad = (angleDeg * Math.PI) / 180;
  const vx = velocity * Math.cos(angleRad);
  const vy = -velocity * Math.sin(angleRad);

  return {
    x: startX + vx * time,
    y: startY + vy * time + 0.5 * GRAVITY * time * time,
    vx,
    vy: vy + GRAVITY * time,
  };
}

export function checkWallCollision(
  x: number,
  y: number
): { hit: boolean; segmentIndex: number } {
  const wallTop = GROUND_Y - WALL_HEIGHT;
  const hit =
    x >= WALL_X &&
    x <= WALL_X + WALL_WIDTH &&
    y >= wallTop &&
    y <= GROUND_Y;

  if (!hit) return { hit: false, segmentIndex: -1 };

  const segmentWidth = WALL_WIDTH / WALL_SEGMENTS;
  const segmentIndex = Math.floor((x - WALL_X) / segmentWidth);
  return { hit: true, segmentIndex: Math.min(segmentIndex, WALL_SEGMENTS - 1) };
}

export function checkGroundCollision(y: number): boolean {
  return y >= GROUND_Y;
}

export function calculateMorale(durability: number, maxDurability: number): number {
  const ratio = durability / maxDurability;
  return Math.max(0, Math.min(100, ratio * 100));
}

export function calculateDamageProbability(health: number, maxHealth: number): number {
  const healthRatio = health / maxHealth;
  return 0.1 + (1 - healthRatio) * 0.4;
}

export function clampAngle(angle: number): number {
  return Math.max(0, Math.min(75, angle));
}

export function calculateAngleFromMouse(
  catapultX: number,
  catapultY: number,
  mouseX: number,
  mouseY: number
): number {
  const dx = mouseX - catapultX;
  const dy = catapultY - mouseY;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return clampAngle(angle);
}
