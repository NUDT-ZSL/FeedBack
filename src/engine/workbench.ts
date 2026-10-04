import { computeAffected, derive, deriveIncremental } from './derive.ts';
import { explain } from './explain.ts';
import type { DerivationResult, Explanation, Resolution, TaskDecl } from './types.ts';

export interface ApplyOutcome {
  affected: string[];
  result: DerivationResult;
}

/**
 * 推演工作台：持有任务声明与裁决记录，对外提供整体重推与增量重推。
 * 任何一次改动后的顺序、时刻与依据都可追溯到具体来源与裁决记录。
 */
export class Workbench {
  private decls: TaskDecl[];
  private resolutions: Resolution[] = [];
  private last: DerivationResult | null = null;
  readonly auditLog: string[] = [];

  constructor(decls: TaskDecl[]) {
    this.decls = decls.map((d) => ({
      ...d,
      dependsOn: [...d.dependsOn],
      optionalDeps: [...(d.optionalDeps ?? [])],
    }));
  }

  getResolutions(): readonly Resolution[] {
    return this.resolutions;
  }

  getDecls(): readonly TaskDecl[] {
    return this.decls;
  }

  /** 整体重推（基线）。 */
  derive(): DerivationResult {
    this.last = derive(this.decls, this.resolutions);
    this.auditLog.push(`整体重推：${this.decls.length} 条声明，${this.resolutions.length} 条裁决`);
    return this.last;
  }

  /** 应用裁决并增量重推：只重推受影响任务，结果与整体重推一致。 */
  apply(fresh: Resolution[]): ApplyOutcome {
    const all = [...this.resolutions, ...fresh];
    const affected = computeAffected(this.decls, all, fresh);
    let result: DerivationResult;
    if (this.last) {
      result = deriveIncremental(this.decls, all, fresh, this.last).result;
    } else {
      result = derive(this.decls, all);
    }
    this.resolutions = all;
    this.last = result;
    for (const res of fresh) this.auditLog.push(`裁决：${describeResolution(res)}（影响 ${affected.size} 项任务）`);
    return { affected: [...affected].sort(), result };
  }

  explain(taskId: string): Explanation {
    const result = this.last ?? this.derive();
    return explain(result, taskId);
  }
}

function describeResolution(res: Resolution): string {
  switch (res.kind) {
    case 'pick-duration':
      return `采用来源 ${res.source} 的耗时（任务 ${res.taskId}）`;
    case 'set-duration':
      return `设定任务 ${res.taskId} 耗时为 ${res.duration}`;
    case 'remove-dependency':
      return `移除依赖边 ${res.taskId} → ${res.dep}`;
    case 'retarget-dependency':
      return `将依赖 ${res.taskId} → ${res.dep} 改指到 ${res.to}`;
  }
}
