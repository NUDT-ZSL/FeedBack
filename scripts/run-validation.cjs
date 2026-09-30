const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.validation-build');

fs.rmSync(buildDir, { recursive: true, force: true });

const tscCommand = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');

if (!fs.existsSync(tscCommand)) {
  console.error('离线验证缺少依赖，请先运行 npm ci 安装 package-lock.json 中锁定的依赖。');
  process.exit(1);
}

const compile = spawnSync(
  process.execPath,
  [tscCommand, '-p', 'tsconfig.validate.json'],
  { cwd: root, stdio: 'inherit', windowsVerbatimArguments: false }
);

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

fs.writeFileSync(
  path.join(buildDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2)
);

const testFiles = fs
  .readdirSync(path.join(buildDir, 'tests'))
  .filter(file => file.endsWith('.js'))
  .map(file => path.join(buildDir, 'tests', file));

const runTests = spawnSync(
  process.execPath,
  ['--test', ...testFiles],
  { cwd: root, stdio: 'inherit' }
);

process.exit(runTests.status ?? 1);
