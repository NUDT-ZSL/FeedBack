/**
 * 浑仪拆装步骤状态机（纯函数，无任何运行时依赖）。
 *
 * 设计要点：
 *  - 进度结论只由 (静态配置, 各部件在位集合) 决定，与操作历史、操作顺序无关；
 *    因此同一操作序列重复执行 / 乱序执行，只要终态相同，结论必然一致。
 *  - 重复拆下 / 重复装回 / 未知部件 = invalid，不改变任何状态与结论。
 *  - 依赖未满足 = blocked，给出 pending 清单；依赖成环 / 指向缺失部件 = 静态不可达，
 *    在步骤与进度结论中都显式列出，绝不静默跳过。
 *  - applyOperation 默认做局部重推：只重推状态发生变化的部件自身与其直接前后依赖，
 *    结论计数 O(1) 更新；deriveFull 做整体重推，二者结论可逐字段比对。
 */

import type {
  AssemblyConfig,
  BlockedReason,
  Derivation,
  OpOutcome,
  Operation,
  PartConfig,
  PartDerivation,
  PartId,
  ProgressConclusion,
  Session,
} from './types.ts';

export type { Session } from './types.ts';

/** 依赖图静态分析结果，只与配置有关，与拆装状态无关 */
export interface StaticAnalysis {
  byId: Map<PartId, PartConfig>;
  /** 已知的前置依赖（detachAfter 中实际存在的部件） */
  fwd: Map<PartId, PartId[]>;
  /** 反向邻接：fwd[q] 包含 p 当且仅当 rev[p] 包含 q */
  rev: Map<PartId, PartId[]>;
  /** 静态不可达原因：依赖成环或（传递性地）依赖缺失部件 */
  unreachable: Map<PartId, BlockedReason>;
}

interface InternalSession extends Session {
  analysis: StaticAnalysis;
}

function buildAnalysis(config: AssemblyConfig): StaticAnalysis {
  const byId = new Map<PartId, PartConfig>();
  for (const part of config.parts) byId.set(part.id, part);

  const fwd = new Map<PartId, PartId[]>();
  const rev = new Map<PartId, PartId[]>();
  for (const part of config.parts) {
    const known = part.detachAfter.filter((dep) => byId.has(dep));
    fwd.set(part.id, known);
    rev.set(part.id, []);
  }
  for (const part of config.parts) {
    for (const dep of fwd.get(part.id) ?? []) {
      rev.get(dep)!.push(part.id);
    }
  }

  // 三色 DFS 找环：发现指向 gray 节点的回边时，从调用栈中切出环路径
  const cyclePath = new Map<PartId, PartId[]>();
  const color = new Map<PartId, 0 | 1 | 2>();
  for (const id of byId.keys()) color.set(id, 0);
  const stack: PartId[] = [];

  const markCycle = (from: PartId, to: PartId) => {
    const start = stack.indexOf(to);
    const path = stack.slice(start).concat(from);
    for (const node of path) {
      if (!cyclePath.has(node)) cyclePath.set(node, path);
    }
  };

  const dfs = (id: PartId) => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of fwd.get(id) ?? []) {
      const c = color.get(dep) ?? 0;
      if (c === 0) {
        dfs(dep);
      } else if (c === 1 && !cyclePath.has(id)) {
        markCycle(id, dep);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of byId.keys()) {
    if (color.get(id) === 0) dfs(id);
  }

  // 传递性收集缺失依赖；并沿正向依赖传播“成环 / 缺失”的不可达性
  const unreachable = new Map<PartId, BlockedReason>();
  const reasonCache = new Map<PartId, BlockedReason | null>();

  const resolve = (id: PartId): BlockedReason | null => {
    const cached = reasonCache.get(id);
    if (cached !== undefined) return cached;
    reasonCache.set(id, null); // 防止自环递归

    const part = byId.get(id);
    if (!part) return null;

    if (cyclePath.has(id)) {
      const reason: BlockedReason = { kind: 'dependency-cycle', cycle: cyclePath.get(id)! };
      reasonCache.set(id, reason);
      return reason;
    }

    const missingSet = new Set<PartId>(
      part.detachAfter.filter((dep) => !byId.has(dep)),
    );
    for (const dep of fwd.get(id) ?? []) {
      const depReason = resolve(dep);
      if (depReason?.kind === 'missing-dependency') {
        for (const m of depReason.missing) missingSet.add(m);
      }
    }
    if (missingSet.size > 0) {
      const reason: BlockedReason = {
        kind: 'missing-dependency',
        missing: [...missingSet],
      };
      reasonCache.set(id, reason);
      return reason;
    }

    for (const dep of fwd.get(id) ?? []) {
      const depReason = resolve(dep);
      if (depReason?.kind === 'dependency-cycle') {
        reasonCache.set(id, depReason);
        return depReason;
      }
    }

    reasonCache.set(id, null);
    return null;
  };

  for (const id of byId.keys()) {
    const reason = resolve(id);
    if (reason) unreachable.set(id, reason);
  }

  return { byId, fwd, rev, unreachable };
}

/** 基于当前在位状态推导单个部件的步骤 */
export function derivePart(
  analysis: StaticAnalysis,
  installed: Record<PartId, boolean>,
  id: PartId,
): PartDerivation {
  const isInstalled = installed[id] !== false;
  const staticReason = analysis.unreachable.get(id);
  if (staticReason) {
    return { part: id, installed: isInstalled, step: { status: 'blocked', reason: staticReason } };
  }

  if (isInstalled) {
    const pending = (analysis.fwd.get(id) ?? []).filter((dep) => installed[dep] !== false);
    if (pending.length === 0) return { part: id, installed: true, step: { status: 'detachable' } };
    return {
      part: id,
      installed: true,
      step: { status: 'blocked', reason: { kind: 'unmet-dependencies', pending } },
    };
  }

  const pending = (analysis.rev.get(id) ?? []).filter((dep) => installed[dep] === false);
  if (pending.length === 0) return { part: id, installed: false, step: { status: 'attachable' } };
  return {
    part: id,
    installed: false,
    step: { status: 'blocked', reason: { kind: 'unmet-dependencies', pending } },
  };
}

export function buildConclusion(
  total: number,
  installedCount: number,
  unreachable: Map<PartId, BlockedReason>,
): ProgressConclusion {
  const detachedCount = total - installedCount;
  const phase =
    installedCount === total ? 'assembled' : detachedCount === total ? 'disassembled' : 'disassembling';
  return {
    total,
    installedCount,
    detachedCount,
    percent: total === 0 ? 100 : Math.round((detachedCount / total) * 100),
    phase,
    unreachable: [...unreachable.entries()].map(([part, reason]) => ({ part, reason })),
  };
}

/** 整体重推：根据配置与全部部件在位状态重建完整推导 */
export function deriveFull(session: Session): Derivation {
  const internal = session as InternalSession;
  const parts: Record<PartId, PartDerivation> = {};
  for (const id of internal.analysis.byId.keys()) {
    parts[id] = derivePart(internal.analysis, internal.installed, id);
  }
  return {
    parts,
    conclusion: buildConclusion(
      internal.analysis.byId.size,
      internal.installedCount,
      internal.analysis.unreachable,
    ),
  };
}

export function createSession(config: AssemblyConfig): Session {
  const analysis = buildAnalysis(config);
  const installed: Record<PartId, boolean> = {};
  for (const id of analysis.byId.keys()) installed[id] = true;
  const session: InternalSession = {
    config,
    installed,
    installedCount: analysis.byId.size,
    derivation: { parts: {}, conclusion: buildConclusion(analysis.byId.size, analysis.byId.size, analysis.unreachable) },
    analysis,
  };
  session.derivation = deriveFull(session);
  return session;
}

/**
 * 对会话施加一次操作（默认局部重推）。
 * 返回新会话与操作结论；无效 / 受阻时返回的新会话在状态与进度结论上与原会话完全一致。
 */
export function applyOperation(
  prev: Session,
  op: Operation,
): { session: Session; outcome: OpOutcome } {
  const internal = prev as InternalSession;
  const { analysis } = internal;

  if (!analysis.byId.has(op.part)) {
    return { session: prev, outcome: { result: 'invalid', reason: 'unknown-part' } };
  }

  const isInstalled = internal.installed[op.part] !== false;
  if (op.kind === 'detach' && !isInstalled) {
    return { session: prev, outcome: { result: 'invalid', reason: 'duplicate-detach' } };
  }
  if (op.kind === 'attach' && isInstalled) {
    return { session: prev, outcome: { result: 'invalid', reason: 'duplicate-attach' } };
  }

  const currentStep = derivePart(analysis, internal.installed, op.part);
  if (currentStep.step.status === 'blocked') {
    return { session: prev, outcome: { result: 'blocked', reason: currentStep.step.reason } };
  }

  const installed = { ...internal.installed, [op.part]: !isInstalled };
  const installedCount = internal.installedCount + (op.kind === 'detach' ? -1 : 1);

  // 局部重推：仅部件自身 + 直接前置（拆装等待集合会变）+ 直接后置（其拆卸等待集合会变）
  const affected = new Set<PartId>([op.part]);
  for (const dep of analysis.fwd.get(op.part) ?? []) affected.add(dep);
  for (const dep of analysis.rev.get(op.part) ?? []) affected.add(dep);

  const parts = { ...internal.derivation.parts };
  for (const id of affected) parts[id] = derivePart(analysis, installed, id);

  const session: InternalSession = {
    config: internal.config,
    installed,
    installedCount,
    analysis,
    derivation: {
      parts,
      conclusion: buildConclusion(analysis.byId.size, installedCount, analysis.unreachable),
    },
  };

  return {
    session,
    outcome: { result: 'applied', affected: [...affected] },
  };
}

/** 当前可拆下的部件（提示按钮据此高亮下一个待拆环体） */
export function nextDetachable(session: Session): PartId[] {
  const internal = session as InternalSession;
  const result: PartId[] = [];
  for (const id of internal.analysis.byId.keys()) {
    if (internal.derivation.parts[id]?.step.status === 'detachable') result.push(id);
  }
  return result;
}

export function resetSession(session: Session): Session {
  return createSession(session.config);
}
