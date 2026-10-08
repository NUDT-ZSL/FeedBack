import { CheckCollector, startTestServer } from './harness';
import { runAuthSuite } from './suites/auth';
import { runLinkageSuite } from './suites/linkage';
import { runFiltersSuite } from './suites/filters';
import { runExportSuite } from './suites/export';
import type { SuiteContext } from './types';

interface SuiteDef {
  module: string;
  run: (ctx: SuiteContext) => Promise<void>;
}

const SUITES: SuiteDef[] = [
  { module: '鉴权与用户隔离', run: runAuthSuite },
  { module: '茶品与品鉴笔记联动', run: runLinkageSuite },
  { module: '筛选与分页边界', run: runFiltersSuite },
  { module: '导出内容完整性', run: runExportSuite },
];

const main = async (): Promise<void> => {
  const collector = new CheckCollector();
  const startedAt = Date.now();
  const { baseUrl, stop } = await startTestServer();

  try {
    for (const suite of SUITES) {
      const check = collector.forModule(suite.module);
      try {
        await suite.run({ baseUrl, check });
      } catch (error) {
        check('套件执行未抛出未捕获异常', false, `异常=${(error as Error).stack ?? String(error)}`);
      }
    }
  } finally {
    await stop();
  }

  console.log('\n========== 茶品收藏与品鉴笔记 · 离线批量验证报告 ==========\n');
  let currentModule = '';
  for (const result of collector.results) {
    if (result.module !== currentModule) {
      currentModule = result.module;
      console.log(`【${currentModule}】`);
    }
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${result.name}`);
    if (!result.ok && result.detail) {
      console.log(`        定位信息: ${result.detail}`);
    }
  }

  console.log('\n---------------- 汇总 ----------------');
  const moduleNames = [...new Set(collector.results.map((r) => r.module))];
  for (const name of moduleNames) {
    const rows = collector.results.filter((r) => r.module === name);
    const failed = rows.filter((r) => !r.ok).length;
    console.log(`  ${name}: ${rows.length - failed}/${rows.length} 通过${failed > 0 ? `（${failed} 项失败）` : ''}`);
  }
  console.log(`\n  总计: ${collector.passed} 通过, ${collector.failed} 失败, 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(collector.failed === 0 ? '  结论: 全部风险点验证通过 ✅' : '  结论: 存在未通过的风险点 ❌');

  process.exit(collector.failed === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('验证运行器自身异常:', error);
  process.exit(2);
});
