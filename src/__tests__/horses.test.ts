import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useStore from '../store';
import {
  ManualClock, installClock, uninstallClock, resetStore, dispatch,
  makeDocument, makeStation, getHorse,
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

describe('驿马占用与释放', () => {
  it('发送后驿马占用，送达后恢复可用', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');
    expect(getHorse('horse-0')?.available).toBe(false);

    clock.advance(1000);
    useStore.getState().updateMovingHorses(clock.now());

    expect(getHorse('horse-0')?.available).toBe(true);
    expect(useStore.getState().movingHorses).toHaveLength(0);
  });

  it('送达时间边界：duration-1ms 仍在途，duration 时刻送达放马', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(999);
    useStore.getState().updateMovingHorses(clock.now());
    expect(useStore.getState().movingHorses).toHaveLength(1);
    expect(getHorse('horse-0')?.available).toBe(false);

    clock.advance(1);
    useStore.getState().updateMovingHorses(clock.now());
    expect(useStore.getState().movingHorses).toHaveLength(0);
    expect(getHorse('horse-0')?.available).toBe(true);
  });

  it('占用中的驿马无法被再次发送', () => {
    resetStore({
      stations: [
        makeStation('station-0', [
          makeDocument({ id: 'doc-0-0' }),
          makeDocument({ id: 'doc-0-1', code: 'T-001' }),
        ]),
        makeStation('station-1', []),
      ],
    });

    dispatch('station-0', 'horse-0', 'doc-0-0');
    dispatch('station-0', 'horse-0', 'doc-0-1');

    const state = useStore.getState();
    expect(state.movingHorses).toHaveLength(1);
    expect(state.movingHorses[0].documentId).toBe('doc-0-0');
    expect(state.stations[0].documents[1].status).toBe('pending');
    expect(getHorse('horse-0')?.available).toBe(false);
  });

  it('同一时刻并发重复发送同一驿马不会产生重复占用', () => {
    resetStore({
      stations: [
        makeStation('station-0', [
          makeDocument({ id: 'doc-0-0' }),
          makeDocument({ id: 'doc-0-1', code: 'T-001' }),
        ]),
        makeStation('station-1', []),
      ],
    });

    const store = useStore.getState();
    store.selectStation('station-0');
    store.selectHorse('horse-0');
    store.selectDocument('doc-0-0');
    store.dispatchDocument();
    store.selectStation('station-0');
    store.selectHorse('horse-0');
    store.selectDocument('doc-0-1');
    store.dispatchDocument();

    const afterDispatch = useStore.getState();
    expect(afterDispatch.movingHorses).toHaveLength(1);
    expect(afterDispatch.soldier.stamina).toBe(80);
    expect(afterDispatch.movingHorses[0].horseId).toBe('horse-0');

    clock.advance(1000);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getHorse('horse-0')?.available).toBe(true);
    expect(useStore.getState().movingHorses).toHaveLength(0);
  });

  it('不同驿马可并发发送，且各自独立释放', () => {
    resetStore({
      stations: [
        makeStation('station-0', [
          makeDocument({ id: 'doc-0-0' }),
          makeDocument({ id: 'doc-0-1', code: 'T-001' }),
        ]),
        makeStation('station-1', []),
      ],
    });

    dispatch('station-0', 'horse-0', 'doc-0-0');
    dispatch('station-0', 'horse-1', 'doc-0-1');

    expect(useStore.getState().movingHorses).toHaveLength(2);
    expect(getHorse('horse-0')?.available).toBe(false);
    expect(getHorse('horse-1')?.available).toBe(false);

    clock.advance(1000);
    useStore.getState().updateMovingHorses(clock.now());

    expect(useStore.getState().movingHorses).toHaveLength(0);
    expect(getHorse('horse-0')?.available).toBe(true);
    expect(getHorse('horse-1')?.available).toBe(true);
  });
});
