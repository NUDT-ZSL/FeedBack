import type { DerivationResult, Explanation } from './types.ts';

/** 解释某项任务为何排在当前位置：依据可追溯到具体来源。 */
export function explain(result: DerivationResult, taskId: string): Explanation {
  const task = result.tasks[taskId];
  if (!task) {
    return {
      taskId,
      scheduled: false,
      orderIndex: null,
      est: null,
      finish: null,
      onCriticalPath: false,
      reasons: [`任务 ${taskId} 不存在于当前任务集合中`],
    };
  }
  const reasons: string[] = [];

  if (task.durationConflict) {
    reasons.push(`耗时存在多来源冲突且未裁决，完成时刻无法确定`);
  } else if (task.duration !== null) {
    const from = task.durationSources.join('、');
    reasons.push(`耗时 ${task.duration}，来源：${from}`);
  }

  for (const dep of task.deps) {
    const depResult = result.tasks[dep.id];
    const finishText = depResult?.finish === null || depResult === undefined ? '完成时刻未定' : `完成于 ${depResult.finish}`;
    reasons.push(`依赖 ${dep.id}（${finishText}），依据来源：${dep.sources.join('、')}`);
  }
  for (const dep of task.optionalDeps) {
    reasons.push(`可选依赖 ${dep.id}（不约束顺序与时刻），来源：${dep.sources.join('、')}`);
  }
  for (const dep of task.missingDeps) {
    reasons.push(`依赖 ${dep.id} 指向不存在的任务，已保留待裁决，来源：${dep.sources.join('、')}`);
  }

  if (task.unscheduledReason !== null) {
    reasons.push(`无法调度：${task.unscheduledReason}`);
  } else if (task.orderIndex !== null) {
    if (task.gatedBy.length > 0 && task.est !== null) {
      reasons.push(`最早开始时刻 ${task.est} 由 ${task.gatedBy.join('、')} 的完成时刻决定`);
    } else if (task.est !== null) {
      reasons.push(`无前置依赖，最早开始时刻为 ${task.est}`);
    }
    if (task.est === null) {
      reasons.push(`存在耗时未确定的依赖，开始时刻待定`);
    }
    if (task.readyWith.length > 0) {
      reasons.push(
        `与 ${task.readyWith.join('、')} 同时就绪，按任务标识字典序确定先后，故排在第 ${task.orderIndex + 1} 位`,
      );
    } else {
      reasons.push(`就绪时无其它竞争任务，排在第 ${task.orderIndex + 1} 位`);
    }
  }

  if (task.onCriticalPath) {
    reasons.push(`位于关键路径上，其延误将直接推迟整体完工时刻 ${result.makespan}`);
  }

  return {
    taskId,
    scheduled: task.orderIndex !== null,
    orderIndex: task.orderIndex,
    est: task.est,
    finish: task.finish,
    onCriticalPath: task.onCriticalPath,
    reasons,
  };
}
