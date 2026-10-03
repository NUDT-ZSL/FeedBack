// 离线测试运行器：用本地 esbuild 将 TS 测试打包为单文件 ESM，再用 Node 执行。
// 不访问网络、不需要浏览器；退出码即测试结果（0 = 全部通过）。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, '.test-build', 'tests.bundle.mjs');

await build({
  entryPoints: [path.join(root, 'tests', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile,
  logLevel: 'warning'
});

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exit(result.status ?? 1);
