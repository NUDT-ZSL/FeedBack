// 测试设施：用例注册、深度部分断言、确定性环境、操作序列步进器。
// 仅依赖 Node 与 src/state 纯模块，不依赖 DOM / 全屏 / 网络资源。

import {
  StoryState,
  StoryAction,
  StoryStore,
  StoryEnv,
  createInitialState,
  createStoryStore
} from '../src/state/storyState';

export type DeepPartial<T> = T extends (infer E)[]
  ? DeepPartial<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface TestContext {
  fail: (message: string) => void;
}

type TestFn = (t: TestContext) => void | Promise<void>;

const registry: { name: string; fn: TestFn }[] = [];

export function test(name: string, fn: TestFn): void {
  registry.push({ name, fn });
}

const indent = (text: string, pad: string): string =>
  text.split('\n').map(line => pad + line).join('\n');

export async function runAll(): Promise<number> {
  let passed = 0;
  let failed = 0;
  console.log(`\n共 ${registry.length} 条验证序列\n`);
  for (const { name, fn } of registry) {
    const errors: string[] = [];
    try {
      await fn({ fail: message => errors.push(message) });
    } catch (err) {
      errors.push(`未捕获异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    }
    if (errors.length === 0) {
      passed += 1;
      console.log(`  ✓ ${name}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${name}`);
      for (const message of errors) {
        console.log(indent(message, '      '));
      }
    }
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 条\n`);
  return failed === 0 ? 0 : 1;
}

/** 深度部分匹配：expected 中出现的字段才参与断言，数组要求长度一致 */
function collectDiffs(actual: unknown, expected: unknown, path: string, diffs: string[]): void {
  if (expected === undefined) return;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      diffs.push(`${path}: 期望数组，实际 ${JSON.stringify(actual)}`);
      return;
    }
    if (actual.length !== expected.length) {
      diffs.push(`${path}.length: 期望 ${expected.length}，实际 ${actual.length}`);
      return;
    }
    expected.forEach((item, idx) => collectDiffs(actual[idx], item, `${path}[${idx}]`, diffs));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {
      diffs.push(`${path}: 期望对象，实际 ${JSON.stringify(actual)}`);
      return;
    }
    for (const key of Object.keys(expected as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      collectDiffs(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        childPath,
        diffs
      );
    }
    return;
  }
  if (!Object.is(actual, expected)) {
    diffs.push(`${path}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

export function diffState(state: StoryState, expected: DeepPartial<StoryState>): string[] {
  const diffs: string[] = [];
  collectDiffs(state, expected, '', diffs);
  return diffs;
}

export function expectState(
  t: TestContext,
  state: StoryState,
  expected: DeepPartial<StoryState>,
  label: string
): void {
  const diffs = diffState(state, expected);
  for (const diff of diffs) {
    t.fail(`${label}\n      字段不符 → ${diff}`);
  }
}

export function expectEqual<T>(t: TestContext, actual: T, expected: T, label: string): void {
  if (!Object.is(actual, expected)) {
    t.fail(`${label}\n      期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

/** 确定性环境：id 自增、random 按固定序列循环，保证离线可重复 */
export function makeDeterministicEnv(): StoryEnv {
  let idCounter = 0;
  let randomIndex = 0;
  const randomSequence = [0, 0.25, 0.5, 0.75, 0.999];
  return {
    generateId: () => {
      idCounter += 1;
      return `test-id-${idCounter}`;
    },
    random: () => {
      const value = randomSequence[randomIndex % randomSequence.length];
      randomIndex += 1;
      return value;
    }
  };
}

export function createTestStore(): StoryStore {
  const env = makeDeterministicEnv();
  return createStoryStore(createInitialState(env), env);
}

export interface Step {
  /** 要推演的动作，或自定义操作（支持异步，如演示模式服务） */
  do: StoryAction | ((store: StoryStore) => void | Promise<void>);
  /** 本步之后的期望状态（深度部分匹配） */
  expect?: DeepPartial<StoryState>;
  /** 步骤说明，失败时用于定位 */
  label?: string;
}

/** 按顺序执行操作序列，每一步之后独立断言状态 */
export async function runSteps(t: TestContext, store: StoryStore, steps: Step[]): Promise<void> {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const stepLabel = step.label ?? (typeof step.do === 'function' ? '自定义操作' : JSON.stringify(step.do));
    try {
      if (typeof step.do === 'function') {
        await step.do(store);
      } else {
        store.dispatch(step.do);
      }
    } catch (err) {
      t.fail(`步骤 #${i + 1} [${stepLabel}] 抛出异常: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (step.expect) {
      const diffs = diffState(store.getState(), step.expect);
      for (const diff of diffs) {
        t.fail(`步骤 #${i + 1} [${stepLabel}]\n      字段不符 → ${diff}`);
      }
    }
  }
}

/** 断言两次快照完全一致（用于"静默忽略/幂等"类验证） */
export function expectUnchanged(t: TestContext, before: StoryState, after: StoryState, label: string): void {
  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  if (beforeJson !== afterJson) {
    t.fail(`${label}\n      期望状态不变，实际发生变化:\n      之前 ${beforeJson}\n      之后 ${afterJson}`);
  }
}
