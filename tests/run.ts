// 统一批量运行入口：一次性跑完全部离线验证并输出通过/失败结论。
// 运行方式：npm run verify（或 npm test）

import { runCases } from './harness.js';
import { addDeleteCases } from './cases/add-delete.cases.js';
import { navigationCases } from './cases/navigation.cases.js';
import { editingCases } from './cases/editing.cases.js';
import { presentationCases } from './cases/presentation.cases.js';
import { invariantCases } from './cases/invariants.cases.js';

const suites = [
  { name: '幻灯片新增与删除', cases: addDeleteCases },
  { name: '导航与键盘', cases: navigationCases },
  { name: '内容编辑（标题/图表/数据点/注释）', cases: editingCases },
  { name: '演示模式与全屏降级', cases: presentationCases },
  { name: '不变量与混合序列', cases: invariantCases }
];

const outcome = await runCases(suites);

console.log('\n========================================');
console.log(`验证结果: 共 ${outcome.passed + outcome.failed} 条用例，通过 ${outcome.passed} 条，失败 ${outcome.failed} 条`);

if (outcome.failed > 0) {
  console.log('\n失败定位汇总:');
  for (const line of outcome.failureLines) {
    console.log(`  ${line}`);
  }
  process.exit(1);
}

console.log('全部验证通过。');
