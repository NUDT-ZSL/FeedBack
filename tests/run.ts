import { runSuites } from './harness';
import { suites } from './molecule-state.test';

declare const process: { exitCode: number | undefined };

console.log('分子编辑器化学状态离线验证');
console.log('==========================');
console.log('');

const allPassed = runSuites(suites);

if (!allPassed) {
  process.exitCode = 1;
}
