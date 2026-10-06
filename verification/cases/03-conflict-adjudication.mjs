/** 风险 2：矛盾状态记录裁决前双方保留；裁决后只重推受影响部分，且与整体重推一致。 */
import { buildDatasetFromInput } from '../../src/replay/importer.js';
import { deriveFullReport, stateAt } from '../../src/replay/engine.js';
import { ReplaySession } from '../../src/replay/session.js';
import { conflictInput } from '../fixtures/datasets.mjs';

export default {
  id: 'conflict-adjudication',
  title: '矛盾记录：裁决前双方保留，裁决后局部重推与整体重推一致',
  category: 'conflict-adjudication',
  run(ctx) {
    const dataset = buildDatasetFromInput(conflictInput);
    const session = new ReplaySession(dataset);

    // 裁决前：双方保留，状态标记为 conflicting。
    const pending = session.pendingConflicts();
    ctx.assertEqual('裁决前矛盾清单', pending, [
      {
        objectId: 'A',
        timestamp: 5,
        records: [
          { recordId: 'r-a5x', state: { mode: 'moving' }, priority: 0 },
          { recordId: 'r-a5y', state: { mode: 'stopped' }, priority: 0 },
        ],
      },
    ]);
    ctx.assertEqual('裁决前回放推进到矛盾时刻返回双方候选', stateAt(session.report, 'A', 5), {
      kind: 'conflicting',
      timestamp: 5,
      candidates: [
        { recordId: 'r-a5x', state: { mode: 'moving' }, priority: 0 },
        { recordId: 'r-a5y', state: { mode: 'stopped' }, priority: 0 },
      ],
    });

    // 未受影响部分在裁决前的引用快照。
    const timelineBBefore = session.report.timeline.B;
    const timelineCBefore = session.report.timeline.C;
    const eventBBefore = session.report.events.find((e) => e.id === 'e-b');

    const dirty = session.adjudicateConflict('A', 5, 'r-a5y');

    ctx.assertEqual('受影响对象仅为 A', dirty.affectedObjects, ['A']);
    ctx.assertEqual('受影响时间区间止于下一条干净记录前', dirty.affectedIntervals, [
      { start: 5, end: 8 },
    ]);
    ctx.assertEqual('受影响事件仅 e-move', dirty.affectedEventIds, ['e-move']);

    ctx.assertEqual('裁决后回放推进到胜方状态', stateAt(session.report, 'A', 5), {
      kind: 'state',
      since: 5,
      state: { mode: 'stopped' },
    });
    ctx.assertEqual('裁决后矛盾清单清空', session.pendingConflicts(), []);

    ctx.assertTrue('未受影响对象 B 时间线未被改动（引用不变）', session.report.timeline.B === timelineBBefore);
    ctx.assertTrue('未受影响对象 C 时间线未被改动（引用不变）', session.report.timeline.C === timelineCBefore);
    ctx.assertTrue('未受影响事件 e-b 未被改动（引用不变）',
      session.report.events.find((e) => e.id === 'e-b') === eventBBefore);

    ctx.assertTrue('局部重推结果与整体重推一致', session.verifyAgainstFullRecompute());

    // 独立全量推导对拍：同一裁决映射直接全量推导，两份报告必须一致。
    const fresh = deriveFullReport(dataset, new Map([['A@5', 'r-a5y']]));
    ctx.assertTrue('会话报告与独立全量推导一致', ctx.deepEqual(session.report, fresh));

    // 非法裁决必须被拒绝而非静默接受。
    const session2 = new ReplaySession(dataset);
    ctx.expectThrow('胜方必须是矛盾双方之一', () => session2.adjudicateConflict('A', 5, 'r-zzz'), 'not among');
    ctx.expectThrow('无矛盾时刻不可裁决', () => session2.adjudicateConflict('A', 1, 'r-a1'), 'not a pending conflict');
  },
};
