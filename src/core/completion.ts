import type { BodyCounters, MomentSnapshot, RunStats } from "./types.js";

/**
 * 完成度累计器。
 *
 * 只累计整数计数，任何比率（完成度）都在读取时由整数换算，
 * 因此连续推进任意多时刻都不会产生浮点累积漂移；
 * 同时计数直接来自每个时刻快照中的可见性判定结果，
 * 保证“不可见的星体绝不计入完成度”。
 */
export class CompletionAccumulator {
  private readonly counters: BodyCounters[];
  private readonly indexById: Map<string, number>;
  private momentCount = 0;

  constructor(bodyIds: readonly string[]) {
    this.counters = bodyIds.map((id) => ({
      id,
      moments: 0,
      visibleMoments: 0,
      belowHorizonMoments: 0,
      occludedMoments: 0,
    }));
    this.indexById = new Map(bodyIds.map((id, i) => [id, i]));
  }

  /** 消费一个时刻快照，按其中每个星体的可见性判定累计整数计数。 */
  record(snapshot: MomentSnapshot): void {
    this.momentCount += 1;
    for (const body of snapshot.bodies) {
      const index = this.indexById.get(body.id);
      if (index === undefined) {
        throw new Error(`未知星体 id: ${body.id}`);
      }
      const counter = this.counters[index];
      counter.moments += 1;
      if (body.status === "visible") {
        counter.visibleMoments += 1;
      } else if (body.status === "below-horizon") {
        counter.belowHorizonMoments += 1;
      } else {
        counter.occludedMoments += 1;
      }
    }
  }

  /** 汇总统计：比率为整数计数在读取时的换算结果。 */
  stats(): RunStats {
    const perBody = this.counters.map((c) => ({ ...c }));
    const totalVisible = perBody.reduce((sum, c) => sum + c.visibleMoments, 0);
    const totalInvisible = perBody.reduce(
      (sum, c) => sum + c.belowHorizonMoments + c.occludedMoments,
      0,
    );
    const bodyCount = perBody.length;
    const denominator = this.momentCount * bodyCount;
    return {
      momentCount: this.momentCount,
      bodyCount,
      totalVisible,
      totalInvisible,
      overallCompletion: denominator === 0 ? 0 : totalVisible / denominator,
      perBody,
    };
  }
}

/** 单时刻完成度：可见星体数 / 星体总数。 */
export function completionOf(visibleCount: number, bodyCount: number): number {
  return bodyCount === 0 ? 0 : visibleCount / bodyCount;
}
