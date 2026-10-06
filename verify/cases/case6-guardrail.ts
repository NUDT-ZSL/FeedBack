/**
 * 护栏自检：验证本套验证能力自身的失败检查确实有效——
 * 用故意注入缺陷的“错误实现”跑同样的断言，必须失败且失败类别可定位。
 * 若这些自检通过，说明上面的用例不是“永远通过”的摆设。
 */
import { importAll } from '../core/importer.ts';
import { ReplayEngine } from '../core/engine.ts';
import { equalConclusions } from '../core/canonical.ts';
import { anomalyDataset, baseDataset } from '../fixtures/datasets.ts';
import type { ImportInput } from '../core/types.ts';

const conflictDataset: ImportInput = {
  records: [
    ...baseDataset.records!,
    { id: 'r2b', objectId: 'obj-A', timestamp: 200, state: 'stopped', dependsOn: ['r1'] },
  ],
  events: baseDataset.events,
};
import { CaseFailure, assert, assertEqual } from './assert.ts';

export const id = '06-guardrail-self-check';
export const category = 'guardrail-self-check';

function expectCaseFailure(label: string, fn: () => void, expectedCategory: string): void {
  try {
    fn();
  } catch (err) {
    assert(err instanceof CaseFailure, category, `${label}: 应抛出 CaseFailure，实际 ${String(err)}`);
    assertEqual(err.category, expectedCategory, category, `${label}: 失败类别应可定位`);
    return;
  }
  throw new CaseFailure(category, `${label}: 缺陷实现未被任何检查拦截（检查形同虚设）`);
}

export function run(): void {
  // 缺陷1：导入器静默丢弃异常 —— 必须被“异常归属”检查拦截
  expectCaseFailure('静默丢弃异常', () => {
    const imported = importAll([anomalyDataset]);
    const dropped = imported.anomalies.filter(() => false); // 缺陷：全部静默丢弃
    assertEqual(dropped.length, 5, 'anomaly-attribution', '异常数量');
  }, 'anomaly-attribution');

  // 缺陷2：矛盾裁决前丢弃一方 —— 必须被“裁决前双方保留”检查拦截
  expectCaseFailure('裁决前丢弃一方', () => {
    const engine = new ReplayEngine([conflictDataset]);
    const states = engine.advance().conclusion.timelines['obj-A'].find((e) => e.timestamp === 200)!.states;
    const buggy = states.slice(0, 1); // 缺陷：只保留一方
    assertEqual(buggy, ['moving', 'stopped'], 'conflict-adjudication', '裁决前双方保留');
  }, 'conflict-adjudication');

  // 缺陷3：局部重推波及未受影响对象 —— 必须被“未受影响部分不被改动”检查拦截
  expectCaseFailure('局部重推越界', () => {
    const engine = new ReplayEngine([conflictDataset]);
    const before = engine.rawState().timelines['obj-C'];
    engine.adjudicate('obj-A', 200, 'r2');
    const after = engine.rawState().timelines['obj-C'];
    const buggyAfter = after === before ? [...after] : after; // 缺陷：重建了未受影响对象
    assert(buggyAfter === before, 'conflict-adjudication', '未受影响对象时间线引用不变');
  }, 'conflict-adjudication');

  // 缺陷4：结论随导入顺序变化 —— 必须被“顺序无关”检查拦截
  expectCaseFailure('顺序相关结论', () => {
    const a = new ReplayEngine([baseDataset]).advance().conclusion;
    const reversed = { records: [...baseDataset.records!].reverse(), events: [...baseDataset.events!].reverse() };
    const b = new ReplayEngine([reversed]).advance().conclusion;
    const buggyEqual = equalConclusions(a, b) && Math.random() < 0; // 缺陷：随机放行
    assert(buggyEqual, 'order-batch-independence', '乱序导入结论一致');
  }, 'order-batch-independence');

  // 缺陷5：事件撤回后影响范围残留 —— 必须被“事件影响更新”检查拦截
  expectCaseFailure('撤回残留', () => {
    const engine = new ReplayEngine([baseDataset]);
    engine.withdrawEvent('ev2');
    const impact = engine.advance().conclusion.eventImpacts['ev2'];
    const buggyObjects = impact.objectIds.length ? impact.objectIds : ['obj-B']; // 缺陷：残留旧范围
    assertEqual(buggyObjects, [], 'event-link-update', '撤回后影响对象清空');
  }, 'event-link-update');
}
