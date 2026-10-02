// 离线批量推演入口：node armillary/runner.js [场景目录]
// 逐条执行场景中的操作序列，每次操作后输出步骤状态、受阻原因与进度结论，
// 并校验“局部重推（仅受影响部件）”与“整体重推”结论一致。
// 任一校验失败时进程以非零码退出。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArmillaryMachine } from './stateMachine.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenarioDir = resolve(process.argv[2] ?? join(here, 'scenarios'));

const files = readdirSync(scenarioDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`未在 ${scenarioDir} 找到场景文件`);
  process.exit(2);
}

let failures = 0;
let checks = 0;

function fail(msg) {
  failures += 1;
  console.error(`  ✗ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function snapshotWithoutHint(snapshot) {
  const { hint, ...rest } = snapshot;
  return rest;
}

function runSequence(config, ops, label) {
  const machine = createArmillaryMachine(config);
  const records = [];
  ops.forEach((op, i) => {
    const result = machine.applyOp(op);
    const incremental = machine.getSnapshot();
    machine.recomputeAll();
    const full = machine.getSnapshot();
    checks += 1;
    if (stableStringify(incremental) !== stableStringify(full)) {
      fail(`[${label}] 第 ${i + 1} 步后局部重推与整体重推不一致`);
    }
    records.push({ op, result, snapshot: incremental });
  });
  return records;
}

function checkExpectations(label, records, expect) {
  if (!Array.isArray(expect)) return;
  for (const exp of expect) {
    const rec = records[exp.step];
    checks += 1;
    if (!rec) {
      fail(`[${label}] 期望第 ${exp.step} 步存在记录，但操作序列只有 ${records.length} 步`);
      continue;
    }
    const problems = [];
    if (exp.kind !== undefined && rec.result.kind !== exp.kind) {
      problems.push(`结果类型应为 ${exp.kind}，实际 ${rec.result.kind}`);
    }
    if (exp.applied !== undefined && rec.result.applied !== exp.applied) {
      problems.push(`applied 应为 ${exp.applied}，实际 ${rec.result.applied}`);
    }
    if (exp.messageIncludes !== undefined && !rec.result.message.includes(exp.messageIncludes)) {
      problems.push(`提示应包含「${exp.messageIncludes}」，实际「${rec.result.message}」`);
    }
    if (exp.conclusion !== undefined && rec.snapshot.progress.conclusion !== exp.conclusion) {
      problems.push(`进度结论应为「${exp.conclusion}」，实际「${rec.snapshot.progress.conclusion}」`);
    }
    if (exp.removed !== undefined && rec.snapshot.progress.removed !== exp.removed) {
      problems.push(`已拆下数应为 ${exp.removed}，实际 ${rec.snapshot.progress.removed}`);
    }
    if (exp.stepStatus) {
      for (const [partId, want] of Object.entries(exp.stepStatus)) {
        const part = rec.snapshot.parts.find((p) => p.id === partId);
        const got = part ? `${part.disassembleStep.status}/${part.reassembleStep.status}` : '部件不存在';
        if (got !== want) problems.push(`部件 ${partId} 步骤状态应为 ${want}，实际 ${got}`);
      }
    }
    if (problems.length) fail(`[${label}] 第 ${exp.step + 1} 步：${problems.join('；')}`);
  }
}

for (const file of files) {
  const scenario = JSON.parse(readFileSync(join(scenarioDir, file), 'utf8'));
  const label = scenario.name ?? file;
  console.log(`\n■ 场景：${label}（${file}）`);

  let records;
  try {
    records = runSequence(scenario, scenario.ops ?? [], label);
  } catch (err) {
    fail(`[${label}] 推演异常：${err.message}`);
    continue;
  }
  pass(`[${label}] ${records.length} 步操作全部完成，局部/整体重推一致`);

  records.forEach((rec, i) => {
    const p = rec.snapshot.progress;
    console.log(
      `  ${String(i + 1).padStart(2)}. ${rec.op.op} ${rec.op.part} -> ${rec.result.kind} | ${rec.result.message} | ${p.conclusion}`
    );
  });

  checkExpectations(label, records, scenario.expect);

  // 乱序等价性：altOps 与 ops 到达同一在位集合时，结论必须一致。
  if (Array.isArray(scenario.altOps)) {
    const altRecords = runSequence(scenario, scenario.altOps, `${label}/altOps`);
    checks += 1;
    const a = stableStringify(snapshotWithoutHint(records[records.length - 1].snapshot));
    const b = stableStringify(snapshotWithoutHint(altRecords[altRecords.length - 1].snapshot));
    if (a === b) {
      pass(`[${label}] 乱序序列与主序列最终结论一致`);
    } else {
      fail(`[${label}] 乱序序列与主序列最终结论不一致`);
    }
  }
}

console.log(`\n共 ${checks} 项校验，${failures === 0 ? '全部通过' : `${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
