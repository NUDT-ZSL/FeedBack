import { runSuites } from './harness.ts';
import { suites } from './scenarios.test.ts';
import { runSabotageDrills } from './sabotage.ts';

console.log('== 工坊状态一致性离线验证 ==');
console.log('（纯本地夹具，无网络、无外部账号依赖）');
console.log('');

console.log('[1/2] 边界场景验证');
const results = runSuites(suites);
const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);
console.log('');
console.log(`场景结果：${totalPassed} 通过，${totalFailed} 失败`);
console.log('');

console.log('[2/2] 故障演练（人为破坏各环节，验证套件必须全部捕获）');
const drillsCaught = runSabotageDrills((line) => console.log(line));
console.log('');

if (totalFailed > 0) {
  console.log(`验证失败：${totalFailed} 个场景未通过。`);
  process.exitCode = 1;
} else if (!drillsCaught) {
  console.log('验证失败：存在未被套件捕获的人为破坏，验证能力不可信。');
  process.exitCode = 1;
} else {
  console.log('全部验证通过：边界场景一致，且所有人为破坏均被明确捕获。');
}
