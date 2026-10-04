/**
 * 批量运行入口（离线）：node scripts/run-samples.ts [samples目录]
 * 覆盖正常、成环、依赖缺失、耗时冲突与局部修正后增量重推等情形；
 * 每一步增量重推都会与整体重推逐字段比对，保证结果一致、可重复执行。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive, Workbench } from '../src/engine/index.ts';
import type { DerivationResult, Resolution, TaskDecl } from '../src/engine/index.ts';

interface ConflictExpect {
  type: string;
  taskId?: string;
  dep?: string;
  members?: string[];
}

interface Expect {
  order?: string[];
  est?: Record<string, number>;
  finish?: Record<string, number>;
  criticalPath?: string[];
  makespan?: number | null;
  conflicts?: ConflictExpect[];
  unscheduled?: string[];
}

interface SampleStep {
  title?: string;
  apply: Resolution[];
  expectAffected?: string[];
  expect?: Expect;
}

interface Sample {
  name: string;
  title?: string;
  decls: TaskDecl[];
  expect?: Expect;
  steps?: SampleStep[];
}

let failures = 0;
let checks = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`    ✗ ${message}`);
}

function pass(message: string): void {
  console.log(`    ✓ ${message}`);
}

function check(condition: boolean, message: string): void {
  checks += 1;
  if (condition) pass(message);
  else fail(message);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function checkExpect(result: DerivationResult, expect: Expect, label: string): void {
  if (expect.order !== undefined) {
    check(
      stableStringify(result.order) === stableStringify(expect.order),
      `${label} 构建顺序 = [ ${JSON.stringify(result.order)}`,
    );
  }
  for (const [id, est] of Object.entries(expect.est ?? {})) {
    check(result.tasks[id]?.est === est, `${label} ${id}.est = ${est}（实际 ${result.tasks[id]?.est}）`);
  }
  for (const [id, finish] of Object.entries(expect.finish ?? {})) {
    check(result.tasks[id]?.finish === finish, `${label} ${id}.finish = ${finish}（实际 ${result.tasks[id]?.finish}）`);
  }
  if (expect.criticalPath !== undefined) {
    check(
      stableStringify(result.criticalPath) === stableStringify(expect.criticalPath),
      `${label} 关键路径 = ${JSON.stringify(result.criticalPath)}`,
    );
  }
  if (expect.makespan !== undefined) {
    check(result.makespan === expect.makespan, `${label} 完工时刻 = ${result.makespan}`);
  }
  if (expect.conflicts !== undefined) {
    check(
      result.conflicts.length === expect.conflicts.length,
      `${label} 冲突数 = ${result.conflicts.length}（期望 ${expect.conflicts.length}）`,
    );
    for (const expected of expect.conflicts) {
      const found = result.conflicts.some((c) => {
        if (c.type !== expected.type) return false;
        if (expected.type === 'duration-conflict' && c.type === 'duration-conflict')
          return c.taskId === expected.taskId;
        if (expected.type === 'missing-dependency' && c.type === 'missing-dependency')
          return c.taskId === expected.taskId && c.dep === expected.dep;
        if (expected.type === 'dependency-cycle' && c.type === 'dependency-cycle')
          return stableStringify(c.members) === stableStringify(expected.members ?? []);
        return false;
      });
      check(found, `${label} 存在冲突 ${JSON.stringify(expected)}`);
    }
  }
  if (expect.unscheduled !== undefined) {
    const actual = Object.values(result.tasks)
      .filter((t) => t.unscheduledReason !== null)
      .map((t) => t.id)
      .sort();
    check(
      stableStringify(actual) === stableStringify([...expect.unscheduled].sort()),
      `${label} 未调度任务 = ${JSON.stringify(actual)}`,
    );
  }
}

function runSample(sample: Sample): void {
  console.log(`\n■ ${sample.name} ${sample.title ?? ''}`);
  const workbench = new Workbench(sample.decls);
  const initial = workbench.derive();
  if (sample.expect) checkExpect(initial, sample.expect, '初始推导');

  for (const [index, step] of (sample.steps ?? []).entries()) {
    const label = `步骤${index + 1}${step.title ? `（${step.title}）` : ''}`;
    const { affected, result } = workbench.apply(step.apply);

    if (step.expectAffected !== undefined) {
      check(
        stableStringify(affected) === stableStringify([...step.expectAffected].sort()),
        `${label} 影响集合 = ${JSON.stringify(affected)}`,
      );
    }

    // 一致性：增量重推结果必须与基于全部裁决的整体重推逐字段一致。
    const full = derive([...workbench.getDecls()], [...workbench.getResolutions()]);
    check(
      stableStringify(result) === stableStringify(full),
      `${label} 增量重推与整体重推一致`,
    );

    if (step.expect) checkExpect(result, step.expect, label);
  }
}

const samplesDir = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  process.argv[2] ?? '../samples',
);
const files = readdirSync(samplesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
console.log(`批量推演：${files.length} 组样例（目录 ${samplesDir}）`);
for (const file of files) {
  const sample = JSON.parse(readFileSync(join(samplesDir, file), 'utf8')) as Sample;
  runSample(sample);
}
console.log(`\n共 ${checks} 项断言，${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
