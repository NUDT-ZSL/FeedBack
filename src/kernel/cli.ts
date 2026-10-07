import { readFileSync } from 'node:fs';
import { runBatch } from './batch.ts';
import { runScenarios } from './scenarios.ts';
import type { KernelEvent } from './divinationKernel.ts';

/**
 * 离线批量运行入口：
 *   node --experimental-strip-types src/kernel/cli.ts            运行内置场景集
 *   node --experimental-strip-types src/kernel/cli.ts events.json 重放自定义事件序列
 *
 * 事件文件为 KernelEvent 数组的 JSON（时间戳由文件注入），
 * 输出逐步状态快照与最终状态，同样输入产出完全一致的结果。
 */
const eventsFile = process.argv[2];

if (eventsFile) {
  const events = JSON.parse(readFileSync(eventsFile, 'utf8')) as KernelEvent[];
  const report = runBatch(events);
  console.log(JSON.stringify(report, null, 2));
} else {
  const reports = runScenarios();
  let failed = 0;
  for (const report of reports) {
    if (report.failures.length === 0) {
      console.log(`✓ ${report.name} — ${report.description}`);
    } else {
      failed += 1;
      console.log(`✗ ${report.name} — ${report.description}`);
      for (const failure of report.failures) {
        console.log(`    - ${failure}`);
      }
    }
  }
  const total = reports.length;
  console.log(
    failed === 0
      ? `\n全部 ${total} 个场景通过。`
      : `\n${failed}/${total} 个场景失败。`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
