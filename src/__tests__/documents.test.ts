import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import useStore from '../store';
import {
  ManualClock, installClock, uninstallClock, resetStore, dispatch,
  getDoc, getLog, getMoving, makeStation, makeDocument,
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

const expectLogAndMovingConsistent = (docId: string): void => {
  const doc = getDoc(docId)!;
  const log = getLog(docId)!;
  const moving = getMoving(docId);

  if (doc.status === 'in-transit') {
    expect(log.status).toBe('in-transit');
    expect(moving).toBeDefined();
  } else {
    expect(['delivered', 'delayed']).toContain(doc.status);
    expect(log.status).toBe(doc.status);
    expect(moving).toBeUndefined();
  }
};

describe('文书状态迁移与日志一致性', () => {
  it('发送后：文书在途、在途记录存在、日志为在途', () => {
    const startTime = clock.now();
    dispatch('station-0', 'horse-0', 'doc-0-0');

    const doc = getDoc('doc-0-0')!;
    const log = getLog('doc-0-0')!;
    const moving = getMoving('doc-0-0')!;

    expect(doc.status).toBe('in-transit');
    expect(doc.dispatchTime).toBe(startTime);
    expect(log.status).toBe('in-transit');
    expect(log.documentId).toBe('doc-0-0');
    expect(log.dispatchTime).toBe(startTime);
    expect(moving).toBeDefined();
    expect(moving.documentId).toBe('doc-0-0');
    expect(moving.horseId).toBe('horse-0');
  });

  it('送达后：文书、日志、在途记录三者同步收敛为已送达', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(1000);
    useStore.getState().updateMovingHorses(clock.now());

    const doc = getDoc('doc-0-0')!;
    const log = getLog('doc-0-0')!;
    expect(doc.status).toBe('delivered');
    expect(doc.arrivalTime).toBe(clock.now());
    expect(log.status).toBe('delivered');
    expect(log.arrivalTime).toBe(clock.now());
    expect(log.duration).toBe(1);
    expect(getMoving('doc-0-0')).toBeUndefined();
  });

  it('同一份文书不会同时出现在在途与已送达（全程扫描不变量）', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    for (let elapsed = 0; elapsed <= 1200; elapsed += 100) {
      clock.advance(100);
      const t = clock.now();
      useStore.getState().updateMovingHorses(t);
      useStore.getState().checkTimeouts(t);
      expectLogAndMovingConsistent('doc-0-0');
    }

    expect(getDoc('doc-0-0')!.status).toBe('delivered');
  });

  it('状态迁移时间边界：duration-1ms 在途，duration 恰好送达', () => {
    dispatch('station-0', 'horse-0', 'doc-0-0');

    clock.advance(999);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('in-transit');
    expect(getLog('doc-0-0')!.status).toBe('in-transit');
    expect(getMoving('doc-0-0')).toBeDefined();

    clock.advance(1);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('delivered');
    expect(getLog('doc-0-0')!.status).toBe('delivered');
    expect(getMoving('doc-0-0')).toBeUndefined();
  });

  it('多份文书并发在途时各自独立迁移、互不串状态', () => {
    resetStore({
      stations: [
        makeStation('station-0', [
          makeDocument({ id: 'doc-0-0' }),
          makeDocument({ id: 'doc-0-1', code: 'T-001', urgency: 'urgent', timeLimit: 10 }),
        ]),
        makeStation('station-1', []),
      ],
    });

    dispatch('station-0', 'horse-0', 'doc-0-0');
    dispatch('station-0', 'horse-1', 'doc-0-1');

    clock.advance(600);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getDoc('doc-0-1')!.status).toBe('delivered');
    expect(getDoc('doc-0-0')!.status).toBe('in-transit');
    expect(getMoving('doc-0-1')).toBeUndefined();
    expect(getMoving('doc-0-0')).toBeDefined();
    expectLogAndMovingConsistent('doc-0-0');
    expectLogAndMovingConsistent('doc-0-1');

    clock.advance(400);
    useStore.getState().updateMovingHorses(clock.now());
    expect(getDoc('doc-0-0')!.status).toBe('delivered');
    expectLogAndMovingConsistent('doc-0-0');
    expectLogAndMovingConsistent('doc-0-1');
  });
});
