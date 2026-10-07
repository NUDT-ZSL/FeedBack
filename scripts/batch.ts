// ---------------------------------------------------------------------------
// 统一批量入口（离线 CLI）
//   npm run batch                      运行内置批量用例
//   npm run batch -- cases.json        运行自定义批量文件（BatchCase[] 或 {cases}）
//   npm run batch -- --out report.json 导出报告
// 退出码：0 = 全部通过，1 = 存在失败
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch, type BatchCase, type BatchReport } from '../src/engine/batch.ts';
import { sampleBatchCases } from '../src/engine/sampleBatch.ts';

function loadCases(path: string): BatchCase[] {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return raw as BatchCase[];
  if (Array.isArray(raw.cases)) return raw.cases as BatchCase[];
  throw new Error('批量文件格式应为 BatchCase[] 或 { cases: BatchCase[] }');
}

function printReport(report: BatchReport): void {
  console.log(`\n批量推演报告：${report.totalCases} 组场景，${report.totalMutations} 组变更`);
  for (const caseReport of report.cases) {
    const mark = caseReport.ok ? 'PASS' : 'FAIL';
    console.log(`\n[${mark}] ${caseReport.caseId}`);
    console.log(
      `  事件 ${caseReport.stats.events}（消费 ${caseReport.stats.consumed} / 丢弃 ${caseReport.stats.dropped} / 保留 ${caseReport.stats.kept}），切换 ${caseReport.stats.switches} 次`,
    );
    if (caseReport.issues.length > 0) {
      console.log(`  输入问题：${caseReport.issues.map((i) => `${i.code}x${i.count}`).join(', ')}`);
    }
    for (const check of caseReport.checks) {
      console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}：${check.detail}`);
    }
    for (const mutation of caseReport.mutations) {
      const inc = mutation.incremental;
      const incInfo = inc
        ? `（复用块 ${inc.reusedBlocks} / 重算块 ${inc.recomputedBlocks}，受影响来源 ${inc.affectedSources.join(',') || '无'}，起始 tick ${inc.affectedFromTick ?? '-'}）`
        : '';
      console.log(`  ${mutation.ok ? '✓' : '✗'} 变更[${mutation.description}]：${mutation.detail}${incInfo}`);
    }
  }
  console.log(`\n总体：${report.ok ? '全部通过' : '存在失败项'}\n`);
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
const inputPath = args.find((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));

const cases = inputPath ? loadCases(inputPath) : sampleBatchCases();
const report = runBatch(cases);
printReport(report);
if (outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`报告已写入 ${outPath}`);
}
process.exit(report.ok ? 0 : 1);
