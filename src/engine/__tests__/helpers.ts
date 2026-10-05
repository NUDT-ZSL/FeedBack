import type { EngineResult, IntervalResult } from '../types';

/**
 * 剥离执行路径与血缘标记（reusedFromCache / basis 版本号），
 * 只保留结论本体：积压曲线、触发时刻、处置结论及其解释。
 * basis 记录的是"该区间结果实际被计算时"的版本，复用区间保留原始
 * 计算时的版本属正常血缘，不影响结论一致性。
 */
export function comparable(result: EngineResult): unknown {
  const stripDecision = (d: EngineResult['decisions'][number]) => {
    const { basis, ...rest } = d;
    void basis;
    return rest;
  };
  return {
    ...result,
    decisions: result.decisions.map(stripDecision),
    intervals: result.intervals.map((r: IntervalResult) => {
      const { reusedFromCache, basis, ...rest } = r;
      void reusedFromCache;
      void basis;
      return { ...rest, decisions: r.decisions.map(stripDecision) };
    }),
  };
}

export function assertSamePath(actual: EngineResult, expected: EngineResult, label: string) {
  const a = JSON.stringify(comparable(actual));
  const b = JSON.stringify(comparable(expected));
  if (a !== b) {
    throw new Error(`${label}：逐区间重推与整体重推结果不一致`);
  }
}
