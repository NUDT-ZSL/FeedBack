import { readFileSync, writeFileSync } from 'node:fs';

import { verificationPath } from './paths';
import { resetResults } from './harness';
import { boundarySuite } from './suites/boundary';
import { phasesSuite } from './suites/phases';
import { visibilitySuite } from './suites/visibility';
import { recordsSuite } from './suites/records';
import { goldenSuite } from './suites/golden';
import { computeEclipse, listSyzygies } from '../src/lib/astronomy/engine';
import { jdToCivil, formatCivil } from '../src/lib/astronomy/time';
import { GoldenCase } from './golden-types';

const goldenPath = verificationPath('golden', 'eclipse-cases.json');

function loadGoldenCases(): GoldenCase[] {
  return JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenCase[];
}

function updateGolden(): void {
  const cases = loadGoldenCases();
  for (const gc of cases) {
    const result = computeEclipse(gc.input);
    const phases: Record<string, number> = {};
    for (const p of result.phases) phases[p.key] = p.jdUtc;
    gc.expected = {
      kind: result.kind,
      type: result.type,
      typeLabel: result.typeLabel,
      magnitude: result.magnitude,
      phases,
      visible: result.visibility?.visible ?? false,
      visibilityReason: result.visibility?.reason ?? 'no_eclipse',
    };
  }
  writeFileSync(goldenPath, JSON.stringify(cases, null, 2) + '\n', 'utf8');
  console.log(`已更新 ${cases.length} 条基准样例 -> ${goldenPath}`);
}

function listEclipses(): void {
  const events = listSyzygies(1280, 1380);
  for (const e of events) {
    const c = jdToCivil(e.jd);
    console.log(
      `${formatCivil(c)}  ${e.kind.padEnd(5)}  ${e.type.padEnd(9)}  mag=${e.magnitude.toFixed(4)}  jd=${e.jd.toFixed(5)}`,
    );
  }
  console.log(`共 ${events.length} 次食象 (1280-1380)`);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    listEclipses();
    return;
  }
  if (args.includes('--update')) {
    updateGolden();
    return;
  }

  resetResults();
  const cases = loadGoldenCases();
  const suites = [
    boundarySuite(),
    phasesSuite(cases),
    visibilitySuite(cases),
    recordsSuite(),
    goldenSuite(cases),
  ];

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  for (const suite of suites) {
    for (const check of suite.checks) {
      if (check.ok) {
        pass += 1;
      } else {
        fail += 1;
        failures.push(`  [${check.suite}] ${check.name}${check.detail ? `\n      ${check.detail}` : ''}`);
      }
    }
    const suitePass = suite.checks.filter((c) => c.ok).length;
    const suiteFail = suite.checks.length - suitePass;
    console.log(
      `${suiteFail === 0 ? 'PASS' : 'FAIL'}  ${suite.name}  (${suitePass} 通过${suiteFail ? `, ${suiteFail} 失败` : ''})`,
    );
  }
  console.log('');
  if (failures.length > 0) {
    console.log('失败明细:');
    for (const f of failures.slice(0, 40)) console.log(f);
    if (failures.length > 40) console.log(`  ... 其余 ${failures.length - 40} 条省略`);
    console.log('');
  }
  console.log(`合计: ${pass} 通过, ${fail} 失败, 共 ${pass + fail} 项检查`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
