/**
 * 离线批量验证入口：node verification/run.mjs
 * 零网络依赖；失败时退出码非 0，并按风险类别定位失败用例与检查项。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll, printSummary } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(here, 'verification-report.json');

const summary = await runAll({ reportPath });
printSummary(summary, reportPath);
process.exit(summary.verdict === 'PASS' ? 0 : 1);
