import { CASES, CATEGORY } from './cases.js';

function runAll() {
  const reports = [];
  for (const testCase of CASES) {
    let failures = [];
    let error = null;
    try {
      failures = testCase.run();
    } catch (thrown) {
      error = thrown;
      failures = [
        {
          category: CATEGORY.PLACEMENT,
          detail: `验证用例自身抛出异常：${thrown?.message ?? thrown}`,
        },
      ];
    }
    reports.push({
      id: testCase.id,
      path: testCase.path,
      title: testCase.title,
      passed: failures.length === 0 && error === null,
      failures,
    });
  }
  return reports;
}

function printReport(reports) {
  const passed = reports.filter((r) => r.passed).length;
  const failed = reports.length - passed;
  const categoryCounts = {};
  for (const report of reports) {
    const tag = report.passed ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
    console.log(`[${tag}] (${report.path}) ${report.id} - ${report.title}`);
    for (const failure of report.failures) {
      categoryCounts[failure.category] = (categoryCounts[failure.category] ?? 0) + 1;
      console.log(`         \u001b[31m[${failure.category}]\u001b[0m ${failure.detail}`);
    }
  }
  console.log('');
  console.log(`合计 ${reports.length} 条：通过 ${passed}，失败 ${failed}`);
  const categories = Object.keys(categoryCounts);
  if (categories.length > 0) {
    console.log(`失败归类：${categories.map((c) => `${c} ${categoryCounts[c]} 处`).join('；')}`);
  }
  return failed === 0;
}

function main() {
  const reports = runAll();
  if (process.argv.includes('--json')) {
    const allPassed = reports.every((r) => r.passed);
    console.log(JSON.stringify({ passed: allPassed, reports }, null, 2));
    process.exitCode = allPassed ? 0 : 1;
    return;
  }
  const ok = printReport(reports);
  process.exitCode = ok ? 0 : 1;
}

main();
