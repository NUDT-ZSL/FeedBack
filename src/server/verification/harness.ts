// 极简离线测试框架：不依赖任何第三方测试库，node/ts-node 直接可跑
export type TestFn = () => void | Promise<void>;

interface Case {
  name: string;
  fn: TestFn;
}

interface Suite {
  name: string;
  cases: Case[];
}

const suites: Suite[] = [];
let current: Suite | null = null;

export const suite = (name: string, define: () => void): void => {
  const s: Suite = { name, cases: [] };
  suites.push(s);
  current = s;
  define();
  current = null;
};

export const test = (name: string, fn: TestFn): void => {
  if (!current) {
    throw new Error('test() 必须在 suite() 内注册');
  }
  current.cases.push({ name, fn });
};

export const assert = (cond: unknown, msg: string): void => {
  if (!cond) {
    throw new Error(`断言失败: ${msg}`);
  }
};

export const assertEqual = (actual: unknown, expected: unknown, msg: string): void => {
  if (actual !== expected) {
    throw new Error(`断言失败: ${msg}（期望 ${expected}，实际 ${actual}）`);
  }
};

export const assertThrows = (
  fn: () => void,
  match: (error: unknown) => boolean,
  msg: string
): void => {
  try {
    fn();
  } catch (error) {
    if (match(error)) {
      return;
    }
    throw new Error(`断言失败: ${msg}（抛出了不符预期的异常: ${String(error)}）`);
  }
  throw new Error(`断言失败: ${msg}（应抛出异常但未抛出）`);
};

export const runAll = async (): Promise<void> => {
  let passed = 0;
  let failed = 0;
  for (const s of suites) {
    console.log(`\n[套件] ${s.name}`);
    for (const c of s.cases) {
      try {
        await c.fn();
        passed += 1;
        console.log(`  PASS ${c.name}`);
      } catch (error) {
        failed += 1;
        console.error(`  FAIL ${c.name}`);
        console.error(`       ${(error as Error).message}`);
      }
    }
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败, 共 ${passed + failed} 条用例`);
  if (failed > 0) {
    process.exitCode = 1;
  }
};
