export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

export interface Suite {
  name: string;
  tests: TestCase[];
}

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

export function suite(name: string, define: () => void): void {
  const s: Suite = { name, tests: [] };
  suites.push(s);
  currentSuite = s;
  define();
  currentSuite = null;
}

export function test(name: string, fn: () => void | Promise<void>): void {
  if (!currentSuite) throw new Error('test() 必须在 suite() 内调用');
  currentSuite.tests.push({ name, fn });
}

export class AssertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertError';
  }
}

function formatValue(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  return json.length > 300 ? json.slice(0, 300) + '…' : json;
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertError(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertError(
      `${message ?? '值不相等'}\n    期望: ${formatValue(expected)}\n    实际: ${formatValue(actual)}`
    );
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => deepEqual(aObj[key], bObj[key]));
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertError(
      `${message ?? '深度比较不相等'}\n    期望: ${formatValue(expected)}\n    实际: ${formatValue(actual)}`
    );
  }
}

export async function runAll(): Promise<number> {
  let passed = 0;
  let failed = 0;
  const failures: { suite: string; test: string; error: string }[] = [];

  for (const s of suites) {
    console.log(`\n■ ${s.name}`);
    for (const t of s.tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  ✓ ${t.name}`);
      } catch (error) {
        failed++;
        const detail = error instanceof Error ? error.message : String(error);
        failures.push({ suite: s.name, test: t.name, error: detail });
        console.log(`  ✗ ${t.name}`);
        console.log(`    ${detail.split('\n').join('\n    ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  if (failed === 0) {
    console.log(`全部通过：${passed} 个用例，0 个失败`);
  } else {
    console.log(`结果：${passed} 个通过，${failed} 个失败`);
    console.log('\n失败定位：');
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.suite}] ${f.test}`);
    });
  }
  return failed;
}
