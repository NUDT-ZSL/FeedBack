/**
 * Offline verification entry point.
 *
 * Drives the real Plant class (the same code the browser render loop uses)
 * and the headless reference simulation (src/simulation.ts) through identical
 * parameter/time timelines, comparing stage, wilt progress and flowering
 * countdown after every tick, plus absolute expectations per scenario.
 *
 * Run with: npm run verify
 */
import {
  PlantParams,
  GrowthStage,
  computeFloweringCountdown,
  computeGrowthRate,
  createSimState,
  formatCountdown,
  getStageForTime,
  isWiltCondition,
  simApplyParams,
  simReset,
  simStep,
  SimState
} from '../src/simulation.js';
import { Expectation, Scenario, scenarios } from './scenarios.js';

// --- Minimal DOM stub: Plant only touches `document` when building flower
// petal textures at the flowering stage. No real browser is needed.
const canvasContextStub = {
  createLinearGradient: () => ({ addColorStop: () => {} }),
  fillRect: () => {},
  fillStyle: ''
};
(globalThis as Record<string, unknown>).document = {
  createElement: (tag: string) =>
    tag === 'canvas'
      ? { width: 0, height: 0, getContext: () => canvasContextStub }
      : {}
};

const { Plant } = await import('../src/plant.js');

// ---------------------------------------------------------------------------
// Failure collection & reporting
// ---------------------------------------------------------------------------

interface Failure {
  scenario: string;
  step: string;
  field: string;
  expected: string;
  actual: string;
}

const failures: Failure[] = [];
let checkCount = 0;

function recordFailure(
  scenario: string,
  step: string,
  field: string,
  expected: string,
  actual: string
) {
  failures.push({ scenario, step, field, expected, actual });
}

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(6);
}

function approxEqual(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
// Unit checks on the pure boundary functions
// ---------------------------------------------------------------------------

function expectClose(fn: string, actual: number, expected: number, tol = 1e-9) {
  checkCount++;
  if (!approxEqual(actual, expected, tol)) {
    recordFailure('unit-checks', fn, 'value', fmt(expected), fmt(actual));
  }
}

function expectEqual<T>(fn: string, actual: T, expected: T) {
  checkCount++;
  if (actual !== expected) {
    recordFailure('unit-checks', fn, 'value', String(expected), String(actual));
  }
}

function runUnitChecks() {
  // Stage boundary critical values
  expectEqual('stage(0)', getStageForTime(0), 'seed');
  expectEqual('stage(4.999999)', getStageForTime(4.999999), 'seed');
  expectEqual('stage(5)', getStageForTime(5), 'sprout');
  expectEqual('stage(14.999999)', getStageForTime(14.999999), 'sprout');
  expectEqual('stage(15)', getStageForTime(15), 'adult');
  expectEqual('stage(29.999999)', getStageForTime(29.999999), 'adult');
  expectEqual('stage(30)', getStageForTime(30), 'flowering');
  expectEqual('stage(1000)', getStageForTime(1000), 'flowering');

  // Wilt thresholds are exclusive: exactly 15/90/5/35 is still "normal"
  const at = (light: number, water: number, temperature: number) =>
    isWiltCondition({ light, water, temperature });
  expectEqual('wilt(light=15)', at(15, 50, 20), false);
  expectEqual('wilt(light=14.9)', at(14.9, 50, 20), true);
  expectEqual('wilt(light=90)', at(90, 50, 20), false);
  expectEqual('wilt(light=90.1)', at(90.1, 50, 20), true);
  expectEqual('wilt(water=15)', at(50, 15, 20), false);
  expectEqual('wilt(water=90.1)', at(50, 90.1, 20), true);
  expectEqual('wilt(temp=5)', at(50, 50, 5), false);
  expectEqual('wilt(temp=4.9)', at(50, 50, 4.9), true);
  expectEqual('wilt(temp=35)', at(50, 50, 35), false);
  expectEqual('wilt(temp=35.1)', at(50, 50, 35.1), true);

  // Growth rate: temperature comfort zone [10, 32] is inclusive
  const rate = (t: number) =>
    computeGrowthRate({ light: 50, water: 50, temperature: t });
  expectClose('rate(temp=10)', rate(10), 1.0);
  expectClose('rate(temp=9.9)', rate(9.9), 0.51);
  expectClose('rate(temp=32)', rate(32), 1.0);
  expectClose('rate(temp=32.1)', rate(32.1), 0.51);
  expectClose('rate(temp=20)', rate(20), 1.0);
  expectClose(
    'rate(light=0)',
    computeGrowthRate({ light: 0, water: 50, temperature: 20 }),
    0.3
  );

  // Flowering countdown
  const normal = { light: 50, water: 50, temperature: 20 };
  expectClose('countdown(t=0)', computeFloweringCountdown(0, normal), 30);
  expectClose('countdown(t=31)', computeFloweringCountdown(31, normal), 0);
  expectClose(
    'countdown(t=15,temp=33)',
    computeFloweringCountdown(15, { light: 50, water: 50, temperature: 33 }),
    15 / 0.51,
    1e-6
  );
  expectEqual('format(flowering)', formatCountdown('flowering', 5), '已开花 🌸');
  expectEqual('format(24.9)', formatCountdown('adult', 24.9), '25 秒');
  expectEqual('format(30)', formatCountdown('seed', 30), '30 秒');
  expectEqual('format(0.001)', formatCountdown('adult', 0.001), '1 秒');
}

// ---------------------------------------------------------------------------
// Scenario runner: double-drive Plant + headless sim over the same timeline
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS: PlantParams = { light: 50, water: 50, temperature: 20 };
const CONSISTENCY_TOL = 1e-9;

interface Snapshot {
  stage: GrowthStage;
  isWilting: boolean;
  growthTime: number;
  wiltProgress: number;
  countdownText: string;
}

function snapshotPlant(plant: InstanceType<typeof Plant>, params: PlantParams): Snapshot {
  return {
    stage: plant.currentStage,
    isWilting: plant.getIsWilting(),
    growthTime: plant.getGrowthTime(),
    wiltProgress: plant.getWiltProgress(),
    countdownText: formatCountdown(
      plant.currentStage,
      computeFloweringCountdown(plant.getGrowthTime(), params)
    )
  };
}

function snapshotSim(sim: SimState, params: PlantParams): Snapshot {
  return {
    stage: sim.stage,
    isWilting: sim.isWilting,
    growthTime: sim.growthTime,
    wiltProgress: sim.wiltProgress,
    countdownText: formatCountdown(
      sim.stage,
      computeFloweringCountdown(sim.growthTime, params)
    )
  };
}

function compareSnapshots(
  scenario: string,
  step: string,
  plant: Snapshot,
  sim: Snapshot
) {
  checkCount++;
  if (plant.stage !== sim.stage) {
    recordFailure(scenario, step, 'stage', sim.stage, plant.stage);
  }
  if (plant.isWilting !== sim.isWilting) {
    recordFailure(scenario, step, 'isWilting', String(sim.isWilting), String(plant.isWilting));
  }
  if (!approxEqual(plant.growthTime, sim.growthTime, CONSISTENCY_TOL)) {
    recordFailure(scenario, step, 'growthTime', fmt(sim.growthTime), fmt(plant.growthTime));
  }
  if (!approxEqual(plant.wiltProgress, sim.wiltProgress, CONSISTENCY_TOL)) {
    recordFailure(scenario, step, 'wiltProgress', fmt(sim.wiltProgress), fmt(plant.wiltProgress));
  }
  if (plant.countdownText !== sim.countdownText) {
    recordFailure(scenario, step, 'countdownText', sim.countdownText, plant.countdownText);
  }
}

function checkExpectation(scenario: string, step: string, actual: Snapshot, exp: Expectation) {
  const tol = exp.tolerance ?? 1e-6;
  const check = (field: keyof Snapshot, ok: boolean, expected: string) => {
    checkCount++;
    if (!ok) recordFailure(scenario, step, field, expected, String(actual[field]));
  };
  if (exp.stage !== undefined) check('stage', actual.stage === exp.stage, exp.stage);
  if (exp.isWilting !== undefined) check('isWilting', actual.isWilting === exp.isWilting, String(exp.isWilting));
  if (exp.growthTime !== undefined)
    check('growthTime', approxEqual(actual.growthTime, exp.growthTime, tol), fmt(exp.growthTime));
  if (exp.growthTimeBelow !== undefined)
    check('growthTime', actual.growthTime < exp.growthTimeBelow, `< ${fmt(exp.growthTimeBelow)}`);
  if (exp.growthTimeAbove !== undefined)
    check('growthTime', actual.growthTime > exp.growthTimeAbove, `> ${fmt(exp.growthTimeAbove)}`);
  if (exp.wiltProgress !== undefined)
    check('wiltProgress', approxEqual(actual.wiltProgress, exp.wiltProgress, Math.max(tol, 1e-3)), fmt(exp.wiltProgress));
  if (exp.wiltProgressBelow !== undefined)
    check('wiltProgress', actual.wiltProgress < exp.wiltProgressBelow, `< ${fmt(exp.wiltProgressBelow)}`);
  if (exp.wiltProgressAbove !== undefined)
    check('wiltProgress', actual.wiltProgress > exp.wiltProgressAbove, `> ${fmt(exp.wiltProgressAbove)}`);
  if (exp.countdownSeconds !== undefined)
    check(
      'countdownText',
      approxEqual(
        computeFloweringCountdown(actual.growthTime, currentParams),
        exp.countdownSeconds,
        Math.max(tol, 1e-3)
      ),
      fmt(exp.countdownSeconds)
    );
  if (exp.countdownText !== undefined)
    check('countdownText', actual.countdownText === exp.countdownText, exp.countdownText);
}

let currentParams: PlantParams = { ...DEFAULT_PARAMS };

function runScenario(scenario: Scenario) {
  const plant = new Plant({ ...DEFAULT_PARAMS });
  const sim = createSimState();
  currentParams = { ...DEFAULT_PARAMS };
  let simTime = 0;

  scenario.ops.forEach((op, opIndex) => {
    const label = `op#${opIndex} ${JSON.stringify(op).slice(0, 80)}`;
    switch (op.kind) {
      case 'set': {
        currentParams = { ...currentParams, ...op.params };
        plant.updateParams({ ...currentParams });
        simApplyParams(sim, currentParams);
        compareSnapshots(scenario.name, label, snapshotPlant(plant, currentParams), snapshotSim(sim, currentParams));
        break;
      }
      case 'advance': {
        const delta = op.delta ?? 1 / 60;
        let t = 0;
        while (t < op.seconds - 1e-12) {
          const d = Math.min(delta, op.seconds - t);
          plant.update(d);
          simStep(sim, currentParams, d);
          t += d;
          simTime += d;
          compareSnapshots(
            scenario.name,
            `${label} tick t=${simTime.toFixed(4)}s`,
            snapshotPlant(plant, currentParams),
            snapshotSim(sim, currentParams)
          );
        }
        break;
      }
      case 'reset': {
        plant.reset();
        simReset(sim);
        compareSnapshots(scenario.name, label, snapshotPlant(plant, currentParams), snapshotSim(sim, currentParams));
        break;
      }
      case 'expect': {
        const note = op.note ? ` [${op.note}]` : '';
        checkExpectation(
          scenario.name,
          `op#${opIndex} expect${note}`,
          snapshotPlant(plant, currentParams),
          op.expect
        );
        break;
      }
    }
  });

  plant.dispose();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('=== 植物生长模拟离线验证 ===\n');

runUnitChecks();
console.log(`[unit-checks] 纯函数边界检查完成`);

for (const scenario of scenarios) {
  const before = failures.length;
  runScenario(scenario);
  const status = failures.length === before ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${scenario.name} — ${scenario.description}`);
}

console.log(`\n共执行 ${checkCount} 项检查`);

if (failures.length > 0) {
  console.log(`\n发现 ${failures.length} 处差异:`);
  const shown = failures.slice(0, 30);
  for (const f of failures.slice(0, 30)) {
    console.log(`  ✗ [${f.scenario}] ${f.step}`);
    console.log(`      字段 ${f.field}: 期望 ${f.expected}, 实际 ${f.actual}`);
  }
  if (failures.length > shown.length) {
    console.log(`  … 其余 ${failures.length - shown.length} 处省略`);
  }
  process.exitCode = 1;
} else {
  console.log('全部通过：界面状态与离线复算结果一致 ✔');
}
