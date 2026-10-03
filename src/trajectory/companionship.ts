// 同行关系识别。
//
// 确定性契约：
// 1) 只依据两个目标各自的“停留段”判定：时间区间相交（含端点接触）且
//    重叠时长 >= minOverlapMs、停留锚点距离 <= maxDistanceMeters 即同行。
//    部分重叠与完全包含走同一条区间求交规则，只是交集形状不同，判定一致。
// 2) 同一对目标的多次相交候选按起始时间排序，间隔 <= gapToleranceMs 时合并。
// 3) 纯函数；目标对按 targetId 排序（pairKey），输出顺序确定。

import type {
  CompanionInterval,
  CompanionParams,
  Segment,
} from './types.ts';
import { haversineMeters } from './segmentation.ts';

/** 规范化目标对键：两个 ID 排序后以 "|" 连接，与调用方向无关 */
export function pairKey(targetA: string, targetB: string): string {
  return [targetA, targetB].sort().join('|');
}

interface RawInterval {
  startMs: number;
  endMs: number;
}

/** 计算一对目标的全部同行区间（部分重叠/完全包含同规则） */
export function detectCompanionshipForPair(
  targetA: string,
  segmentsA: Segment[],
  targetB: string,
  segmentsB: Segment[],
  params: CompanionParams,
): CompanionInterval[] {
  const staysA = segmentsA.filter((s) => s.kind === 'stay');
  const staysB = segmentsB.filter((s) => s.kind === 'stay');
  const candidates: RawInterval[] = [];

  for (const stayA of staysA) {
    for (const stayB of staysB) {
      const startMs = Math.max(stayA.startMs, stayB.startMs);
      const endMs = Math.min(stayA.endMs, stayB.endMs);
      // endMs < startMs 为不相交；重叠不足 minOverlapMs 也排除。
      if (endMs - startMs < params.minOverlapMs) continue;

      const anchorA = stayA.anchor;
      const anchorB = stayB.anchor;
      if (anchorA === null || anchorB === null) continue;
      const distance = haversineMeters(
        anchorA.lng,
        anchorA.lat,
        anchorB.lng,
        anchorB.lat,
      );
      if (distance > params.maxDistanceMeters) continue;

      candidates.push({ startMs, endMs });
    }
  }

  candidates.sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );

  const merged: RawInterval[] = [];
  for (const candidate of candidates) {
    const previous = merged[merged.length - 1];
    if (
      previous !== undefined &&
      candidate.startMs - previous.endMs <= params.gapToleranceMs
    ) {
      previous.endMs = Math.max(previous.endMs, candidate.endMs);
    } else {
      merged.push({ ...candidate });
    }
  }

  const [lo, hi] = [targetA, targetB].sort();
  return merged.map((interval) => ({
    id: `comp:${lo}:${hi}:${interval.startMs}:${interval.endMs}`,
    targetA: lo,
    targetB: hi,
    startMs: interval.startMs,
    endMs: interval.endMs,
  }));
}

/** 全量同行识别：枚举排序后的所有目标对（含无同行关系的空数组，保证结构稳定） */
export function detectCompanionship(
  segmentsByTarget: ReadonlyMap<string, Segment[]>,
  params: CompanionParams,
): Map<string, CompanionInterval[]> {
  const targetIds = [...segmentsByTarget.keys()].sort();
  const result = new Map<string, CompanionInterval[]>();
  for (let i = 0; i < targetIds.length; i++) {
    for (let j = i + 1; j < targetIds.length; j++) {
      const a = targetIds[i];
      const b = targetIds[j];
      result.set(
        pairKey(a, b),
        detectCompanionshipForPair(
          a,
          segmentsByTarget.get(a) ?? [],
          b,
          segmentsByTarget.get(b) ?? [],
          params,
        ),
      );
    }
  }
  return result;
}
