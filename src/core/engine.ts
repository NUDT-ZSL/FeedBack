import type { BodySpec, MomentSnapshot, RunResult } from "./types.js";
import { CompletionAccumulator, completionOf } from "./completion.js";
import { evaluateVisibilityAt } from "./visibility.js";

/**
 * 浑天仪推演引擎（与 Three.js / 浏览器渲染完全解耦）。
 *
 * - snapshotAt(t) 是时间的纯函数：不维护任何跨时刻可变状态，
 *   同一时刻重复推演、回退后再前进，结果逐位一致；
 * - run(times) 顺序消费任意时间序列（允许回退/重访），
 *   统计只累计整数计数，长时间推进无浮点累积漂移；
 * - 可见性判定与完成度统计消费同一份快照，二者天然吻合。
 */
export class DeductionEngine {
  private readonly bodyIds: string[];

  constructor(private readonly bodies: readonly BodySpec[]) {
    this.bodyIds = bodies.map((b) => b.id);
  }

  get bodySpecs(): readonly BodySpec[] {
    return this.bodies;
  }

  /** 推演单个时刻：位置 + 可见性 + 单时刻完成度。 */
  snapshotAt(t: number): MomentSnapshot {
    const bodyStates = evaluateVisibilityAt(this.bodies, t);
    const visibleCount = bodyStates.reduce(
      (count, state) => (state.status === "visible" ? count + 1 : count),
      0,
    );
    return {
      time: t,
      bodies: bodyStates,
      visibleCount,
      completion: completionOf(visibleCount, this.bodies.length),
    };
  }

  /**
   * 批量推演时间序列（序列允许回退、重复访问同一时刻）。
   * 返回每个时刻的快照与全程整数计数统计。
   */
  run(times: readonly number[]): RunResult {
    const snapshots: MomentSnapshot[] = [];
    const accumulator = new CompletionAccumulator(this.bodyIds);
    for (const t of times) {
      const snapshot = this.snapshotAt(t);
      snapshots.push(snapshot);
      accumulator.record(snapshot);
    }
    return { snapshots, stats: accumulator.stats() };
  }
}
