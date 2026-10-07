import { describe, expect, it } from 'vitest';
import {
  MAX_PULP_PARTICLES,
  ParticleSystem,
  STEAM_EMIT_RATE,
  WATER_DROP_FALL_SPEED,
  WATER_DROP_RADIUS,
} from '@/core/particleSystem';

function createSystem(maxParticles = 500) {
  let value = 0.5;
  return new ParticleSystem({
    maxParticles,
    random: () => {
      value = (value * 9301 + 0.13) % 1;
      return value;
    },
  });
}

describe('ParticleSystem emission constraints', () => {
  it('emits steam at the fixed rate of 30 particles per call', () => {
    const system = createSystem();
    system.emitSteam(0, 0, 0);
    expect(system.activeCount).toBe(STEAM_EMIT_RATE);
    system.emitSteam(0, 0, 0);
    expect(system.activeCount).toBe(STEAM_EMIT_RATE * 2);
  });

  it('never exceeds the configured max particle cap', () => {
    const system = createSystem(50);
    for (let i = 0; i < 10; i++) {
      system.emitSteam(0, 0, 0);
    }
    expect(system.activeCount).toBe(50);
    system.emitWaterDrop(0, 0, 0);
    system.emitPulp(0, 0, 0, '#fff');
    expect(system.activeCount).toBe(50);
  });

  it('caps pulp particles at 200 regardless of total capacity', () => {
    const system = createSystem(1000);
    for (let i = 0; i < MAX_PULP_PARTICLES + 100; i++) {
      system.emitPulp(0, 0, 0, '#ffffff');
    }
    expect(system.activePulpCount).toBe(MAX_PULP_PARTICLES);
    expect(system.activeCount).toBe(MAX_PULP_PARTICLES);
  });

  it('emits water drops with the fixed radius and fall speed', () => {
    const system = createSystem();
    system.emitWaterDrop(1, 2, 3);
    const [drop] = system.getParticles();
    expect(drop.size).toBe(WATER_DROP_RADIUS * 2);
    expect(drop.vy).toBe(WATER_DROP_FALL_SPEED);
    expect(drop.vx).toBe(0);
    expect(drop.vz).toBe(0);
  });
});

describe('ParticleSystem lifecycle and recycling', () => {
  it('recycles dead particles back into the pool', () => {
    const system = createSystem();
    system.emitWaterDrop(0, 0, 0);
    expect(system.activeCount).toBe(1);

    system.update(4);
    expect(system.activeCount).toBe(0);
    expect(system.pooledCount).toBe(1);

    system.emitWaterDrop(0, 0, 0);
    expect(system.activeCount).toBe(1);
    expect(system.pooledCount).toBe(0);
  });

  it('decrements the pulp counter when pulp particles die', () => {
    const system = createSystem();
    for (let i = 0; i < 10; i++) {
      system.emitPulp(0, 0, 0, '#fff');
    }
    expect(system.activePulpCount).toBe(10);

    system.update(10);
    expect(system.activePulpCount).toBe(0);

    for (let i = 0; i < MAX_PULP_PARTICLES + 50; i++) {
      system.emitPulp(0, 0, 0, '#fff');
    }
    expect(system.activePulpCount).toBe(MAX_PULP_PARTICLES);
  });

  it('stays within the cap across long mixed emit/update sessions', () => {
    const system = createSystem(120);
    for (let frame = 0; frame < 500; frame++) {
      system.emitSteam(0, 0, 0);
      system.emitPulp(0, 0, 0, '#fff');
      system.emitWaterDrop(0, 0, 0);
      system.update(0.016);
      expect(system.activeCount).toBeLessThanOrEqual(120);
      expect(system.activePulpCount).toBeLessThanOrEqual(MAX_PULP_PARTICLES);
    }
  });
});

describe('ParticleSystem resource release (unmount regression)', () => {
  it('drops the canvas reference on dispose', () => {
    const system = createSystem();
    const canvas = {} as HTMLCanvasElement;
    system.attachCanvas(canvas);
    expect(system.getAttachedCanvas()).toBe(canvas);

    system.dispose();
    expect(system.getAttachedCanvas()).toBeNull();
    expect(system.isDisposed).toBe(true);
  });

  it('clears all live particles, pool and bookkeeping on dispose', () => {
    const system = createSystem();
    system.emitSteam(0, 0, 0);
    system.emitPulp(0, 0, 0, '#fff');
    system.emitWaterDrop(0, 0, 0);
    system.update(10);
    expect(system.pooledCount).toBeGreaterThan(0);

    system.dispose();
    expect(system.activeCount).toBe(0);
    expect(system.pooledCount).toBe(0);
    expect(system.activePulpCount).toBe(0);
    expect(system.getParticles()).toHaveLength(0);
  });

  it('becomes inert after dispose without throwing', () => {
    const system = createSystem();
    system.dispose();

    expect(() => {
      system.emitSteam(0, 0, 0);
      system.emitPulp(0, 0, 0, '#fff');
      system.emitWaterDrop(0, 0, 0);
      system.update(1);
    }).not.toThrow();
    expect(system.activeCount).toBe(0);
  });
});
