/** 零依赖微型测试框架：离线批量执行，输出明确通过/失败结论并以退出码汇报。 */

export interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
}

const registry: TestCase[] = [];
let currentSuite = '';

export function describe(suite: string, define: () => void): void {
  const prev = currentSuite;
  currentSuite = suite;
  define();
  currentSuite = prev;
}

export function it(name: string, fn: () => void | Promise<void>): void {
  registry.push({ suite: currentSuite, name, fn });
}

export function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message} — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`断言失败: ${message}\n  期望: ${e}\n  实际: ${a}`);
  }
}

export function assertThrows(fn: () => void, message: string): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`断言失败: ${message} — 期望抛出异常，但未抛出`);
}

export async function runAll(): Promise<number> {
  let passed = 0;
  let failed = 0;
  const failures: Array<{ test: TestCase; error: unknown }> = [];

  for (const test of registry) {
    try {
      await test.fn();
      passed++;
      console.log(`  ✓ [${test.suite}] ${test.name}`);
    } catch (error) {
      failed++;
      failures.push({ test, error });
      console.log(`  ✗ [${test.suite}] ${test.name}`);
    }
  }

  console.log('');
  if (failures.length > 0) {
    console.log('失败详情:');
    for (const { test, error } of failures) {
      console.log(`  [${test.suite}] ${test.name}`);
      console.log(`    ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log('');
  }
  console.log(`结果: ${passed} 通过, ${failed} 失败, 共 ${registry.length} 项`);
  console.log(failed === 0 ? '结论: 全部通过 ✓' : '结论: 存在失败 ✗');
  return failed === 0 ? 0 : 1;
}
