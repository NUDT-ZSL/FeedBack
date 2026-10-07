/** 演示数据集：共享池 + 4 个场次（含空场次、单资源场次、场内外冲突场景） */
import { OrchestrationStore } from './multiSession';
import type { BookingRequest, Participant, ResourceItem, TimeSlot } from './types';

export const PARTICIPANTS: Participant[] = [
  { id: 'p-shen', name: '沈括', roles: ['主宾'] },
  { id: 'p-li', name: '李清照', roles: ['副宾'] },
  { id: 'p-su', name: '苏轼', roles: ['陪客'] },
  { id: 'p-wang', name: '王安石', roles: ['陪客'] },
];

export const RESOURCES: ResourceItem[] = [
  { id: 'r-yubei', name: '玉杯', kind: 'vessel', capacity: 1 },
  { id: 'r-yinzhu', name: '银箸', kind: 'cutlery', capacity: 1 },
  { id: 'r-qipan', name: '漆盘', capacity: 2, kind: 'tray' },
  { id: 'r-ding', name: '青铜鼎', kind: 'ritual', capacity: 1 },
];

function slot(id: string, sessionId: string, start: number, end: number, label?: string): TimeSlot {
  return { id, sessionId, start, end, label };
}

function request(
  id: string,
  sessionId: string,
  participantId: string,
  resourceId: string,
  slotId: string,
  priority: number,
  requiredKind?: string,
): BookingRequest {
  return { id, sessionId, participantId, resourceId, slotId, priority, requiredKind };
}

/** 构造演示用多场次编排 Store（空场次与仅含单一资源项的场次都在其中） */
export function buildDemoStore(): OrchestrationStore {
  const store = new OrchestrationStore({ participants: PARTICIPANTS, resources: RESOURCES });

  // s1 春分宴：玉杯/银箸/漆盘/青铜鼎混合；漆盘容量 2，并发 2 不冲突
  store.addSession(
    { id: 's1', name: '春分宴' },
    [
      slot('t1', 's1', 0, 60, '辰时'),
      slot('t1b', 's1', 30, 90, '辰时一刻'),
      slot('t2', 's1', 60, 120, '巳时'),
      slot('t3', 's1', 120, 180, '午时'),
    ],
    [
      request('q1', 's1', 'p-shen', 'r-yubei', 't1', 0, 'vessel'),
      request('q2', 's1', 'p-li', 'r-yinzhu', 't1', 1),
      request('q3', 's1', 'p-su', 'r-qipan', 't1b', 0),
      request('q4', 's1', 'p-wang', 'r-qipan', 't1', 2),
      request('q5', 's1', 'p-li', 'r-ding', 't3', 0),
    ],
  );

  // s2 秋分宴：玉杯跨时段重叠（场内 resource-overlap），沈括跨时段（场内 participant-overlap）
  store.addSession(
    { id: 's2', name: '秋分宴' },
    [
      slot('u1', 's2', 0, 90, '辰时'),
      slot('u2', 's2', 60, 150, '巳时'),
    ],
    [
      request('q6', 's2', 'p-shen', 'r-yinzhu', 'u1', 0),
      request('q7', 's2', 'p-li', 'r-yubei', 'u2', 0, 'vessel'),
      request('q8', 's2', 'p-wang', 'r-yubei', 'u1', 1),
      request('q9', 's2', 'p-shen', 'r-qipan', 'u2', 2),
    ],
  );

  // s3 冬至宴：仅含单一资源项的场次
  store.addSession(
    { id: 's3', name: '冬至宴' },
    [slot('v1', 's3', 0, 60, '辰时')],
    [request('q10', 's3', 'p-wang', 'r-ding', 'v1', 0)],
  );

  // s4 空场次（有时段无请求，不应报错）
  store.addSession({ id: 's4', name: '空场次' }, [slot('w1', 's4', 0, 60, '辰时')], []);

  return store;
}
