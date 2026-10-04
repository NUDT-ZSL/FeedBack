/**
 * 皮影关节链路离线验证统一入口。
 *
 * 用法：node tests/run.ts（或 npm run verify）
 * 完全离线：仅使用 Node 内置 node:test，不安装依赖、不访问网络、不需要浏览器。
 * 退出码：0 = 全部通过；1 = 存在失败。
 */

import { run } from 'node:test';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const suiteDir = join(here, 'puppet');
const files = readdirSync(suiteDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(suiteDir, name));

if (files.length === 0) {
  console.error('未找到任何验证用例（tests/puppet/*.test.ts）');
  process.exit(1);
}

interface CaseResult {
  file: string;
  name: string;
  ok: boolean;
  error?: string;
}

const results: CaseResult[] = [];
const stream = run({ files, concurrency: false });
stream.resume();

stream.on('test:pass', (data) => {
  if (data.details.type === 'suite') return;
  results.push({ file: data.file ?? '', name: data.name, ok: true });
});
stream.on('test:fail', (data) => {
  if (data.details.type === 'suite') return;
  const error = data.details.error;
  results.push({
    file: data.file ?? '',
    name: data.name,
    ok: false,
    error: error ? String(error.message ?? error) : '未知错误',
  });
});

stream.on('end', () => {
  const byFile = new Map<string, CaseResult[]>();
  for (const result of results) {
    const key = relative(here, result.file) || result.file;
    const list = byFile.get(key) ?? [];
    list.push(result);
    byFile.set(key, list);
  }

  console.log('');
  console.log('皮影关节链路离线验证结果');
  console.log('='.repeat(56));
  let pass = 0;
  let fail = 0;
  for (const [file, cases] of byFile) {
    const failed = cases.filter((item) => !item.ok);
    const mark = failed.length === 0 ? '✓' : '✗';
    console.log(`${mark} ${file}（${cases.length - failed.length}/${cases.length} 通过）`);
    for (const item of failed) {
      console.log(`    ✗ ${item.name}`);
      console.log(`      ${item.error?.split('\n')[0]}`);
    }
    pass += cases.length - failed.length;
    fail += failed.length;
  }
  console.log('='.repeat(56));
  console.log(`合计：${pass} 通过，${fail} 失败，共 ${pass + fail} 项`);
  console.log(fail === 0 ? '结论：全部通过 ✓' : '结论：存在失败 ✗');
  process.exit(fail === 0 ? 0 : 1);
});
