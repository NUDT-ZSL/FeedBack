import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'lantern-batch-'));

try {
  execFileSync(
    'npx',
    ['tsc', 'src/batch/batchScenarios.ts', '--outDir', outDir,
     '--module', 'commonjs', '--target', 'es2020', '--moduleResolution', 'node',
     '--strict', '--skipLibCheck'],
    { cwd: root, stdio: 'inherit' }
  );

  writeFileSync(join(outDir, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(
    join(outDir, 'runner.cjs'),
    `const { runBatchChecks } = require('./batch/batchScenarios.js');
const report = runBatchChecks();
for (const s of report.scenarios) {
  console.log((s.passed ? 'PASS' : 'FAIL') + '  ' + s.title);
  for (const c of s.checks) {
    if (!c.passed) console.log('   - FAIL: ' + c.name + (c.detail ? ' (' + c.detail + ')' : ''));
  }
  for (const v of s.invariantViolations) console.log('   - INVARIANT: ' + v);
}
console.log(report.passedChecks + '/' + report.totalChecks + ' checks passed');
process.exit(report.passed ? 0 : 1);
`
  );
  execFileSync('node', [join(outDir, 'runner.cjs')], { stdio: 'inherit' });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
