/**
 * 从归因结论中提取可断言的投影。用例文件只声明期望的投影值，
 * 运行器据此计算实际投影并做差异比较。
 */

export function projectPathTotals(result) {
  const totals = {};
  for (const path of result.paths) totals[path.label] = path.totalMs;
  return totals;
}

export function projectSelfTimes(result) {
  const selfTimes = {};
  for (const path of result.paths) {
    for (const entry of path.entries) {
      selfTimes[`${path.label} :: ${entry.nodeId}`] = entry.selfMs;
    }
  }
  return selfTimes;
}

export function projectCumulativeTimes(result) {
  const cumulative = {};
  for (const path of result.paths) {
    for (const entry of path.entries) {
      cumulative[`${path.label} :: ${entry.nodeId}`] = entry.cumulativeMs;
    }
  }
  return cumulative;
}

export function projectSharedSelfTimes(result) {
  const shared = {};
  for (const [name, record] of Object.entries(result.sharedNodes)) {
    shared[name] = {};
    for (const [pathLabel, slot] of Object.entries(record)) {
      shared[name][pathLabel] = slot.selfMs;
    }
  }
  return shared;
}

export function projectAnomalies(result) {
  return result.anomalies.map((a) => `${a.type}@${a.traceId ?? ''}@${a.nodeId ?? ''}`).sort();
}

export function projectPathCount(result) {
  return result.paths.length;
}

export function projectAffectedPaths(evidence) {
  const affected = {};
  for (const item of evidence.affectedPaths) affected[item.label] = item.status;
  return affected;
}

export const projections = {
  pathTotals: projectPathTotals,
  selfTimes: projectSelfTimes,
  cumulativeTimes: projectCumulativeTimes,
  sharedSelfTimes: projectSharedSelfTimes,
  anomalies: projectAnomalies,
  pathCount: projectPathCount,
};

export function computeExpectations(result, expect) {
  const actual = {};
  for (const key of Object.keys(expect)) {
    const projector = projections[key];
    if (!projector) throw new Error(`unknown expectation projection: '${key}'`);
    actual[key] = projector(result);
  }
  return actual;
}
