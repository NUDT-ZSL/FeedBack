/**
 * 风险3：事件关联对象被修正或撤回后，
 * 受影响的回放区间与事件影响范围随之更新，未受影响部分不被改动。
 */
import { ReplayEngine } from '../core/engine.ts';
import { importAll } from '../core/importer.ts';
import { equalConclusions, diffConclusion } from '../core/canonical.ts';
import { baseDataset } from '../fixtures/datasets.ts';
import { assert, assertEqual } from './assert.ts';

export const id = '04-event-link-update';
export const category = 'event-link-update';

export function run(): void {
  const engine = new ReplayEngine([baseDataset]);
  const before = engine.advance().conclusion;
  const rawBefore = engine.rawState();

  // 基线：ev1 关联 r2 -> 闭包 {r2,r1} -> obj-A, [100,200]
  assertEqual(before.eventImpacts['ev1'].objectIds, ['obj-A'], category, '修正前 ev1 影响对象');
  assertEqual(before.eventImpacts['ev1'].interval, { start: 100, end: 200 }, category, '修正前 ev1 区间');

  // 修正：ev1 改挂到 r4（obj-B, t=250, 依赖 r2 -> 闭包 {r4,r2,r1}）
  const scope = engine.correctEventLinks('ev1', { recordIds: ['r4'] });
  const after = engine.advance().conclusion;

  assertEqual(after.eventImpacts['ev1'].objectIds, ['obj-A', 'obj-B'], category, '修正后 ev1 影响对象随关联更新');
  assertEqual(after.eventImpacts['ev1'].interval, { start: 100, end: 250 }, category, '修正后 ev1 回放区间扩大');
  assertEqual(after.eventImpacts['ev1'].derivedFromRecords, ['r4'], category, '修正后 ev1 关联来源更新');
  assertEqual(scope.objectIds, ['obj-A', 'obj-B'], category, '修正影响范围 = 新旧区间并集涉及对象');

  // 未受影响部分不被改动
  assert(after.eventImpacts['ev2'] === rawBefore.eventImpacts['ev2'], category, '未受影响事件 ev2 范围引用不变');
  assert(engine.rawState().timelines['obj-C'] === rawBefore.timelines['obj-C'], category, '未受影响对象 obj-C 时间线引用不变');

  // 局部重推与整体重推一致
  const fullAfterCorrect = engine.fullRecompute().conclusion;
  assert(equalConclusions(after, fullAfterCorrect), category, `修正后局部与整体重推不一致，分歧类别: ${diffConclusion(after, fullAfterCorrect) ?? '未知'}`);

  // 撤回：ev2 撤回后影响范围清空，其余不受影响
  const rawBeforeWithdraw = engine.rawState();
  const withdrawScope = engine.withdrawEvent('ev2');
  const afterWithdraw = engine.advance().conclusion;

  assertEqual(afterWithdraw.eventImpacts['ev2'].withdrawn, true, category, '撤回事件标记 withdrawn');
  assertEqual(afterWithdraw.eventImpacts['ev2'].objectIds, [], category, '撤回事件影响对象清空');
  assertEqual(withdrawScope.objectIds, ['obj-B'], category, '撤回影响范围 = 原影响对象');
  assert(afterWithdraw.eventImpacts['ev1'] === rawBeforeWithdraw.eventImpacts['ev1'], category, '撤回 ev2 不影响 ev1（引用不变）');
  assert(engine.rawState().timelines['obj-A'] === rawBeforeWithdraw.timelines['obj-A'], category, '撤回 ev2 不影响 obj-A 时间线');

  const fullAfterWithdraw = engine.fullRecompute().conclusion;
  assert(equalConclusions(afterWithdraw, fullAfterWithdraw), category, `撤回后局部与整体重推不一致，分歧类别: ${diffConclusion(afterWithdraw, fullAfterWithdraw) ?? '未知'}`);

  // 修正到不存在的记录：重新导入校验必须给出可追溯异常，而非静默接受
  const reimported = importAll([{ records: baseDataset.records, events: [{ id: 'ev1', timestamp: 200, linkedRecordIds: ['ghost'] }] }]);
  assertEqual(
    reimported.anomalies.filter((a) => a.kind === 'missing-ref').map((a) => a.owner),
    ['event:ev1'],
    category,
    '修正到缺失记录时可追溯归因',
  );
}
