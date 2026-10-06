export interface TestCase {
  name: string;
  fn(): void;
}

export interface Suite {
  name: string;
  cases: TestCase[];
}

export interface SuiteResult {
  name: string;
  passed: number;
  failed: Array<{ name: string; error: Error }>;
}

export function suite(name: string, define: (test: (name: string, fn: () => void) => void) => void): Suite {
  const cases: TestCase[] = [];
  define((caseName, fn) => cases.push({ name: caseName, fn }));
  return { name, cases };
}

export function runSuites(suites: Suite[], options: { quiet?: boolean } = {}): SuiteResult[] {
  return suites.map((s) => {
    const result: SuiteResult = { name: s.name, passed: 0, failed: [] };
    for (const c of s.cases) {
      try {
        c.fn();
        result.passed += 1;
        if (!options.quiet) console.log(`  \u2713 ${c.name}`);
      } catch (error) {
        result.failed.push({ name: c.name, error: error as Error });
        if (!options.quiet) {
          console.log(`  \u2717 ${c.name}`);
          console.log(`      ${(error as Error).message}`);
        }
      }
    }
    return result;
  });
}

export function fail(message: string): never {
  throw new Error(message);
}

export function expect(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

export function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function expectDeepEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function expectThrows(fn: () => void, label: string, errorName?: string): Error {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    fail(`${label}: expected an error but none was thrown`);
  }
  if (errorName && (thrown as Error).name !== errorName) {
    fail(`${label}: expected ${errorName}, got ${(thrown as Error).name}`);
  }
  return thrown as Error;
}
