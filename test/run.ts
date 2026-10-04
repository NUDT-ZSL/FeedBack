/**
 * 离线验证入口：批量执行 test/scenarios.ts 中的场景，
 * 对 PlantSimulation 的推演结果做断言，输出可读的差异定位。
 *
 * 运行：npm run verify
 */
import { PlantSimulation, SimulationSnapshot } from '../src/simulation.js';
import { scenarios, Scenario, Step } from './scenarios.js';

interface Failure {
  scenario: string;
  stepIndex: number;
  note: string;
  field: string;
  expected: string;
  actual: string;
}

const failures: Failure[] = [];
let totalChecks = 0;
let passedChecks = 0;

function fmt(value: unknown): string {
  if (typeof value === 'number') return value.toFixed(6);
  return String(value);
}

function checkStep(
  scenario: Scenario,
  stepIndex: number,
  sim: PlantSimulation,
  expect: Partial<Record<keyof SimulationSnapshot, number | string | boolean>>,
  tol: number,
  note: string
) {
  const snap = sim.snapshot();
  for (const [field, expected] of Object.entries(expect)) {
    totalChecks++;
    const actual = snap[field as keyof SimulationSnapshot];
    let ok: boolean;
    if (typeof expected === 'number' && typeof actual === 'number') {
      ok = Math.abs(actual - expected) <= tol;
    } else {
      ok = actual === expected;
    }
    if (ok) {
      passedChecks++;
      console.log(`    ✓ ${field} = ${fmt(actual)}${note ? `  (${note})` : ''}`);
    } else {
      failures.push({
        scenario: scenario.name,
        stepIndex,
        note,
        field,
        expected: fmt(expected),
        actual: fmt(actual)
      });
      console.log(`    ✗ ${field}: 期望 ${fmt(expected)}，实际 ${fmt(actual)}${note ? `  (${note})` : ''}`);
    }
  }
}

function runScenario(scenario: Scenario) {
  console.log(`\n▶ ${scenario.name} — ${scenario.description}`);
  const sim = new PlantSimulation(scenario.params ?? { light: 50, water: 50, temperature: 20 });

  scenario.steps.forEach((step: Step, index: number) => {
    if ('advance' in step) {
      const delta = step.delta ?? 1 / 60;
      const ticks = Math.round(step.advance / delta);
      for (let i = 0; i < ticks; i++) sim.update(delta);
    } else if ('setParams' in step) {
      sim.updateParams({ ...sim.params, ...step.setParams });
    } else if ('reset' in step) {
      sim.reset();
    }
    if (step.expect) {
      checkStep(scenario, index, sim, step.expect, step.tol ?? 0.001, step.note ?? '');
    }
  });
}

console.log('=== 植物生长推演离线验证 ===');
for (const scenario of scenarios) {
  runScenario(scenario);
}

console.log('\n=== 汇总 ===');
console.log(`场景 ${scenarios.length} 个，断言 ${totalChecks} 条，通过 ${passedChecks} 条，失败 ${failures.length} 条`);

if (failures.length > 0) {
  console.log('\n差异定位：');
  for (const f of failures) {
    console.log(`  [${f.scenario}] 步骤#${f.stepIndex} ${f.note}`);
    console.log(`    字段 ${f.field}: 期望 ${f.expected}，实际 ${f.actual}`);
  }
  process.exit(1);
}
console.log('全部场景通过 ✔');
