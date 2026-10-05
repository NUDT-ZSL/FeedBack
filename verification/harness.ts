export interface CheckResult {
  suite: string;
  name: string;
  ok: boolean;
  detail?: string;
}

export interface TestContext {
  check(name: string, ok: boolean, detail?: string): void;
  approx(
    name: string,
    actual: number,
    expected: number,
    tolerance: number,
    unit?: string,
  ): void;
  step(name: string, fn: () => void): void;
}

export interface SuiteResult {
  name: string;
  checks: CheckResult[];
}

const results: CheckResult[] = [];

export function runSuite(
  name: string,
  fn: (t: TestContext) => void,
): SuiteResult {
  const checks: CheckResult[] = [];
  const ctx: TestContext = {
    check(caseName, ok, detail) {
      const result: CheckResult = { suite: name, name: caseName, ok: !!ok };
      if (detail) result.detail = detail;
      if (!ok && detail === undefined) {
        result.detail = new Error().stack?.split('\n')[2]?.trim();
      }
      checks.push(result);
      results.push(result);
    },
    approx(caseName, actual, expected, tolerance, unit) {
      const diff = Math.abs(actual - expected);
      checks.push({
        suite: name,
        name: caseName,
        ok: Number.isFinite(actual) && diff <= tolerance,
        detail: `actual=${actual} expected=${expected} diff=${diff} tol=${tolerance}${unit ? ' ' + unit : ''}`,
      });
      results.push(checks[checks.length - 1]);
    },
    step(stepName, stepFn) {
      try {
        stepFn();
      } catch (err) {
        checks.push({
          suite: name,
          name: stepName,
          ok: false,
          detail: err instanceof Error ? `${err.message}\n${err.stack}` : String(err),
        });
      }
    },
  };
  fn(ctx);
  return { name, checks };
}

export function allResults(): CheckResult[] {
  return results;
}

export function resetResults(): void {
  results.length = 0;
}
