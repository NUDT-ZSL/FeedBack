// 统一入口：一次性执行全部离线验证用例
// 运行方式：npm run verify
import './exchangeStatusConsistency.test';
import './unreadCountConsistency.test';
import './multiNotificationIsolation.test';
import './randomizedSequences.test';
import { runAll } from './harness';

runAll().catch((error) => {
  console.error('验证执行器异常:', error);
  process.exitCode = 1;
});
