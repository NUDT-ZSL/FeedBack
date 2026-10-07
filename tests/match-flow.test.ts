import { describe, it, expect } from 'vitest';
import {
  step,
  runMatch,
  FIXED_DT,
  HALF_DURATION,
  HALFTIME_PAUSE,
} from '../src/sim';
import type { SimState } from '../src/sim';
import { makeState, withPlayer } from './helpers';

function forceEventDue(state: SimState): SimState {
  return { ...state, nextEventAt: state.clock };
}

describe('比赛流程与事件时序', () => {
  it('完整空场比赛依次经过上半场、中场、下半场并终场结算', () => {
    const phases: string[] = [];
    const halves: string[] = [];
    const final = runMatch(
      { name: 'flow', seed: 11, templateId: 'zhang-jun' },
      {
        onStep: (s) => {
          phases.push(s.phase);
          halves.push(s.currentHalf);
        },
      }
    );
    expect(phases).toContain('halftime');
    expect(halves).toContain('second');
    expect(final.phase).toBe('finished');
    expect(final.backgroundTime).toBe('dusk');
    expect(final.timeRemaining).toBe(0);
    expect(final.result).not.toBeNull();
    const halftimeIndex = phases.indexOf('halftime');
    expect(halves[halftimeIndex]).toBe('second');
  });

  it('半场切换优先于到期随机事件，事件不在中场触发', () => {
    const base = forceEventDue({
      ...makeState(21),
      timeRemaining: HALF_DURATION + 8,
    });
    const next = step(base, FIXED_DT);
    expect(next.currentHalf).toBe('second');
    expect(next.phase).toBe('halftime');
    expect(next.currentEvent).toBeNull();
    expect(next.eventLog).toHaveLength(0);
    expect(next.backgroundTime).toBe('dusk');
    expect(next.ball.x).toBe(400);

    const duringHalftime = step(forceEventDue(next), FIXED_DT);
    expect(duringHalftime.phase).toBe('halftime');
    expect(duringHalftime.currentEvent).toBeNull();

    let resumed = next;
    for (let i = 0; i < Math.ceil(HALFTIME_PAUSE / (FIXED_DT * 1000)) + 2; i++) {
      resumed = step(resumed, FIXED_DT);
    }
    expect(resumed.phase).toBe('playing');
    expect(resumed.eventLog).toHaveLength(1);
    expect(resumed.currentEvent).not.toBeNull();

    const triggered = step(forceEventDue(resumed), FIXED_DT);
    expect(triggered.eventLog).toHaveLength(2);
  });

  it('终场结算优先于到期随机事件，结束后不再触发事件', () => {
    const base = forceEventDue({ ...makeState(22), timeRemaining: 5 });
    const finished = step(base, FIXED_DT);
    expect(finished.phase).toBe('finished');
    expect(finished.currentEvent).toBeNull();
    expect(finished.eventLog).toHaveLength(0);

    let after = finished;
    for (let i = 0; i < 120; i++) {
      after = step(forceEventDue(after), FIXED_DT);
    }
    expect(after.eventLog).toHaveLength(0);
    expect(after.currentEvent).toBeNull();
    expect(after.phase).toBe('finished');
  });

  it('进球暂停期间不触发随机事件', () => {
    const scoring = {
      ...makeState(23),
      ball: {
        x: 785, y: 250, z: 0,
        vx: 300, vy: 0, vz: 0,
        rotation: 0, isMoving: true, isBouncing: false,
      },
    };
    const afterGoal = step(scoring, FIXED_DT);
    expect(afterGoal.isTransitioning).toBe(true);
    const duringPause = step(forceEventDue(afterGoal), FIXED_DT);
    expect(duringPause.currentEvent).toBeNull();
    expect(duringPause.eventLog).toHaveLength(0);
  });

  it('事件效果受属性上下限约束且到时自动清除', () => {
    let state = withPlayer(makeState(24), { morale: 98, stamina: 1 });
    let fired = 0;
    for (let i = 0; i < 40 && state.phase === 'playing'; i++) {
      state = step(forceEventDue(state), FIXED_DT);
      if (state.currentEvent) fired++;
      expect(state.player.morale).toBeLessThanOrEqual(100);
      expect(state.player.morale).toBeGreaterThanOrEqual(0);
      expect(state.player.stamina).toBeLessThanOrEqual(state.player.maxStamina);
      expect(state.player.stamina).toBeGreaterThanOrEqual(0);
      let waited = 0;
      while (state.currentEvent && waited < 600) {
        state = step(state, FIXED_DT);
        waited++;
      }
      expect(state.currentEvent).toBeNull();
    }
    expect(fired).toBeGreaterThan(0);
    expect(state.eventLog.length).toBeGreaterThan(0);
  });

  it('事件触发时刻全部落在比赛进行窗口内', () => {
    const final = runMatch({ name: 'events', seed: 31, templateId: 'li-qing' });
    expect(final.eventLog.length).toBeGreaterThan(0);
    for (const record of final.eventLog) {
      expect(record.clock).toBeLessThan(final.clock + 1);
    }
    const goalClocks = final.goals.map((g) => g.clock);
    for (const record of final.eventLog) {
      for (const goalClock of goalClocks) {
        const withinPause = record.clock > goalClock && record.clock < goalClock + 2000;
        expect(withinPause).toBe(false);
      }
    }
  });
});
