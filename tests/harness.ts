// Minimal zero-dependency test harness.
//
// Design goals:
//  - Every assertion is attached to a named invariant (e.g. INV-PRICE-01),
//    so a failure report points at the violated business rule instead of a
//    bare stack trace.
//  - A failing check never aborts the suite: all checks run and all
//    failures are collected, then reported grouped by invariant.
//  - Fully offline: no imports beyond node builtins.

export interface Failure {
  suite: string;
  invariant: string;
  scenario: string;
  message: string;
}

export interface CheckRecorder {
  /** Record a boolean condition as an invariant check. */
  expect(condition: boolean, message: string): void;
  /** Record an equality check (actual === expected). */
  eq(actual: unknown, expected: unknown, label: string): void;
}

export type SuiteBody = (inv: (id: string, name: string, scenario: string) => CheckRecorder) => void;

interface SuiteDef {
  name: string;
  body: SuiteBody;
}

const suites: SuiteDef[] = [];

export function suite(name: string, body: SuiteBody): void {
  suites.push({ name, body });
}

class Recorder implements CheckRecorder {
  private readonly failures: Failure[];
  private readonly suiteName: string;
  private readonly invariant: string;
  private readonly scenario: string;

  constructor(
    failures: Failure[],
    suiteName: string,
    invariant: string,
    scenario: string
  ) {
    this.failures = failures;
    this.suiteName = suiteName;
    this.invariant = invariant;
    this.scenario = scenario;
  }

  expect(condition: boolean, message: string): void {
    if (!condition) {
      this.failures.push({
        suite: this.suiteName,
        invariant: this.invariant,
        scenario: this.scenario,
        message
      });
    }
  }

  eq(actual: unknown, expected: unknown, label: string): void {
    if (actual !== expected) {
      this.expect(false, `${label}: 期望 ${fmt(expected)}, 实际 ${fmt(actual)}`);
    }
  }
}

function fmt(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

export interface RunResult {
  totalChecks: number;
  failures: Failure[];
  suiteErrors: { suite: string; error: string }[];
}

export function runAll(): RunResult {
  const failures: Failure[] = [];
  const suiteErrors: { suite: string; error: string }[] = [];
  let totalChecks = 0;

  for (const s of suites) {
    const countingFailures = failures.length;
    const inv = (id: string, name: string, scenario: string): CheckRecorder => {
      totalChecks++;
      return new Recorder(failures, s.name, `${id} ${name}`, scenario);
    };
    try {
      s.body(inv);
    } catch (err) {
      suiteErrors.push({
        suite: s.name,
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
      });
    }
    void countingFailures;
  }

  return { totalChecks, failures, suiteErrors };
}

export function printReport(result: RunResult, meta: { seed: number; fuzzOps: number; fuzzSeeds: number }): void {
  const line = '='.repeat(64);
  console.log(line);
  console.log('交易/采矿结算 — 离线不变量验证报告');
  console.log(`随机种子: ${meta.seed}   fuzz 每种子操作数: ${meta.fuzzOps}   fuzz 种子数: ${meta.fuzzSeeds}`);
  console.log(line);

  if (result.suiteErrors.length > 0) {
    console.log('\n!! 套件执行异常（未能完成全部检查）:');
    for (const e of result.suiteErrors) {
      console.log(`  [套件异常] ${e.suite}\n    ${e.error.split('\n').join('\n    ')}`);
    }
  }

  if (result.failures.length === 0 && result.suiteErrors.length === 0) {
    console.log(`\n全部通过 ✔  (共 ${result.totalChecks} 个不变量检查点)`);
    return;
  }

  const byInvariant = new Map<string, Failure[]>();
  for (const f of result.failures) {
    const list = byInvariant.get(f.invariant) ?? [];
    list.push(f);
    byInvariant.set(f.invariant, list);
  }

  console.log(`\n失败 ✘  ${result.failures.length} 处断言，涉及 ${byInvariant.size} 条不变量 (共 ${result.totalChecks} 个检查点):`);
  for (const [invariant, list] of byInvariant) {
    console.log(`\n  ✘ 不变量 ${invariant}`);
    for (const f of list) {
      console.log(`      套件:   ${f.suite}`);
      console.log(`      场景:   ${f.scenario}`);
      console.log(`      失败:   ${f.message}`);
    }
  }
  console.log('\n提示: 每条失败均标注了被违反的不变量编号与触发场景，可据此定位业务规则。');
}
