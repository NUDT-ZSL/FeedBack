import { describe, expect, it } from 'vitest';
import {
  calculateInkUniformity,
  calculatePlateOffset,
  hasWhiteSpot,
} from '../src/utils/printUtils';
import { hashString, mulberry32 } from '../src/utils/random';

describe('确定性随机源', () => {
  it('相同 seed 产生相同随机序列，不同 seed 序列不同', () => {
    const take = (seed: number, count: number) => {
      const rng = mulberry32(seed);
      return Array.from({ length: count }, () => rng());
    };
    const seqA = take(1234, 8);
    expect(take(1234, 8)).toEqual(seqA);
    const seqB = take(4321, 8);
    expect(seqA).not.toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('hashString 对相同字符串稳定', () => {
    expect(hashString('毕昇印-001')).toBe(hashString('毕昇印-001'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('calculatePlateOffset（施压）', () => {
  it('压力不超过 80 时版心偏移恒为 0', () => {
    for (const pressure of [0, 29, 30, 79, 80]) {
      expect(calculatePlateOffset(pressure, () => 0)).toEqual({ x: 0, y: 0 });
      expect(calculatePlateOffset(pressure, () => 1)).toEqual({ x: 0, y: 0 });
    }
  });

  it('压力超过 80 时偏移落在约定的 ±3px 范围内', () => {
    const deterministic = calculatePlateOffset(81, () => 0);
    expect(deterministic).toEqual({ x: -3, y: -3 });
    expect(calculatePlateOffset(100, () => 1)).toEqual({ x: 3, y: 3 });
    expect(calculatePlateOffset(100, () => 0.5)).toEqual({ x: 0, y: 0 });

    for (let i = 0; i < 100; i += 1) {
      const rng = mulberry32(i);
      const offset = calculatePlateOffset(100, rng);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(3);
    }
  });
});

describe('calculateInkUniformity（上墨）', () => {
  it('注入固定随机源时结果确定', () => {
    expect(calculateInkUniformity(60, () => 0)).toBe(60);
    expect(calculateInkUniformity(60, () => 1)).toBe(45);
  });

  it('结果始终落在 0-100', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const rng = mulberry32(seed);
      const value = calculateInkUniformity(seed * 2, rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('hasWhiteSpot（断墨白点）', () => {
  it('墨量不低于 20 时任何随机值都不出现白点', () => {
    expect(hasWhiteSpot(20, () => 0)).toBe(false);
    expect(hasWhiteSpot(100, () => 0)).toBe(false);
  });

  it('墨量低于 20 时按 0.3 概率出现白点', () => {
    expect(hasWhiteSpot(19, () => 0.29)).toBe(true);
    expect(hasWhiteSpot(0, () => 0.3)).toBe(false);
    expect(hasWhiteSpot(10, () => 0.99)).toBe(false);
  });
});
