/** 端到端：导入 -> 回放推进 -> 事件关联推导 -> 矛盾裁决局部重推 -> 关联撤回，全链路衔接。 */
import { buildDatasetFromInput } from '../../src/replay/importer.js';
import { ReplaySession } from '../../src/replay/session.js';
import { stateAt } from '../../src/replay/engine.js';

const input = {
  records: [
    { id: 'r1', objectId: 'A', timestamp: 1, state: { mode: 'idle' } },
    { id: 'r2', objectId: 'A', timestamp: 4, state: { mode: 'moving' }, links: ['r4'] },
    { id: 'r3', objectId: 'A', timestamp: 4, state: { mode: 'halt' } },
    { id: 'r4', objectId: 'B', timestamp: 3, state: { temp: 30 } },
    { id: 'r5', objectId: 'C', timestamp: 6, state: { pos: [0, 0] } },
  ],
  events: [
    { id: 'e-a', timestamp: 2, kind: 'trigger', links: ['r2'] },
    { id: 'e-c', timestamp: 6, kind: 'locate', links: ['r5'] },
  ],
};

export default {
  id: 'end-to-end-chain',
  title: '全链路衔接：异常台账、裁决局部重推、事件撤回逐段一致',
  category: 'end-to-end',
  run(ctx) {
    const session = new ReplaySession(buildDatasetFromInput(input));

    ctx.assertEqual('导入无异常', session.report.anomalies, []);
    ctx.assertEqual('裁决前 A@4 双方保留', session.pendingConflicts().map((c) => c.records), [
      [
        { recordId: 'r2', state: { mode: 'moving' }, priority: 0 },
        { recordId: 'r3', state: { mode: 'halt' }, priority: 0 },
      ],
    ]);

    const triggerBefore = session.report.events.find((e) => e.id === 'e-a');
    ctx.assertEqual('事件 e-a 沿关联推导至 A、B', triggerBefore.affectedObjects, ['A', 'B']);
    ctx.assertEqual('事件 e-a 影响记录', triggerBefore.affectedRecords, ['r2', 'r4']);

    const dirty = session.adjudicateConflict('A', 4, 'r2');
    ctx.assertEqual('裁决局部重推对象', dirty.affectedObjects, ['A']);
    ctx.assertEqual('裁决局部重推区间（开口到末尾）', dirty.affectedIntervals, [{ start: 4, end: null }]);
    ctx.assertEqual('裁决后 e-a 状态指纹随胜方状态更新', stateAt(session.report, 'A', 4), {
      kind: 'state',
      since: 4,
      state: { mode: 'moving' },
    });
    ctx.assertTrue('每次局部重推后均与整体重推一致', session.verifyAgainstFullRecompute());

    const cTimelineBefore = session.report.timeline.C;
    session.withdrawEvent('e-c');
    ctx.assertTrue('撤回事件不影响时间线', session.report.timeline.C === cTimelineBefore);
    ctx.assertEqual('撤回后 e-c 无影响对象', session.report.events.find((e) => e.id === 'e-c').affectedObjects, []);
    ctx.assertTrue('撤回后仍与整体重推一致', session.verifyAgainstFullRecompute());

    // 审计日志完整保留每段变更，可追溯。
    ctx.assertEqual('局部重推审计日志', session.dirtyLog().map((d) => d.kind), ['adjudication', 'event-withdraw']);
  },
};
