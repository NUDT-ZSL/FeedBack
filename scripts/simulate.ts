/**
 * 离线批量推演入口。
 *
 * 用法：node scripts/simulate.ts [场景文件...]（缺省读取 scenarios/ 下全部 *.json）
 *
 * 每个场景执行以下校验：
 *   1. 逐次操作后比对「局部重推」与「整体重推」的步骤状态、受阻原因、进度结论完全一致；
 *   2. 局部重推实际重算的部件集合 ⊆ 受影响闭包（自身 + 前驱 + 后继）；
 *   3. 无效操作（重复拆/装、依赖未满足、未知部件）不改变部件状态与进度结论；
 *   4. 操作结果与场景声明的 expect 一致，最终进度与 expectProgress 一致；
 *   5. 同一操作序列重复执行两遍，快照逐字节一致（结论稳定）。
 * 全部通过时退出码为 0，否则为 1。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deepStrictEqual } from 'node:assert';
import { AssemblyMachine } from '../src/assembly/machine.ts';
import { analyzeGraph, affectedClosure } from '../src/assembly/graph.ts';
import type { Operation, PartSpec, StepSnapshot } from '../src/assembly/types.ts';

interface ExpectedOutcome {
  ok: boolean;
  reason?: string;
}

interface ScenarioOperation extends Operation {
  expect?: ExpectedOutcome;
}

interface Scenario {
  name: string;
  description?: string;
  parts: PartSpec[];
  operations: ScenarioOperation[];
  expectProgress?: Record<string, unknown>;
}

interface Failure {
  context: string;
  detail: string;
}

function strip(snapshot: StepSnapshot): Omit<StepSnapshot, 'recomputed'> {
  const { recomputed: _ignored, ...rest } = snapshot;
  return rest;
}

function diffMessage(label: string, a: unknown, b: unknown): string {
  return `${label}\n  局部重推: ${JSON.stringify(a)}\n  整体重推: ${JSON.stringify(b)}`;
}

function runScenario(scenario: Scenario): Failure[] {
  const failures: Failure[] = [];
  const analysis = analyzeGraph(scenario.parts);
  const machine = new AssemblyMachine(scenario.parts);
  const snapshots: StepSnapshot[] = [machine.snapshot()];
  const opLabel = (index: number, op: Operation) =>
    `第 ${index + 1} 步 ${op.type === 'disassemble' ? '拆下' : '装回'}「${op.partId}」`;

  // 第一遍：局部重推 + 每步与整体重推比对
  scenario.operations.forEach((operation, index) => {
    const before = machine.snapshot();
    const outcome = machine.apply(operation);
    const after = machine.snapshot(operation, outcome);
    snapshots.push(after);
    const context = opLabel(index, operation);

    // 1. 局部重推 == 整体重推
    const full = machine.deriveAll();
    try {
      deepStrictEqual(after.mountStates, full.mountStates);
      deepStrictEqual(after.steps, full.steps);
      deepStrictEqual(after.progress, full.progress);
    } catch {
      failures.push({
        context,
        detail: diffMessage('局部重推与整体重推结论不一致', strip(after), strip(full)),
      });
    }

    // 2. 实际重推集合 ⊆ 受影响闭包
    if (outcome.ok) {
      const closure = affectedClosure(analysis, operation.partId);
      const outside = after.recomputed.filter((id) => !closure.includes(id));
      if (outside.length > 0) {
        failures.push({
          context,
          detail: `局部重推范围越界：${outside.join('、')} 不在受影响闭包内`,
        });
      }
    } else if (after.recomputed.length > 0) {
      failures.push({ context, detail: '无效操作不应触发任何重推' });
    }

    // 3. 无效操作不改变部件状态与进度结论
    if (!outcome.ok) {
      try {
        deepStrictEqual(after.mountStates, before.mountStates);
        deepStrictEqual(after.progress, before.progress);
      } catch {
        failures.push({ context, detail: '无效操作改变了部件状态或进度结论' });
      }
    }

    // 4. 与场景声明的期望比对
    if (operation.expect) {
      if (outcome.ok !== operation.expect.ok) {
        failures.push({
          context,
          detail: `期望 ok=${operation.expect.ok}，实际 ok=${outcome.ok}（${outcome.reason?.message ?? '无原因'}）`,
        });
      }
      if (
        operation.expect.reason !== undefined &&
        outcome.reason?.code !== operation.expect.reason
      ) {
        failures.push({
          context,
          detail: `期望受阻原因 ${operation.expect.reason}，实际 ${outcome.reason?.code ?? '无'}`,
        });
      }
    }
  });

  // 4b. 最终进度结论
  if (scenario.expectProgress) {
    const progress = machine.getProgress() as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(scenario.expectProgress)) {
      if (!deepEqualScalar(progress[key], expected)) {
        failures.push({
          context: '最终进度结论',
          detail: `字段 ${key} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(progress[key])}`,
        });
      }
    }
  }

  // 5. 重复执行同一操作序列，结论逐字节一致
  const replay = new AssemblyMachine(scenario.parts);
  const replaySnapshots: StepSnapshot[] = [replay.snapshot()];
  for (const operation of scenario.operations) {
    const outcome = replay.apply(operation);
    replaySnapshots.push(replay.snapshot(operation, outcome));
  }
  try {
    deepStrictEqual(replaySnapshots, snapshots);
  } catch {
    failures.push({ context: '稳定性', detail: '同一操作序列重复执行得到不同结论' });
  }

  return failures;
}

function deepEqualScalar(a: unknown, b: unknown): boolean {
  try {
    deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = resolve('scenarios');
  const files =
    args.length > 0
      ? args.map((arg) => resolve(arg))
      : readdirSync(dir)
          .filter((name) => name.endsWith('.json'))
          .sort()
          .map((name) => join(dir, name));

  let totalFailures = 0;
  for (const file of files) {
    const scenario = JSON.parse(readFileSync(file, 'utf-8')) as Scenario;
    console.log(`\n=== ${scenario.name} ===`);
    if (scenario.description) console.log(`    ${scenario.description}`);

    const failures = runScenario(scenario);
    const machine = new AssemblyMachine(scenario.parts);
    for (const operation of scenario.operations) {
      const outcome = machine.apply(operation);
      const mark = outcome.ok ? '✓' : '✗';
      const note = outcome.ok
        ? machine.getProgress().message
        : `无效：${outcome.reason?.message ?? ''}`;
      console.log(
        `  ${mark} ${operation.type === 'disassemble' ? '拆下' : '装回'} ${operation.partId} -> ${note}`,
      );
    }
    const progress = machine.getProgress();
    console.log(
      `  进度结论：${progress.message}（阶段=${progress.phase}，已拆=${progress.disassembled}/${progress.total}，已装回=${progress.assembled}/${progress.total}）`,
    );

    if (failures.length === 0) {
      console.log('  校验通过：局部重推≡整体重推，无效操作无副作用，重复执行结论稳定');
    } else {
      totalFailures += failures.length;
      for (const failure of failures) {
        console.log(`  [失败] ${failure.context}: ${failure.detail}`);
      }
    }
  }

  console.log(
    totalFailures === 0
      ? `\n全部场景通过（共 ${files.length} 个场景）`
      : `\n共 ${totalFailures} 处校验失败`,
  );
  process.exit(totalFailures === 0 ? 0 : 1);
}

main();
