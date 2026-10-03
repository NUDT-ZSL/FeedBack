// 轨迹推演引擎：维护位置点、判定参数与缓存结论，支持
// - setPoints            初始载入（整目标全量分段）
// - correctPoint          单点修正（窗口化增量重推，只替换受影响分段）
// - updateParams          参数调整（参数影响全局 → 全量重推）
// - snapshot              当前结论快照
// - fullRecomputeSnapshot 从当前点集合+参数无缓存全量重推（用于一致性校验）
//
// 窗口化重推正确性依据（segmentation 的扫描是从左到右、因果的）：
// - 窗口从“旧分段边界”开始，窗口左侧的点未被修改，前缀扫描状态与全量一致，
//   故新全量结果在左边界处必然仍是分段边界；
// - 在窗口内，窗口化扫描与全量扫描处理完全相同的点序列，产出完全相同的段；
// - 当窗口右端新段与旧段内容指纹一致时，该段在旧结果中本就是边界，其后点未变，
//   尾部扫描状态一致 ⇒ 窗口外尾部逐段复用；
// - 否则向左侧/右侧各扩展一个旧分段后重试；扩展到整段数组时与全量完全相同。
// 因此增量结论 == 全量重推结论，而未变化分段保持同一对象引用（可被引用相等断言）。

import type {
  CompanionInterval,
  CompanionParams,
  EngineParams,
  EngineSnapshot,
  IncrementalReport,
  PositionPoint,
  Segment,
  SegmentationParams,
  ValidationIssue,
} from './types.ts';
import { segmentValidPoints, validatePoints } from './segmentation.ts';
import { detectCompanionshipForPair, pairKey } from './companionship.ts';

export type PointPatch = Partial<Pick<PositionPoint, 'timestamp' | 'lng' | 'lat'>>;
export type ParamsPatch = {
  segmentation?: Partial<SegmentationParams>;
  companionship?: Partial<CompanionParams>;
};

interface TargetState {
  points: PositionPoint[];
  segments: Segment[];
  validationIssues: ValidationIssue[];
  jitterIssues: ValidationIssue[];
}

interface FullSegmentation {
  segments: Segment[];
  validationIssues: ValidationIssue[];
  jitterIssues: ValidationIssue[];
}

export class TrajectoryEngine {
  private targets = new Map<string, TargetState>();
  private companions = new Map<string, CompanionInterval[]>();
  private params: EngineParams;
  private version = 0;

  constructor(params: EngineParams) {
    this.params = {
      segmentation: { ...params.segmentation },
      companionship: { ...params.companionship },
    };
  }

  get currentVersion(): number {
    return this.version;
  }

  /** 载入/替换一个目标的全部位置点，并只重推与该目标相关的同行对 */
  setPoints(targetId: string, points: PositionPoint[]): void {
    for (const point of points) {
      if (point.targetId !== targetId) {
        throw new Error(
          `setPoints("${targetId}") rejected: point "${point.id}" carries targetId "${point.targetId}"`,
        );
      }
    }
    const full = this.segmentTargetFull(targetId, points);
    this.targets.set(targetId, {
      points: points.map((p) => ({ ...p })),
      ...full,
    });
    for (const otherId of this.targets.keys()) {
      if (otherId !== targetId) this.recomputePair(targetId, otherId);
    }
    this.version++;
  }

  /**
   * 修正单个位置点。仅对该目标做窗口化分段重推；其他目标分段与无关同行对
   * 保持原对象引用。返回的 IncrementalReport 给出受影响/复用明细。
   */
  correctPoint(
    targetId: string,
    pointId: string,
    patch: PointPatch,
  ): IncrementalReport {
    const state = this.mustGet(targetId);
    const pointIndex = state.points.findIndex((p) => p.id === pointId);
    if (pointIndex === -1) {
      throw new Error(
        `correctPoint rejected: point "${pointId}" not found for target "${targetId}"`,
      );
    }

    const updated: PositionPoint = {
      ...state.points[pointIndex],
      ...patch,
      id: pointId,
      targetId,
    };
    state.points[pointIndex] = updated;
    this.version++;

    const oldSegments = state.segments;
    const oldById = new Map(oldSegments.map((s) => [s.id, s] as const));
    const { valid, issues: validationIssues } = validatePoints(state.points);

    let segments: Segment[];
    let jitterIssues: ValidationIssue[];
    let window: { lo: number; hi: number } | null = null;

    const containingIndex = oldSegments.findIndex((s) =>
      s.pointIds.includes(pointId),
    );

    if (containingIndex === -1) {
      // 该点此前因异常未参与任何分段：无法定位旧窗口，对该目标全量重推。
      const full = segmentValidPoints(valid, this.params.segmentation, targetId);
      segments = full.segments;
      jitterIssues = full.issues;
    } else {
      // 初始窗口：被修正点所在旧分段及其左右各一个分段。
      let lo = Math.max(0, containingIndex - 1);
      let hi = Math.min(oldSegments.length - 1, containingIndex + 1);

      // 若时间戳被修正到窗口之外，先把窗口扩展到覆盖其新位置。
      const newTs = Number.isFinite(updated.timestamp)
        ? updated.timestamp
        : null;
      if (newTs !== null) {
        while (lo > 0 && newTs < oldSegments[lo].startMs) lo--;
        while (hi < oldSegments.length - 1 && newTs > oldSegments[hi].endMs) hi++;
      }

      for (;;) {
        const t0 =
          newTs === null
            ? oldSegments[lo].startMs
            : Math.min(oldSegments[lo].startMs, newTs);
        const t1 =
          newTs === null
            ? oldSegments[hi].endMs
            : Math.max(oldSegments[hi].endMs, newTs);
        // 有效点时间戳单调不减，时间窗口等价于连续切片。
        const windowPoints = valid.filter(
          (p) => p.timestamp >= t0 && p.timestamp <= t1,
        );
        const local = segmentValidPoints(
          windowPoints,
          this.params.segmentation,
          targetId,
        );

        const first = local.segments[0];
        const last = local.segments[local.segments.length - 1];
        const leftConverged =
          lo === 0 || (first !== undefined && first.id === oldSegments[lo].id);
        const rightConverged =
          hi === oldSegments.length - 1 ||
          (last !== undefined && last.id === oldSegments[hi].id);

        if (leftConverged && rightConverged) {
          const spliced = [
            ...oldSegments.slice(0, lo),
            ...local.segments,
            ...oldSegments.slice(hi + 1),
          ];
          // 内容指纹相同的段映射回旧对象，保证“未受影响部分”引用稳定。
          segments = spliced.map((s) => oldById.get(s.id) ?? s);

          // 窗口内 jitter 重新判定，窗口外沿用旧记录，再按点序号排序，
          // 使其与全量重推的 issue 顺序逐字节一致。
          const inWindow = new Set(windowPoints.map((p) => p.id));
          const orderById = new Map(
            state.points.map((p, i) => [p.id, i] as const),
          );
          jitterIssues = [
            ...state.jitterIssues.filter(
              (issue) => !inWindow.has(issue.pointId),
            ),
            ...local.issues,
          ].sort(
            (a, b) =>
              (orderById.get(a.pointId) ?? 0) -
              (orderById.get(b.pointId) ?? 0),
          );
          window = { lo, hi };
          break;
        }

        if (!leftConverged) lo--;
        if (!rightConverged) hi++;
      }
    }

    const oldIds = new Set(oldSegments.map((s) => s.id));
    const newIds = new Set(segments.map((s) => s.id));
    const changedSegmentIds = segments
      .filter((s) => !oldIds.has(s.id))
      .map((s) => s.id);
    const removedSegmentIds = oldSegments
      .filter((s) => !newIds.has(s.id))
      .map((s) => s.id);
    const reusedSegmentIds = segments
      .filter((s) => oldIds.has(s.id))
      .map((s) => s.id);
    const segmentsChanged =
      changedSegmentIds.length > 0 || removedSegmentIds.length > 0;

    state.segments = segments;
    state.validationIssues = validationIssues;
    state.jitterIssues = jitterIssues;

    // 同行关系按目标对独立：只重推与被修正目标相关、且分段确实变化的对。
    const recomputedPairs: string[] = [];
    const reusedPairs: string[] = [];
    for (const key of this.allPairKeys()) {
      const touches = key.split('|').includes(targetId);
      if (touches && segmentsChanged) {
        const [a, b] = key.split('|');
        this.recomputePair(a, b);
        recomputedPairs.push(key);
      } else {
        reusedPairs.push(key);
      }
    }
    recomputedPairs.sort();
    reusedPairs.sort();

    return {
      version: this.version,
      affectedTargets: [targetId],
      changedSegmentIds,
      removedSegmentIds,
      reusedSegmentIds,
      recomputedPairs,
      reusedPairs,
      window,
      issues: [...validationIssues, ...jitterIssues],
    };
  }

  /** 判定参数调整：参数影响全体目标，全量重推；结论仍与 fullRecomputeSnapshot 一致 */
  updateParams(patch: ParamsPatch): IncrementalReport {
    this.params = {
      segmentation: {
        ...this.params.segmentation,
        ...(patch.segmentation ?? {}),
      },
      companionship: {
        ...this.params.companionship,
        ...(patch.companionship ?? {}),
      },
    };
    this.version++;

    const changedSegmentIds: string[] = [];
    const removedSegmentIds: string[] = [];
    const reusedSegmentIds: string[] = [];
    const affectedTargets: string[] = [];
    const allIssues: ValidationIssue[] = [];

    for (const [targetId, state] of this.targets) {
      const oldIds = new Set(state.segments.map((s) => s.id));
      const full = this.segmentTargetFull(targetId, state.points);
      const newIds = new Set(full.segments.map(s => s.id));
      changedSegmentIds.push(
        ...full.segments.filter((s) => !oldIds.has(s.id)).map((s) => s.id),
      );
      removedSegmentIds.push(
        ...state.segments.filter((s) => !newIds.has(s.id)).map((s) => s.id),
      );
      reusedSegmentIds.push(
        ...full.segments.filter((s) => oldIds.has(s.id)).map((s) => s.id),
      );
      state.segments = full.segments;
      state.validationIssues = full.validationIssues;
      state.jitterIssues = full.jitterIssues;
      affectedTargets.push(targetId);
      allIssues.push(...full.validationIssues, ...full.jitterIssues);
    }
    affectedTargets.sort();

    const recomputedPairs = this.allPairKeys();
    for (const key of recomputedPairs) {
      const [a, b] = key.split('|');
      this.recomputePair(a, b);
    }

    return {
      version: this.version,
      affectedTargets,
      changedSegmentIds,
      removedSegmentIds,
      reusedSegmentIds,
      recomputedPairs,
      reusedPairs: [],
      window: null,
      issues: allIssues,
    };
  }

  /** 当前缓存结论快照（未变化部分为同一对象引用） */
  snapshot(): EngineSnapshot {
    const segmentsByTarget: Record<string, Segment[]> = {};
    const issuesByTarget: Record<string, ValidationIssue[]> = {};
    for (const targetId of [...this.targets.keys()].sort()) {
      const state = this.targets.get(targetId) as TargetState;
      segmentsByTarget[targetId] = state.segments;
      issuesByTarget[targetId] = [
        ...state.validationIssues,
        ...state.jitterIssues,
      ];
    }
    const companions: Record<string, CompanionInterval[]> = {};
    for (const key of this.allPairKeys()) {
      companions[key] = this.companions.get(key) ?? [];
    }
    return {
      version: this.version,
      params: {
        segmentation: { ...this.params.segmentation },
        companionship: { ...this.params.companionship },
      },
      segmentsByTarget,
      issuesByTarget,
      companions,
    };
  }

  /**
   * 无缓存全量重推：只用当前保存的点集合 + 当前参数，从零计算，不读取/修改任何缓存。
   * 与 snapshot() 做 deep-equal 即可验证增量重推与全量重推结论一致。
   */
  fullRecomputeSnapshot(): EngineSnapshot {
    const segmentsByTarget: Record<string, Segment[]> = {};
    const issuesByTarget: Record<string, ValidationIssue[]> = {};
    const freshSegments = new Map<string, Segment[]>();

    for (const targetId of [...this.targets.keys()].sort()) {
      const state = this.targets.get(targetId) as TargetState;
      const full = this.segmentTargetFull(targetId, state.points);
      freshSegments.set(targetId, full.segments);
      segmentsByTarget[targetId] = full.segments;
      issuesByTarget[targetId] = [
        ...full.validationIssues,
        ...full.jitterIssues,
      ];
    }

    const companions: Record<string, CompanionInterval[]> = {};
    for (const key of this.allPairKeys()) {
      const [a, b] = key.split('|');
      companions[key] = detectCompanionshipForPair(
        a,
        freshSegments.get(a) ?? [],
        b,
        freshSegments.get(b) ?? [],
        this.params.companionship,
      );
    }

    return {
      version: this.version,
      params: {
        segmentation: { ...this.params.segmentation },
        companionship: { ...this.params.companionship },
      },
      segmentsByTarget,
      issuesByTarget,
      companions,
    };
  }

  private segmentTargetFull(
    targetId: string,
    points: PositionPoint[],
  ): FullSegmentation {
    const { valid, issues: validationIssues } = validatePoints(points);
    const { segments, issues: jitterIssues } = segmentValidPoints(
      valid,
      this.params.segmentation,
      targetId,
    );
    return { segments, validationIssues, jitterIssues };
  }

  private recomputePair(a: string, b: string): void {
    const segmentsA = this.mustGet(a).segments;
    const segmentsB = this.mustGet(b).segments;
    this.companions.set(
      pairKey(a, b),
      detectCompanionshipForPair(
        a,
        segmentsA,
        b,
        segmentsB,
        this.params.companionship,
      ),
    );
  }

  private allPairKeys(): string[] {
    const ids = [...this.targets.keys()].sort();
    const keys: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        keys.push(pairKey(ids[i], ids[j]));
      }
    }
    return keys;
  }

  private mustGet(targetId: string): TargetState {
    const state = this.targets.get(targetId);
    if (state === undefined) {
      throw new Error(`unknown target "${targetId}"`);
    }
    return state;
  }
}
