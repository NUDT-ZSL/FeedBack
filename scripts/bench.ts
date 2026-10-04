// 统一批量运行入口（离线、可重复执行）：
//   node scripts/bench.ts                运行 samples/ 下全部样例
//   node scripts/bench.ts samples/x.json 只运行指定样例
// 覆盖：正常 DAG、依赖成环、依赖指向缺失、多来源耗时冲突、可选依赖、局部修正后重推。
// 每个“修正/裁决”步骤都会同时做整体重推与局部重推，并断言两者结果逐字段一致。
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive, deriveIncremental, stableHash } from '../src/scheduler/index.ts';
import type { BatchInput, Decision, DeriveResult, TaskDecl } from '../src/scheduler/index.ts';

interface SampleFix {
  label: string;
  decisions: Decision[];
}

interface SampleEdit {
  label: string;
  addDeclarations?: TaskDecl[];
  replaceDeclarations?: TaskDecl[];
  decisions?: Decision[];
}

interface SampleFile extends BatchInput {
  fixes?: SampleFix[];
  edits?: SampleEdit[];
}

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const args = process.argv.slice(2);
const sampleFiles = args.length
  ? args.map((arg) => resolve(arg))
  : readdirSync(join(rootDir, 'samples'))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(rootDir, 'samples', name));

let failures = 0;
const fail = (message: string): void => {
  failures++;
  console.error(`  ✗ ${message}`);
};
const pass = (message: string): void => console.log(`  ✓ ${message}`);

function checkConsistency(label: string, previous: DeriveResult | null, previousInput: BatchInput | null, nextInput: BatchInput): DeriveResult {
  const incremental = deriveIncremental(previous, previousInput, nextInput);
  const full = derive(nextInput);
  if (!incremental.consistent) fail(`${label}：局部重推自检未通过`);
  else pass(`${label}：局部重推与整体重推一致（指纹 ${incremental.result.fingerprint}）`);
  if (stableHash(serialize(incremental.result)) !== stableHash(serialize(full))) {
    fail(`${label}：局部重推结果与整体重推结果不一致`);
  }
  if (incremental.affected.length) {
    console.log(`    受影响任务: ${incremental.affected.join(', ')}`);
    console.log(`    复用未受影响任务: ${incremental.reused.join(', ') || '(无)'}`);
  }
  if (incremental.changedPositions.length) {
    console.log(`    排位变化: ${incremental.changedPositions.map((c) => `${c.id} ${c.from ?? '-'}→${c.to ?? '-'}`).join(', ')}`);
  }
  return incremental.result;
}

function serialize(result: DeriveResult): unknown {
  return {
    fingerprint: result.fingerprint,
    order: result.order,
    projectDuration: result.projectDuration,
    criticalPaths: result.criticalPaths,
    criticalTasks: result.criticalTasks,
    tasks: Object.fromEntries(Object.entries(result.tasks).map(([id, task]) => [id, {
      d: task.duration, es: task.earliestStart, ef: task.earliestFinish,
      ls: task.latestStart, lf: task.latestFinish, slack: task.slack, critical: task.critical,
    }])),
    issues: result.issues.map((issue) => [issue.id, issue.status, issue.resolution ?? null]),
    blocked: result.blocked.map((task) => [task.id, task.reasons]),
  };
}

function printResult(result: DeriveResult): void {
  console.log(`  输入指纹: ${result.fingerprint}  项目总时长: ${result.projectDuration}`);
  if (result.order.length) {
    console.log('  构建顺序（位置 | 任务 | 最早开始 | 最早完成 | 松弛 | 关键）:');
    result.order.forEach((id, index) => {
      const task = result.tasks[id];
      console.log(`    ${String(index + 1).padStart(2)} | ${id.padEnd(14)} | ES=${task.earliestStart} EF=${task.earliestFinish} | slack=${task.slack} | ${task.critical ? '★关键' : '-'}`);
    });
  }
  if (result.criticalPaths.length) {
    console.log(`  关键路径: ${result.criticalPaths.map((path) => path.join(' → ')).join(' ； ')}`);
  }
  const openIssues = result.issues.filter((issue) => issue.status === 'open');
  for (const issue of result.issues) {
    const marker = issue.status === 'open' ? '⚠ 待裁决' : '✓ 已解决';
    const desc = issue.kind === 'missing-target'
      ? `缺失依赖 ${issue.from} -> ${issue.to}${issue.optional ? '（可选）' : ''}`
      : issue.kind === 'cycle'
        ? `依赖成环 ${issue.displayCycle.join(' → ')}`
        : `耗时冲突 ${issue.taskId}: ${issue.claims.map((c) => `${c.source}=${c.duration}`).join(' vs ')}`;
    console.log(`  [${marker}] ${desc}${issue.resolution ? ` —— ${issue.resolution}` : ''}`);
  }
  if (result.blocked.length) {
    console.log(`  阻塞任务: ${result.blocked.map((task) => `${task.id}(${task.reasons.join('/')})`).join(', ')}`);
  }
  if (result.skippedEdges.length) {
    console.log(`  跳过的可选依赖: ${result.skippedEdges.map((edge) => `${edge.from} -> ${edge.to}`).join(', ')}`);
  }
  if (result.ignoredDecisions.length) {
    console.log(`  未生效裁决: ${result.ignoredDecisions.map((entry) => entry.reason).join('；')}`);
  }
  if (openIssues.length === 0 && result.blocked.length === 0) {
    console.log('  无待裁决问题，全部任务完成调度。');
  }
}

function applyEdit(base: BatchInput, edit: SampleEdit): BatchInput {
  const declarations = [...(base.declarations ?? [])];
  for (const replacement of edit.replaceDeclarations ?? []) {
    const index = declarations.findIndex((decl) => decl.taskId === replacement.taskId && decl.source === replacement.source);
    if (index >= 0) declarations[index] = replacement;
    else declarations.push(replacement);
  }
  declarations.push(...(edit.addDeclarations ?? []));
  return {
    name: base.name,
    declarations,
    decisions: [...(base.decisions ?? []), ...(edit.decisions ?? [])],
  };
}

for (const file of sampleFiles) {
  const sample = JSON.parse(readFileSync(file, 'utf8')) as SampleFile;
  console.log(`\n=== 样例: ${sample.name ?? file} ===`);
  const baseInput: BatchInput = { name: sample.name, declarations: sample.declarations, decisions: sample.decisions ?? [] };
  let result = derive(baseInput);
  let input = baseInput;
  printResult(result);
  // fixes 是对基础输入的并列裁决分支（每种裁决独立验证）；edits 是在最新输入上的增量修正序列。

  if (sample.name?.startsWith('normal')) {
    const open = result.issues.filter((issue) => issue.status === 'open');
    if (open.length) fail(`正常样例不应存在待裁决问题: ${open.map((issue) => issue.id).join(', ')}`);
    else pass('正常样例无待裁决问题');
    if (result.order.length !== sample.declarations.length) fail('正常样例存在未调度任务');
    else pass(`全部 ${result.order.length} 个任务完成调度`);
  }

  for (const fix of sample.fixes ?? []) {
    console.log(`\n  --- ${fix.label} ---`);
    const nextInput: BatchInput = { ...baseInput, decisions: [...(baseInput.decisions ?? []), ...fix.decisions] };
    result = checkConsistency(fix.label, derive(baseInput), baseInput, nextInput);
    printResult(result);
  }

  for (const edit of sample.edits ?? []) {
    console.log(`\n  --- ${edit.label} ---`);
    const nextInput = applyEdit(input, edit);
    result = checkConsistency(edit.label, result, input, nextInput);
    input = nextInput;
    printResult(result);
  }
}

console.log(failures ? `\n共 ${failures} 项校验失败` : '\n全部样例校验通过');
process.exit(failures ? 1 : 0);
