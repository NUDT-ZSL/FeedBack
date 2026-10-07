// 离线测试构建与执行：使用项目自带的 esbuild（vite 依赖）打包测试，
// 不新增任何依赖，不需要网络，不需要浏览器。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'dist-test', 'run.cjs');

await build({
  entryPoints: [join(root, 'test', 'run.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile,
  logLevel: 'warning'
});

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exit(result.status ?? 1);
