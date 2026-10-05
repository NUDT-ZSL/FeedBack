// 统一批量入口：注册全部验证序列并执行。
import { runAll } from './harness';
import './storyState.test';
import './presentation.test';

declare const process: { exitCode?: number };

runAll().then(code => {
  process.exitCode = code;
});
