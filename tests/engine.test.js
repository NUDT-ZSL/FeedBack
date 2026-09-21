const assert = require("node:assert/strict");
const { PlanEngine } = require("../src/engine");
const sample = require("../src/sample-data");

const clone = (value) => JSON.parse(JSON.stringify(value));

function baseline() {
  return new PlanEngine(clone(sample));
}

function assertSameAsFresh(engine, cutoff) {
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(engine.analyze(cutoff))),
    JSON.parse(JSON.stringify(engine.fullReanalyze(cutoff)))
  );
}

function testBasicCumulativeProgress() {
  const engine = baseline();
  const result = engine.analyze();
  const p2 = result.phases.find((phase) => phase.id === "P2");
  assert.equal(p2.cumulativeActual, 1220 + 1530);
  assert.equal(p2.cumulativeTarget, 2700);
  assert.equal(p2.status, "achieved");
  assert.equal(p2.shortfall, 0);
  assert.equal(p2.trusted, true);
}

function testTargetChangeAffectsDependentsAndMatchesFullRecompute() {
  const engine = baseline();
  const output = engine.setPhaseTarget("P1", 1400);
  assert.deepEqual(output.affected, ["P1", "P2", "P3"]);
  const p1 = output.analysis.phases.find((phase) => phase.id === "P1");
  const p2 = output.analysis.phases.find((phase) => phase.id === "P2");
  assert.equal(p1.status, "behind");
  assert.equal(p1.shortfall, 180);
  assert.equal(p2.cumulativeTarget, 2900);
  assert.equal(p2.status, "behind");
  for (let cutoff = 0; cutoff < engine.periods.length; cutoff += 1) {
    assertSameAsFresh(engine, cutoff);
  }
}

function testActualCorrectionAffectsOwnAndDownstream() {
  const engine = baseline();
  const output = engine.setMeasureActual("M1", "2024H2", 470);
  assert.deepEqual(output.affected, ["P1", "P2", "P3"]);
  const p1 = output.analysis.phases.find((phase) => phase.id === "P1");
  assert.equal(p1.ownActual, 320 + 470 + 210 + 300);
  assert.equal(p1.status, "achieved");
  assertSameAsFresh(engine);
}

function testMeasureExclusionMatchesFullRecompute() {
  const engine = baseline();
  const output = engine.setMeasureExcluded("M2", true);
  assert.deepEqual(output.affected, ["P1", "P2", "P3"]);
  assert.equal(output.analysis.summary.totalActual, 1220 - 510 + 1530 + 1610);
  assertSameAsFresh(engine);
  const restored = engine.setMeasureExcluded("M2", false);
  assert.deepEqual(restored.analysis.phases.find((phase) => phase.id === "P1").ownActual, 1220);
  assertSameAsFresh(engine);
}

function testLockOnlyOverridesOwnConclusion() {
  const engine = baseline();
  engine.setPhaseTarget("P1", 1400);
  const locked = engine.setPhaseLock("P1", "achieved");
  const p1 = locked.analysis.phases.find((phase) => phase.id === "P1");
  const p2 = locked.analysis.phases.find((phase) => phase.id === "P2");
  assert.equal(p1.status, "achieved");
  assert.equal(p1.locked, true);
  assert.equal(p1.lockMismatch, true);
  assert.equal(p2.status, "behind");
  assert.equal(p2.locked, false);
  assertSameAsFresh(engine);
}

function testMixedRepeatedAdjustmentsStayConsistentAcrossCutoffs() {
  const engine = baseline();
  engine.setPhaseTarget("P2", 1550);
  engine.setMeasureActual("M5", "2026H2", 560);
  engine.setMeasureExcluded("M4", true);
  engine.setPhaseLock("P3", "achieved");
  engine.setMeasureExcluded("M4", false);
  engine.setMeasureActual("M1", "2024H1", 300);
  const result = engine.analyze();
  assert.ok(result.phases.find((phase) => phase.id === "P3").locked);
  for (let cutoff = 0; cutoff < engine.periods.length; cutoff += 1) {
    assertSameAsFresh(engine, cutoff);
  }
}

function testCycleIsReportedAndPropagated() {
  const data = clone(sample);
  data.phases[0].prerequisites = ["P3"];
  const engine = new PlanEngine(data);
  const result = engine.analyze();
  assert.ok(result.issues.some((issue) => issue.code === "PREREQUISITE_CYCLE"));
  assert.deepEqual(result.invalidPhaseIds.sort(), ["P1", "P2", "P3"]);
  assert.ok(result.phases.every((phase) => phase.trusted === false));
}

function testMissingPrerequisiteIsReported() {
  const data = clone(sample);
  data.phases[1].prerequisites = ["P1", "PX"];
  const engine = new PlanEngine(data);
  const result = engine.analyze();
  assert.ok(result.issues.some((issue) => issue.code === "PREREQUISITE_MISSING"));
  assert.ok(result.invalidPhaseIds.includes("P2"));
  assert.ok(result.invalidPhaseIds.includes("P3"));
  assert.ok(!result.invalidPhaseIds.includes("P1"));
}

function testMeasureAssignedToMultiplePhasesIsUntrusted() {
  const data = clone(sample);
  data.measures.push({ id: "M_DUP", name: "重复归属", phaseId: "P1", planned: 100, actuals: {} });
  data.measures.push({ id: "M_DUP", name: "重复归属", phaseId: "P2", planned: 100, actuals: {} });
  const engine = new PlanEngine(data);
  const result = engine.analyze();
  assert.ok(result.issues.some((issue) => issue.code === "MEASURE_PHASE_DUPLICATE"));
  assert.deepEqual(result.invalidPhaseIds.sort(), ["P1", "P2", "P3"]);
}

const tests = [
  testBasicCumulativeProgress,
  testTargetChangeAffectsDependentsAndMatchesFullRecompute,
  testActualCorrectionAffectsOwnAndDownstream,
  testMeasureExclusionMatchesFullRecompute,
  testLockOnlyOverridesOwnConclusion,
  testMixedRepeatedAdjustmentsStayConsistentAcrossCutoffs,
  testCycleIsReportedAndPropagated,
  testMissingPrerequisiteIsReported,
  testMeasureAssignedToMultiplePhasesIsUntrusted
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}
console.log(`${tests.length} tests passed`);
