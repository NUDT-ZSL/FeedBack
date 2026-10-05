// 编译产物为 CommonJS, 而仓库根 package.json 为 "type": "module",
// 因此在 dist 内写入局部 package.json 声明 CommonJS, 保证 node 可直接执行。
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const dist = join(__dirname, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'package.json'), JSON.stringify({ type: 'commonjs' }) + '\n');
