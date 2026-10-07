/**
 * 套件一：正常排布 —— 档期精确值、顺延依据、工时结论。
 * 期望值依据确定性规则独立推演得到（拓扑序按 stepId，织机按 优先级/最早空档/id）：
 *   s_warp L1[0-120]   s_draft L2[120-220]  s_weave L3[220-520]  t_warp L1[120-240]
 *   t_draft L2[240-340]  s_inspect L4[520-580]  t_weave L3[520-820]  t_inspect L4[820-880]
 */
import { runSchedule } from '../src/scheduling/engine.ts';
import { normalInput } from './fixtures/index.ts';
import { assert, assertEqual, check, suite } from './lib/harness.ts';

suite('正常排布');

const result = runSchedule(normalInput);
const HORIZON = 880;

check('推演成功且无 error 级发现', () => {
  assert(result.ok, `推演失败：${result.findings.map((f) => f.message).join('；')}`);
  assert(!result.findings.some((f) => f.severity === 'error'), '存在 error 级发现');
});

check('穿经类型的跨织机不同优先级覆盖产生 warning 并给出裁决规则', () => {
  const warn = result.findings.find((f) => f.code === 'PRIORITY_CONFLICT');
  assert(warn !== undefined, '缺少 PRIORITY_CONFLICT 预警');
  assertEqual(warn.refs.slice().sort(), ['L1', 'L2', 'L3'], '优先级冲突关联织机');
});

check('全部 8 道工序的可执行档期与织机分派精确一致', () => {
  const got = result.entries.map((e) => `${e.stepId}@${e.loomId}[${e.startMinute}-${e.endMinute}]`);
  assertEqual(
    got,
    [
      's_warp@L1[0-120]',
      's_draft@L2[120-220]',
      't_warp@L1[120-240]',
      's_weave@L3[220-520]',
      't_draft@L2[240-340]',
      's_inspect@L4[520-580]',
      't_weave@L3[520-820]',
      't_inspect@L4[820-880]',
    ],
    '可执行档期',
  );
});

check('同织机档期互不重叠且满足前置与投料约束', () => {
  const byLoom = new Map<string, { s: number; e: number; id: string }[]>();
  for (const e of result.entries) {
    byLoom.set(e.loomId, [...(byLoom.get(e.loomId) ?? []), { s: e.startMinute, e: e.endMinute, id: e.stepId }]);
  }
  for (const [loom, list] of byLoom) {
    const sorted = list.slice().sort((a, b) => a.s - b.s);
    for (let i = 1; i < sorted.length; i++) {
      assert(
        sorted[i].s >= sorted[i - 1].e,
        `织机 ${loom} 上工序 ${sorted[i - 1].id} 与 ${sorted[i].id} 档期重叠`,
      );
    }
  }
  const endOf = new Map(result.entries.map((e) => [e.stepId, e.endMinute]));
  const releaseOf = new Map(normalInput.orders.map((o) => [o.id, o.releaseMinute]));
  for (const step of normalInput.steps) {
    const self = result.entries.find((e) => e.stepId === step.id)!;
    for (const dep of step.dependsOn) {
      assert(self.startMinute >= endOf.get(dep)!, `工序 ${step.id} 开工早于前置 ${dep} 完工`);
    }
    assert(self.startMinute >= releaseOf.get(step.orderId)!, `工序 ${step.id} 开工早于订单投料时刻`);
  }
});

check('顺延依据可追溯：t_warp 被 s_warp 顺延 20 分钟', () => {
  const e = result.entries.find((x) => x.stepId === 't_warp')!;
  assertEqual(e.delay.readyMinute, 100, 't_warp 就绪时刻（订单投料）');
  assertEqual(e.delay.startMinute, 120, 't_warp 开工时刻');
  assertEqual(e.delay.delayMinutes, 20, 't_warp 顺延分钟数');
  assert(e.delay.reason.includes('s_warp'), `顺延依据未指向占用工序：${e.delay.reason}`);
  assert(e.delay.reason.includes('L1'), `顺延依据未指向织机：${e.delay.reason}`);
});

check('顺延依据可追溯：t_weave 被 s_weave 顺延 180 分钟', () => {
  const e = result.entries.find((x) => x.stepId === 't_weave')!;
  assertEqual(e.delay.readyMinute, 340, 't_weave 就绪时刻');
  assertEqual(e.delay.startMinute, 520, 't_weave 开工时刻');
  assertEqual(e.delay.delayMinutes, 180, 't_weave 顺延分钟数');
  assert(e.delay.reason.includes('s_weave'), `顺延依据未指向占用工序：${e.delay.reason}`);
  assert(e.delay.reason.includes('L3'), `顺延依据未指向织机：${e.delay.reason}`);
});

check('未顺延工序的顺延依据为空', () => {
  const e = result.entries.find((x) => x.stepId === 's_warp')!;
  assertEqual(e.delay.delayMinutes, 0, 's_warp 顺延分钟数');
  assertEqual(e.delay.reason, '', 's_warp 顺延原因应为空');
});

check('工时结论：织机忙闲与利用率', () => {
  const got = new Map(result.loomSummaries.map((s) => [s.loomId, s]));
  assertEqual(got.get('L1')!.busyMinutes, 240, 'L1 占用工时');
  assertEqual(got.get('L2')!.busyMinutes, 200, 'L2 占用工时');
  assertEqual(got.get('L3')!.busyMinutes, 600, 'L3 占用工时');
  assertEqual(got.get('L4')!.busyMinutes, 120, 'L4 占用工时');
  assertEqual(got.get('L1')!.idleMinutes, HORIZON - 240, 'L1 空闲工时');
  assertEqual(got.get('L4')!.idleMinutes, HORIZON - 120, 'L4 空闲工时');
  assertEqual(got.get('L4')!.utilization, Number((120 / HORIZON).toFixed(4)), 'L4 利用率');
});

check('工时结论：订单工时、完工与交期风险', () => {
  const got = new Map(result.orderSummaries.map((s) => [s.orderId, s]));
  assertEqual(got.get('O1')!.workMinutes, 580, 'O1 总工时');
  assertEqual(got.get('O1')!.makespanEnd, 580, 'O1 完工时刻');
  assertEqual(got.get('O2')!.workMinutes, 580, 'O2 总工时');
  assertEqual(got.get('O2')!.makespanEnd, 880, 'O2 完工时刻');
  assertEqual(got.get('O1')!.lateMinutes, 0, 'O1 逾期分钟数');
});

check('裁决记录覆盖每道工序且候选完整', () => {
  assertEqual(result.adjudications.length, normalInput.steps.length, '裁决记录条数');
  const draft = result.adjudications.find((a) => a.stepId === 's_draft')!;
  assertEqual(draft.candidates.length, 3, 's_draft 候选织机数（穿经被 3 台织机覆盖）');
  const selected = draft.candidates.filter((c) => c.outcome === 'selected');
  assertEqual(selected.length, 1, 's_draft 被选中织机数');
  assertEqual(selected[0].loomId, 'L2', 's_draft 选中织机（L2/L3 同优先级同空档 120，按 id 字典序）');
  for (const c of draft.candidates.filter((c) => c.outcome === 'rejected')) {
    assert(c.reason.length > 0, `候选 ${c.loomId} 缺少落选依据`);
  }
});

check('幂等：重复推演两次结果逐字节一致', () => {
  const again = runSchedule(normalInput);
  assertEqual(JSON.stringify(again.entries), JSON.stringify(result.entries), '重复推演档期');
});
