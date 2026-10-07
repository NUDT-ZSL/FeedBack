/**
 * 输入校验：在排产前暴露依赖闭环、指向缺失、能力覆盖不足与优先级冲突。
 * error 级发现将拒绝排产；warning 级发现（优先级冲突）进入裁决流程并留痕。
 */
import type { Finding, SchedulingInput } from './types.ts';

export function validateInput(input: SchedulingInput): Finding[] {
  const findings: Finding[] = [];
  const loomIds = new Set<string>();
  const orderIds = new Set<string>();
  const stepIds = new Set<string>();

  for (const loom of input.looms) {
    if (!loom.id) {
      findings.push(err('INVALID_FIELD', '织机存在空 id', []));
    } else if (loomIds.has(loom.id)) {
      findings.push(err('DUPLICATE_ID', `织机 id 重复：${loom.id}`, [loom.id]));
    }
    loomIds.add(loom.id);
    if (!(loom.dailyCapacityMinutes > 0)) {
      findings.push(err('INVALID_FIELD', `织机 ${loom.id} 日产能必须为正数`, [loom.id]));
    }
  }
  for (const order of input.orders) {
    if (orderIds.has(order.id)) {
      findings.push(err('DUPLICATE_ID', `订单 id 重复：${order.id}`, [order.id]));
    }
    orderIds.add(order.id);
    if (!(order.releaseMinute >= 0) || !(order.dueMinute >= 0)) {
      findings.push(err('INVALID_FIELD', `订单 ${order.id} 的投料/交期时刻非法`, [order.id]));
    }
  }
  for (const step of input.steps) {
    if (stepIds.has(step.id)) {
      findings.push(err('DUPLICATE_ID', `工序 id 重复：${step.id}`, [step.id]));
    }
    stepIds.add(step.id);
    if (!(step.standardMinutes > 0)) {
      findings.push(err('INVALID_FIELD', `工序 ${step.id} 标准工时必须为正数`, [step.id]));
    }
  }

  // 引用完整性
  for (const cap of input.capabilities) {
    if (!loomIds.has(cap.loomId)) {
      findings.push(err('MISSING_LOOM_REF', `能力记录指向不存在的织机 ${cap.loomId}（工序类型 ${cap.processType}）`, [cap.loomId]));
    }
  }
  for (const step of input.steps) {
    if (!orderIds.has(step.orderId)) {
      findings.push(err('MISSING_ORDER_REF', `工序 ${step.id} 指向不存在的订单 ${step.orderId}`, [step.id, step.orderId]));
    }
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        findings.push(err('MISSING_STEP_REF', `工序 ${step.id} 的前置依赖指向不存在的工序 ${dep}`, [step.id, dep]));
      }
    }
  }

  // 依赖闭环检测（DFS 三色标记，输出具体闭环路径）
  const depsOf = new Map(input.steps.map((s) => [s.id, s.dependsOn.filter((d) => stepIds.has(d))]));
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  const dfs = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const dep of depsOf.get(node) ?? []) {
      const st = state.get(dep) ?? 0;
      if (st === 0) {
        dfs(dep);
      } else if (st === 1) {
        const cyclePath = [...stack.slice(stack.indexOf(dep)), dep];
        const key = [...cyclePath].sort().join('|');
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          findings.push(
            err('DEPENDENCY_CYCLE', `检测到依赖闭环：${cyclePath.join(' -> ')}`, [...new Set(cyclePath)]),
          );
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const step of input.steps) {
    if ((state.get(step.id) ?? 0) === 0) dfs(step.id);
  }

  // 能力覆盖：每个工序类型至少要有一台真实存在的织机承接
  const capByType = new Map<string, { loomId: string; priority: number }[]>();
  for (const cap of input.capabilities) {
    if (!loomIds.has(cap.loomId)) continue;
    const list = capByType.get(cap.processType) ?? [];
    list.push(cap);
    capByType.set(cap.processType, list);
  }
  const usedTypes = new Set(input.steps.map((s) => s.processType));
  for (const type of usedTypes) {
    const list = capByType.get(type) ?? [];
    if (list.length === 0) {
      const stepRefs = input.steps.filter((s) => s.processType === type).map((s) => s.id);
      findings.push(err('CAPABILITY_GAP', `工序类型 ${type} 没有任何织机具备承接能力`, stepRefs));
      continue;
    }
    // 优先级冲突：同一工序类型被多台织机以不同优先级覆盖 → 可裁决，记录 warning
    const priorities = new Set(list.map((c) => c.priority));
    if (list.length > 1 && priorities.size > 1) {
      const detail = list
        .slice()
        .sort((a, b) => a.priority - b.priority || a.loomId.localeCompare(b.loomId))
        .map((c) => `${c.loomId}(优先级${c.priority})`)
        .join('、');
      findings.push({
        severity: 'warning',
        code: 'PRIORITY_CONFLICT',
        message: `工序类型 ${type} 被多台织机以不同优先级覆盖：${detail}；将按优先级升序、织机 id 字典序裁决`,
        refs: list.map((c) => c.loomId),
      });
    }
  }

  return findings;
}

function err(code: Finding['code'], message: string, refs: string[]): Finding {
  return { severity: 'error', code, message, refs };
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
