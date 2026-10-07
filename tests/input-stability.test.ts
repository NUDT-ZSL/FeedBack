import { describe, it, expect } from 'vitest';
import {
  applyAction,
  step,
  startCharge,
  shoot,
  pass,
  tackle,
  FIXED_DT,
  FIELD_WIDTH,
  FIELD_HEIGHT,
  PLAYER_MARGIN,
} from '../src/sim';
import type { SimState } from '../src/sim';
import { makeState, withPlayer } from './helpers';

function holdKey(state: SimState, key: string): SimState {
  return applyAction(state, { type: 'keyDown', key });
}

describe('连续与快速交替输入', () => {
  it('重复 keyDown 与单次按下的推进结果一致', () => {
    const single = holdKey(makeState(1), 'w');
    const repeated = holdKey(holdKey(holdKey(makeState(1), 'w'), 'w'), 'w');
    expect(repeated.keys).toEqual(['w']);

    let a = single;
    let b = repeated;
    for (let i = 0; i < 60; i++) {
      a = step(a, FIXED_DT);
      b = step(b, FIXED_DT);
    }
    expect(a.player.x).toBeCloseTo(b.player.x, 12);
    expect(a.player.y).toBeCloseTo(b.player.y, 12);
    expect(a.player.stamina).toBeCloseTo(b.player.stamina, 12);
  });

  it('w/s 快速交替不会同时占用按键，且结果可复现', () => {
    function alternate(seed: number): SimState {
      let state = makeState(seed);
      for (let i = 0; i < 120; i++) {
        state = applyAction(state, { type: 'keyUp', key: i % 2 === 0 ? 's' : 'w' });
        state = applyAction(state, { type: 'keyDown', key: i % 2 === 0 ? 'w' : 's' });
        state = step(state, FIXED_DT);
        expect(new Set(state.keys).size).toBeLessThanOrEqual(1);
      }
      return state;
    }
    const first = alternate(13);
    const second = alternate(13);
    expect(first.player.x).toBeCloseTo(second.player.x, 12);
    expect(first.player.y).toBeCloseTo(second.player.y, 12);
    expect(first.player.x).toBeGreaterThanOrEqual(PLAYER_MARGIN);
    expect(first.player.x).toBeLessThanOrEqual(FIELD_WIDTH - PLAYER_MARGIN);
    expect(first.player.y).toBeGreaterThanOrEqual(PLAYER_MARGIN);
    expect(first.player.y).toBeLessThanOrEqual(FIELD_HEIGHT - PLAYER_MARGIN);
  });

  it('蓄力重复触发不会重置蓄力起点', () => {
    const base = makeState(2);
    const first = startCharge(base);
    expect(first.isCharging).toBe(true);
    const second = startCharge(first);
    expect(second.chargeStartClock).toBe(first.chargeStartClock);
    expect(second).toBe(first);
  });

  it('同一 tick 内传球后射门按顺序生效且可复现', () => {
    function run(): SimState {
      let state = makeState(3);
      state = pass(state);
      state = shoot(state);
      return state;
    }
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first.player.stamina).toBeCloseTo(makeState(3).player.stamina - 7, 10);
    expect(first.isCharging).toBe(false);
    expect(first.ball.isMoving).toBe(true);
  });

  it('终场后射门传球等动作被忽略，状态不被覆盖', () => {
    const finished = { ...makeState(4), phase: 'finished' as const };
    expect(shoot(finished)).toBe(finished);
    expect(pass(finished)).toBe(finished);
    expect(tackle(finished)).toBe(finished);
    expect(startCharge(finished)).toBe(finished);
  });

  it('球不在抢断范围内时连续抢断不产生任何状态变化', () => {
    const base = makeState(5);
    let current = base;
    for (let i = 0; i < 30; i++) {
      current = tackle(current);
      expect(current).toBe(base);
    }
  });

  it('长按前进持续消耗体力至耗尽后速度保持低档', () => {
    let current = holdKey(withPlayer(makeState(6), { stamina: 5 }), 'w');
    let sawExhausted = false;
    for (let i = 0; i < 600; i++) {
      current = step(current, FIXED_DT);
      if (current.player.stamina === 0) {
        sawExhausted = true;
        expect(current.player.speed).toBeCloseTo(current.player.baseSpeed * 0.3, 10);
      }
    }
    expect(sawExhausted).toBe(true);
    expect(current.player.stamina).toBe(0);
  });
});
