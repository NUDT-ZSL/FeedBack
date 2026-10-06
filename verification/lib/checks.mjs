/**
 * 通用验证检查。检查只依据用例声明（fixture）与归因结果本身，
 * 不内置任何具体业务断言；属性类检查（守恒、顺序无关、全量一致）适用于任意输入。
 */

import { diffValues, FLOAT_TOLERANCE } from './compare.mjs';

const SUM_TOLERANCE = 1e-5;

const ok = (name) => ({ name, status: 'pass', details: [] });
const bad = (name, details) => ({ name, status: 'fail', details });

/** 归因内部不变量：逐层累计、共享分摊、全局耗时守恒。 */
export function checkAttributionInvariants(report, label) {
  const details = [];
  const membership = new Map();
  for (const p of report.paths) {
    const sum = p.contributions.reduce((s, c) => s + c.contribution, 0);
    if (Math.abs(sum - p.totalDuration) > SUM_TOLERANCE) {
      details.push(`${label} path ${p.key}: summed contributions ${sum} != total ${p.totalDuration}`);
    }
    for (const c of p.contributions) {
      membership.set(c.nodeId, (membership.get(c.nodeId) ?? 0) + 1);
      const expected = c.duration / c.pathCount;
      if (Math.abs(expected - c.contribution) > FLOAT_TOLERANCE) {
        details.push(`${label} path ${p.key} node ${c.nodeId}: contribution ${c.contribution} != duration/pathCount ${expected}`);
      }
    }
  }
  for (const [nodeId, count] of membership) {
    const node = report.nodes.find((n) => n.id === nodeId);
    const contributions = report.paths
      .filter((p) => p.contributions.some((c) => c.nodeId === nodeId))
      .map((p) => p.contributions.find((c) => c.nodeId === nodeId).contribution);
    const total = contributions.reduce((s, v) => s + v, 0);
    if (Math.abs(total - node.duration) > SUM_TOLERANCE) {
      details.push(`${label} node ${nodeId}: cross-path contributions ${total} != own duration ${node.duration}`);
    }
    const pathCount = report.paths.find((p) => p.contributions.some((c) => c.nodeId === nodeId))
      .contributions.find((c) => c.nodeId === nodeId).pathCount;
    if (pathCount !== count) {
      details.push(`${label} node ${nodeId}: declared pathCount ${pathCount} != actual paths ${count}`);
    }
  }
  const pathTotal = report.paths.reduce((s, p) => s + p.totalDuration, 0);
  if (Math.abs(pathTotal - report.totals.nodeDurationTotal) > SUM_TOLERANCE) {
    details.push(`${label}: sum of path totals ${pathTotal} != node duration total ${report.totals.nodeDurationTotal}`);
  }
  if (!report.totals.conserved) details.push(`${label}: totals.conserved is false`);
  for (const shared of report.sharedNodes) {
    const expected = shared.nodeId;
    if (shared.pathCount <= 1) details.push(`${label}: shared node ${expected} has pathCount ${shared.pathCount}`);
    const node = report.nodes.find((n) => n.id === shared.nodeId);
    const perPath = node.duration / shared.pathCount;
    if (Math.abs(perPath - shared.perPathContribution) > FLOAT_TOLERANCE) {
      details.push(`${label}: shared node ${shared.nodeId} perPathContribution ${shared.perPathContribution} != ${perPath}`);
    }
  }
  return details.length ? bad(`attribution invariants [${label}]`, details) : ok(`attribution invariants [${label}]`);
}

/** 输入都有可观察结果：不静默跳过、不凭空增删节点。 */
export function checkNoSilentSkip(report, label) {
  const details = [];
  const { inputSpanCount, nodeCount, occurrenceCount } = report.stats;
  if (nodeCount > inputSpanCount) details.push(`${label}: node count ${nodeCount} exceeds input span count ${inputSpanCount}`);
  if (occurrenceCount !== inputSpanCount) {
    details.push(`${label}: ${inputSpanCount} input spans but only ${occurrenceCount} occurrences traceable (spans silently dropped)`);
  }
  for (const d of report.diagnostics) {
    if (!d.detail) details.push(`${label}: diagnostic ${d.code}@${d.nodeId ?? '-'} has no detail (not traceable)`);
  }
  const droppedParents = report.nodes.filter((n) => n.parents.some((pid) => !report.nodes.some((p) => p.id === pid)));
  if (droppedParents.length) details.push(`${label}: nodes reference missing parents without diagnostic: ${droppedParents.map((n) => n.id).join(',')}`);
  return details.length ? bad(`no silent skip [${label}]`, details) : ok(`no silent skip [${label}]`);
}

/** 同一批样本不同导入顺序：报告必须完全一致。 */
export function checkOrderInvariance(importedReports) {
  const details = [];
  const [base, ...rest] = importedReports;
  for (const item of rest) {
    const diffs = diffValues(base.report, item.report);
    if (diffs.length) details.push(`import "${item.name}" differs from "${base.name}":\n${diffs.slice(0, 10).map((d) => `    ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`).join('\n')}`);
  }
  return details.length ? bad(`import-order consistency across ${importedReports.length} orders`, details) : ok(`import-order consistency across ${importedReports.length} orders`);
}

/** 声明的边界诊断必须出现（code/nodeId 匹配，可声明确切数量）。 */
export function checkExpectDiagnostics(report, expected, label) {
  const details = [];
  for (const exp of expected) {
    const matched = report.diagnostics.filter((d) => {
      if (d.code !== exp.code) return false;
      if (exp.nodeId !== undefined && d.nodeId !== exp.nodeId) return false;
      return true;
    });
    if (matched.length === 0) {
      details.push(`${label}: expected diagnostic ${exp.code}${exp.nodeId ? `@${exp.nodeId}` : ''} not found; actual diagnostics: [${report.diagnostics.map((d) => `${d.code}@${d.nodeId ?? '-'}`).join(', ')}]`);
    } else if (exp.count !== undefined && matched.length !== exp.count) {
      details.push(`${label}: diagnostic ${exp.code}${exp.nodeId ? `@${exp.nodeId}` : ''} count ${matched.length} != expected ${exp.count}`);
    }
  }
  return details.length ? bad(`expected diagnostics [${label}]`, details) : ok(`expected diagnostics [${label}]`);
}

/** 共享节点跨路径贡献区分。 */
export function checkSharedNodes(report, expected, label) {
  const details = [];
  for (const exp of expected) {
    const shared = report.sharedNodes.find((s) => s.nodeId === exp.nodeId);
    if (!shared) {
      details.push(`${label}: node ${exp.nodeId} expected to be shared but is not (pathCount<=1)`);
      continue;
    }
    if (shared.pathCount !== exp.pathCount) details.push(`${label}: shared ${exp.nodeId} pathCount ${shared.pathCount} != ${exp.pathCount}`);
    if (exp.perPathContribution !== undefined && Math.abs(shared.perPathContribution - exp.perPathContribution) > FLOAT_TOLERANCE) {
      details.push(`${label}: shared ${exp.nodeId} perPathContribution ${shared.perPathContribution} != ${exp.perPathContribution}`);
    }
  }
  return details.length ? bad(`shared-node contributions [${label}]`, details) : ok(`shared-node contributions [${label}]`);
}

/** 声明的根到叶路径集合。 */
export function checkExpectedPaths(report, expectedPaths, label) {
  const actual = report.paths.map((p) => p.key);
  const missing = expectedPaths.filter((k) => !actual.includes(k));
  const extra = actual.filter((k) => !expectedPaths.includes(k));
  const details = [];
  if (missing.length) details.push(`${label}: missing paths ${missing.join(' , ')}`);
  if (extra.length) details.push(`${label}: unexpected paths ${extra.join(' , ')}`);
  return details.length ? bad(`expected paths [${label}]`, details) : ok(`expected paths [${label}]`);
}

/**
 * 增量重算 vs 全量重算一致性，并核验“只重算受影响路径”及其依据完整性。
 */
export function checkIncrementalFix({ label, preReport, postReport, fullReport, evidence, preCache, postCache }) {
  const details = [];

  const diffs = diffValues(fullReport, postReport);
  if (diffs.length) details.push(`incremental result differs from full recompute:\n${diffs.slice(0, 10).map((d) => `    ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`).join('\n')}`);

  const preKeys = new Set(preReport.paths.map((p) => p.key));
  const postKeys = new Set(postReport.paths.map((p) => p.key));
  const affected = new Set(evidence.affectedPaths);
  const changed = [];
  for (const key of new Set([...preKeys, ...postKeys])) {
    if (!preKeys.has(key) || !postKeys.has(key)) changed.push(key);
  }
  const preByKey = new Map(preReport.paths.map((p) => [p.key, p]));
  for (const path of postReport.paths) {
    const before = preByKey.get(path.key);
    if (before && JSON.stringify(before.contributions) !== JSON.stringify(path.contributions)) changed.push(path.key);
  }
  const uncovered = changed.filter((k) => !affected.has(k));
  if (uncovered.length) details.push(`paths actually changed but not marked affected: ${uncovered.join(' , ')}`);

  const partition = [...evidence.removedPaths, ...evidence.addedPaths, ...evidence.recomputedPaths];
  if (new Set(partition).size !== partition.length) details.push('evidence partition lists overlap among removed/added/recomputed');
  if (new Set(partition).size !== affected.size || partition.some((k) => !affected.has(k))) {
    details.push('evidence affectedPaths is not the union of removed+added+recomputed');
  }
  for (const key of evidence.unchangedPaths) {
    if (affected.has(key)) details.push(`unchanged path ${key} is also listed as affected`);
    if (preCache.has(key) && postCache.has(key) && preCache.get(key) !== postCache.get(key)) {
      details.push(`unchanged path ${key} was recomputed (cached attribution object replaced)`);
    }
  }
  for (const key of evidence.recomputedPaths) {
    if (preCache.get(key) === postCache.get(key)) details.push(`recomputed path ${key} kept its old cached attribution`);
  }

  return details.length
    ? bad(`incremental vs full consistency [${label}]`, details)
    : ok(`incremental vs full consistency [${label}] (${affected.size} affected / ${postKeys.size} paths)`);
}
