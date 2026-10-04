import { Suite, type SuiteFn } from './harness';
import { matchConsistencySuite } from './suites/matchConsistency';
import { questionSelectionSuite } from './suites/questionSelection';
import { answerSubmissionSuite } from './suites/answerSubmission';
import { timerProgressionSuite } from './suites/timerProgression';
import { roomCleanupSuite } from './suites/roomCleanup';

const suites: { name: string; fn: SuiteFn }[] = [
  { name: '匹配度与雷达数据一致性', fn: matchConsistencySuite },
  { name: '题目抽取可复现性', fn: questionSelectionSuite },
  { name: '作答提交健壮性', fn: answerSubmissionSuite },
  { name: '计时推进（手动驱动）', fn: timerProgressionSuite },
  { name: '房间清理与残留计时', fn: roomCleanupSuite },
];

let totalChecks = 0;
let failedChecks = 0;
const failedSuites: string[] = [];

for (const { name, fn } of suites) {
  const suite = new Suite(name);
  try {
    fn(suite);
  } catch (error) {
    suite.check('套件执行过程中未抛出异常', false, error instanceof Error ? error.stack : String(error));
  }

  const failed = suite.results.filter(r => !r.passed);
  totalChecks += suite.results.length;
  failedChecks += failed.length;
  if (failed.length > 0) failedSuites.push(name);

  const status = failed.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\n[${status}] ${name}（${suite.results.length - failed.length}/${suite.results.length} 通过）`);
  for (const result of failed) {
    console.log(`  ✗ ${result.name}`);
    if (result.detail) {
      console.log(`    ${result.detail}`);
    }
  }
}

console.log('\n========================================');
if (failedChecks === 0) {
  console.log(`全部通过：${suites.length} 个套件，${totalChecks} 项断言。`);
} else {
  console.log(`失败 ${failedChecks}/${totalChecks} 项断言，涉及套件：${failedSuites.join('、')}`);
  process.exitCode = 1;
}
