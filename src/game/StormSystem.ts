import type { Storm, StormParticle, MazeData } from '../types/game';

const STORM_SPEED = 40;
const STORM_MAX_RADIUS = 25;
const STORM_LIFETIME = 8;
const STORM_PARTICLE_COUNT = 10;
const STORM_SPAWN_MIN = 10;
const STORM_SPAWN_MAX = 15;
const STORM_PARTICLE_MIN_RADIUS = 10;
const STORM_PARTICLE_MAX_RADIUS = 30;
const STORM_PARTICLE_SPEED = 60;
const STORM_COLLISION_DISTANCE = 20;
const STORM_ENERGY_DRAIN = 15;

let stormIdCounter = 0;

function createStorm(
  rift: { x: number; y: number; direction: 'horizontal' | 'vertical' },
  cellSize: number
): Storm {
  const centerX = rift.x * cellSize + cellSize / 2;
  const centerY = rift.y * cellSize + cellSize / 2;

  let vx = 0;
  let vy = 0;

  if (rift.direction === 'horizontal') {
    vx = Math.random() > 0.5 ? STORM_SPEED : -STORM_SPEED;
  } else {
    vy = Math.random() > 0.5 ? STORM_SPEED : -STORM_SPEED;
  }

  const particles: StormParticle[] = [];
  for (let i = 0; i < STORM_PARTICLE_COUNT; i++) {
    particles.push({
      angle: Math.random() * Math.PI * 2,
      radius: STORM_PARTICLE_MIN_RADIUS + Math.random() * (STORM_PARTICLE_MAX_RADIUS - STORM_PARTICLE_MIN_RADIUS),
      speed: STORM_PARTICLE_SPEED * (0.5 + Math.random() * 0.5),
    });
  }

  return {
    id: stormIdCounter++,
    x: centerX,
    y: centerY,
    vx,
    vy,
    radius: 5,
    maxRadius: STORM_MAX_RADIUS,
    lifetime: STORM_LIFETIME,
    maxLifetime: STORM_LIFETIME,
    particles,
    riftIndex: 0,
  };
}

export function generateStormSpawnTime(): number {
  return STORM_SPAWN_MIN + Math.random() * (STORM_SPAWN_MAX - STORM_SPAWN_MIN);
}

export function spawnStorm(maze: MazeData): Storm | null {
  if (maze.rifts.length === 0) return null;

  const riftIndex = Math.floor(Math.random() * maze.rifts.length);
  const rift = maze.rifts[riftIndex];
  const storm = createStorm(rift, maze.cellSize);
  storm.riftIndex = riftIndex;

  return storm;
}

function isWall(maze: MazeData, gridX: number, gridY: number): boolean {
  if (gridX < 0 || gridX >= maze.width || gridY < 0 || gridY >= maze.height) {
    return true;
  }
  return maze.grid[gridY][gridX] === 1;
}

export function updateStorms(
  storms: Storm[],
  maze: MazeData,
  deltaTime: number
): Storm[] {
  const cellSize = maze.cellSize;
  const updated: Storm[] = [];

  for (const storm of storms) {
    if (storm.lifetime <= 0) continue;

    const newLifetime = storm.lifetime - deltaTime;
    if (newLifetime <= 0) continue;

    let newX = storm.x + storm.vx * deltaTime;
    let newY = storm.y + storm.vy * deltaTime;
    let vx = storm.vx;
    let vy = storm.vy;

    const gridX = Math.floor(newX / cellSize);
    const gridY = Math.floor(newY / cellSize);

    if (isWall(maze, gridX, gridY)) {
      if (storm.vx !== 0) {
        vx = -vx;
        newX = storm.x + vx * deltaTime;
      }
      if (storm.vy !== 0) {
        vy = -vy;
        newY = storm.y + vy * deltaTime;
      }
    }

    if (newX < cellSize / 2 || newX > (maze.width - 1) * cellSize - cellSize / 2) {
      vx = -vx;
      newX = Math.max(cellSize / 2, Math.min(newX, (maze.width - 1) * cellSize - cellSize / 2));
    }
    if (newY < cellSize / 2 || newY > (maze.height - 1) * cellSize - cellSize / 2) {
      vy = -vy;
      newY = Math.max(cellSize / 2, Math.min(newY, (maze.height - 1) * cellSize - cellSize / 2));
    }

    const growthDuration = 1;
    const fadeDuration = 1;
    let radius = storm.radius;

    if (newLifetime > storm.maxLifetime - growthDuration) {
      const growthProgress = 1 - (newLifetime - (storm.maxLifetime - growthDuration)) / growthDuration;
      radius = 5 + (storm.maxRadius - 5) * growthProgress;
    } else if (newLifetime < fadeDuration) {
      const fadeProgress = newLifetime / fadeDuration;
      radius = storm.maxRadius * fadeProgress;
    } else {
      radius = storm.maxRadius;
    }

    const newParticles = storm.particles.map((p) => {
      const newAngle = p.angle + (p.speed / p.radius) * deltaTime;
      return {
        ...p,
        angle: newAngle % (Math.PI * 2),
      };
    });

    updated.push({
      ...storm,
      x: newX,
      y: newY,
      vx,
      vy,
      radius,
      lifetime: newLifetime,
      particles: newParticles,
    });
  }

  return updated;
}

export function checkStormCollision(
  shipX: number,
  shipY: number,
  storms: Storm[]
): boolean {
  for (const storm of storms) {
    const dx = shipX - storm.x;
    const dy = shipY - storm.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < STORM_COLLISION_DISTANCE + storm.radius * 0.5) {
      return true;
    }
  }
  return false;
}

export function getStormEnergyDrain(): number {
  return STORM_ENERGY_DRAIN;
}
