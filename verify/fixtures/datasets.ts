/** 本地样例数据：全部内联，无网络 / 无外部服务依赖。 */
import type { ImportInput, KeyEvent, SpatialRecord } from '../core/types.ts';

export const baseRecords: SpatialRecord[] = [
  { id: 'r1', objectId: 'obj-A', timestamp: 100, state: 'idle' },
  { id: 'r2', objectId: 'obj-A', timestamp: 200, state: 'moving', dependsOn: ['r1'] },
  { id: 'r3', objectId: 'obj-B', timestamp: 150, state: 'idle' },
  { id: 'r4', objectId: 'obj-B', timestamp: 250, state: 'active', dependsOn: ['r2'] },
  { id: 'r5', objectId: 'obj-C', timestamp: 300, state: 'standby' },
];

export const baseEvents: KeyEvent[] = [
  { id: 'ev1', timestamp: 200, linkedRecordIds: ['r2'] },
  { id: 'ev2', timestamp: 260, linkedObjectIds: ['obj-B'] },
];

export const baseDataset: ImportInput = { records: baseRecords, events: baseEvents };

/** 矛盾记录：obj-A 在 t=200 出现两条不同 state。 */
export const conflictRecords: SpatialRecord[] = [
  { id: 'r2', objectId: 'obj-A', timestamp: 200, state: 'moving', dependsOn: ['r1'] },
  { id: 'r2b', objectId: 'obj-A', timestamp: 200, state: 'stopped', dependsOn: ['r1'] },
];

export const anomalyDataset: ImportInput = {
  records: [
    { id: 'ok1', objectId: 'obj-A', timestamp: 10, state: 'idle' },
    { id: 'miss1', objectId: 'obj-A', timestamp: 20, state: 'moving', dependsOn: ['ghost-record'] },
    { id: 'self1', objectId: 'obj-B', timestamp: 30, state: 'loop', dependsOn: ['self1'] },
    { id: 'cyc1', objectId: 'obj-C', timestamp: 40, state: 'a', dependsOn: ['cyc2'] },
    { id: 'cyc2', objectId: 'obj-C', timestamp: 50, state: 'b', dependsOn: ['cyc1'] },
  ],
  events: [
    { id: 'ev-ok', timestamp: 15, linkedRecordIds: ['ok1'] },
    { id: 'ev-miss-rec', timestamp: 25, linkedRecordIds: ['no-such-record'] },
    { id: 'ev-miss-obj', timestamp: 35, linkedObjectIds: ['obj-ghost'] },
  ],
};
