// 极简测试框架：每个用例执行前重置内存状态，逐项报告风险点的通过/失败
import { resetStore } from '../src/server/data/store';

export type TestFn = (base: string) => Promise<void>;

interface Case {
  group: string;
  name: string;
  fn: TestFn;
}

const cases: Case[] = [];

export const test = (group: string, name: string, fn: TestFn) => {
  cases.push({ group, name, fn });
};

export const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};

export const assertEqual = (actual: unknown, expected: unknown, msg: string) => {
  if (actual !== expected) {
    throw new Error(`${msg}（期望 ${expected}，实际 ${actual}）`);
  }
};

export const runAll = async (base: string): Promise<boolean> => {
  let passed = 0;
  const failures: { c: Case; err: string }[] = [];
  let currentGroup = '';

  for (const c of cases) {
    // 关键：每个用例前重置内存数据，保证单独执行与整体执行结论一致
    resetStore();
    if (c.group !== currentGroup) {
      currentGroup = c.group;
      console.log(`\n[${c.group}]`);
    }
    try {
      await c.fn(base);
      passed++;
      console.log(`  PASS  ${c.name}`);
    } catch (err: any) {
      const msg = err && err.message ? err.message : String(err);
      failures.push({ c, err: msg });
      console.log(`  FAIL  ${c.name}`);
    }
  }

  console.log('\n========================================');
  console.log(`共 ${cases.length} 项验证：通过 ${passed}，失败 ${failures.length}`);
  if (failures.length > 0) {
    console.log('失败的风险点：');
    for (const f of failures) {
      console.log(`  [${f.c.group}] ${f.c.name}`);
      console.log(`    原因: ${f.err}`);
    }
  }
  console.log('========================================');
  return failures.length === 0;
};
