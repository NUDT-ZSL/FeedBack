/**
 * 统一批量验证入口：npm run verify
 *
 * 依次执行全部行为检查，逐项输出通过与否及关键中间量，
 * 任一检查失败时以非零退出码结束，便于接入回归流程。
 */

import { ALL_CHECKS, type CheckResult } from './checks';

function printResult(result: CheckResult, index: number): void {
  const mark = result.passed ? 'PASS' : 'FAIL';
  console.log(`\n[${mark}] ${index + 1}. ${result.title} (${result.id})`);
  for (const line of result.details) {
    console.log(`       ${line}`);
  }
  for (const failure of result.failures) {
    console.log(`       ✗ ${failure}`);
  }
}

function main(): void {
  console.log('=== 太阳系运动与聚焦链路离线验证 ===');
  console.log(`时间: ${new Date().toISOString()}（固定 delta 推进，结果与真实帧率无关）`);

  const results: CheckResult[] = [];
  for (const [index, check] of ALL_CHECKS.entries()) {
    let result: CheckResult;
    try {
      result = check();
    } catch (error) {
      result = {
        id: check.name,
        title: check.name,
        passed: false,
        details: [],
        failures: [`检查执行抛出异常: ${error instanceof Error ? error.stack ?? error.message : String(error)}`]
      };
    }
    results.push(result);
    printResult(result, index);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n=== 汇总: ${passed}/${results.length} 项通过 ===`);
  if (passed !== results.length) {
    console.log('失败项: ' + results.filter(r => !r.passed).map(r => r.id).join(', '));
    process.exit(1);
  }
}

main();
