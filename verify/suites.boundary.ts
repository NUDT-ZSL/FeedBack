/** 套件二：边界条件 —— 单机紧凑链、织机 id 决胜、投料门控、优先级压空档、隔离链 */
import { runSchedule } from '../src/scheduling/engine.ts';
import {
  isolatedChainsInput,
  loomIdTieInput,
  priorityOverEarliestInput,
  releaseGatedInput,
  tightChainInput,
} from './fixtures/index.ts';
import { assert, assertEqual, check, suite } from './lib/harness.ts';

suite('边界条件');

check('单机紧凑链：三道工序首尾相接零空档', () => {
  const r = runSchedule(tightChainInput);
  assert(r.ok, '推演应成功');
  const got = r.entries.map((e) => `${e.stepId}[${e.startMinute}-${e.endMinute}]`);
  assertEqual(got, ['a[0-60]', 'b[60-120]', 'c[120-180]'], '紧凑链档期');
  const b = r.entries.find((e) => e.stepId === 'b')!;
  assertEqual(b.delay.delayMinutes, 0, 'b 紧接 a 完工开工，无顺延');
});

check('同优先级同空档：按织机 id 字典序裁决且留痕', () => {
  const r = runSchedule(loomIdTieInput);
  assert(r.ok, '推演应成功');
  const e = r.entries.find((x) => x.stepId === 'x1')!;
  assertEqual(e.loomId, 'MA', '同优先级同空档应裁给 id 字典序较小的 MA');
  const adj = r.adjudications.find((a) => a.stepId === 'x1')!;
  const mb = adj.candidates.find((c) => c.loomId === 'MB')!;
  assertEqual(mb.outcome, 'rejected', 'MB 应落选');
  assert(mb.reason.includes('字典序'), `MB 落选依据应说明字典序裁决：${mb.reason}`);
});

check('投料门控：开工不得早于订单投料时刻', () => {
  const r = runSchedule(releaseGatedInput);
  assert(r.ok, '推演应成功');
  const e = r.entries.find((x) => x.stepId === 'x1')!;
  assertEqual(e.startMinute, 100, '开工时刻应等于投料时刻 100');
  assertEqual(e.delay.delayMinutes, 0, '投料约束本身不计为织机顺延');
});

check('优先级压过最早空档：高优先级织机被占 300 分钟仍优先选用', () => {
  const r = runSchedule(priorityOverEarliestInput);
  assert(r.ok, '推演应成功');
  const z1 = r.entries.find((x) => x.stepId === 'z1')!;
  assertEqual(z1.loomId, 'LB', 'z1 应落在高优先级 LB 而非空闲的低优先级 LA');
  assertEqual(z1.startMinute, 300, 'z1 在 LB 上顺延至 300 开工');
  assert(z1.delay.reason.includes('y1'), `z1 顺延依据应指向占用工序 y1：${z1.delay.reason}`);
  const adj = r.adjudications.find((a) => a.stepId === 'z1')!;
  const la = adj.candidates.find((c) => c.loomId === 'LA')!;
  assert(la.reason.includes('优先级'), `LA 落选依据应说明优先级：${la.reason}`);
});

check('隔离链：两条互不相干的工序链各自独占织机', () => {
  const r = runSchedule(isolatedChainsInput);
  assert(r.ok, '推演应成功');
  const got = r.entries.map((e) => `${e.stepId}@${e.loomId}[${e.startMinute}-${e.endMinute}]`);
  assertEqual(
    got,
    ['a1@PA[0-60]', 'b1@PB[0-60]', 'a2@PA[60-120]', 'b2@PB[60-120]'],
    '隔离链档期',
  );
});
