import { describe, it, expect } from 'vitest';
import { shoot, pass, step, FIXED_DT } from '../src/sim';
import { makeState, withPlayer, normalizeAngle } from './helpers';

const SHOT_AMPLITUDE = {
  high: (0.3 - 0.2 * 0.3) / 2,
  mid: 0.3 / 2,
  low: (0.3 + 0.15 * 0.3) / 2,
};

const PASS_AMPLITUDE = {
  high: (0.2 - 0.2 * 0.2) / 2,
  mid: 0.2 / 2,
  low: (0.2 + 0.15 * 0.3) / 2,
};

const EPS = 1e-9;

function shotDeviation(seed: number, morale: number, stamina: number): number {
  const base = withPlayer(makeState(seed), { rotation: 90, morale, stamina });
  const after = shoot(base);
  const angle = Math.atan2(after.ball.vy, after.ball.vx);
  return normalizeAngle(angle - Math.PI / 2);
}

function passDeviation(seed: number, morale: number): number {
  const base = withPlayer(makeState(seed), { morale });
  const expected = Math.atan2(
    base.opponent.y - base.player.y,
    base.opponent.x - base.player.x
  );
  const after = pass(base);
  const angle = Math.atan2(after.ball.vy, after.ball.vx);
  return normalizeAngle(angle - expected);
}

describe('射门与传球偏差边界', () => {
  it('低士气射门偏差不超过扩大后的上限', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dev = shotDeviation(seed, 10, 100);
      expect(Math.abs(dev)).toBeLessThanOrEqual(SHOT_AMPLITUDE.low + EPS);
    }
  });

  it('高士气射门偏差不超过收窄后的上限', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dev = shotDeviation(seed, 90, 100);
      expect(Math.abs(dev)).toBeLessThanOrEqual(SHOT_AMPLITUDE.high + EPS);
    }
  });

  it('低士气射门散布显著大于高士气', () => {
    let maxLow = 0;
    let maxHigh = 0;
    for (let seed = 0; seed < 200; seed++) {
      maxLow = Math.max(maxLow, Math.abs(shotDeviation(seed, 10, 100)));
      maxHigh = Math.max(maxHigh, Math.abs(shotDeviation(seed, 90, 100)));
    }
    expect(maxLow).toBeGreaterThan(maxHigh);
    expect(maxLow).toBeGreaterThan(SHOT_AMPLITUDE.low * 0.8);
    expect(maxHigh).toBeGreaterThan(SHOT_AMPLITUDE.high * 0.8);
  });

  it('体力耗尽不放大射门偏差范围', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dev = shotDeviation(seed, 10, 0);
      expect(Math.abs(dev)).toBeLessThanOrEqual(SHOT_AMPLITUDE.low + EPS);
    }
  });

  it('低士气传球偏差上限包含失误率加成', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dev = passDeviation(seed, 10);
      expect(Math.abs(dev)).toBeLessThanOrEqual(PASS_AMPLITUDE.low + EPS);
    }
  });

  it('高士气传球偏差不超过收窄后的上限', () => {
    for (let seed = 0; seed < 200; seed++) {
      const dev = passDeviation(seed, 90);
      expect(Math.abs(dev)).toBeLessThanOrEqual(PASS_AMPLITUDE.high + EPS);
    }
  });

  it('体力耗尽后移动速度固定为基础速度的 30% 且不继续衰减', () => {
    const exhausted = withPlayer(makeState(5), { stamina: 0 });
    const held = { ...exhausted, keys: ['w'] };
    const trace: number[] = [];
    let current = held;
    for (let i = 0; i < 120; i++) {
      current = step(current, FIXED_DT);
      trace.push(current.player.speed);
    }
    const expected = current.player.baseSpeed * 0.3;
    for (const speed of trace) {
      expect(speed).toBeCloseTo(expected, 10);
    }
    expect(current.player.stamina).toBe(0);
  });

  it('体力随移动单调下降且不为负', () => {
    let current = { ...makeState(6), keys: ['w'] };
    let previous = current.player.stamina;
    for (let i = 0; i < 600; i++) {
      current = step(current, FIXED_DT);
      expect(current.player.stamina).toBeLessThanOrEqual(previous + 1e-9);
      expect(current.player.stamina).toBeGreaterThanOrEqual(0);
      previous = current.player.stamina;
    }
  });
});
