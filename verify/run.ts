/**
 * 离线批量验证入口：不启动界面，Node 直接执行全部套件并输出可读中文结论。
 *   node --experimental-strip-types verify/run.ts          （本机 Node 22 已原生支持）
 *   node verify/run.ts --json                             （机读报告）
 */
import { getResults, printReport } from './lib/harness.ts';
import './suites.normal.ts';
import './suites.boundary.ts';
import './suites.failure.ts';
import './suites.entries.ts';
import './suites.incremental.ts';

void getResults();
const code = printReport(process.argv.includes('--json'));
process.exitCode = code;
