/**
 * 拆装步骤状态机。
 *
 * 每次操作都基于「当前部件状态 + 依赖关系」推导出：
 *   - 该操作是否可执行（无效操作不改变任何状态与进度结论）
 *   - 每个部件拆/装步骤的状态与受阻原因
 *   - 进度结论（仅由部件状态推导的纯函数）
 *
 * 状态推进采用局部重推：一次操作只重推受影响闭包内的部件步骤，
 * 并保证与整体重推（deriveAll）结论一致。
 */
import { analyzeGraph, affectedClosure, type GraphAnalysis } from './graph.ts';
import type {
  BlockReason,
  MountState,
  Operation,
  OperationOutcome,
  PartId,
  PartSpec,
  Progress,
  StepKind,
  StepSnapshot,
  StepState,
} from './types.ts';

function makeReason(code: BlockReason['code'], related: PartId[], message: string): BlockReason {
  return { code, related: [...related].sort(), message };
}

export class AssemblyMachine {
  private readonly specs: PartSpec[];
  private readonly analysis: GraphAnalysis;
  private readonly nameOf: Record<PartId, string>;
  private mountStates: Record<PartId, MountState> = {};
  private stepCache: Record<PartId, { disassemble: StepState; assemble: StepState }> = {};
  private lastRecomputed: PartId[] = [];
  private historyLength = 0;

  constructor(specs: PartSpec[]) {
    this.specs = specs;
    this.analysis = analyzeGraph(specs);
    this.nameOf = {};
    for (const spec of specs) this.nameOf[spec.id] = spec.name;
    for (const id of this.analysis.ids) this.mountStates[id] = 'installed';
    // 初始整体重推
    this.recompute(this.analysis.ids);
  }

  private label(partId: PartId): string {
    return this.nameOf[partId] ?? partId;
  }

  /** 推导单个部件的单个步骤（纯函数，不读写缓存） */
  private deriveStep(partId: PartId, kind: StepKind): StepState {
    const state = this.mountStates[partId];
    const name = this.label(partId);
    const unreachable = this.analysis.unreachableKind[partId];

    if (kind === 'disassemble') {
      if (state !== 'installed') {
        return { partId, kind, status: 'done', blockedBy: null };
      }
      if (unreachable === 'dependency-cycle') {
        const members = this.analysis.cycleReach[partId];
        return {
          partId, kind, status: 'blocked',
          blockedBy: makeReason('dependency-cycle', members,
            `「${name}」的拆解依赖成环（${members.map((m) => this.label(m)).join('、')}），不可达`),
        };
      }
      if (unreachable === 'missing-dependency') {
        const missing = this.analysis.missingReach[partId];
        return {
          partId, kind, status: 'blocked',
          blockedBy: makeReason('missing-dependency', missing,
            `「${name}」的拆解依赖指向缺失部件（${missing.join('、')}），不可达`),
        };
      }
      const unmet = this.analysis.depsClosure[partId].filter(
        (dep) => this.mountStates[dep] !== 'removed',
      );
      if (unmet.length === 0) {
        return { partId, kind, status: 'ready', blockedBy: null };
      }
      return {
        partId, kind, status: 'blocked',
        blockedBy: makeReason('waiting-dependency', unmet,
          `需先拆下：${unmet.map((dep) => this.label(dep)).join('、')}`),
      };
    }

    // kind === 'assemble'
    if (state === 'assembled') {
      return { partId, kind, status: 'done', blockedBy: null };
    }
    if (state === 'installed') {
      return {
        partId, kind, status: 'blocked',
        blockedBy: makeReason('not-yet-disassembled', [partId], `「${name}」尚未拆下，无法装回`),
      };
    }
    if (unreachable === 'dependency-cycle') {
      const members = this.analysis.cycleReach[partId];
      return {
        partId, kind, status: 'blocked',
        blockedBy: makeReason('dependency-cycle', members,
          `「${name}」的装配依赖成环（${members.map((m) => this.label(m)).join('、')}），不可达`),
      };
    }
    if (unreachable === 'missing-dependency') {
      const missing = this.analysis.missingReach[partId];
      return {
        partId, kind, status: 'blocked',
        blockedBy: makeReason('missing-dependency', missing,
          `「${name}」的装配依赖指向缺失部件（${missing.join('、')}），不可达`),
      };
    }
    const unmet = this.analysis.dependentsClosure[partId].filter(
      (dep) => this.mountStates[dep] !== 'assembled',
    );
    if (unmet.length === 0) {
      return { partId, kind, status: 'ready', blockedBy: null };
    }
    return {
      partId, kind, status: 'blocked',
      blockedBy: makeReason('waiting-dependency', unmet,
        `需先装回：${unmet.map((dep) => this.label(dep)).join('、')}`),
    };
  }

  /** 重推指定部件的步骤并写入缓存；进度结论由 deriveProgress 从缓存与部件状态纯推导 */
  private recompute(partIds: PartId[]): void {
    const targets = [...new Set(partIds)].sort();
    for (const id of targets) {
      this.stepCache[id] = {
        disassemble: this.deriveStep(id, 'disassemble'),
        assemble: this.deriveStep(id, 'assemble'),
      };
    }
    this.lastRecomputed = targets;
  }

  private deriveProgress(): Progress {
    const ids = this.analysis.ids;
    const total = ids.length;
    const disassembled = ids.filter((id) => this.mountStates[id] !== 'installed').length;
    const assembled = ids.filter((id) => this.mountStates[id] === 'assembled').length;
    const unreachable = ids
      .filter((id) => this.analysis.unreachableKind[id] !== null)
      .sort();
    const complete = total > 0 && assembled === total;
    const phase: Progress['phase'] = complete
      ? 'complete'
      : disassembled === total && total > 0
        ? 'assembly'
        : 'disassembly';

    let message: string;
    if (complete) {
      message = `全部 ${total} 个部件已装回，拆装完成`;
    } else if (phase === 'disassembly') {
      message = `拆解阶段：已拆 ${disassembled}/${total}`;
    } else {
      message = `组装阶段：已装回 ${assembled}/${total}`;
    }
    if (unreachable.length > 0) {
      message += `；${unreachable.length} 个部件因依赖问题不可达：${unreachable
        .map((id) => this.label(id))
        .join('、')}`;
    }
    return { total, disassembled, assembled, phase, unreachable, complete, message };
  }

  /** 应用一次操作；无效操作返回 ok=false 且状态与进度结论完全不变 */
  apply(operation: Operation): OperationOutcome {
    const { type, partId } = operation;
    const name = this.label(partId);
    this.historyLength += 1;

    if (!this.analysis.ids.includes(partId)) {
      this.lastRecomputed = [];
      return { ok: false, reason: makeReason('unknown-part', [partId], `部件「${partId}」不存在`) };
    }

    const state = this.mountStates[partId];
    if (type === 'disassemble') {
      if (state !== 'installed') {
        this.lastRecomputed = [];
        return {
          ok: false,
          reason: makeReason('already-removed', [partId], `「${name}」已拆下，重复拆下无效`),
        };
      }
    } else {
      if (state === 'assembled') {
        this.lastRecomputed = [];
        return {
          ok: false,
          reason: makeReason('already-assembled', [partId], `「${name}」已装回，重复装回无效`),
        };
      }
      if (state === 'installed') {
        this.lastRecomputed = [];
        return {
          ok: false,
          reason: makeReason('not-yet-disassembled', [partId], `「${name}」尚未拆下，无法装回`),
        };
      }
    }

    const step = this.stepCache[partId][type];
    if (step.status === 'blocked') {
      this.lastRecomputed = [];
      return { ok: false, reason: step.blockedBy };
    }

    this.mountStates[partId] = type === 'disassemble' ? 'removed' : 'assembled';
    // 局部重推：仅受影响闭包内的部件步骤可能变化
    this.recompute(affectedClosure(this.analysis, partId));
    return { ok: true, reason: null };
  }

  /** 当前快照：步骤、受阻原因、进度结论与本次实际重推的部件集合 */
  snapshot(operation: Operation | null = null, outcome: OperationOutcome | null = null): StepSnapshot {
    const steps: StepState[] = [];
    for (const id of this.analysis.ids) {
      steps.push(this.stepCache[id].disassemble, this.stepCache[id].assemble);
    }
    return {
      operation,
      outcome: outcome ?? { ok: true, reason: null },
      mountStates: { ...this.mountStates },
      steps,
      progress: this.deriveProgress(),
      recomputed: [...this.lastRecomputed],
    };
  }

  /** 整体重推：从部件状态出发重新推导全部步骤（用于与局部重推比对） */
  deriveAll(): StepSnapshot {
    const saved = this.lastRecomputed;
    const fresh = new AssemblyMachine(this.specs);
    fresh.mountStates = { ...this.mountStates };
    fresh.historyLength = this.historyLength;
    fresh.recompute(fresh.analysis.ids);
    const result = fresh.snapshot();
    this.lastRecomputed = saved;
    return result;
  }

  /** 整体重推并写回缓存（全量基准模式使用） */
  recomputeAll(): void {
    this.recompute(this.analysis.ids);
  }

  /** 提示下一个可执行步骤（按部件声明顺序，确定性） */
  nextHint(): StepState | null {
    for (const id of this.analysis.ids) {
      const step = this.stepCache[id].disassemble;
      if (step.status === 'ready') return step;
    }
    for (const id of this.analysis.ids) {
      const step = this.stepCache[id].assemble;
      if (step.status === 'ready') return step;
    }
    return null;
  }

  getMountStates(): Record<PartId, MountState> {
    return { ...this.mountStates };
  }

  getProgress(): Progress {
    return this.deriveProgress();
  }
}

/** 便捷入口：整体重推模式，每次操作后都全量推导（供离线比对基准） */
export function runFullRecompute(specs: PartSpec[], operations: Operation[]): StepSnapshot[] {
  const machine = new AssemblyMachine(specs);
  const snapshots: StepSnapshot[] = [machine.snapshot()];
  for (const operation of operations) {
    const outcome = machine.apply(operation);
    machine.recomputeAll();
    snapshots.push(machine.snapshot(operation, outcome));
  }
  return snapshots;
}
