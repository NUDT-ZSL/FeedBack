/**
 * 时间胶囊生命周期自动化验证 —— 统一批量入口。
 *
 * 用法：npm run verify   （或 node scripts/verify.mjs）
 *
 * 完全离线运行：仅依赖 Node.js 内置 test runner（Node >= 22），
 * 不需要 npm install，不访问网络，不使用真实外部账号。
 * 时间相关断言全部通过注入固定时间戳完成，可重复复现边界时刻。
 *
 * 退出码：全部通过为 0，任一失败为 1（可直接接入 CI）。
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'tests');

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(testsDir, name));

if (files.length === 0) {
  console.error('❌ 未在 tests/ 下找到任何 .test.ts 用例');
  process.exit(1);
}

console.log(`🕰️  时间胶囊生命周期验证：发现 ${files.length} 个测试套件`);
for (const file of files) console.log(`   - ${file.replace(root + '/', '')}`);
console.log('');

const result = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', ...files],
  { stdio: 'inherit', cwd: root },
);

const passed = result.status === 0;
console.log('');
console.log('════════════════════════════════════════════════');
if (passed) {
  console.log('✅ 验证通过：全部生命周期用例成功');
} else {
  console.log('❌ 验证失败：存在未通过的用例，详见上方输出');
}
console.log('════════════════════════════════════════════════');
process.exit(result.status ?? 1);
