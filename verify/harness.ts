/**
 * 零依赖验证小框架：提供 check/分组/汇总，失败信息定位到 tick 与星体。
 * 完全离线运行（Node ESM，无浏览器、无网络）。
 */

export interface CheckFailure {
  group: string;
  message: string;
}

export class CheckContext {
  failures: CheckFailure[] = [];
  checks = 0;

  constructor(readonly group: string) {}

  ok(condition: boolean, message: string): void {
    this.checks += 1;
    if (!condition) this.failures.push({ group: this.group, message });
  }

  /** 浮点数近似相等（度），默认双精度容差 */
  approx(
    actual: number,
    expected: number,
    tol: number,
    message: string,
  ): void {
    this.ok(
      Math.abs(actual - expected) <= tol,
      `${message}（实际=${formatNum(actual)}，期望=${formatNum(expected)}，容差=${tol}）`,
    );
  }
}

export interface ScenarioResult {
  name: string;
  checks: number;
  failures: CheckFailure[];
  elapsedMs: number;
}

export function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toExponential(3);
}

export function runScenario(
  name: string,
  fn: (ctx: CheckContext) => void,
): ScenarioResult {
  const ctx = new CheckContext(name);
  const start = Date.now();
  try {
    fn(ctx);
  } catch (err) {
    ctx.failures.push({
      group: name,
      message: `场景抛出异常：${(err as Error).stack ?? String(err)}`,
    });
  }
  return {
    name,
    checks: ctx.checks,
    failures: ctx.failures,
    elapsedMs: Date.now() - start,
  };
}
