export type TestFn = () => void | Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __marbleTests: Array<{ name: string; fn: TestFn }> | undefined;
}

export function test(name: string, fn: TestFn): void {
  globalThis.__marbleTests ??= [];
  globalThis.__marbleTests.push({ name, fn });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}（实际: ${String(actual)}，期望: ${String(expected)}）`);
  }
}

export function closeTo(actual: number, expected: number, epsilon: number, message: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > epsilon) {
    throw new Error(`${message}（实际: ${actual}，期望约为: ${expected}）`);
  }
}

export function greaterThan(actual: number, expected: number, message: string): void {
  if (!(actual > expected)) {
    throw new Error(`${message}（实际: ${actual}，应大于: ${expected}）`);
  }
}

export function lessThanOrEqual(actual: number, expected: number, message: string): void {
  if (!(actual <= expected)) {
    throw new Error(`${message}（实际: ${actual}，应不大于: ${expected}）`);
  }
}
