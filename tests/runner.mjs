// 离线验证运行器：注册 TS 加载钩子后执行统一批量入口 tests/index.ts。
// 全程无网络、无 DOM、无全屏依赖。
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.join(rootDir, 'loader.mjs')).href);
await import(pathToFileURL(path.join(rootDir, 'index.ts')).href);
