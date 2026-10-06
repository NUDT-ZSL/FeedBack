#!/usr/bin/env node
/**
 * 三维时序回放与关键事件定位工作台 —— 离线批量验证入口。
 *
 * 用法：
 *   npm run verify            # 跑全部用例，输出可判定的通过/失败
 *   npm run verify -- --json  # 输出 JSON 报告（供 CI 消费）
 *
 * 特性：
 *   - 零依赖：仅用 Node 内置能力，不访问网络，本地样例内联于 verify/fixtures；
 *   - 可重复：所有随机性来自固定种子的确定性 PRNG；
 *   - 可归因：失败时输出用例 id 与判定类别（anomaly-attribution /
 *     conflict-adjudication / event-link-update / order-batch-independence /
 *     guardrail-self-check / baseline）；
 *   - 退出码：全部通过 0，任一失败 1。
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

interface CaseModule {
  id: string;
  category: string;
  run: () => void;
}

interface CaseResult {
  id: string;
  category: string;
  status: 'pass' | 'fail';
  durationMs: number;
  error?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const jsonMode = process.argv.includes('--json');

async function main(): Promise<void> {
  const caseDir = join(here, 'cases');
  const files = readdirSync(caseDir)
    .filter((f) => f.startsWith('case') && f.endsWith('.ts'))
    .sort();

  const results: CaseResult[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(caseDir, file)).href)) as CaseModule;
    const started = Date.now();
    try {
      mod.run();
      results.push({ id: mod.id, category: mod.category, status: 'pass', durationMs: Date.now() - started });
    } catch (err) {
      results.push({
        id: mod.id,
        category: mod.category,
        status: 'fail',
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failed = results.filter((r) => r.status === 'fail');
  const report = {
    suite: 'replay-workbench-verification',
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('三维时序回放判定链路 · 离线批量验证');
    console.log('='.repeat(60));
    for (const r of results) {
      const mark = r.status === 'pass' ? 'PASS' : 'FAIL';
      console.log(`[${mark}] ${r.id}  (${r.category})`);
      if (r.error) console.log(`       失败归因: ${r.error}`);
    }
    console.log('='.repeat(60));
    console.log(`合计 ${report.total} 个用例：通过 ${report.passed}，失败 ${report.failed}`);
    if (failed.length) {
      console.log('失败类别分布: ' + failed.map((f) => f.category).join(', '));
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('批量验证入口自身异常:', err);
  process.exit(2);
});
