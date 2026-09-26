import type { MazeData, ShipState, InputState, TrailParticle } from '../types/game';

const SHIP_SPEED = 120;
const SHIP_RADIUS = 12;
const TRAIL_COUNT = 5;
const HIT_DURATION = 100;
const HIT_ENERGY_LOSS = 10;
const BOUNCE_FACTOR = 0.6;

export function createInitialShip(x: number, y: number): ShipState {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    energy: 100,
    maxEnergy: 100,
    isHit: false,
    hitTime: 0,
    trail: [],
  };
}

function isWall(maze: MazeData, gridX: number, gridY: number): boolean {
  if (gridX < 0 || gridX >= maze.width || gridY < 0 || gridY >= maze.height) {
    return true;
  }
  return maze.grid[gridY][gridX] === 1;
}

function checkCircleWallCollision(
  x: number,
  y: number,
  radius: number,
  maze: MazeData
): { collided: boolean; nx: number; ny: number } {
  const cellSize = maze.cellSize;
  const gridX = Math.floor(x / cellSize);
  const gridY = Math.floor(y / cellSize);

  let minDist = Infinity;
  let closestX = x;
  let closestY = y;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = gridX + dx;
      const gy = gridY + dy;

      if (isWall(maze, gx, gy)) {
        const wallLeft = gx * cellSize;
        const wallRight = wallLeft + cellSize;
        const wallTop = gy * cellSize;
        const wallBottom = wallTop + cellSize;

        const nearestX = Math.max(wallLeft, Math.min(x, wallRight));
        const nearestY = Math.max(wallTop, Math.min(y, wallBottom));

        const distX = x - nearestX;
        const distY = y - nearestY;
        const dist = Math.sqrt(distX * distX + distY * distY);

        if (dist < minDist) {
          minDist = dist;
          closestX = nearestX;
          closestY = nearestY;
        }
      }
    }
  }

  if (minDist < radius) {
    const dx = x - closestX;
    const dy = y - closestY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      collided: true,
      nx: dx / len,
      ny: dy / len,
    };
  }

  return { collided: false, nx: 0, ny: 0 };
}

export function updateShipPhysics(
  ship: ShipState,
  input: InputState,
  maze: MazeData,
  deltaTime: number,
  currentTime: number
): ShipState {
  let dx = 0;
  let dy = 0;

  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;

  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag > 0) {
    dx /= mag;
    dy /= mag;
  }

  let vx = dx * SHIP_SPEED;
  let vy = dy * SHIP_SPEED;

  let x = ship.x + vx * deltaTime;
  let y = ship.y + vy * deltaTime;

  const collision = checkCircleWallCollision(x, y, SHIP_RADIUS, maze);

  let isHit = ship.isHit;
  let hitTime = ship.hitTime;
  let energy = ship.energy;

  if (collision.collided) {
    const dot = vx * collision.nx + vy * collision.ny;
    if (dot < 0) {
      vx = vx - 2 * dot * collision.nx * BOUNCE_FACTOR;
      vy = vy - 2 * dot * collision.ny * BOUNCE_FACTOR;
    }

    x = ship.x;
    y = ship.y;

    const recheck = checkCircleWallCollision(
      x + collision.nx * 2,
      y + collision.ny * 2,
      SHIP_RADIUS,
      maze
    );
    if (!recheck.collided) {
      x += collision.nx * 2;
      y += collision.ny * 2;
    }

    if (!isHit || currentTime - hitTime > HIT_DURATION + 50) {
      isHit = true;
      hitTime = currentTime;
      energy = Math.max(0, energy - HIT_ENERGY_LOSS);
    }
  }

  if (isHit && currentTime - hitTime > HIT_DURATION) {
    isHit = false;
  }

  let angle = ship.angle;
  if (mag > 0) {
    angle = Math.atan2(dy, dx);
  }

  const trail: TrailParticle[] = [...ship.trail];
  if (mag > 0 || trail.length > 0) {
    trail.unshift({
      x: ship.x,
      y: ship.y,
      life: 1,
      maxLife: 1,
    });

    if (trail.length > TRAIL_COUNT) {
      trail.pop();
    }

    for (let i = 0; i < trail.length; i++) {
      trail[i].life = 1 - i / TRAIL_COUNT;
    }
  }

  return {
    ...ship,
    x,
    y,
    vx,
    vy,
    angle,
    energy,
    isHit,
    hitTime,
    trail,
  };
}

export function getShipRadius(): number {
  return SHIP_RADIUS;
}
