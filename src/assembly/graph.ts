/**
 * 依赖图分析：传递闭包、成环检测、缺失依赖检测。
 * 所有输出按确定顺序排列（输入顺序 + 字典序），保证重复/乱序推演结论稳定。
 */
import type { PartId, PartSpec } from './types.ts';

export interface GraphAnalysis {
  ids: PartId[];
  /** 每个已知部件可达的全部依赖（仅已知部件，不含自身） */
  depsClosure: Record<PartId, PartId[]>;
  /** 每个已知部件的全部反向依赖（哪些部件（直接或间接）依赖它） */
  dependentsClosure: Record<PartId, PartId[]>;
  /** 部件所在/可达的环成员集合；非空表示不可达 */
  cycleReach: Record<PartId, PartId[]>;
  /** 部件依赖链上指向的缺失部件 id */
  missingReach: Record<PartId, PartId[]>;
  /** 部件被标记为不可达时的原因类别 */
  unreachableKind: Record<PartId, 'dependency-cycle' | 'missing-dependency' | null>;
}

/** Tarjan 强连通分量（迭代实现，避免深递归），返回环成员（size>1 或自环） */
function findCycleMembers(specs: PartSpec[], idSet: Set<PartId>): PartId[][] {
  const index = new Map<PartId, number>();
  const low = new Map<PartId, number>();
  const onStack = new Set<PartId>();
  const stack: PartId[] = [];
  const cycles: PartId[][] = [];
  let counter = 0;

  for (const start of specs) {
    if (index.has(start.id)) continue;
    // 每项为 [部件 id, 已处理到的邻接下标]
    const work: Array<[PartId, number]> = [[start.id, 0]];
    index.set(start.id, counter);
    low.set(start.id, counter);
    counter += 1;
    stack.push(start.id);
    onStack.add(start.id);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [nodeId, nextEdge] = frame;
      const spec = specs.find((item) => item.id === nodeId);
      const neighbors = spec ? spec.dependsOn.filter((dep) => idSet.has(dep)) : [];
      if (nextEdge < neighbors.length) {
        frame[1] = nextEdge + 1;
        const dep = neighbors[nextEdge];
        if (!index.has(dep)) {
          index.set(dep, counter);
          low.set(dep, counter);
          counter += 1;
          stack.push(dep);
          onStack.add(dep);
          work.push([dep, 0]);
        } else if (onStack.has(dep)) {
          low.set(nodeId, Math.min(low.get(nodeId)!, index.get(dep)!));
        }
      } else {
        work.pop();
        if (low.get(nodeId) === index.get(nodeId)) {
          const component: PartId[] = [];
          let top: PartId;
          do {
            top = stack.pop()!;
            onStack.delete(top);
            component.push(top);
          } while (top !== nodeId);
          const hasSelfLoop = neighbors.includes(nodeId);
          if (component.length > 1 || hasSelfLoop) {
            cycles.push(component.sort());
          }
        }
        if (work.length > 0) {
          const parentId = work[work.length - 1][0];
          low.set(parentId, Math.min(low.get(parentId)!, low.get(nodeId)!));
        }
      }
    }
  }
  return cycles;
}

function fixedPointClosure(
  ids: PartId[],
  edges: Record<PartId, PartId[]>,
): Record<PartId, PartId[]> {
  const closure: Record<PartId, Set<PartId>> = {};
  for (const id of ids) closure[id] = new Set(edges[id] ?? []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      const acc = closure[id];
      for (const dep of edges[id] ?? []) {
        for (const transit of closure[dep] ?? []) {
          if (!acc.has(transit)) {
            acc.add(transit);
            changed = true;
          }
        }
      }
    }
  }
  const result: Record<PartId, PartId[]> = {};
  for (const id of ids) result[id] = [...closure[id]].sort();
  return result;
}

export function analyzeGraph(specs: PartSpec[]): GraphAnalysis {
  const ids = specs.map((spec) => spec.id);
  const idSet = new Set(ids);
  const directEdges: Record<PartId, PartId[]> = {};
  const missingDirect: Record<PartId, PartId[]> = {};
  for (const spec of specs) {
    const known: PartId[] = [];
    const missing: PartId[] = [];
    for (const dep of [...new Set(spec.dependsOn)].sort()) {
      (idSet.has(dep) ? known : missing).push(dep);
    }
    directEdges[spec.id] = known;
    missingDirect[spec.id] = missing;
  }

  const depsClosure = fixedPointClosure(ids, directEdges);

  const reverseEdges: Record<PartId, PartId[]> = {};
  for (const id of ids) reverseEdges[id] = [];
  for (const spec of specs) {
    for (const dep of spec.dependsOn) {
      if (idSet.has(dep)) reverseEdges[dep].push(spec.id);
    }
  }
  for (const id of ids) reverseEdges[id].sort();
  const dependentsClosure = fixedPointClosure(ids, reverseEdges);

  const cycles = findCycleMembers(specs, idSet);
  const cycleReach: Record<PartId, PartId[]> = {};
  const memberToCycle: Record<PartId, PartId[]> = {};
  for (const cycle of cycles) {
    for (const member of cycle) memberToCycle[member] = cycle;
  }
  for (const id of ids) {
    const reach = new Set<PartId>();
    if (memberToCycle[id]) {
      for (const member of memberToCycle[id]) reach.add(member);
    }
    for (const dep of depsClosure[id]) {
      if (memberToCycle[dep]) {
        for (const member of memberToCycle[dep]) reach.add(member);
      }
    }
    cycleReach[id] = [...reach].sort();
  }

  const missingReach: Record<PartId, PartId[]> = {};
  for (const id of ids) {
    const reach = new Set<PartId>(missingDirect[id]);
    for (const dep of depsClosure[id]) {
      for (const missing of missingDirect[dep]) reach.add(missing);
    }
    missingReach[id] = [...reach].sort();
  }

  const unreachableKind: Record<PartId, 'dependency-cycle' | 'missing-dependency' | null> = {};
  for (const id of ids) {
    unreachableKind[id] =
      cycleReach[id].length > 0
        ? 'dependency-cycle'
        : missingReach[id].length > 0
          ? 'missing-dependency'
          : null;
  }

  return { ids, depsClosure, dependentsClosure, cycleReach, missingReach, unreachableKind };
}

/** 部件状态变化后，步骤结论可能随之变化的部件集合：自身 + 全部前驱 + 全部后继 */
export function affectedClosure(analysis: GraphAnalysis, partId: PartId): PartId[] {
  const set = new Set<PartId>([partId]);
  for (const id of analysis.depsClosure[partId] ?? []) set.add(id);
  for (const id of analysis.dependentsClosure[partId] ?? []) set.add(id);
  return [...set].sort();
}
