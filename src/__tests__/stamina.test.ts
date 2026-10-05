import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useStore from '../store';
import {
  ManualClock, installClock, uninstallClock, resetStore, dispatch,
  makeDocument, makeStation, makeHorse, stamina,
} from './testUtils';

let clock: ManualClock;

beforeEach(() => {
  clock = new ManualClock();
  installClock(clock);
  resetStore();
});

afterEach(() => {
  uninstallClock();
});

describe('驿卒体力', () => {
  it('发送文书扣减 20 点体力', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');
    expect(stamina()).toBe(80);
  });

  it('体力扣减不会越下界（不为负数）', () => {
    resetStore({ stamina: 10 });
    dispatch('station-0', 'horse-0', 'doc-0-0');
    expect(stamina()).toBe(0);
    expect(useStore.getState().movingHorses).toHaveLength(1);
  });

  it('体力耗尽时无法继续发送', () => {
    resetStore({ stamina: 0 });
    dispatch('station-0', 'horse-0', 'doc-0-0');
    const state = useStore.getState();
    expect(state.movingHorses).toHaveLength(0);
    expect(state.logs).toHaveLength(0);
    expect(state.stations[0].documents[0].status).toBe('pending');
    expect(state.horses[0].available).toBe(true);
  });

  it('连续发送直至耗尽后，后续发送被拒绝', () => {
    const docs = Array.from({ length: 6 }, (_, i) =>
      makeDocument({ id: `doc-0-${i}`, code: `T-${i}` })
    );
    resetStore({
      stations: [makeStation('station-0', docs), makeStation('station-1', [])],
      horses: Array.from({ length: 6 }, (_, i) => makeHorse(`horse-${i}`)),
      stamina: 100,
    });

    for (let i = 0; i < 6; i++) {
      dispatch('station-0', `horse-${i}`, `doc-0-${i}`);
    }

    const state = useStore.getState();
    expect(stamina()).toBe(0);
    expect(state.movingHorses).toHaveLength(5);
    expect(state.stations[0].documents[5].status).toBe('pending');
  });

  it('休息结束后恢复 30 点体力', () => {
    resetStore({ stamina: 50 });
    useStore.getState().restSoldier();
    expect(useStore.getState().soldier.isResting).toBe(true);

    clock.advance(5000);
    useStore.getState().updateSoldierRest(clock.now());

    expect(useStore.getState().soldier.isResting).toBe(false);
    expect(stamina()).toBe(80);
  });

  it('体力恢复不会越上界（不超过 100）', () => {
    resetStore({ stamina: 90 });
    useStore.getState().restSoldier();
    clock.advance(5000);
    useStore.getState().updateSoldierRest(clock.now());
    expect(stamina()).toBe(100);
  });

  it('休息时间未到不恢复（边界：restEndTime 前 1ms）', () => {
    resetStore({ stamina: 50 });
    useStore.getState().restSoldier();

    clock.advance(4999);
    useStore.getState().updateSoldierRest(clock.now());
    expect(useStore.getState().soldier.isResting).toBe(true);
    expect(stamina()).toBe(50);

    clock.advance(1);
    useStore.getState().updateSoldierRest(clock.now());
    expect(useStore.getState().soldier.isResting).toBe(false);
    expect(stamina()).toBe(80);
  });

  it('休息期间无法发送文书', () => {
    resetStore({ stamina: 50 });
    useStore.getState().restSoldier();
    dispatch('station-0', 'horse-0', 'doc-0-0');
    expect(useStore.getState().movingHorses).toHaveLength(0);
    expect(stamina()).toBe(50);
  });

  it('满体力时不能重复进入休息', () => {
    resetStore({ stamina: 100 });
    useStore.getState().restSoldier();
    expect(useStore.getState().soldier.isResting).toBe(false);
  });
});
