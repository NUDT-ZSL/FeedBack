/** 风险1：指向缺失 / 自引用 / 成环必须给出可追溯异常归属，且不静默跳过。 */
import { ReplayEngine } from '../core/engine.ts';
import { importAll } from '../core/importer.ts';
import { anomalyDataset } from '../fixtures/datasets.ts';
import { assert, assertEqual } from './assert.ts';

export const id = '02-anomaly-attribution';
export const category = 'anomaly-attribution';

export function run(): void {
  const imported = importAll([anomalyDataset]);
  const byKind = new Map(imported.anomalies.map((a) => [a.kind, imported.anomalies.filter((x) => x.kind === a.kind)]));

  const missing = byKind.get('missing-ref')!;
  assertEqual(missing.length, 3, category, '应识别 3 个指向缺失（记录依赖 + 事件关联记录 + 事件关联对象）');
  const owners = missing.map((a) => a.owner).sort();
  assertEqual(owners, ['event:ev-miss-obj', 'event:ev-miss-rec', 'record:miss1'], category, '缺失异常可追溯到归属主体');
  assertEqual(missing.find((a) => a.owner === 'record:miss1')!.path, ['miss1', 'ghost-record'], category, '缺失引用路径完整');

  const selfRef = byKind.get('self-ref')!;
  assertEqual(selfRef.length, 1, category, '应识别 1 个自引用');
  assertEqual(selfRef[0].owner, 'record:self1', category, '自引用归属');
  assertEqual(selfRef[0].path, ['self1', 'self1'], category, '自引用路径');

  const cycles = byKind.get('cycle')!;
  assertEqual(cycles.length, 2, category, '环上每条记录都应有异常归属');
  assertEqual(cycles.map((a) => a.owner).sort(), ['record:cyc1', 'record:cyc2'], category, '成环归属主体');
  assertEqual(cycles[0].path, ['cyc1', 'cyc2', 'cyc1'], category, '成环路径可追溯');

  // 异常记录不被静默丢弃：仍然出现在回放时间线中；异常边从推导图剔除
  const engine = new ReplayEngine([anomalyDataset]);
  const conclusion = engine.advance().conclusion;
  const allObjects = Object.keys(conclusion.timelines).sort();
  assertEqual(allObjects, ['obj-A', 'obj-B', 'obj-C'], category, '异常记录仍参与回放（不静默跳过）');
  assertEqual(conclusion.timelines['obj-C'].map((e) => e.states[0]).sort(), ['a', 'b'], category, '成环记录状态保留');

  // 清洗后的推导边：自引用 / 成环 / 缺失边全部剔除
  assertEqual(imported.edges.get('self1'), [], category, '自引用边剔除');
  assertEqual(imported.edges.get('cyc1'), [], category, '成环边剔除 cyc1');
  assertEqual(imported.edges.get('cyc2'), [], category, '成环边剔除 cyc2');
  assertEqual(imported.edges.get('miss1'), [], category, '缺失依赖边剔除');

  // 正常事件推导不受异常记录影响
  const evOk = conclusion.eventImpacts['ev-ok'];
  assertEqual(evOk.objectIds, ['obj-A'], category, '正常事件影响范围正确');
  assertEqual(evOk.interval, { start: 10, end: 15 }, category, '正常事件区间正确');
}
