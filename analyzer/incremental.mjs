/**
 * 增量归因：节点数据被修正后，只重算受影响路径。
 *
 * 受影响范围：
 *  - 耗时修正：所有经过该节点的路径；
 *  - 父引用修正：修正前后该节点的祖先、后代子树与节点自身，与这些节点相交的路径。
 * 父引用修正后通过全量重放边引用（rebuildEdges）重算邻接，断环/缺父诊断与全量
 * 导入完全同源；未受影响路径的归因缓存对象保持不变。
 */

import { DiagnosticCode, coerceDuration } from './model.mjs';
import { ancestorsOf, buildGraph, descendantsOf, rebuildEdges } from './graph.mjs';
import {
  attributePath,
  buildReport,
  enumeratePaths,
  pathMembership,
} from './attribution.mjs';

const VALUE_DIAGNOSTIC_CODES = new Set([
  DiagnosticCode.DURATION_CONFLICT,
  DiagnosticCode.INVALID_DURATION,
  DiagnosticCode.NEGATIVE_DURATION,
]);
const EDGE_DIAGNOSTIC_CODES = new Set([
  DiagnosticCode.MISSING_PARENT,
  DiagnosticCode.CYCLE_EDGE,
]);

export class IncrementalAttributor {
  constructor(samples) {
    const graph = buildGraph(samples);
    this.nodes = graph.nodes;
    this.occurrences = graph.occurrences;
    this.parentRefs = graph.parentRefs;
    this.diagnostics = graph.diagnostics;
    this.stats = graph.stats;
    this.paths = enumeratePaths(this.nodes);
    this.k = pathMembership(this.paths);
    this.attributionCache = this.#buildCache();
  }

  #buildCache() {
    const cache = new Map();
    for (const path of this.paths) cache.set(path.join('>'), attributePath(this.nodes, path, this.k));
    return cache;
  }

  report() {
    return buildReport(this.nodes, this.paths, this.k, this.diagnostics, this.stats);
  }

  /**
   * @param {Array<{type:'set-duration'|'set-parent', nodeId:string, duration?:number, parentId?:string|null}>} fixes
   * @returns 可追溯依据：修正内容、受影响区域、删除/新增/重算/未变路径清单
   */
  applyFixes(fixes) {
    const beforeKeys = new Set(this.paths.map((p) => p.join('>')));
    const region = new Set();
    const fixTrace = [];

    for (const [index, fix] of fixes.entries()) {
      if (!this.nodes.has(fix.nodeId)) throw new Error(`fix #${index} targets unknown node ${fix.nodeId}`);
      if (fix.type === 'set-duration') {
        region.add(fix.nodeId);
        this.#applyDurationFix(fix);
      } else if (fix.type === 'set-parent') {
        this.#collectRegion(region, fix.nodeId);
        this.#applyParentFix(fix);
        this.#collectRegion(region, fix.nodeId);
      } else {
        throw new Error(`fix #${index} has unknown type ${fix.type}`);
      }
      fixTrace.push(this.#traceOf(fix));
    }

    const nextPaths = enumeratePaths(this.nodes);
    const nextK = pathMembership(nextPaths);
    const nextKeys = new Set(nextPaths.map((p) => p.join('>')));
    const intersectsRegion = (path) => path.some((id) => region.has(id));

    const affectedKeys = new Set();
    for (const key of beforeKeys) if (!nextKeys.has(key)) affectedKeys.add(key);
    for (const key of nextKeys) if (!beforeKeys.has(key)) affectedKeys.add(key);
    for (const path of this.paths) if (intersectsRegion(path)) affectedKeys.add(path.join('>'));
    for (const path of nextPaths) if (intersectsRegion(path)) affectedKeys.add(path.join('>'));

    const removedPaths = [...affectedKeys].filter((key) => !nextKeys.has(key)).sort();
    const addedPaths = [...affectedKeys].filter((key) => !beforeKeys.has(key)).sort();
    const recomputedPaths = [...affectedKeys]
      .filter((key) => beforeKeys.has(key) && nextKeys.has(key))
      .sort();
    const unchangedPaths = [...nextKeys].filter((key) => !affectedKeys.has(key)).sort();

    // 只重算受影响路径：未受影响路径保留旧归因对象。
    const newCache = new Map();
    for (const [key, attr] of this.attributionCache) {
      if (!affectedKeys.has(key)) newCache.set(key, attr);
    }
    for (const path of nextPaths) {
      const key = path.join('>');
      if (affectedKeys.has(key)) newCache.set(key, attributePath(this.nodes, path, nextK));
    }

    this.paths = nextPaths;
    this.k = nextK;
    this.attributionCache = newCache;

    return {
      fixes: fixTrace,
      region: [...region].sort(),
      affectedPaths: [...affectedKeys].sort(),
      removedPaths,
      addedPaths,
      recomputedPaths,
      unchangedPaths,
    };
  }

  #collectRegion(region, nodeId) {
    region.add(nodeId);
    for (const id of ancestorsOf(this.nodes, nodeId)) region.add(id);
    for (const id of descendantsOf(this.nodes, nodeId)) region.add(id);
  }

  #traceOf(fix) {
    if (fix.type === 'set-duration') {
      return { type: 'set-duration', nodeId: fix.nodeId, duration: fix.duration };
    }
    return {
      type: 'set-parent',
      nodeId: fix.nodeId,
      requestedParent: fix.parentId ?? null,
      resolvedParents: [...this.nodes.get(fix.nodeId).parents],
    };
  }

  #applyDurationFix(fix) {
    const { nodeId, duration } = fix;
    const occs = this.occurrences.get(nodeId);
    for (const occ of occs) occ.rawDuration = duration;

    this.diagnostics = this.diagnostics.filter(
      (d) => !(d.nodeId === nodeId && VALUE_DIAGNOSTIC_CODES.has(d.code)),
    );
    const sorted = [...occs].sort((a, b) => (a.occurrenceKey < b.occurrenceKey ? -1 : 1));
    const coerced = sorted.map((o) => ({ ...o, ...coerceDuration(o.rawDuration) }));
    const winner = coerced[0];
    this.nodes.get(nodeId).duration = winner.value;
    for (const c of coerced) {
      if (c.diagnosticCode) {
        this.diagnostics.push({
          code: c.diagnosticCode,
          nodeId,
          detail: `occurrence ${c.occurrenceKey} coerced to 0`,
        });
      }
    }
    const distinct = [...new Set(coerced.map((c) => c.value))].sort((x, y) => x - y);
    if (distinct.length > 1) {
      this.diagnostics.push({
        code: DiagnosticCode.DURATION_CONFLICT,
        nodeId,
        detail: `conflicting durations ${distinct.join('/')} resolved to ${winner.value} via ${winner.occurrenceKey}`,
      });
    }
  }

  #applyParentFix(fix) {
    const refs = this.parentRefs.get(fix.nodeId);
    refs.clear();
    refs.set(fix.parentId ?? null, ['incremental-fix']);
    this.diagnostics = this.diagnostics.filter((d) => !EDGE_DIAGNOSTIC_CODES.has(d.code));
    this.diagnostics.push(...rebuildEdges(this.nodes, this.parentRefs));
  }
}
