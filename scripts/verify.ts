#!/usr/bin/env node
import { runVerification } from '../src/engine/verify.ts';

const report = runVerification();

console.log('数字灵感板 · 卡组功能统一批量验证');
console.log('='.repeat(56));
for (const item of report.cases) {
  console.log(`\n[${item.passed ? 'PASS' : 'FAIL'}] ${item.name}`);
  for (const line of item.details) console.log(`  ${line}`);
}
console.log('\n' + '='.repeat(56));
console.log(`结果：${report.passed}/${report.cases.length} 通过，${report.failed} 失败（${report.finishedAt}）`);
process.exit(report.ok ? 0 : 1);
