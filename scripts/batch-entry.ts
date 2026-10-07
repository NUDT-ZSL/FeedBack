/**
 * 批量入口（Node）：读取 JSON 用例文件，运行推演并核对结论自洽性。
 * 由 scripts/batch.mjs 经 esbuild 打包后执行。
 */
import { readFileSync } from "node:fs";
import { runBatch, BatchCase } from "../src/engine/index";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("用法: node batch-dist.cjs <case1.json> [case2.json ...]");
  process.exit(2);
}

const cases: BatchCase[] = files.map((f) => {
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  const arr: BatchCase[] = Array.isArray(parsed) ? parsed : [parsed];
  return arr;
}).flat();

const reports = runBatch(cases);
let failed = 0;
for (const r of reports) {
  const status = r.ok ? "PASS" : "FAIL";
  if (!r.ok) failed += 1;
  console.log(`\n[${status}] ${r.caseName}`);
  for (const b of r.blockingIssues) console.log(`  阻塞: ${b}`);
  if (r.invariantReport) {
    for (const inv of r.invariantReport.invariants) {
      console.log(`  不变量 ${inv.ok ? "✓" : "✗"} ${inv.name}${inv.detail ? ` (${inv.detail})` : ""}`);
    }
  }
  for (const m of r.mutations) {
    console.log(
      `  变更 ${m.ok ? "✓" : "✗"} ${m.name} ` +
      `(增量复用快照: ${m.resumedFromSnapshot ? "是" : "否"})`,
    );
    for (const f of m.failures) console.log(`    ✗ ${f}`);
  }
  if (r.stats) {
    console.log(
      `  统计: 共 ${r.stats.totalEvents} 事件, 保留 ${r.stats.kept}, ` +
      `丢弃 ${r.stats.dropped}, 降采样 ${r.stats.downsampledOut}, ` +
      `暂存 ${r.stats.held}, 队列残留 ${r.stats.queued}`,
    );
  }
}
console.log(`\n== 批量结果: ${reports.length - failed}/${reports.length} 通过 ==`);
process.exit(failed === 0 ? 0 : 1);
