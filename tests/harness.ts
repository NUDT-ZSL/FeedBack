declare const console: { log: (msg: string) => void };
declare const process: { exitCode: number | undefined };

export type TestFn = () => void | Promise<void>;

interface TestCase {
  name: string;
  fn: TestFn;
}

const tests: TestCase[] = [];

export function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

export function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message} (期望 ${String(expected)}, 实际 ${String(actual)})`);
  }
}

export function assertClose(actual: number, expected: number, eps: number, message: string): void {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`断言失败: ${message} (期望 ${expected}, 实际 ${actual}, 容差 ${eps})`);
  }
}

export function assertVec3Close(
  actual: readonly number[],
  expected: readonly number[],
  eps: number,
  message: string
): void {
  assertEqual(actual.length, expected.length, `${message} 维度`);
  for (let i = 0; i < actual.length; i++) {
    assertClose(actual[i], expected[i], eps, `${message} 第${i}分量`);
  }
}

export async function run(): Promise<void> {
  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (error) {
      failures.push({ name: t.name, error });
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n结果: ${passed} 通过, ${failures.length} 失败, 共 ${tests.length} 项`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
