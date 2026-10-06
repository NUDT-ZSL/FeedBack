/**
 * 调用图构建：把导入的调用链样本规整为确定性的有向无环图（可多父）。
 *
 * 同一节点可在多个样本中出现并挂在不同父节点下（共享节点 → 多父 DAG），
 * 所有出现位置声明的边都会进入图；仅“同一样本内重复 id”记 DUPLICATE_SPAN。
 *
 * 确定性规则（与导入顺序无关）：
 *  - 规范耗时取 occurrenceKey 字典序最小者的取值，冲突值按数值排序输出；
 *  - 父引用缺失 / 自引用 / 成环的边被丢弃并各自产生诊断，节点本身保留；
 *  - 断环采用固定顺序 DFS，访问到的回边即断开边，结果唯一；
 *  - 边校验与断环逻辑在全量构建和增量修正中共用 rebuildEdges，保证一致。
 */

import {
  DiagnosticCode,
  coerceDuration,
  occurrenceKey,
} from './model.mjs';

function emptyNode(id) {
  return { id, duration: 0, parents: [], children: [] };
}

/**
 * @param {Array<{sampleId:string, spans:Array}>} samples 按导入顺序排列的样本
 */
export function buildGraph(samples) {
  const nodes = new Map();
  const occurrences = new Map(); // nodeId -> [{occurrenceKey, rawDuration, rawParent}]
  const parentRefs = new Map();  // nodeId -> Map(parentId -> [occurrenceKey])
  const diagnostics = [];
  let inputSpanCount = 0;

  for (const sample of samples) {
    const seenInSample = new Set();
    sample.spans.forEach((span, index) => {
      inputSpanCount += 1;
      const key = occurrenceKey(sample.sampleId, span.id, index);
      if (!nodes.has(span.id)) {
        nodes.set(span.id, emptyNode(span.id));
        occurrences.set(span.id, []);
        parentRefs.set(span.id, new Map());
      } else if (seenInSample.has(span.id)) {
        diagnostics.push({
          code: DiagnosticCode.DUPLICATE_SPAN,
          nodeId: span.id,
          detail: `duplicate within sample ${sample.sampleId}: occurrence ${key} ignored`,
        });
      }
      seenInSample.add(span.id);
      occurrences.get(span.id).push({ occurrenceKey: key, rawDuration: span.duration, rawParent: span.parentId ?? null });
      const refs = parentRefs.get(span.id);
      const parent = span.parentId ?? null;
      if (!refs.has(parent)) refs.set(parent, []);
      refs.get(parent).push(key);
    });
  }

  for (const [nodeId, occs] of occurrences) {
    const sorted = [...occs].sort((a, b) => (a.occurrenceKey < b.occurrenceKey ? -1 : 1));
    const coerced = sorted.map((o) => ({ ...o, ...coerceDuration(o.rawDuration) }));
    const winner = coerced[0];
    nodes.get(nodeId).duration = winner.value;
    for (const c of coerced) {
      if (c.diagnosticCode) {
        diagnostics.push({
          code: c.diagnosticCode,
          nodeId,
          detail: `occurrence ${c.occurrenceKey} coerced to 0`,
        });
      }
    }
    const distinct = [...new Set(coerced.map((c) => c.value))].sort((x, y) => x - y);
    if (distinct.length > 1) {
      diagnostics.push({
        code: DiagnosticCode.DURATION_CONFLICT,
        nodeId,
        detail: `conflicting durations ${distinct.join('/')} resolved to ${winner.value} via ${winner.occurrenceKey}`,
      });
    }
  }

  const edgeDiagnostics = rebuildEdges(nodes, parentRefs);
  diagnostics.push(...edgeDiagnostics);

  const occurrenceCount = [...occurrences.values()].reduce((sum, list) => sum + list.length, 0);
  return {
    nodes,
    occurrences,
    parentRefs,
    diagnostics,
    stats: { inputSpanCount, nodeCount: nodes.size, occurrenceCount },
  };
}

export function link(nodes, parentId, childId) {
  const parent = nodes.get(parentId);
  const child = nodes.get(childId);
  if (!child.parents.includes(parentId)) {
    child.parents.push(parentId);
    child.parents.sort();
  }
  if (!parent.children.includes(childId)) {
    parent.children.push(childId);
    parent.children.sort();
  }
}

function unlinkOne(nodes, parentId, childId) {
  const parent = nodes.get(parentId);
  const child = nodes.get(childId);
  if (child) child.parents = child.parents.filter((p) => p !== parentId);
  if (parent) parent.children = parent.children.filter((c) => c !== childId);
}

/**
 * 依据 parentRefs 全量重建邻接关系：校验缺失/自引用边，再确定性断环。
 * 返回新产生的边诊断列表（MISSING_PARENT / CYCLE_EDGE）。
 */
export function rebuildEdges(nodes, parentRefs) {
  for (const node of nodes.values()) {
    node.parents = [];
    node.children = [];
  }
  const diagnostics = [];

  for (const nodeId of [...parentRefs.keys()].sort()) {
    for (const rawParent of [...parentRefs.get(nodeId).keys()].sort()) {
      if (rawParent === null) continue;
      if (rawParent === '') continue;
      if (rawParent === nodeId) {
        diagnostics.push({
          code: DiagnosticCode.CYCLE_EDGE,
          nodeId,
          detail: `self edge ${nodeId}>${nodeId} dropped`,
        });
        continue;
      }
      if (!nodes.has(rawParent)) {
        diagnostics.push({
          code: DiagnosticCode.MISSING_PARENT,
          nodeId,
          detail: `parent ${rawParent} not found; edge ${rawParent}>${nodeId} dropped`,
        });
        continue;
      }
      link(nodes, rawParent, nodeId);
    }
  }

  breakCycles(nodes, diagnostics);
  return diagnostics;
}

/** 固定顺序 DFS：访问到回边即断开，返回断开的边；诊断挂在被断开边的子节点上。 */
export function breakCycles(nodes, diagnostics) {
  const dropped = [];
  const state = new Map(); // 1=在栈中 2=完成
  const visit = (id) => {
    state.set(id, 1);
    const node = nodes.get(id);
    for (const childId of [...node.children].sort()) {
      if (state.get(childId) === 1) {
        unlinkOne(nodes, id, childId);
        dropped.push({ from: id, to: childId });
        if (diagnostics) {
          diagnostics.push({
            code: DiagnosticCode.CYCLE_EDGE,
            nodeId: childId,
            detail: `cycle edge ${id}>${childId} dropped`,
          });
        }
      } else if (!state.has(childId)) {
        visit(childId);
      }
    }
    state.set(id, 2);
  };
  for (const id of [...nodes.keys()].sort()) {
    if (!state.has(id)) visit(id);
  }
  return dropped;
}

/** 祖先集合（不含自身，多父 DAG）。 */
export function ancestorsOf(nodes, nodeId) {
  const out = new Set();
  const stack = [...(nodes.get(nodeId)?.parents ?? [])];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(nodes.get(id)?.parents ?? []));
  }
  return out;
}

/** 后代集合（不含自身，多父 DAG）。 */
export function descendantsOf(nodes, nodeId) {
  const out = new Set();
  const stack = [...(nodes.get(nodeId)?.children ?? [])];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(nodes.get(id)?.children ?? []));
  }
  return out;
}
