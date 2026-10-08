#!/usr/bin/env node
/**
 * 紫檀木躺椅工坊 —— 离线批量验证入口
 *
 * 用法：
 *   node scripts/run-tests.mjs
 *   npm test
 *
 * 说明：
 * - 零依赖、完全离线：直接调用 Node 内置 node:test 运行器。
 * - Node >= 22.6 原生支持运行 TypeScript（类型擦除），无需编译与安装。
 * - 低版本 Node 会给出明确提示并退出。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'tests')
const testFiles = readdirSync(testDir)
  .filter(name => name.endsWith('.test.ts'))
  .sort()
  .map(name => join(testDir, name))

if (testFiles.length === 0) {
  console.error('未找到任何测试文件（tests/*.test.ts）')
  process.exit(1)
}

const [major, minor] = process.versions.node.split('.').map(Number)
const supportsNativeTs = major > 22 || (major === 22 && minor >= 6) || major >= 23

console.log(`离线批量验证：共 ${testFiles.length} 个测试文件（Node ${process.version}）`)
for (const file of testFiles) {
  console.log(`  - ${file.replace(root + '/', '')}`)
}
console.log('')

if (!supportsNativeTs) {
  console.error(
    `当前 Node ${process.version} 不支持直接运行 TypeScript 测试，请使用 Node >= 22.6（推荐 22 LTS）。`
  )
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  ['--no-warnings', '--test', ...testFiles],
  { cwd: root, stdio: 'inherit' }
)

process.exit(result.status === null ? 1 : result.status)
