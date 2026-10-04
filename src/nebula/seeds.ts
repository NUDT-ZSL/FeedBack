export interface ParticleSeeds {
  directionU: Float32Array;
  directionV: Float32Array;
  radial: Float32Array;
  size: Float32Array;
}

export function createParticleSeeds(
  count: number,
  random: () => number = Math.random
): ParticleSeeds {
  const seeds: ParticleSeeds = {
    directionU: new Float32Array(count),
    directionV: new Float32Array(count),
    radial: new Float32Array(count),
    size: new Float32Array(count)
  };

  for (let i = 0; i < count; i++) {
    seeds.directionU[i] = random();
    seeds.directionV[i] = random();
    seeds.radial[i] = random();
    seeds.size[i] = 0.05 + random() * 0.45;
  }

  return seeds;
}
