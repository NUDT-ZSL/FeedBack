/** 套件五：增量重推 —— 与整体重排逐字节等价，且只重推受影响排布 */
import { canonicalDiff, canonicalEquals } from '../src/scheduling/canonical.ts';
import { runSchedule } from '../src/scheduling/engine.ts';
import { applyChange, rescheduleIncremental } from '../src/scheduling/incremental.ts';
import type { SchedulingChange, SchedulingInput } from '../src/scheduling/types.ts';
import { isolatedChainsInput, normalInput } from './fixtures/index.ts';
import { assert, assertEqual, check, suite } from './lib/harness.ts';

suite('增量重推');

function expectEquivalent(
  label: string,
  input: SchedulingInput,
  change: SchedulingChange,
  expectAffected: string[],
): void {
  const baseline = runSchedule(input);
  assert(baseline.ok, `${label}：基线推演应成功`);
  const inc = rescheduleIncremental(input, baseline, change);
  assert(inc.ok, `${label}：增量推演应成功；${inc.findings.map((f) => f.message).join('；')}`);
  assertEqual(
    inc.affectedStepIds,
    expectAffected,
    `${label}：受影响集合（只应重推这些工序）`,
  );
  const full = runSchedule(applyChange(input, change));
  assert(
    canonicalEquals(inc.result, full),
    `${label}：增量重推与整体重排不一致：\n  ${canonicalDiff(inc.result, full)}`,
  );
  // 未受影响工序必须逐字节保持基线结论（锚点保证）
  const affectedSet = new Set(inc.affectedStepIds);
  const baselineByStep = new Map(baseline.entries.map((e) => [e.stepId, e]));
  for (const entry of inc.result.entries) {
    if (affectedSet.has(entry.stepId)) continue;
    const base = baselineByStep.get(entry.stepId);
    assert(base !== undefined, `${label}：未受影响工序 ${entry.stepId} 在基线中不存在`);
    assertEqual(
      JSON.stringify(entry),
      JSON.stringify(base),
      `${label}：未受影响工序 ${entry.stepId} 的结论被改动`,
    );
  }
}

check('依赖调整（新增跨订单前置）：只重推受影响排布且与整体重排一致', () => {
  expectEquivalent(
    't_draft 新增前置 s_weave',
    normalInput,
    { kind: 'dependency', stepId: 't_draft', dependsOn: ['t_warp', 's_weave'] },
    ['s_draft', 's_inspect', 's_warp', 's_weave', 't_draft', 't_inspect', 't_warp', 't_weave'],
  );
});

check('依赖调整（解除前置）：只重推受影响排布且与整体重排一致', () => {
  expectEquivalent(
    't_draft 解除全部前置',
    normalInput,
    { kind: 'dependency', stepId: 't_draft', dependsOn: [] },
    ['s_draft', 's_inspect', 's_warp', 's_weave', 't_draft', 't_inspect', 't_warp', 't_weave'],
  );
});

check('能力调整（优先级变更）：能力池内全部工序重推且与整体重排一致', () => {
  expectEquivalent(
    'L2 穿经优先级 0→5',
    normalInput,
    { kind: 'capability', loomId: 'L2', processType: '穿经', priority: 5 },
    ['s_draft', 's_inspect', 's_warp', 's_weave', 't_draft', 't_inspect', 't_warp', 't_weave'],
  );
});

check('能力调整（移除织机能力）：级联重推且与整体重排一致', () => {
  expectEquivalent(
    '移除 L3 的穿经能力',
    normalInput,
    { kind: 'capability', loomId: 'L3', processType: '穿经', priority: null },
    ['s_draft', 's_inspect', 's_warp', 's_weave', 't_draft', 't_inspect', 't_warp', 't_weave'],
  );
});

check('小范围调整：验布链自洽重推，整经/穿经/织造均不被波及', () => {
  expectEquivalent(
    's_inspect 前置保持不变（无实质变更）',
    normalInput,
    { kind: 'dependency', stepId: 's_inspect', dependsOn: ['s_weave'] },
    ['s_inspect', 't_inspect'],
  );
});

check('局部性：互不相干的工序链完全不被波及', () => {
  const baseline = runSchedule(isolatedChainsInput);
  assert(baseline.ok, '隔离链基线推演应成功');
  const inc = rescheduleIncremental(isolatedChainsInput, baseline, {
    kind: 'dependency',
    stepId: 'a1',
    dependsOn: [],
  });
  assert(inc.ok, '增量推演应成功');
  assertEqual(inc.affectedStepIds, ['a1', 'a2'], '受影响集合应只含甲链');
  const b1 = inc.result.entries.find((e) => e.stepId === 'b1')!;
  const b2 = inc.result.entries.find((e) => e.stepId === 'b2')!;
  assertEqual(`${b1.loomId}[${b1.startMinute}-${b1.endMinute}]`, 'PB[0-60]', 'b1 档期不应变化');
  assertEqual(`${b2.loomId}[${b2.startMinute}-${b2.endMinute}]`, 'PB[60-120]', 'b2 档期不应变化');
  const full = runSchedule(isolatedChainsInput);
  assert(
    canonicalEquals(inc.result, full),
    `无实质变更时增量重推应与整体重排一致：\n  ${canonicalDiff(inc.result, full)}`,
  );
});
