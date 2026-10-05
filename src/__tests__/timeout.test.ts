import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useStore from '../store';
import {
  ManualClock, installClock, uninstallClock, resetStore, dispatch,
  getDoc, getLog, getMoving, getHorse, makeDocument, makeStation,
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

describe('延误判定与状态收敛', () => {
  it('超过时限后：文书、日志、在途记录、驿马同步收敛，触发告警', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(15_001);
    useStore.getState().checkTimeouts(clock.now());

    const state = useStore.getState();
    expect(getDoc('doc-0-0')!.status).toBe('delayed');
    expect(getLog('doc-0-0')!.status).toBe('delayed');
    expect(getMoving('doc-0-0')).toBeUndefined();
    expect(state.movingHorses).toHaveLength(0);
    expect(getHorse('horse-0')!.available).toBe(true);
    expect(state.alertMessage).toContain('延误');
  });

  it('时限边界：elapsed == timeLimit 不判延误，超过 1ms 即判延误', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(15_000);
    useStore.getState().checkTimeouts(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('in-transit');
    expect(useStore.getState().alertMessage).toBeNull();

    clock.advance(1);
    useStore.getState().checkTimeouts(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('delayed');
    expect(useStore.getState().alertMessage).toContain('延误');
  });

  it('延误后不残留悬挂在途记录，后续帧不会翻转为已送达', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(20_000);
    useStore.getState().checkTimeouts(clock.now());
    useStore.getState().updateMovingHorses(clock.now());

    const state = useStore.getState();
    expect(state.movingHorses).toHaveLength(0);
    expect(getDoc('doc-0-0')!.status).toBe('delayed');
    expect(getLog('doc-0-0')!.status).toBe('delayed');
    expect(getHorse('horse-0')!.available).toBe(true);
  });

  it('时限内送达的文书不会被误判延误', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(1000);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('delivered');

    clock.advance(30_000);
    useStore.getState().checkTimeouts(clock.now());

    expect(getDoc('doc-0-0')!.status).toBe('delivered');
    expect(getLog('doc-0-0')!.status).toBe('delivered');
    expect(useStore.getState().alertMessage).toBeNull();
  });

  it('多份文书在途时仅超时者收敛，未超时者保持在途', () => {
    resetStore({
      stations: [
        makeStation('station-0', [
          makeDocument({ id: 'doc-0-0', urgency: 'urgent', timeLimit: 10 }),
          makeDocument({ id: 'doc-0-1', code: 'T-001', urgency: 'normal', timeLimit: 15 }),
        ]),
        makeStation('station-1', []),
      ],
    });

    dispatch('station-0', 'horse-0', 'doc-0-0');
    dispatch('station-0', 'horse-1', 'doc-0-1');

    clock.advance(10_001);
    useStore.getState().checkTimeouts(clock.now());

    expect(getDoc('doc-0-0')!.status).toBe('delayed');
    expect(getLog('doc-0-0')!.status).toBe('delayed');
    expect(getMoving('doc-0-0')).toBeUndefined();
    expect(getHorse('horse-0')!.available).toBe(true);

    expect(getDoc('doc-0-1')!.status).toBe('in-transit');
    expect(getLog('doc-0-1')!.status).toBe('in-transit');
    expect(getMoving('doc-0-1')).toBeDefined();
    expect(getHorse('horse-1')!.available).toBe(false);

    clock.advance(4_999);
    useStore.getState().checkTimeouts(clock.now());
    expect(getDoc('doc-0-1')!.status).toBe('in-transit');

    clock.advance(1);
    useStore.getState().checkTimeouts(clock.now());
    expect(getDoc('doc-0-1')!.status).toBe('delayed');
    expect(getMoving('doc-0-1')).toBeUndefined();
    expect(getHorse('horse-1')!.available).toBe(true);
    expect(useStore.getState().movingHorses).toHaveLength(0);
  });

  it('告警可消除且不影响已收敛状态', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');
    clock.advance(16_000);
    useStore.getState().checkTimeouts(clock.now());
    expect(useStore.getState().alertMessage).not.toBeNull();

    useStore.getState().dismissAlert();
    expect(useStore.getState().alertMessage).toBeNull();
    expect(getDoc('doc-0-0')!.status).toBe('delayed');
    expect(useStore.getState().movingHorses).toHaveLength(0);
  });
});
