import { scenarios } from './scenarios.ts';

let passed = 0;
let failed = 0;

for (const scenario of scenarios) {
  console.log(`\n■ ${scenario.id} — ${scenario.title}`);
  for (const check of scenario.run()) {
    const mark = check.pass ? '✓' : '✗';
    console.log(`  ${mark} ${check.name} — ${check.detail}`);
    if (check.trace) {
      for (const line of check.trace) {
        console.log(`      trace: ${line}`);
      }
    }
    if (check.pass) passed += 1;
    else failed += 1;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`scenarios: ${scenarios.length}, checks passed: ${passed}, failed: ${failed}`);
if (failed > 0) {
  console.log('RESULT: FAIL');
  process.exit(1);
}
console.log('RESULT: PASS');
