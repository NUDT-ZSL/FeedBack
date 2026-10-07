/** 套件三：失败路径 —— 依赖闭环、指向缺失、能力缺口、增量调整引入缺口 */
import { runSchedule } from '../src/scheduling/engine.ts';
import { rescheduleIncremental } from '../src/scheduling/incremental.ts';
import {
  capabilityGapInput,
  cycleInput,
  missingRefInput,
  soleCapabilityInput,
} from './fixtures/index.ts';
import { assert, assertEqual, check, suite } from './lib/harness.ts';

suite('失败路径');

check('依赖闭环：拒绝排产并给出闭环路径', () => {
  const r = runSchedule(cycleInput);
  assert(!r.ok, '存在依赖闭环时推演必须失败');
  assertEqual(r.entries.length, 0, '失败时不得产出任何档期');
  const cycle = r.findings.find((f) => f.code === 'DEPENDENCY_CYCLE');
  assert(cycle !== undefined, '缺少 DEPENDENCY_CYCLE 发现');
  assertEqual(cycle.severity, 'error', '闭环必须是 error 级');
  assertEqual(cycle.refs.slice().sort(), ['a', 'b', 'c'], '闭环应定位到 a/b/c 三道工序');
  assert(cycle.message.includes('->'), `闭环信息应包含路径：${cycle.message}`);
});

check('指向缺失：幽灵织机与幽灵前置同时被定位', () => {
  const r = runSchedule(missingRefInput);
  assert(!r.ok, '存在指向缺失时推演必须失败');
  const loom = r.findings.find((f) => f.code === 'MISSING_LOOM_REF');
  assert(loom !== undefined, '缺少 MISSING_LOOM_REF 发现');
  assert(loom.refs.includes('GHOST'), `应定位到不存在的织机 GHOST：${loom.refs.join(',')}`);
  const step = r.findings.find((f) => f.code === 'MISSING_STEP_REF');
  assert(step !== undefined, '缺少 MISSING_STEP_REF 发现');
  assert(step.refs.includes('NOPE'), `应定位到不存在的前置 NOPE：${step.refs.join(',')}`);
  assert(step.refs.includes('a'), `应定位到引用方工序 a：${step.refs.join(',')}`);
});

check('能力缺口：无任何织机承接的工序类型被拒绝', () => {
  const r = runSchedule(capabilityGapInput);
  assert(!r.ok, '存在能力缺口时推演必须失败');
  const gap = r.findings.find((f) => f.code === 'CAPABILITY_GAP');
  assert(gap !== undefined, '缺少 CAPABILITY_GAP 发现');
  assert(gap.refs.includes('d1'), `应定位到缺口工序 d1：${gap.refs.join(',')}`);
  assert(gap.message.includes('染色'), `应指出缺口工序类型：${gap.message}`);
});

check('增量调整引入能力缺口：同样拒绝且不影响基线数据', () => {
  const baseline = runSchedule(soleCapabilityInput);
  assert(baseline.ok, '基线推演应成功');
  const inc = rescheduleIncremental(soleCapabilityInput, baseline, {
    kind: 'capability',
    loomId: 'M1',
    processType: 'X',
    priority: null,
  });
  assert(!inc.ok, '移除唯一能力后增量推演必须失败');
  const gap = inc.findings.find((f) => f.code === 'CAPABILITY_GAP');
  assert(gap !== undefined, '缺少 CAPABILITY_GAP 发现');
  assert(gap.refs.includes('x1'), `应定位到缺口工序 x1：${gap.refs.join(',')}`);
  assert(baseline.entries.length === 1, '基线结果不应被失败的增量推演污染');
});

check('失败结果不含半成品档期与裁决', () => {
  const r = runSchedule(cycleInput);
  assertEqual(r.entries.length, 0, '档期应为空');
  assertEqual(r.adjudications.length, 0, '裁决应为空');
  assertEqual(r.loomSummaries.length, 0, '织机工时结论应为空');
});
