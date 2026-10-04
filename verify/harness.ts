/**
 * 零依赖校验框架：收集每条检查的结果，统一输出可读的通过/失败。
 * 断言失败即抛错，由 Harness.check 捕获并记录，不中断后续检查。
 */

export interface CheckOutcome {
  name: string;
  ok: boolean;
  error?: string;
}

export class Harness {
  readonly outcomes: CheckOutcome[] = [];
  readonly suiteName: string;

  constructor(suiteName: string) {
    this.suiteName = suiteName;
  }

  check(name: string, fn: () => void): void {
    try {
      fn();
      this.outcomes.push({ name, ok: true });
    } catch (error) {
      this.outcomes.push({
        name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: 期望 ${String(expected)}，实际 ${String(actual)}`);
  }
}

export function assertApprox(actual: number, expected: number, tolerance: number, label: string): void {
  if (!Number.isFinite(actual)) {
    throw new Error(`${label}: 结果不是有限数值（${String(actual)}）`);
  }
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${label}: 期望 ${expected} ±${tolerance}，实际 ${actual}（偏差 ${diff}）`);
  }
}

export function assertVec2Approx(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  tolerance: number,
  label: string,
): void {
  assertApprox(actual.x, expected.x, tolerance, `${label}.x`);
  assertApprox(actual.y, expected.y, tolerance, `${label}.y`);
}

export function assertThrows(fn: () => void, label: string, messageIncludes?: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (messageIncludes && !message.includes(messageIncludes)) {
      throw new Error(`${label}: 抛出了异常但信息不符，期望包含「${messageIncludes}」，实际「${message}」`);
    }
    return;
  }
  throw new Error(`${label}: 期望抛出异常，但实际正常返回`);
}
