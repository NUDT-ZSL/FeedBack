export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface ScenarioResult {
  id: string;
  title: string;
  checks: CheckResult[];
  pass: boolean;
  durationMs: number;
}

export interface Scenario {
  id: string;
  title: string;
  run: (t: TestContext) => void | Promise<void>;
}

export class ExpectError extends Error {}

export class TestContext {
  readonly checks: CheckResult[] = [];

  check(name: string, condition: boolean, detail?: string): void {
    this.checks.push({ name, pass: condition, detail });
    if (!condition) {
      throw new ExpectError(`check failed: ${name}${detail ? ` (${detail})` : ''}`);
    }
  }

  equal<T>(name: string, actual: T, expected: T): void {
    const pass = Object.is(actual, expected);
    this.check(
      name,
      pass,
      pass ? undefined : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }

  deepEqual(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    this.check(name, a === b, a === b ? undefined : `expected=${b} actual=${a}`);
  }

  throws(name: string, fn: () => void, code?: string): void {
    try {
      fn();
    } catch (err) {
      const errCode = (err as { code?: string }).code;
      const pass = code === undefined || errCode === code;
      this.check(
        name,
        pass,
        pass ? undefined : `expected error code=${code} got=${String(errCode)}`,
      );
      return;
    }
    this.check(name, false, 'expected function to throw, but it returned');
  }
}

export async function runScenarios(scenarios: Scenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const ctx = new TestContext();
    const start = Date.now();
    let pass = true;
    try {
      await scenario.run(ctx);
    } catch (err) {
      pass = false;
      if (!(err instanceof ExpectError)) {
        ctx.checks.push({
          name: 'unexpected exception',
          pass: false,
          detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
      }
    }
    if (ctx.checks.some((c) => !c.pass)) pass = false;
    results.push({
      id: scenario.id,
      title: scenario.title,
      checks: ctx.checks,
      pass,
      durationMs: Date.now() - start,
    });
  }
  return results;
}

export function printReport(results: ScenarioResult[]): void {
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.id} ${r.title} (${r.durationMs}ms)`);
    for (const c of r.checks) {
      const cm = c.pass ? '  ok ' : '  XX ';
      console.log(`  ${cm} ${c.name}${c.detail ? ` -- ${c.detail}` : ''}`);
    }
  }
  const failed = results.filter((r) => !r.pass);
  const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
  const failedChecks = results.reduce(
    (n, r) => n + r.checks.filter((c) => !c.pass).length,
    0,
  );
  console.log('');
  console.log(
    `scenarios: ${results.length - failed.length}/${results.length} passed, ` +
      `checks: ${totalChecks - failedChecks}/${totalChecks} passed`,
  );
}
