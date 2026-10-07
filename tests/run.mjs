// 茶道模拟器参数链路离线验证统一入口。
// 零依赖：直接用 Node(>=22.18) 内置 TS 类型擦除加载 src/TeaController.ts，
// 假定时器 + DOM 替身替代真实浏览器，全程无网络、无真实等待。
// 运行：npm test   或   node tests/run.mjs
import { createEnv } from './helpers/env.mjs';

const SUITES = [
  ['预设加载', './preset-load.test.mjs'],
  ['参数校验与告警', './param-warning.test.mjs'],
  ['预设连续切换', './preset-switch.test.mjs'],
  ['reset 与 dispose', './reset-dispose.test.mjs'],
  ['告警闪烁定时行为', './warning-flash.test.mjs'],
];

let passed = 0;
let failed = 0;
const failures = [];

for (const [suiteName, file] of SUITES) {
  const mod = await import(new URL(file, import.meta.url));
  console.log(`\n■ ${suiteName} (${file.replace('./', '')})`);
  for (const test of mod.default) {
    const env = createEnv();
    try {
      await test.fn(env);
      passed++;
      console.log(`  ✓ ${test.name}`);
    } catch (err) {
      failed++;
      failures.push({ suiteName, name: test.name, err });
      console.log(`  ✗ ${test.name}`);
      console.log(`    ${String((err && err.message) || err).split('\n').join('\n    ')}`);
    } finally {
      env.timers.restore();
      env.dom.restore();
    }
  }
}

console.log(`\n${'='.repeat(48)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 条用例`);
if (failed > 0) {
  console.log('失败用例:');
  for (const f of failures) console.log(`  - [${f.suiteName}] ${f.name}`);
}
process.exit(failed > 0 ? 1 : 0);
