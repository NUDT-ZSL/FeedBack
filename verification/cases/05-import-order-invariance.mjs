/** 风险 4：同一批输入在不同导入顺序、不同批次切分下，回放结论与影响范围必须一致。 */
import { Importer, buildDatasetFromInput } from '../../src/replay/importer.js';
import { deriveFullReport } from '../../src/replay/engine.js';
import { ReplaySession } from '../../src/replay/session.js';
import { seededShuffle } from '../../src/replay/canonical.js';
import { baselineInput, anomalyInput, conflictInput } from '../fixtures/datasets.mjs';

function flatten(input) {
  return [
    ...input.records.map((record) => ({ kind: 'record', value: record })),
    ...input.events.map((event) => ({ kind: 'event', value: event })),
  ];
}

function buildViaBatches(items, batchCount) {
  const importer = new Importer();
  const batches = Array.from({ length: batchCount }, () => ({ records: [], events: [] }));
  items.forEach((item, index) => {
    const bucket = batches[index % batchCount];
    if (item.kind === 'record') bucket.records.push(item.value);
    else bucket.events.push(item.value);
  });
  for (const batch of batches) importer.ingestBatch(batch);
  return importer.buildDataset();
}

export default {
  id: 'import-order-invariance',
  title: '导入顺序与批次切分不变性：结论指纹跨排列一致',
  category: 'import-invariance',
  run(ctx) {
    for (const [name, input] of [
      ['baseline', baselineInput],
      ['anomaly', anomalyInput],
      ['conflict', conflictInput],
    ]) {
      const reference = deriveFullReport(buildDatasetFromInput(input));
      const referenceFp = ctx.fingerprint(reference);
      const items = flatten(input);

      for (const seed of [1, 7, 42, 2026]) {
        const shuffled = seededShuffle(items, seed);
        for (const batchCount of [1, 2, 3, 5]) {
          const report = deriveFullReport(buildViaBatches(shuffled, batchCount));
          ctx.assertTrue(
            `${name} 样例 seed=${seed} 批次=${batchCount} 结论一致`,
            ctx.fingerprint(report) === referenceFp,
            `fingerprint mismatch: ${ctx.fingerprint(report)} != ${referenceFp}`,
          );
        }
      }
    }

    // 含裁决的会话结论同样与导入顺序无关。
    const adjudications = new Map([['A@5', 'r-a5y']]);
    const items = flatten(conflictInput);
    const referenceSession = new ReplaySession(buildDatasetFromInput(conflictInput));
    referenceSession.adjudicateConflict('A', 5, 'r-a5y');
    const referenceFp = ctx.fingerprint(referenceSession.report);
    for (const seed of [3, 99]) {
      const session = new ReplaySession(buildViaBatches(seededShuffle(items, seed), 4));
      session.adjudicateConflict('A', 5, 'r-a5y');
      ctx.assertTrue(
        `裁决后结论 seed=${seed} 与参考一致`,
        ctx.fingerprint(session.report) === referenceFp,
      );
    }
    void adjudications;
  },
};
