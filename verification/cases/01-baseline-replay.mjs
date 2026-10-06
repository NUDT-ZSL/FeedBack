/** 基线：无异常样例的导入、时间推进回放与事件影响推导。 */
import { buildDatasetFromInput } from '../../src/replay/importer.js';
import { deriveFullReport, stateAt } from '../../src/replay/engine.js';
import { baselineInput } from '../fixtures/datasets.mjs';

export default {
  id: 'baseline-replay',
  title: '无异常样例：导入干净、回放推进与事件影响范围正确',
  category: 'baseline',
  run(ctx) {
    const dataset = buildDatasetFromInput(baselineInput);
    const report = deriveFullReport(dataset);

    ctx.assertEqual('无异常归属', report.anomalies, []);
    ctx.assertEqual('无未裁决矛盾', report.conflicts, []);

    ctx.assertEqual('对象 A 时间线', report.timeline.A, [
      { objectId: 'A', timestamp: 1, status: 'ok', state: { mode: 'idle' }, recordIds: ['r-a1'] },
      { objectId: 'A', timestamp: 5, status: 'ok', state: { mode: 'moving' }, recordIds: ['r-a5'] },
      { objectId: 'A', timestamp: 9, status: 'ok', state: { mode: 'idle' }, recordIds: ['r-a9'] },
    ]);

    ctx.assertEqual('t=4 时 A 保持 t=1 状态', stateAt(report, 'A', 4), {
      kind: 'state',
      since: 1,
      state: { mode: 'idle' },
    });
    ctx.assertEqual('t=6 时 A 推进到 t=5 状态', stateAt(report, 'A', 6), {
      kind: 'state',
      since: 5,
      state: { mode: 'moving' },
    });
    ctx.assertEqual('t=0 时 A 尚无记录', stateAt(report, 'A', 0), { kind: 'empty' });
    ctx.assertEqual('未知对象', stateAt(report, 'ZZZ', 5), { kind: 'unknown' });

    const move = report.events.find((e) => e.id === 'e-move');
    ctx.assertEqual('e-move 沿关联推导影响记录', move.affectedRecords, ['r-a5', 'r-b5']);
    ctx.assertEqual('e-move 影响对象', move.affectedObjects, ['A', 'B']);
    ctx.assertEqual('e-move 影响时间区间', move.intervals, [{ start: 5, end: 5 }]);

    const pos = report.events.find((e) => e.id === 'e-pos');
    ctx.assertEqual('e-pos 沿记录链回溯', pos.affectedRecords, ['r-c3', 'r-c7']);
    ctx.assertEqual('e-pos 影响时间区间', pos.intervals, [{ start: 3, end: 3 }, { start: 7, end: 7 }]);
  },
};
