import './exchangeConsistency.test';
import './unreadCount.test';
import './notificationIsolation.test';
import './randomOrder.test';
import { getTests } from './helpers';

async function main(): Promise<void> {
  const tests = getTests();
  console.log(`离线验证套件：共 ${tests.length} 个用例\n`);
  let passed = 0;
  const failures: string[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ [${t.suite}] ${t.name}`);
    } catch (err) {
      failures.push(`[${t.suite}] ${t.name}`);
      console.error(`  ✗ [${t.suite}] ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n结果: ${passed}/${tests.length} 通过`);
  if (failures.length > 0) {
    console.error(`失败用例:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('全部不变量验证通过：状态流转与通知标记一致，未读计数与通知集合吻合。');
}

main().catch((err) => {
  console.error('测试运行器异常:', err);
  process.exit(1);
});
