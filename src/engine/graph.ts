/**
 * 工序依赖图：找环（Tarjan）+ 定序（Kahn，id 字典序决胜，保证确定顺序）。
 */
import type { JadeMaterial, ProcessStep, SandBatch, WorkshopConfig } from "./types.js";

export interface GraphIndex {
  stepById: Map<string, ProcessStep>;
  materialById: Map<string, JadeMaterial>;
  sandById: Map<string, SandBatch>;
  /** 仅含启用工序之间、且引用存在的边 */
  activeIds: Set<string>;
  preds: Map<string, Set<string>>; // 有效前置
  succs: Map<string, Set<string>>;
  /** 结构问题：环（成员集合的列表）与缺失引用 */
  cycleGroups: string[][];
  inCycle: Set<string>;
  missing: Map<string, { material?: boolean; sand?: boolean; prereqs: string[] }>;
}

export function buildIndex(cfg: WorkshopConfig): GraphIndex {
  const stepById = new Map(cfg.steps.map((s) => [s.id, s]));
  const materialById = new Map(cfg.materials.map((m) => [m.id, m]));
  const sandById = new Map(cfg.sands.map((s) => [s.id, s]));

  const activeIds = new Set<string>();
  const preds = new Map<string, Set<string>>();
  const succs = new Map<string, Set<string>>();
  const missing = new Map<
    string,
    { material?: boolean; sand?: boolean; prereqs: string[] }
  >();

  for (const step of cfg.steps) {
    if (step.disabled) continue;
    activeIds.add(step.id);
    preds.set(step.id, new Set());
    succs.set(step.id, new Set());
    const miss = { material: false, sand: false, prereqs: [] as string[] };
    if (step.materialId && !materialById.has(step.materialId)) miss.material = true;
    if (step.sandId && !sandById.has(step.sandId)) miss.sand = true;
    for (const p of step.prerequisites) {
      if (!stepById.has(p)) miss.prereqs.push(p);
    }
    if (miss.material || miss.sand || miss.prereqs.length) missing.set(step.id, miss);
  }

  for (const id of activeIds) {
    const step = stepById.get(id)!;
    for (const p of step.prerequisites) {
      if (activeIds.has(p)) {
        preds.get(id)!.add(p);
        succs.get(p)!.add(id);
      }
    }
  }

  const { groups: cycleGroups, inCycle } = findSccCycles(activeIds, preds);
  return { stepById, materialById, sandById, activeIds, preds, succs, cycleGroups, inCycle, missing };
}

/** Tarjan 强连通分量，返回节点数 >1 的分量（自环也算）。 */
function findSccCycles(nodes: Set<string>, preds: Map<string, Set<string>>) {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const groups: string[][] = [];

  const strong = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of preds.get(v) ?? []) {
      // preds 作为入边：v 依赖 w，沿边向 w 深搜，SCC 结果相同
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      const selfLoop = comp.length === 1 && (preds.get(comp[0])?.has(comp[0]) ?? false);
      if (comp.length > 1 || selfLoop) {
        comp.sort();
        groups.push(comp);
      }
    }
  };

  for (const id of [...nodes].sort()) {
    if (!index.has(id)) strong(id);
  }
  const inCycle = new Set(groups.flat());
  groups.sort((a, b) => a[0].localeCompare(b[0]));
  return { groups, inCycle };
}

/**
 * Kahn 定序。
 * - 环上节点永远不入队；
 * - 有环上/缺失前置的节点同样无法入队（被结构卡住）；
 * - 其余节点按「入度归零的先后」+ id 字典序取出，顺序确定。
 * 返回顺序以及未能进入顺序的启用节点及其阻塞原因（缺失前置、环前置、自身在环）。
 */
export interface TopoResult {
  order: string[];
  /** 未进入 order 的启用节点 -> 结构原因 */
  structurallyBlocked: Map<string, string[]>;
}

export function topoOrder(idx: GraphIndex): TopoResult {
  const indeg = new Map<string, number>();
  for (const id of idx.activeIds) indeg.set(id, idx.preds.get(id)!.size);

  const ready: string[] = [];
  const pushReady = (id: string) => {
    ready.push(id);
    ready.sort();
  };
  for (const id of idx.activeIds) if (indeg.get(id) === 0) pushReady(id);

  const order: string[] = [];
  while (ready.length) {
    const v = ready.shift()!;
    order.push(v);
    for (const w of idx.succs.get(v)!) {
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) pushReady(w);
    }
  }

  const structurallyBlocked = new Map<string, string[]>();
  for (const id of idx.activeIds) {
    if (order.includes(id)) continue;
    const reasons: string[] = [];
    if (idx.inCycle.has(id)) reasons.push("位于依赖环中");
    else {
      const blockedPreds = [...idx.preds.get(id)!].filter(
        (p) => !order.includes(p),
      );
      if (blockedPreds.length) reasons.push(`前置工序无法完成: ${blockedPreds.sort().join("、")}`);
    }
    const miss = idx.missing.get(id);
    if (miss?.prereqs.length) reasons.push(`前置引用缺失: ${miss.prereqs.join("、")}`);
    structurallyBlocked.set(id, reasons);
  }
  return { order, structurallyBlocked };
}
