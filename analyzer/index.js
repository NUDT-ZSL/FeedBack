import { importSamples } from './import.js';
import { attributeTrace, computeSharedNodes } from './attribute.js';

export { buildTrace, importSamples } from './import.js';
export { attributeTrace, computeSharedNodes, computeSelfTimes } from './attribute.js';
export { canonicalize, canonicalString } from './canonical.js';
export { createEngine } from './incremental.js';

function sortAnomalies(anomalies) {
  return [...anomalies].sort((a, b) => {
    const ka = `${a.type}@${a.traceId ?? ''}@${a.nodeId ?? ''}`;
    const kb = `${b.type}@${b.traceId ?? ''}@${b.nodeId ?? ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * 基于已导入的 trace 集合与每个 trace 的归因缓存，组装整体归因结论。
 */
export function assembleResult(traces, attributionByTrace) {
  const paths = [];
  const anomalies = [];
  for (const [traceId, trace] of traces) {
    const attribution = attributionByTrace.get(traceId);
    paths.push(...attribution.paths);
    anomalies.push(...trace.anomalies, ...attribution.anomalies);
  }
  paths.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    paths,
    sharedNodes: computeSharedNodes(paths),
    anomalies: sortAnomalies(anomalies),
  };
}

/**
 * 全量归因：导入样本 -> 还原调用树 -> 逐路径归因。
 */
export function analyze(samples) {
  const { traces } = importSamples(samples);
  const attributionByTrace = new Map();
  for (const [traceId, trace] of traces) {
    attributionByTrace.set(traceId, attributeTrace(trace));
  }
  return assembleResult(traces, attributionByTrace);
}
