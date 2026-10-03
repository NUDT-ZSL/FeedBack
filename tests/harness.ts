// 零依赖离线测试框架：test 注册、断言、统一报告。
// 不依赖浏览器与网络，配合 scripts/run-tests.mjs 在 Node 下运行。

export interface TestCase {
  suite: string;
  name: string;
  fn: () => void | Promise<void>;
}

const registry: TestCase[] = [];
let currentSuite = '';

export function suite(name: string): void {
  currentSuite = name;
}

export function test(name: string, fn: () => void | Promise<void>): void {
  registry.push({ suite: currentSuite, name, fn });
}

export class AssertError extends Error {}

function fmt(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : String(value);
  return JSON.stringify(value);
}

export interface Assert {
  ok(cond: unknown, msg?: string): asserts cond;
  equal(actual: unknown, expected: unknown, msg?: string): void;
  close(actual: number, expected: number, tol: number, msg?: string): void;
  between(value: number, min: number, max: number, msg?: string): void;
  finite(value: number, msg?: string): void;
  throws(fn: () => void, msg?: string): void;
}

export const assert: Assert = {
  ok(cond: unknown, msg = 'expected condition to be truthy'): asserts cond {
    if (!cond) throw new AssertError(msg);
  },
  equal(actual: unknown, expected: unknown, msg?: string): void {
    if (actual !== expected) {
      throw new AssertError(msg ?? `expected ${fmt(expected)}, got ${fmt(actual)}`);
    }
  },
  close(actual: number, expected: number, tol: number, msg?: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
      throw new AssertError(
        msg ?? `expected ${fmt(actual)} ≈ ${fmt(expected)} (tol ${tol}), diff=${Math.abs(actual - expected)}`
      );
    }
  },
  between(value: number, min: number, max: number, msg?: string): void {
    if (!(value >= min && value <= max)) {
      throw new AssertError(msg ?? `expected ${fmt(value)} in [${fmt(min)}, ${fmt(max)}]`);
    }
  },
  finite(value: number, msg?: string): void {
    if (!Number.isFinite(value)) {
      throw new AssertError(msg ?? `expected finite number, got ${fmt(value)}`);
    }
  },
  throws(fn: () => void, msg?: string): void {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) throw new AssertError(msg ?? 'expected function to throw');
  }
};

export interface TestResult {
  suite: string;
  name: string;
  ok: boolean;
  error?: string;
}

export async function runAll(): Promise<number> {
  const results: TestResult[] = [];
  for (const tc of registry) {
    try {
      await tc.fn();
      results.push({ suite: tc.suite, name: tc.name, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ suite: tc.suite, name: tc.name, ok: false, error: message });
    }
  }

  let lastSuite = '';
  for (const r of results) {
    if (r.suite !== lastSuite) {
      console.log(`\n[${r.suite}]`);
      lastSuite = r.suite;
    }
    if (r.ok) {
      console.log(`  PASS  ${r.name}`);
    } else {
      console.log(`  FAIL  ${r.name}`);
      console.log(`        ${r.error}`);
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n========================================`);
  console.log(`总计 ${results.length} 项：通过 ${passed}，失败 ${failed}`);
  console.log(failed === 0 ? '结论：全部通过' : '结论：存在失败用例');
  return failed === 0 ? 0 : 1;
}
