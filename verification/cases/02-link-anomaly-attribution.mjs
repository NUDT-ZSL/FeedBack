/** 风险 1：缺失指向 / 自引用 / 成环必须给出可追溯归属，且坏边被剔除、不静默跳过。 */
import { buildDatasetFromInput } from '../../src/replay/importer.js';
import { deriveFullReport } from '../../src/replay/engine.js';

import { anomalyInput } from '../fixtures/datasets.mjs';

export default {
  id: 'link-anomaly-attribution',
  title: '关联缺失/自引用/成环：逐条归属到具体记录或事件',
  category: 'link-integrity',
  run(ctx) {
    const dataset = buildDatasetFromInput(anomalyInput);
    const report = deriveFullReport(dataset);

    const byOwner = new Map();
    for (const anomaly of report.anomalies) {
      const key = `${anomaly.ownerType}:${anomaly.ownerId}:${anomaly.code}`;
      byOwner.set(key, anomaly);
    }

    ctx.assertTrue('缺失指向归属到记录 r-miss', byOwner.has('record:r-miss:missing-reference'));
    ctx.assertEqual('r-miss 异常指向幽灵记录', byOwner.get('record:r-miss:missing-reference')?.details, {
      reference: 'r-ghost',
    });
    ctx.assertTrue('缺失指向归属到事件 e-miss', byOwner.has('event:e-miss:missing-reference'));
    ctx.assertTrue('自引用归属到 r-self', byOwner.has('record:r-self:self-reference'));
    for (const id of ['r-c1', 'r-c2', 'r-c3']) {
      const anomaly = byOwner.get(`record:${id}:reference-cycle`);
      ctx.assertTrue(`成环归属到 ${id}`, Boolean(anomaly));
      ctx.assertEqual(`${id} 的成环节点集合`, anomaly?.details?.cycle, ['r-c1', 'r-c2', 'r-c3']);
    }

    ctx.assertEqual('异常类别均为 link-integrity', [...new Set(report.anomalies.map((a) => a.category))], [
      'link-integrity',
    ]);
    ctx.assertEqual('异常总数（2 缺失 + 1 自引用 + 3 成环）', report.anomalies.length, 6);

    // 坏边被剔除：r-miss 的有效关联为空，但记录本身保留。
    ctx.assertEqual('r-miss 坏边已剔除', dataset.validLinks.get('r-miss'), []);
    ctx.assertTrue('r-miss 记录未被静默丢弃', dataset.records.has('r-miss'));
    ctx.assertTrue('r-self 记录未被静默丢弃', dataset.records.has('r-self'));

    // 成环不导致推导死循环：e-cycle 的影响范围仍是有限集合。
    const cycleEvent = report.events.find((e) => e.id === 'e-cycle');
    ctx.assertEqual('成环事件影响范围有限且确定', cycleEvent.affectedRecords, ['r-c1', 'r-c2', 'r-c3']);
  },
};
