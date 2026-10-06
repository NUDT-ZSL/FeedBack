/** 同 ID 不同内容跨批次导入：必须归属 duplicate 异常，且保留版本确定、可复现。 */
import { Importer } from '../../src/replay/importer.js';
import { deriveFullReport } from '../../src/replay/engine.js';
import { stableStringify } from '../../src/replay/canonical.js';

export default {
  id: 'duplicate-payload-attribution',
  title: '重复 ID 内容不一致：归属异常，保留版本与导入顺序无关',
  category: 'link-integrity',
  run(ctx) {
    const variants = [
      { id: 'r-dup', objectId: 'A', timestamp: 1, state: { mode: 'a' } },
      { id: 'r-dup', objectId: 'A', timestamp: 1, state: { mode: 'b' } },
    ];
    const build = (order) => {
      const importer = new Importer();
      importer.ingestBatch({ records: [order[0]] });
      importer.ingestBatch({ records: [order[1]] });
      return importer.buildDataset();
    };

    const d1 = build(variants);
    const d2 = build([variants[1], variants[0]]);

    for (const [tag, dataset] of [['先 a 后 b', d1], ['先 b 后 a', d2]]) {
      const dup = dataset.anomalies.find((a) => a.code === 'inconsistent-duplicate');
      ctx.assertTrue(`${tag}：归属 duplicate 异常`, Boolean(dup));
      ctx.assertEqual(`${tag}：异常归属到 r-dup`, dup?.ownerId, 'r-dup');
      ctx.assertEqual(`${tag}：异常类别`, dup?.category, 'duplicate');
      ctx.assertEqual(`${tag}：记录两个版本的载荷指纹`, dup?.details?.payloadHashes?.length, 2);
    }

    ctx.assertEqual('两种导入顺序保留版本一致', stableStringify([...d1.records.values()]), stableStringify([...d2.records.values()]));
    ctx.assertEqual('异常台账与导入顺序无关', d1.anomalies, d2.anomalies);
    ctx.assertEqual('全量推导结论与导入顺序无关', deriveFullReport(d1), deriveFullReport(d2));

    // 完全相同的重复导入不产生异常。
    const clean = new Importer()
      .ingestBatch({ records: [variants[0]] })
      .ingestBatch({ records: [variants[0]] })
      .buildDataset();
    ctx.assertEqual('同内容重复导入无异常', clean.anomalies, []);
  },
};
