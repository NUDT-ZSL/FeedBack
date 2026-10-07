/**
 * 批量重复执行验证：node tests/batch.mjs [轮数]
 * 每轮完整跑一遍 vitest，任一轮失败即整体失败，用于离线批量复现验证。
 */
import { spawnSync } from 'node:child_process';

const rounds = Number.parseInt(process.argv[2] ?? '5', 10);
if (!Number.isInteger(rounds) || rounds < 1) {
  console.error('用法: node tests/batch.mjs [轮数>=1]');
  process.exit(2);
}

for (let i = 1; i <= rounds; i++) {
  console.log(`\n===== 第 ${i}/${rounds} 轮 =====`);
  const result = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run'],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`\n第 ${i} 轮验证失败，批量执行终止。`);
    process.exit(1);
  }
}

console.log(`\n全部 ${rounds} 轮验证通过。`);
