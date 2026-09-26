import { RoomConfig, MATERIAL_PROPS, WallType } from '@/types';

export function calculateRT60(room: RoomConfig): number {
  const volume = room.width * room.height * room.depth;

  const wallAreas: Record<WallType, number> = {
    front: room.width * room.height,
    back: room.width * room.height,
    left: room.depth * room.height,
    right: room.depth * room.height,
    floor: room.width * room.depth,
    ceiling: room.width * room.depth,
  };

  let totalAbsorption = 0;
  const wallKeys = Object.keys(wallAreas) as WallType[];

  for (const wall of wallKeys) {
    const material = room.walls[wall];
    const absorptionCoeff = 1 - MATERIAL_PROPS[material].reflectionRate;
    totalAbsorption += wallAreas[wall] * absorptionCoeff;
  }

  if (totalAbsorption <= 0) return 5.0;

  const rt60 = (0.161 * volume) / totalAbsorption;
  return Math.min(Math.max(rt60, 0.3), 5.0);
}

export function calculateParticleCount(rt60: number): number {
  const minParticles = 50;
  const maxParticles = 200;
  const minRT60 = 0.5;
  const maxRT60 = 2.0;

  const t = Math.min(Math.max((rt60 - minRT60) / (maxRT60 - minRT60), 0), 1);
  return Math.round(minParticles + t * (maxParticles - minParticles));
}

export function generateParticleData(
  count: number,
  room: RoomConfig,
): {
  positions: Float32Array;
  velocities: Float32Array;
  lifetimes: Float32Array;
  alphas: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);
  const alphas = new Float32Array(count);

  const hw = room.width / 2;
  const hh = room.height / 2;
  const hd = room.depth / 2;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * room.width * 0.8;
    positions[i * 3 + 1] = (Math.random() - 0.5) * room.height * 0.8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * room.depth * 0.8;

    const speed = 0.5 + Math.random() * 1.5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    velocities[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
    velocities[i * 3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
    velocities[i * 3 + 2] = speed * Math.cos(phi);

    lifetimes[i] = Math.random();
    alphas[i] = 0.1 + Math.random() * 0.2;
  }

  return { positions, velocities, lifetimes, alphas };
}
