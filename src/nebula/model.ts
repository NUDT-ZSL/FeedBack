import type { NebulaParams, NebulaParamKey } from './params.ts';
import { MAX_PARTICLES, cloneParams, diffParams } from './params.ts';
import type { ParticleSeeds } from './seeds.ts';
import { createParticleSeeds } from './seeds.ts';
import type { Vec3 } from './derive.ts';
import { derivePosition, deriveColor, deriveSize } from './derive.ts';

export class NebulaModel {
  readonly maxParticles: number;
  private readonly seeds: ParticleSeeds;
  private params: NebulaParams;

  constructor(
    params: NebulaParams,
    maxParticles: number = MAX_PARTICLES,
    random: () => number = Math.random
  ) {
    this.params = cloneParams(params);
    this.maxParticles = maxParticles;
    this.seeds = createParticleSeeds(maxParticles, random);
  }

  getParams(): Readonly<NebulaParams> {
    return this.params;
  }

  setParams(next: NebulaParams): NebulaParamKey[] {
    const changed = diffParams(this.params, next);
    if (changed.length > 0) {
      this.params = cloneParams(next);
    }
    return changed;
  }

  positionAt(index: number): Vec3 {
    return derivePosition(this.seeds, index, this.params.radius);
  }

  colorAt(index: number): Vec3 {
    return deriveColor(this.seeds, index, this.params.hueOffset);
  }

  sizeAt(index: number): number {
    return deriveSize(this.seeds, index);
  }
}
