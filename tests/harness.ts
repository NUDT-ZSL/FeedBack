// Minimal offline test harness: no external dependencies, runs via tsx.

export type TestFn = () => void | Promise<void>;

interface Suite {
  name: string;
  tests: { name: string; fn: TestFn }[];
}

const suites: Suite[] = [];
let current: Suite | null = null;

export function describe(name: string, register: () => void): void {
  const suite: Suite = { name, tests: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  register();
  current = prev;
}

export function it(name: string, fn: TestFn): void {
  if (!current) throw new Error(`it("${name}") called outside describe()`);
  current.tests.push({ name, fn });
}

export async function runAll(): Promise<number> {
  let passed = 0;
  let failed = 0;
  for (const suite of suites) {
    console.log(`\n[suite] ${suite.name}`);
    for (const t of suite.tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  PASS ${t.name}`);
      } catch (err) {
        failed++;
        console.log(`  FAIL ${t.name}`);
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`       ${msg}`);
      }
    }
  }
  console.log(`\n========================================`);
  console.log(`total: ${passed + failed}, passed: ${passed}, failed: ${failed}`);
  return failed === 0 ? 0 : 1;
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

export function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}:\n  expected ${e}\n  got      ${a}`);
}
