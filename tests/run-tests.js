const assert = require("node:assert/strict");
const path = require("node:path");
require(path.join(__dirname, "..", "js", "analysis.js"));
const C = globalThis.MovementAnalysisCore;

function point(id, targetId, time, lat, lon, originalOrder) {
  return { id, targetId, time: new Date(Date.UTC(2026, 8, 22, 2, 0, time)).toISOString(), lat, lon, originalOrder };
}

function stableTrack(id, baseLat, baseLon) {
  const out = [];
  for (let s = 0; s <= 420; s += 60) {
    out.push(point(`${id}-${s}`, id, s, baseLat + (s % 120 ? 0.00002 : -0.00002), baseLon));
  }
  return out;
}

const points = [
  ...stableTrack("A", 31.23, 121.47),
  ...stableTrack("B", 31.23012, 121.47012),
  point("C-0", "C", 0, 31.23005, 121.47005),
  point("C-60", "C", 60, 31.23008, 121.47008),
  point("C-120", "C", 120, 31.23005, 121.47005),
  point("C-300-LATE", "C", 90, 31.23006, 121.47006, 99),
  point("C-DUP", "C", 60, 31.23008, 121.47008, 100),
  point("C-DRIFT", "C", 180, 31.27, 121.5, 101),
  point("C-240", "C", 240, 31.23006, 121.47006),
  point("C-300", "C", 300, 31.2401, 121.4801),
  point("C-360", "C", 360, 31.2402, 121.4802)
];

const full = C.analyzeAll(points, {
  clusterRadius: 50, minStayDuration: 300, companionRadius: 50,
  stableCompanionDuration: 300, maxTrackingGap: 180, driftSpeed: 55
});

function findPoint(id) {
  return full.points.find(p => p.id === id);
}
assert(findPoint("C-300-LATE").anomalies.some(a => a.type === "out_of_order"), "倒序点必须保留并标记");
assert(findPoint("C-DUP").anomalies.some(a => a.type === "duplicate"), "重复点必须保留并标记");
assert(findPoint("C-DRIFT").excluded, "明显漂移点必须标记为排除但保留");
assert(full.points.some(p => p.anomalies.some(a => a.type === "speed_gap")), "速度异常应提示");
assert(full.targets.filter(t => ["A", "B"].includes(t.targetId)).every(t => t.stays.length >= 1), "静止目标应推导出停留段");
assert(
  C.analyzeAll([
    point("X-0", "X", 0, 31.23000, 121.47000),
    point("X-1", "X", 60, 31.23001, 121.47001),
    point("Y-0", "Y", 0, 31.23002, 121.47002),
    point("Y-1", "Y", 60, 31.23003, 121.47003),
    point("Z-0", "Z", 0, 31.23004, 121.47004),
    point("Z-1", "Z", 60, 31.23005, 121.47005)
  ], { clusterRadius: 50, minStayDuration: 1, companionRadius: 5000, stableCompanionDuration: 30, maxTrackingGap: 180 })
    .groups.every(g => g.durationSec > 0),
  "同时结束的多人稳定关系不应产生 0 秒伪群体"
);
assert(full.relations.some(r => r.relation === "stable" && r.targetIds.includes("A") && r.targetIds.includes("B")), "A/B 应稳定同行");
assert(full.relations.some(r => r.relation === "casual" && r.targetIds.includes("A") && r.targetIds.includes("C")), "A/C 应为偶发接近");
assert(full.groups.length >= 0, "群体分析应返回结果且不崩溃");

function comparable(result) {
  const normalizePoint = p => JSON.stringify({
    id: p.id, targetId: p.targetId, time: p.time, canonical: p.canonical,
    anomalies: p.anomalies.map(a => [a.type, a.severity]).sort()
  });
  const normalizeSegment = s => JSON.stringify({
    id: s.id, kind: s.kind, start: s.startPointId, end: s.endPointId,
    evidence: s.evidencePointIds, center: s.center,
    radius: s.radiusM, distance: s.distanceM
  });
  const normalizeRelation = r => JSON.stringify({
    pair: r.targetIds.slice().sort(), type: r.relation, start: r.startTime,
    end: r.endTime, confidence: r.confidence, avg: r.avgDistanceM,
    max: r.maxDistanceM, evidence: r.evidencePointIds.sort(), samples: r.sampleEvidence
  });
  return {
    points: result.points.map(normalizePoint).sort(),
    segments: result.targets.flatMap(t => t.segments).map(normalizeSegment).sort(),
    relations: result.relations.map(normalizeRelation).sort()
  };
}

function assertSameAnalysis(actual, expected, label) {
  const a = comparable(actual), e = comparable(expected);
  assert.deepEqual(a, e, label);
}

const edited = points.map(p => p.id === "C-60"
  ? { ...p, lat: 31.24, lon: 121.48 }
  : p);
const state = C.createState(points, full.params);
C.updatePoints(state, edited, { targetId: "C" });
assert(state.relationChanges.some(ch => ch.kind === "removed" || ch.kind === "changed"), "修破同行关系时必须标出去失或变化");
assertSameAnalysis(state.analysis, C.analyzeAll(edited, full.params), "单点局部更新应与整体重推一致");

C.updateParams(state, { stableCompanionDuration: 600 }, { targetParams: false, companionParams: true });
assertSameAnalysis(state.analysis, C.analyzeAll(edited, { ...full.params, stableCompanionDuration: 600 }), "同行参数局部更新应与整体重推一致");

C.updateParams(state, { clusterRadius: 30 }, { targetParams: true, companionParams: false });
assertSameAnalysis(state.analysis, C.analyzeAll(edited, { ...full.params, stableCompanionDuration: 600, clusterRadius: 30 }), "停留参数局部更新应与整体重推一致");

const renamedState = C.createState(edited, full.params);
const renamed = renamedState.rawPoints.map(p => p.id === "C-60" ? { ...p, id: "C-60-RENAMED", targetId: "D" } : p);
renamedState.rawPoints = renamed;
C.recomputeState(renamedState, ["C", "D"], "point_edit");
assertSameAnalysis(renamedState.analysis, C.analyzeAll(renamed, full.params), "修改点 ID/目标后的局部更新应与整体重推一致");

console.log("全部分析测试通过：异常保留、停留/移动、稳定/偶发同行、变更标记、增量=整体重推");
