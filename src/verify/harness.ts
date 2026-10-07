import type { Assignment, Pin, Plan } from '../scheduling/types.ts';

/**
 * 验证失败分类：
 * - SCHEDULE：排布结论错（设备/起止时间不一致、钉住约束被破坏、错误码不符）
 * - COST：代价结论错（单工序代价或总代价不一致）
 * - SCOPE：受影响范围漏推（发生变化的工序未出现在受影响集合中）
 */
export type FailureClass = 'SCHEDULE' | 'COST' | 'SCOPE';

export interface Finding {
  scenario: string;
  class: FailureClass;
  message: string;
}

export function formatAssignment(assignment: Assignment): string {
  return `${assignment.opId}@${assignment.deviceId}[${assignment.start},${assignment.end}) cost=${assignment.cost}`;
}

/** 比较两份排布结论，返回排布差异与代价差异（分别对应 SCHEDULE / COST） */
export function diffPlans(
  scenario: string,
  expected: Plan,
  actual: Plan,
  label: string,
): Finding[] {
  const findings: Finding[] = [];
  const actualByOp = new Map(actual.assignments.map((item) => [item.opId, item]));

  for (const expectedItem of expected.assignments) {
    const actualItem = actualByOp.get(expectedItem.opId);
    if (!actualItem) {
      findings.push({
        scenario,
        class: 'SCHEDULE',
        message: `${label}: 工序 ${expectedItem.opId} 缺失`,
      });
      continue;
    }
    if (
      expectedItem.deviceId !== actualItem.deviceId ||
      expectedItem.start !== actualItem.start ||
      expectedItem.end !== actualItem.end
    ) {
      findings.push({
        scenario,
        class: 'SCHEDULE',
        message: `${label}: 工序 ${expectedItem.opId} 排布不一致，期望 ${formatAssignment(expectedItem)}，实际 ${formatAssignment(actualItem)}`,
      });
    }
    if (expectedItem.cost !== actualItem.cost) {
      findings.push({
        scenario,
        class: 'COST',
        message: `${label}: 工序 ${expectedItem.opId} 代价不一致，期望 ${expectedItem.cost}，实际 ${actualItem.cost}`,
      });
    }
  }
  for (const actualItem of actual.assignments) {
    if (!expected.assignments.some((item) => item.opId === actualItem.opId)) {
      findings.push({
        scenario,
        class: 'SCHEDULE',
        message: `${label}: 多出未预期的工序 ${actualItem.opId}`,
      });
    }
  }
  if (expected.totalCost !== actual.totalCost) {
    findings.push({
      scenario,
      class: 'COST',
      message: `${label}: 总代价不一致，期望 ${expected.totalCost}，实际 ${actual.totalCost}`,
    });
  }
  return findings;
}

/**
 * 受影响范围核对：相对基线发生排布或代价变化的工序，必须出现在
 * “受影响集合 ∪ 钉住集合”中，否则记为 SCOPE（受影响范围漏推）。
 */
export function checkScope(
  scenario: string,
  basePlan: Plan,
  nextPlan: Plan,
  affected: string[],
  pins: Pin[],
): Finding[] {
  const findings: Finding[] = [];
  const covered = new Set([...affected, ...pins.map((pin) => pin.opId)]);
  const nextByOp = new Map(nextPlan.assignments.map((item) => [item.opId, item]));

  for (const baseItem of basePlan.assignments) {
    const nextItem = nextByOp.get(baseItem.opId);
    if (!nextItem) {
      findings.push({
        scenario,
        class: 'SCOPE',
        message: `工序 ${baseItem.opId} 在重推结果中缺失，且不在受影响集合内`,
      });
      continue;
    }
    const changed =
      baseItem.deviceId !== nextItem.deviceId ||
      baseItem.start !== nextItem.start ||
      baseItem.cost !== nextItem.cost;
    if (changed && !covered.has(baseItem.opId)) {
      findings.push({
        scenario,
        class: 'SCOPE',
        message: `工序 ${baseItem.opId} 的排布/代价发生变化（${formatAssignment(baseItem)} -> ${formatAssignment(nextItem)}），但未包含在受影响集合中`,
      });
    }
  }
  return findings;
}

/** 钉住约束核对：裁决保留的工序在结果中必须原样出现 */
export function checkPinsPreserved(scenario: string, pins: Pin[], plan: Plan): Finding[] {
  const findings: Finding[] = [];
  for (const pin of pins) {
    const item = plan.assignments.find((assignment) => assignment.opId === pin.opId);
    if (!item) {
      findings.push({
        scenario,
        class: 'SCHEDULE',
        message: `钉住的工序 ${pin.opId} 在重推结果中缺失`,
      });
      continue;
    }
    if (item.deviceId !== pin.deviceId || item.start !== pin.start) {
      findings.push({
        scenario,
        class: 'SCHEDULE',
        message: `钉住的工序 ${pin.opId} 被改动：期望 ${pin.deviceId}@${pin.start}，实际 ${item.deviceId}@${item.start}`,
      });
    }
  }
  return findings;
}
