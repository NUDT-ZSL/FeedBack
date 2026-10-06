/**
 * 增量归因引擎。
 *
 * createEngine(samples) 持有导入后的调用树与每个 trace 的归因缓存；
 * correct(corrections) 应用节点数据修正（durationMs / parentId），
 * 只重算受影响路径，并产出可追溯证据（evidence）。
 *
 * 受影响路径的判定（依赖分析）：
 *   - 修正节点 X 的耗时：X 的 selfMs 变化，且 X 父节点的 selfMs 变化
 *     （父 self = 父耗时 - 子耗时之和），因此经过「X 的父节点（无父则为 X）」
 *     的所有路径受影响；
 *   - 修正节点 X 的父引用：X 的子树在新旧两个位置的路径都会变化，
 *     因此经过「旧父节点（无则为 X）」与「新父节点（无则为 X）」的所有路径受影响。
 * 以上节点称为锚点（anchor）；只有经过锚点的路径会被重新构建，
 * 其余路径直接复用缓存。锚点之上的祖先前缀累计值不变，可安全复用。
 */

import { buildTrace } from './import.js';
import { computeSelfTimes } from './attribute.js';
import { assembleResult } from './index.js';

function enumeratePaths(trace) {
  const nodeIdLists = [];
  const visit = (nodeId, prefix) => {
    const node = trace.nodes.get(nodeId);
    const ids = [...prefix, nodeId];
    if (node.children.length === 0) {
      nodeIdLists.push(ids);
      return;
    }
    for (const childId of node.children) visit(childId, ids);
  };
  for (const rootId of trace.rootIds) visit(rootId, []);
  return nodeIdLists;
}

function buildPathEntries(trace, ids, selfMs, nodeCumulative) {
  return ids.map((id, depth) => ({
    nodeId: id,
    name: trace.nodes.get(id).name,
    depth,
    selfMs: selfMs.get(id),
    cumulativeMs: nodeCumulative.get(id),
  }));
}

function makePath(trace, ids, selfMs, nodeCumulative) {
  return {
    key: `${trace.traceId}:${ids.join('/')}`,
    label: `${trace.traceId}:${ids.map((id) => trace.nodes.get(id).name).join('>')}`,
    traceId: trace.traceId,
    nodeIds: ids,
    entries: buildPathEntries(trace, ids, selfMs, nodeCumulative),
    totalMs: nodeCumulative.get(ids[ids.length - 1]),
  };
}

export function createEngine(samples) {
  const samplesByTrace = new Map();
  for (const sample of samples) {
    if (!samplesByTrace.has(sample.traceId)) {
      samplesByTrace.set(sample.traceId, {
        traceId: sample.traceId,
        nodes: (sample.nodes ?? []).map((n) => ({ ...n })),
      });
    }
  }

  const traces = new Map();
  const attributionByTrace = new Map();
  for (const sample of samplesByTrace.values()) {
    const trace = buildTrace(sample);
    traces.set(sample.traceId, trace);
    attributionByTrace.set(sample.traceId, attributeWithCache(trace));
  }

  function attributeWithCache(trace) {
    const { selfMs, anomalies } = computeSelfTimes(trace);
    const nodeCumulative = new Map();
    const paths = [];
    for (const ids of enumeratePaths(trace)) {
      let cum = 0;
      for (const id of ids) {
        cum += selfMs.get(id);
        nodeCumulative.set(id, cum);
      }
      paths.push(makePath(trace, ids, selfMs, nodeCumulative));
    }
    paths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { paths, nodeCumulative, selfMs, anomalies };
  }

  return {
    analyze() {
      return assembleResult(traces, attributionByTrace);
    },

    exportSamples() {
      return [...samplesByTrace.values()].map((s) => ({
        traceId: s.traceId,
        nodes: s.nodes.map((n) => ({ ...n })),
      }));
    },

    /**
     * corrections: [{ traceId, nodeId, set: { durationMs?, parentId? } }]
     * 返回 { result, evidence }；result 为增量合并后的整体归因结论。
     */
    correct(corrections) {
      const byTrace = new Map();
      for (const correction of corrections) {
        const list = byTrace.get(correction.traceId) ?? [];
        list.push(correction);
        byTrace.set(correction.traceId, list);
      }

      const evidence = { corrections: [], affectedPaths: [], notes: [] };

      for (const [traceId, traceCorrections] of byTrace) {
        const oldTrace = traces.get(traceId);
        const oldAttribution = attributionByTrace.get(traceId);
        const sample = samplesByTrace.get(traceId);
        if (!oldTrace || !sample) {
          evidence.notes.push(`trace '${traceId}' not found; ${traceCorrections.length} correction(s) ignored`);
          continue;
        }

        const anchorReasons = new Map(); // anchorId -> Set<reason>
        const addAnchor = (nodeId, reason) => {
          const set = anchorReasons.get(nodeId) ?? new Set();
          set.add(reason);
          anchorReasons.set(nodeId, set);
        };

        // 第一遍：基于旧树记录旧位置锚点，并把修正写入样本副本
        for (const correction of traceCorrections) {
          const nodeId = String(correction.nodeId);
          const oldNode = oldTrace.nodes.get(nodeId);
          const target = sample.nodes.find((n) => String(n.id) === nodeId);
          if (!oldNode || !target) {
            evidence.notes.push(`node '${nodeId}' not found in trace '${traceId}'; correction ignored`);
            continue;
          }
          const applied = { traceId, nodeId, changes: {} };
          if ('durationMs' in (correction.set ?? {})) {
            applied.changes.durationMs = { from: target.durationMs ?? null, to: correction.set.durationMs };
            target.durationMs = correction.set.durationMs;
            const anchor = oldNode.effectiveParentId ?? nodeId;
            addAnchor(anchor, `duration-changed@${nodeId}`);
          }
          if ('parentId' in (correction.set ?? {})) {
            applied.changes.parentId = { from: target.parentId ?? null, to: correction.set.parentId };
            target.parentId = correction.set.parentId;
            const anchor = oldNode.effectiveParentId ?? nodeId;
            addAnchor(anchor, `reparent-old-location@${nodeId}`);
          }
          evidence.corrections.push(applied);
        }

        // 重建 trace（重新解析父引用、环、耗时清洗）
        const newTrace = buildTrace(sample);
        const { selfMs, anomalies } = computeSelfTimes(newTrace);

        // 第二遍：基于新树记录新位置锚点
        for (const correction of traceCorrections) {
          if (!('parentId' in (correction.set ?? {}))) continue;
          const nodeId = String(correction.nodeId);
          const newNode = newTrace.nodes.get(nodeId);
          if (!newNode) continue;
          const anchor = newNode.effectiveParentId ?? nodeId;
          addAnchor(anchor, `reparent-new-location@${nodeId}`);
        }

        const anchorIds = new Set([...anchorReasons.keys()].filter((id) => newTrace.nodes.has(id)));

        // 受影响节点 = 新树中各锚点的子树（含锚点）
        const affectedNodes = new Set();
        const markSubtree = (nodeId) => {
          affectedNodes.add(nodeId);
          for (const childId of newTrace.nodes.get(nodeId).children) markSubtree(childId);
        };
        for (const anchorId of anchorIds) markSubtree(anchorId);

        // 累计值：未受影响节点复用旧缓存，受影响子树自锚点向下重算
        const nodeCumulative = new Map();
        for (const [nodeId, cum] of oldAttribution.nodeCumulative) {
          if (!affectedNodes.has(nodeId) && newTrace.nodes.has(nodeId)) {
            nodeCumulative.set(nodeId, cum);
          }
        }
        const depthOf = (nodeId) => {
          let depth = 0;
          let cursor = newTrace.nodes.get(nodeId).effectiveParentId;
          while (cursor !== null) {
            depth += 1;
            cursor = newTrace.nodes.get(cursor).effectiveParentId;
          }
          return depth;
        };
        const anchorsByDepth = [...anchorIds].sort((a, b) => depthOf(a) - depthOf(b));
        const recomputeSubtree = (nodeId, prefixCum) => {
          const cum = prefixCum + selfMs.get(nodeId);
          nodeCumulative.set(nodeId, cum);
          for (const childId of newTrace.nodes.get(nodeId).children) recomputeSubtree(childId, cum);
        };
        for (const anchorId of anchorsByDepth) {
          const parentId = newTrace.nodes.get(anchorId).effectiveParentId;
          const prefixCum = parentId === null ? 0 : nodeCumulative.get(parentId);
          recomputeSubtree(anchorId, prefixCum);
        }

        // 路径：仅重建经过锚点的路径，其余复用缓存
        const oldPathByKey = new Map(oldAttribution.paths.map((p) => [p.key, p]));
        const newPaths = [];
        const affectedPathKeys = new Set();
        for (const ids of enumeratePaths(newTrace)) {
          const hitsAnchor = ids.some((id) => anchorIds.has(id));
          if (!hitsAnchor) {
            const key = `${traceId}:${ids.join('/')}`;
            const cached = oldPathByKey.get(key);
            if (cached) {
              newPaths.push(cached);
              continue;
            }
          }
          const path = makePath(newTrace, ids, selfMs, nodeCumulative);
          newPaths.push(path);
          affectedPathKeys.add(path.key);
        }
        newPaths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

        // 证据：受影响路径的前后对照
        const newPathByKey = new Map(newPaths.map((p) => [p.key, p]));
        for (const key of [...affectedPathKeys].sort()) {
          const after = newPathByKey.get(key);
          const before = oldPathByKey.get(key) ?? null;
          const reasons = new Set();
          for (const id of after.nodeIds) {
            for (const reason of anchorReasons.get(id) ?? []) reasons.add(reason);
          }
          evidence.affectedPaths.push({
            traceId,
            key,
            label: after.label,
            status: before ? 'updated' : 'added',
            reasons: [...reasons].sort(),
            beforeTotalMs: before ? before.totalMs : null,
            afterTotalMs: after.totalMs,
          });
        }
        for (const oldPath of oldAttribution.paths) {
          if (!newPathByKey.has(oldPath.key)) {
            const removedReasons = new Set();
            for (const id of oldPath.nodeIds) {
              for (const reason of anchorReasons.get(id) ?? []) removedReasons.add(reason);
            }
            evidence.affectedPaths.push({
              traceId,
              key: oldPath.key,
              label: oldPath.label,
              status: 'removed',
              reasons: [...removedReasons].sort(),
              beforeTotalMs: oldPath.totalMs,
              afterTotalMs: null,
            });
          }
        }

        traces.set(traceId, newTrace);
        attributionByTrace.set(traceId, { paths: newPaths, nodeCumulative, selfMs, anomalies });
      }

      evidence.affectedPaths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return { result: assembleResult(traces, attributionByTrace), evidence };
    },
  };
}
