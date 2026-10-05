import assert from 'node:assert/strict';
import type { Document, Horse, PostStation } from '../src/types.ts';
import type { SimState } from '../src/simulation.ts';

export const TIME_ORIGIN = 1_700_000_000_000;

export const makeDoc = (overrides: Partial<Document> & { id: string }): Document => ({
  code: `TEST-${overrides.id}`,
  urgency: 'normal',
  fromStation: 'station-0',
  toStation: 'station-1',
  status: 'pending',
  timeLimit: 15,
  ...overrides,
});

export const makeStation = (index: number, documents: Document[] = []): PostStation => ({
  id: `station-${index}`,
  name: `测试驿-${index}`,
  position: { x: index * 100, y: 0 },
  horses: 10,
  soldiers: 3,
  documents,
});

export const makeHorses = (count: number): Horse[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `horse-${i}`,
    name: `马${i}`,
    available: true,
  }));

export const makeState = (overrides: Partial<SimState> = {}): SimState => ({
  stations: [makeStation(0), makeStation(1), makeStation(2)],
  horses: makeHorses(3),
  soldier: { id: 'soldier-1', stamina: 100, isResting: false },
  movingHorses: [],
  logs: [],
  documentCounter: 100,
  alertMessage: null,
  ...overrides,
});

export interface FakeClock {
  now: () => number;
  set: (t: number) => void;
  advanceBy: (ms: number) => number;
  current: number;
}

export const makeClock = (start: number = TIME_ORIGIN): FakeClock => {
  const clock = {
    current: start,
    now: () => clock.current,
    set: (t: number) => {
      clock.current = t;
    },
    advanceBy: (ms: number) => {
      clock.current += ms;
      return clock.current;
    },
  };
  return clock;
};

export const findDoc = (state: SimState, docId: string): Document => {
  const doc = state.stations.flatMap(s => s.documents).find(d => d.id === docId);
  assert.ok(doc, `文书 ${docId} 不存在`);
  return doc;
};

export const findLog = (state: SimState, docId: string) => {
  const log = state.logs.find(l => l.documentId === docId);
  assert.ok(log, `文书 ${docId} 缺少日志记录`);
  return log;
};

export const findHorse = (state: SimState, horseId: string): Horse => {
  const horse = state.horses.find(h => h.id === horseId);
  assert.ok(horse, `驿马 ${horseId} 不存在`);
  return horse;
};

/**
 * 全局一致性不变量：任何一次状态迁移后都必须成立。
 * 覆盖体力边界、驿马占用互斥、文书/日志/在途记录三方一致。
 */
export const assertInvariants = (state: SimState): void => {
  const { soldier, horses, movingHorses, stations, logs } = state;
  const allDocs = stations.flatMap(s => s.documents);
  const docById = new Map(allDocs.map(d => [d.id, d]));

  // 1. 体力边界
  assert.ok(
    soldier.stamina >= 0 && soldier.stamina <= 100,
    `驿卒体力越界: ${soldier.stamina}`
  );
  if (soldier.isResting) {
    assert.ok(soldier.restEndTime !== undefined, '休息中缺少 restEndTime');
  }

  // 2. 驿马占用与在途记录一一对应
  const busyHorseIds = movingHorses.map(mh => mh.horseId);
  assert.equal(
    new Set(busyHorseIds).size,
    busyHorseIds.length,
    '同一驿马被多条在途记录重复占用'
  );
  for (const mh of movingHorses) {
    const horse = horses.find(h => h.id === mh.horseId);
    assert.ok(horse, `在途记录引用了不存在的驿马 ${mh.horseId}`);
    assert.equal(horse.available, false, `驿马 ${mh.horseId} 在途却被标记为可用`);
  }
  for (const horse of horses) {
    if (!horse.available) {
      assert.ok(
        busyHorseIds.includes(horse.id),
        `驿马 ${horse.id} 被占用但不存在对应在途记录`
      );
    }
  }

  // 3. 文书状态、在途记录、日志三方一致
  const transitDocIds = movingHorses.map(mh => mh.documentId);
  assert.equal(
    new Set(transitDocIds).size,
    transitDocIds.length,
    '同一文书存在多条在途记录'
  );
  for (const mh of movingHorses) {
    const doc = docById.get(mh.documentId);
    assert.ok(doc, `在途记录引用了不存在的文书 ${mh.documentId}`);
    assert.equal(
      doc.status,
      'in-transit',
      `文书 ${doc.id} 有在途驿马但状态为 ${doc.status}`
    );
  }
  for (const doc of allDocs) {
    if (doc.status === 'in-transit') {
      assert.ok(
        transitDocIds.includes(doc.id),
        `文书 ${doc.id} 标记在途但缺少在途驿马记录`
      );
    } else {
      assert.ok(
        !transitDocIds.includes(doc.id),
        `文书 ${doc.id} 已${doc.status === 'delivered' ? '送达' : '延误'}却仍残留在途记录`
      );
    }
    if (doc.status === 'delivered') {
      assert.ok(doc.arrivalTime !== undefined, `文书 ${doc.id} 已送达但缺少到达时间`);
    }
  }
  for (const log of logs) {
    const doc = docById.get(log.documentId);
    if (!doc) continue;
    if (doc.status === 'delivered') {
      assert.equal(log.status, 'delivered', `文书 ${doc.id} 已送达但日志状态为 ${log.status}`);
      assert.ok(log.arrivalTime !== undefined, `文书 ${doc.id} 日志缺少到达时间`);
      assert.ok(log.duration !== undefined, `文书 ${doc.id} 日志缺少耗时`);
    } else if (doc.status === 'delayed') {
      assert.equal(log.status, 'delayed', `文书 ${doc.id} 已延误但日志状态为 ${log.status}`);
    } else if (doc.status === 'in-transit') {
      assert.equal(log.status, 'in-transit', `文书 ${doc.id} 在途但日志状态为 ${log.status}`);
    }
  }
};
