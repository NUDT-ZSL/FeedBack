/**
 * 风险2：同一对象同一时刻的矛盾状态记录
 *  - 裁决前双方都保留；
 *  - 裁决后仅重推受影响对象与时间区间；
 *  - 局部重推结果与整体重推一致。
 */
import { ReplayEngine } from '../core/engine.ts';
import { equalConclusions, diffConclusion } from '../core/canonical.ts';
import { baseEvents } from '../fixtures/datasets.ts';
import type { ImportInput, SpatialRecord } from '../core/types.ts';
import { assert, assertEqual } from './assert.ts';

export const id = '03-conflict-adjudication';
export const category = 'conflict-adjudication';

const records: SpatialRecord[] = [
  { id: 'r1', objectId: 'obj-A', timestamp: 100, state: 'idle' },
  { id: 'r2', objectId: 'obj-A', timestamp: 200, state: 'moving', dependsOn: ['r1'] },
  { id: 'r2b', objectId: 'obj-A', timestamp: 200, state: 'stopped', dependsOn: ['r1'] },
  { id: 'r4', objectId: 'obj-B', timestamp: 250, state: 'active', dependsOn: ['r2'] },
  { id: 'r5', objectId: 'obj-C', timestamp: 300, state: 'standby' },
];
const dataset: ImportInput = { records, events: baseEvents };

export function run(): void {
  const engine = new ReplayEngine([dataset]);

  // 裁决前：矛盾双方保留
  const before = engine.advance().conclusion;
  const conflict = before.conflicts['obj-A@200'];
  assert(conflict && !conflict.resolved, category, '裁决前必须存在未裁决矛盾组');
  assertEqual(conflict.recordIds, ['r2', 'r2b'], category, '矛盾双方记录均保留');
  assertEqual(conflict.states, ['moving', 'stopped'], category, '矛盾双方状态均保留');
  assertEqual(before.timelines['obj-A'].find((e) => e.timestamp === 200)!.states, ['moving', 'stopped'], category, '时间线条目裁决前保留双方');

  const rawBefore = engine.rawState();
  const untouchedEntryRef = before.timelines['obj-C'][0];

  // 裁决：r2(moving) 胜出
  const scope = engine.adjudicate('obj-A', 200, 'r2');
  const after = engine.advance().conclusion;

  // 裁决后：只保留胜方
  assertEqual(after.timelines['obj-A'].find((e) => e.timestamp === 200)!.states, ['moving'], category, '裁决后时间线只保留胜方状态');
  assertEqual(after.timelines['obj-A'].find((e) => e.timestamp === 200)!.adjudicated, 'r2', category, '裁决记录指向胜方');
  assertEqual(after.conflicts['obj-A@200'].resolved, true, category, '矛盾组标记已裁决');
  assertEqual(after.conflicts['obj-A@200'].winnerId, 'r2', category, '矛盾组记录胜方');

  // 局部重推范围：obj-A（矛盾对象+其闭包）、obj-B（反向依赖 r4->r2）；不含 obj-C
  assertEqual(scope.objectIds, ['obj-A', 'obj-B'], category, '受影响对象集合（含反向依赖传播）');
  assertEqual([...engine.advance().lastRecomputedObjects].sort(), ['obj-A', 'obj-B'], category, '局部重推实际覆盖对象集合');
  assertEqual(
    [...engine.advance().lastRecomputedKeys].sort(),
    ['obj-A@100', 'obj-A@200', 'obj-B@250'],
    category,
    '局部重推实际覆盖时间点（闭包传播范围）',
  );

  // 未受影响部分不被改动：引用相等
  assert(engine.rawState().timelines['obj-C'] === rawBefore.timelines['obj-C'], category, '未受影响对象时间线引用不变');
  assert(engine.rawState().timelines['obj-C'][0] === untouchedEntryRef, category, '未受影响时间线条目引用不变');
  assert(engine.rawState().eventImpacts['ev2'] === rawBefore.eventImpacts['ev2'], category, '未受影响事件范围引用不变');

  // 局部重推结果与整体重推一致
  const full = engine.fullRecompute().conclusion;
  assert(equalConclusions(after, full), category, `局部重推与整体重推结论不一致，分歧类别: ${diffConclusion(after, full) ?? '未知'}`);

  // 另一方胜出也应一致
  const engine2 = new ReplayEngine([dataset]);
  engine2.adjudicate('obj-A', 200, 'r2b');
  const partial2 = engine2.advance().conclusion;
  const full2 = engine2.fullRecompute().conclusion;
  assertEqual(partial2.timelines['obj-A'].find((e) => e.timestamp === 200)!.states, ['stopped'], category, '改判另一方后只保留其状态');
  assert(equalConclusions(partial2, full2), category, `改判后局部重推与整体重推不一致，分歧类别: ${diffConclusion(partial2, full2) ?? '未知'}`);
}
