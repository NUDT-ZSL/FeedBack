// 轨迹推演自动化验证的统一批量入口。
// 完全离线：只使用 Node 内置 test runner 与本地构造样例，不访问网络与外部服务。
// 用法：node tests/run.ts   或   npm run verify:trajectory
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const suiteDir = join(here, 'trajectory');
const files = readdirSync(suiteDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => join(suiteDir, f));

console.log(`[verify] trajectory deduction batch verification (offline, deterministic)`);
console.log(`[verify] node ${process.version}, ${files.length} suite file(s):`);
for (const f of files) console.log(`         - ${f}`);

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[verify] failed to launch test runner: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(
    '[verify] FAILED — 上方失败用例以 seg-XX / comp-XX / inc-XX 编号标识，' +
      '断言信息中包含具体位置点 ID、参数组合或随机种子，可直接定位。',
  );
  process.exit(result.status ?? 1);
}
console.log('[verify] OK — 分段、同行与增量重推结论全部可复现且与全量重推一致。');
