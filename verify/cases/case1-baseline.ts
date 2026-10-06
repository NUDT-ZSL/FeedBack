/** 基线：导入 -> 回放推进 -> 关联推导的端到端正确性。 */
import { ReplayEngine } from '../core/engine.ts';
import { importAll } from '../core/importer.ts';
import { equalConclusions } from '../core/canonical.ts';
import { baseDataset } from '../fixtures/datasets.ts';
import { assert, assertEqual } from './assert.ts';

export const id = '01-baseline-pipeline';
export const category = 'baseline';

export function run(): void {
  const imported = importAll([baseDataset]);
  assertEqual(imported.anomalies.length, 0, category, '基线数据不应有导入异常');

  const engine = new ReplayEngine([baseDataset]);
  const full = engine.advance();
  assertEqual(full.conclusion.timelines['obj-A'].map((e) => e.timestamp), [100, 200], category, 'obj-A 时间线时间戳');
  assertEqual(full.conclusion.timelines['obj-B'].map((e) => e.timestamp), [150, 250], category, 'obj-B 时间线时间戳');
  assertEqual(full.conclusion.timelines['obj-A'][1].states, ['moving'], category, 'obj-A@200 状态');
  assertEqual(Object.keys(full.conclusion.conflicts), [], category, '基线数据不应有矛盾组');

  // 事件影响范围：沿依赖闭包传播
  const ev1 = full.conclusion.eventImpacts['ev1'];
  assertEqual(ev1.objectIds, ['obj-A'], category, 'ev1 影响对象（r2->r1 闭包均为 obj-A）');
  assertEqual(ev1.interval, { start: 100, end: 200 }, category, 'ev1 回放区间');

  const ev2 = full.conclusion.eventImpacts['ev2'];
  assertEqual(ev2.objectIds, ['obj-B'], category, 'ev2 影响对象');
  assertEqual(ev2.interval, { start: 150, end: 260 }, category, 'ev2 回放区间（含事件时刻）');

  // 回放推进：t=150 之前只应看到 r1(obj-A@100) 与 r3(obj-B@150)
  const at150 = engine.advance(150).conclusion;
  assertEqual(Object.keys(at150.timelines).sort(), ['obj-A', 'obj-B'], category, '推进到150的对象集合');
  assertEqual(at150.timelines['obj-A'].map((e) => e.timestamp), [100], category, '推进到150 obj-A 仅一条');
  assertEqual(at150.timelines['obj-B'].map((e) => e.timestamp), [150], category, '推进到150 obj-B 仅一条');

  const at99 = engine.advance(99).conclusion;
  assertEqual(Object.keys(at99.timelines), [], category, '推进到99无任何时间线条目');

  // 全程推进等价于最终结论
  assert(equalConclusions(engine.advance().conclusion, full.conclusion), category, '推进到全程应等价于最终结论');
}
