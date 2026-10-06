/** 风险 3：事件关联修正/撤回后，受影响回放区间与影响范围随之更新，未受影响部分不被改动。 */
import { buildDatasetFromInput } from '../../src/replay/importer.js';
import { ReplaySession } from '../../src/replay/session.js';
import { mutableInput } from '../fixtures/datasets.mjs';

export default {
  id: 'event-revise-withdraw',
  title: '事件关联修正与撤回：影响范围精确更新，其余部分不动',
  category: 'event-association',
  run(ctx) {
    const dataset = buildDatasetFromInput(mutableInput);
    const session = new ReplaySession(dataset);

    const timelineBefore = session.report.timeline;
    const e2Before = session.report.events.find((e) => e.id === 'e2');
    const e3Before = session.report.events.find((e) => e.id === 'e3');

    // 修正 e1：从 r-a1 改挂 r-c3。
    const revise = session.reviseEventLinks('e1', ['r-c3']);
    ctx.assertEqual('修正后 e1 影响记录', revise.newScope.affectedRecords, ['r-c3']);
    ctx.assertEqual('修正后 e1 影响对象', revise.newScope.affectedObjects, ['C']);
    ctx.assertEqual('修正后 e1 影响区间', revise.newScope.intervals, [{ start: 3, end: 3 }]);
    ctx.assertEqual('修正前 e1 影响对象（审计留痕）', revise.previousScope.affectedObjects, ['A']);
    ctx.assertTrue('时间线不受事件修正影响（引用不变）', session.report.timeline === timelineBefore);
    ctx.assertTrue('e2 未被改动（引用不变）', session.report.events.find((e) => e.id === 'e2') === e2Before);
    ctx.assertTrue('e3 未被改动（引用不变）', session.report.events.find((e) => e.id === 'e3') === e3Before);
    ctx.assertTrue('修正后局部结果与整体重推一致', session.verifyAgainstFullRecompute());

    // 修正到缺失指向：归属异常，不静默跳过。
    const badRevise = session.reviseEventLinks('e1', ['r-ghost']);
    ctx.assertEqual('坏关联下 e1 影响范围为空', badRevise.newScope.affectedRecords, []);
    const anomaly = session.report.anomalies.find((a) => a.ownerType === 'event' && a.ownerId === 'e1');
    ctx.assertEqual('缺失指向归属到事件 e1', anomaly?.code, 'missing-reference');
    ctx.assertEqual('异常详情指向幽灵记录', anomaly?.details, { reference: 'r-ghost' });
    ctx.assertTrue('异常归属后仍与整体重推一致', session.verifyAgainstFullRecompute());

    // 撤回 e3：影响范围清空，事件保留且状态为 withdrawn。
    const withdraw = session.withdrawEvent('e3');
    ctx.assertEqual('撤回前 e3 影响对象（审计留痕）', withdraw.previousScope.affectedObjects, ['A']);
    ctx.assertEqual('撤回后 e3 影响记录清空', withdraw.newScope.affectedRecords, []);
    ctx.assertEqual('撤回后 e3 影响区间清空', withdraw.newScope.intervals, []);
    ctx.assertEqual('撤回后 e3 状态', withdraw.newScope.status, 'withdrawn');
    ctx.assertTrue('撤回后仍与整体重推一致', session.verifyAgainstFullRecompute());

    // 未知事件操作必须报错。
    ctx.expectThrow('修正未知事件报错', () => session.reviseEventLinks('e-zzz', []), 'unknown event');
    ctx.expectThrow('撤回未知事件报错', () => session.withdrawEvent('e-zzz'), 'unknown event');
  },
};
