/**
 * 皮影「关节操控 → 多关节联动 → 角色合成」链路统一验证入口。
 *
 * 运行：npm run verify   （Node >= 22 原生执行 TypeScript，零第三方依赖、零网络）
 *
 * 退出码：0 = 全部通过；1 = 存在失败项。
 */

import { type Harness } from './harness.ts';
import { runJointConvergenceSuite } from './suites/joint-convergence.ts';
import { runLinkageConsistencySuite } from './suites/linkage-consistency.ts';
import { runFigureCompositionSuite } from './suites/figure-composition.ts';
import { runDeterminismSuite } from './suites/determinism.ts';

const suites: Harness[] = [
  runJointConvergenceSuite(),
  runLinkageConsistencySuite(),
  runFigureCompositionSuite(),
  runDeterminismSuite(),
];

let passed = 0;
let failed = 0;

console.log('');
console.log('皮影关节联动 / 角色合成链路 · 离线验证');
console.log('======================================');

for (const suite of suites) {
  console.log('');
  console.log(`【${suite.suiteName}】(${suite.outcomes.length} 项)`);
  for (const outcome of suite.outcomes) {
    if (outcome.ok) {
      passed++;
      console.log(`  ✓ ${outcome.name}`);
    } else {
      failed++;
      console.log(`  ✗ ${outcome.name}`);
      for (const line of String(outcome.error).split('\n')) {
        console.log(`      ${line}`);
      }
    }
  }
}

console.log('');
console.log('--------------------------------------');
console.log(`合计：${passed} 项通过，${failed} 项失败（共 ${passed + failed} 项）`);
console.log('--------------------------------------');
if (failed === 0) {
  console.log('结论：全部通过 ✓');
} else {
  console.log('结论：存在失败项，请修正实现后重跑 ✗');
}
console.log('');
console.log('边界说明（当前实现无法稳定离线验证的部分，见 VERIFY.md）：');
console.log('  · 幕布投影 / drop-shadow / 皮革纹理等视觉结果依赖浏览器渲染，不在数值断言范围内');
console.log('  · Canvas 帧缓存、gif.js Worker 编码、Web Audio 旋律依赖浏览器 API，需真机/浏览器环境验证');
console.log('  · 上述项未通过任何形式的断言占位，不参与通过/失败统计');
console.log('');

process.exitCode = failed === 0 ? 0 : 1;
