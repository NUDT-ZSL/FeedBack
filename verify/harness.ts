// Minimal offline test harness: no framework, no browser, runs under
// `node verify/run.ts`. Each check is tagged with the chain it belongs
// to (terrain / fence / hole / strokes / golden) so a physics change
// points at the affected chain instead of one opaque failure.

export interface CaseResult {
  chain: string;
  name: string;
  passed: boolean;
  details: string[];
}

function fmt(v: unknown): string {
  return typeof v === 'number' ? String(Number(v.toPrecision(12))) : JSON.stringify(v);
}

export class Tester {
  private result: CaseResult;

  constructor(result: CaseResult) {
    this.result = result;
  }

  ok(condition: boolean, message: string): void {
    if (!condition) {
      this.result.passed = false;
      this.result.details.push(message);
    }
  }

  equal<T>(actual: T, expected: T, label: string): void {
    if (actual !== expected) {
      this.result.passed = false;
      this.result.details.push(`${label}: expected ${fmt(expected)}, got ${fmt(actual)}`);
    }
  }

  approx(actual: number, expected: number, eps: number, label: string): void {
    if (!(Math.abs(actual - expected) <= eps)) {
      this.result.passed = false;
      this.result.details.push(
        `${label}: expected ~${fmt(expected)} +/-${eps}, got ${fmt(actual)}`
      );
    }
  }
}

export class Harness {
  private results: CaseResult[] = [];

  test(chain: string, name: string, fn: (t: Tester) => void): void {
    const result: CaseResult = { chain, name, passed: true, details: [] };
    try {
      fn(new Tester(result));
    } catch (err) {
      result.passed = false;
      result.details.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.results.push(result);
  }

  get failedCount(): number {
    return this.results.filter((r) => !r.passed).length;
  }

  printReport(): void {
    let chain = '';
    for (const r of this.results) {
      if (r.chain !== chain) {
        chain = r.chain;
        console.log(`\n[${chain}]`);
      }
      console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.name}`);
      for (const d of r.details) console.log(`        -> ${d}`);
    }
    const passed = this.results.length - this.failedCount;
    console.log(`\n${passed}/${this.results.length} cases passed, ${this.failedCount} failed`);
    if (this.failedCount > 0) {
      const chains = [...new Set(this.results.filter((r) => !r.passed).map((r) => r.chain))];
      console.log(`affected chains: ${chains.join(', ')}`);
    }
  }
}
