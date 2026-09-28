/** 极简离线测试框架：注册用例、断言、汇总通过/失败并设置退出码。 */

export interface TestCase {
  suite: string;
  name: string;
  fn: () => void;
}

const registry: TestCase[] = [];
let currentSuite = '未分组';

export function describe(suite: string, register: () => void): void {
  const prev = currentSuite;
  currentSuite = suite;
  register();
  currentSuite = prev;
}

export function test(name: string, fn: () => void): void {
  registry.push({ suite: currentSuite, name, fn });
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message ?? '断言失败'}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    );
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${message ?? '深比较失败'}：期望 ${e}，实际 ${a}`);
  }
}

export function assertClose(actual: number, expected: number, message?: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message ?? '数值断言失败'}：期望 ${expected}，实际 ${actual}`);
  }
}

export function runAll(): void {
  let passed = 0;
  const failures: { test: TestCase; error: Error }[] = [];

  for (const t of registry) {
    try {
      t.fn();
      passed++;
      console.log(`  ✓ [${t.suite}] ${t.name}`);
    } catch (err) {
      failures.push({ test: t, error: err as Error });
      console.log(`  ✗ [${t.suite}] ${t.name}`);
    }
  }

  console.log('');
  if (failures.length > 0) {
    console.log('失败详情：');
    for (const f of failures) {
      console.log(`  [${f.test.suite}] ${f.test.name}`);
      console.log(`    ${f.error.message}`);
    }
    console.log('');
  }
  console.log(`结果：${passed} 通过，${failures.length} 失败，共 ${registry.length} 个用例`);

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
