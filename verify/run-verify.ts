import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printReport, runScenarios } from './harness.ts';
import { continuousScenarios } from './suites/continuous.ts';
import { exportScenarios } from './suites/export.ts';
import { boundaryScenarios } from './suites/boundary.ts';

const here = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

const suites = [
  { name: 'continuous-carving', scenarios: continuousScenarios },
  { name: 'export-reset', scenarios: exportScenarios },
  { name: 'boundary-validation', scenarios: boundaryScenarios },
];

const selected = filter
  ? suites.filter((s) => s.name.includes(filter) || s.scenarios.some((sc) => sc.id === filter))
  : suites;

if (selected.length === 0) {
  console.error(`no suite matched filter: ${filter}`);
  process.exit(2);
}

const all = [];
for (const suite of selected) {
  console.log(`== suite: ${suite.name} ==`);
  const scenarios = filter
    ? suite.scenarios.filter((sc) => sc.id === filter || suite.name.includes(filter))
    : suite.scenarios;
  const results = await runScenarios(scenarios);
  printReport(results);
  all.push(...results);
  console.log('');
}

const failed = all.filter((r) => !r.pass);
const reportDir = join(here, 'reports');
mkdirSync(reportDir, { recursive: true });
const reportPath = join(reportDir, 'verify-report.json');
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      offline: true,
      total: all.length,
      passed: all.length - failed.length,
      failed: failed.length,
      scenarios: all,
    },
    null,
    2,
  ),
);
console.log(`report written: ${reportPath}`);

if (failed.length > 0) {
  console.error(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('ALL SCENARIOS PASSED');
