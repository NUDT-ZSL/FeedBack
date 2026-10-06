/** 验收用固定样例：3 台织机、4 张订单、多道工序，含同刻竞争与多机候选。 */
import type { ScheduleInput, WorkCalendar } from './types';

const TZ = 480; // Asia/Shanghai，无 DST
const dayStandard: WorkCalendar['days'] = [
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [{ startMinute: 480, endMinute: 720 }, { startMinute: 780, endMinute: 1080 }],
  [],
];
const dayShort: WorkCalendar['days'] = [
  [{ startMinute: 540, endMinute: 1020 }],
  [{ startMinute: 540, endMinute: 1020 }],
  [{ startMinute: 540, endMinute: 1020 }],
  [{ startMinute: 540, endMinute: 1020 }],
  [{ startMinute: 540, endMinute: 1020 }],
  [],
  [],
];

export const sampleInput: ScheduleInput = {
  horizonStart: '2026-10-08T00:00:00.000Z', // 当日 08:00 上海时间
  looms: [
    {
      id: 'L1',
      name: '云纹提花机',
      efficiency: 1.0,
      calendar: { id: 'CAL-L1', timezoneOffsetMinutes: TZ, days: dayStandard },
    },
    {
      id: 'L2',
      name: '花鸟小机',
      efficiency: 0.85,
      calendar: { id: 'CAL-L2', timezoneOffsetMinutes: TZ, days: dayStandard },
    },
    {
      id: 'L3',
      name: '通经快机',
      efficiency: 1.15,
      calendar: { id: 'CAL-L3', timezoneOffsetMinutes: TZ, days: dayShort },
    },
  ],
  orders: [
    {
      id: 'O1',
      name: '缂丝花鸟挂屏',
      priority: 1,
      releaseAt: '2026-10-08T00:00:00.000Z',
      dueAt: '2026-10-11T16:00:00.000Z',
    },
    {
      id: 'O2',
      name: '缂丝花卉团扇',
      priority: 1,
      releaseAt: '2026-10-08T00:00:00.000Z',
      dueAt: '2026-10-10T16:00:00.000Z',
    },
    {
      id: 'O3',
      name: '缂丝山水长卷',
      priority: 2,
      releaseAt: '2026-10-08T00:00:00.000Z',
      dueAt: '2026-10-15T16:00:00.000Z',
    },
    {
      id: 'O4',
      name: '缂丝人物册页',
      priority: 3,
      releaseAt: '2026-10-08T01:00:00.000Z',
      dueAt: '2026-10-14T16:00:00.000Z',
    },
  ],
  operations: [
    { id: 'O1-A', orderId: 'O1', sequence: 1, name: '挑经结本', loomIds: ['L1', 'L2'], workMinutes: 300, dependsOn: [] },
    { id: 'O1-B', orderId: 'O1', sequence: 2, name: '引纬配色', loomIds: ['L1', 'L2'], workMinutes: 240, dependsOn: ['O1-A'] },
    { id: 'O1-C', orderId: 'O1', sequence: 3, name: '通经织造', loomIds: ['L1'], workMinutes: 480, dependsOn: ['O1-B'] },
    { id: 'O2-A', orderId: 'O2', sequence: 1, name: '挑经结本', loomIds: ['L2', 'L3'], workMinutes: 240, dependsOn: [] },
    { id: 'O2-B', orderId: 'O2', sequence: 2, name: '断纬织造', loomIds: ['L2', 'L3'], workMinutes: 360, dependsOn: ['O2-A'] },
    { id: 'O3-A', orderId: 'O3', sequence: 1, name: '挑经结本', loomIds: ['L1', 'L2'], workMinutes: 360, dependsOn: [] },
    { id: 'O3-B', orderId: 'O3', sequence: 2, name: '引纬配色', loomIds: ['L1'], workMinutes: 300, dependsOn: ['O3-A'] },
    { id: 'O3-C', orderId: 'O3', sequence: 3, name: '通经织造', loomIds: ['L1', 'L3'], workMinutes: 600, dependsOn: ['O3-B'] },
    { id: 'O4-A', orderId: 'O4', sequence: 1, name: '挑经结本', loomIds: ['L3'], workMinutes: 180, dependsOn: [] },
    { id: 'O4-B', orderId: 'O4', sequence: 2, name: '断纬织造', loomIds: ['L3'], workMinutes: 300, dependsOn: ['O4-A'] },
    { id: 'O4-C', orderId: 'O4', sequence: 3, name: '装裱收卷', loomIds: ['L2'], workMinutes: 120, dependsOn: ['O4-B'] },
  ],
};
