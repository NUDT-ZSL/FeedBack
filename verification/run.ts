import { runChecks } from './framework';
import { saltChecks, saltErrorChecks } from './suites/salt';
import { ironChecks } from './suites/iron';
import { reportChecks } from './suites/report';
import { searchChecks } from './suites/search';
import { reproChecks } from './suites/repro';

const suites: Array<{ title: string; checks: Parameters<typeof runChecks>[0] }> = [
  { title: '盐引核验链路', checks: saltChecks },
  { title: '错误语义', checks: saltErrorChecks },
  { title: '铁券变更链路', checks: ironChecks },
  { title: '月度汇总口径', checks: reportChecks },
  { title: '混合搜索与排序', checks: searchChecks },
  { title: '可复现性', checks: reproChecks },
];

async function main(): Promise<void> {
  let exitCode = 0;
  for (const suite of suites) {
    console.log(`\n[${suite.title}]`);
    const code = await runChecks(suite.checks);
    if (code !== 0) {
      exitCode = code;
    }
  }
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error('验证执行器自身故障:', error);
  process.exitCode = 2;
});
