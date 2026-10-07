import {
  DivinationKernel,
  type DivinationResult,
  type KernelEvent,
  type KernelState,
} from './divinationKernel.ts';

export interface BatchStep {
  index: number;
  event: KernelEvent;
  state: KernelState;
  result: DivinationResult | null;
  ignored: boolean;
}

export interface BatchReport {
  steps: BatchStep[];
  results: DivinationResult[];
  finalState: KernelState;
}

/**
 * 统一的离线批量运行入口：
 * 将一串带注入时间戳的内核事件依次投递给一个全新内核，
 * 逐步记录可观察状态快照与推演结果。
 * 不依赖浏览器、真实时钟与任何随机源，同样的事件序列产出完全一致、可复现。
 */
export function runBatch(events: KernelEvent[]): BatchReport {
  const kernel = new DivinationKernel();
  const steps: BatchStep[] = events.map((event, index) => {
    const outcome = kernel.dispatch(event);
    return {
      index,
      event,
      state: outcome.state,
      result: outcome.result,
      ignored: outcome.ignored,
    };
  });
  return {
    steps,
    results: steps
      .map((step) => step.result)
      .filter((result): result is DivinationResult => result !== null),
    finalState: kernel.getState(),
  };
}
