/**
 * Auto16 可推演标记链路 —— 离线验收运行器
 *
 * 运行：node tests/acceptance.ts   （或 npm run acceptance）
 *
 * 每个样例的每一步操作后执行：
 *   1. 增量快照 vs 整体重推快照的逐位一致性校验（未收敛位置仅比较未收敛集合）；
 *   2. checkpoint 断言在增量现场上校验（含本次增量变化集，随后才整体重推）；
 *   3. 规则顺序反转后的确定性校验（冲突不得依赖遍历顺序）；
 *   4. 最终 expect 断言（标记、冲突、环、悬空、未收敛、输入日志）。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine, type ChangeSet, type ExplanationNode, type RuleSpec } from '../src/labelchain/index.ts';

interface Op {
  op: 'submit' | 'setRules' | 'adjudicate' | 'release';
  source?: string;
  seq?: number;
  revision?: number;
  text?: string;
  rules?: RuleSpec[];
  index?: number;
  label?: string;
  note?: string;
}

interface Checkpoint {
  afterOp?: number;
  text?: string;
  labels?: Array<string | null>;
  statuses?: string[];
  conflicts?: number[];
  unconverged?: number[];
  cycles?: number[][];
  dangling?: Array<{ index: number; ruleId: string; target: number }>;
  ingest?: Record<string, number>;
  lastDerived?: number[];
  lastDerivedEmpty?: boolean;
  lastChanged?: number[];
  candidateAt?: Record<string, string[]>;
}

interface Sample {
  name: string;
  title: string;
  rules: RuleSpec[];
  ops: Op[];
  checkpoints?: Checkpoint[];
  expect: Checkpoint;
  explainAt?: { afterOp: number; index: number };
}

type Snapshot = ReturnType<Engine['snapshot']>;

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => JSON.stringify(v) === JSON.stringify(b[i]));
}

/** 增量与整体重推一致性比较；未收敛位置振荡值不做要求，只要求未收敛集合相同 */
function diffSnapshots(a: Snapshot, b: Snapshot): string[] {
  const diffs: string[] = [];
  if (!arraysEqual(a.unconverged, b.unconverged)) {
    diffs.push(`unconverged 不一致: ${JSON.stringify(a.unconverged)} != ${JSON.stringify(b.unconverged)}`);
  }
  if (!arraysEqual(a.conflicts, b.conflicts)) {
    diffs.push(`conflicts 不一致: ${JSON.stringify(a.conflicts)} != ${JSON.stringify(b.conflicts)}`);
  }
  if (!arraysEqual(a.dangling, b.dangling)) {
    diffs.push(`dangling 不一致: ${JSON.stringify(a.dangling)} != ${JSON.stringify(b.dangling)}`);
  }
  if (!arraysEqual(a.cycles, b.cycles)) {
    diffs.push(`cycles 不一致: ${JSON.stringify(a.cycles)} != ${JSON.stringify(b.cycles)}`);
  }
  const skip = new Set([...a.unconverged, ...b.unconverged]);
  const n = Math.max(a.labels.length, b.labels.length);
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    if (a.labels[i] !== b.labels[i]) {
      diffs.push(`位置${i} 标记不一致: ${String(a.labels[i])} != ${String(b.labels[i])}`);
    }
    if (a.statuses[i] !== b.statuses[i]) {
      diffs.push(`位置${i} 状态不一致: ${a.statuses[i]} != ${b.statuses[i]}`);
    }
    if (!arraysEqual(a.candidates[i] ?? [], b.candidates[i] ?? [])) {
      diffs.push(`位置${i} 候选依据不一致: ${JSON.stringify(a.candidates[i])} != ${JSON.stringify(b.candidates[i])}`);
    }
  }
  return diffs;
}

function executeOps(sample: Sample, rulesOverride?: RuleSpec[]): Engine {
  const engine = new Engine(rulesOverride ?? sample.rules);
  for (const step of sample.ops) {
    if (step.op === 'submit') {
      engine.submit({ source: step.source!, seq: step.seq!, revision: step.revision!, text: step.text! });
    } else if (step.op === 'setRules') {
      engine.setRules(step.rules!);
    } else if (step.op === 'adjudicate') {
      engine.adjudicate(step.index!, step.label!, step.note);
    } else {
      engine.release(step.index!);
    }
  }
  return engine;
}

function ingestCounts(engine: Engine): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of engine.report().ingestLog) {
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
  }
  return counts;
}

function assertCheckpoint(
  sampleName: string,
  engine: Engine,
  cp: Checkpoint,
  at: string,
  changeSet: ChangeSet,
): string[] {
  const failures: string[] = [];
  const report = engine.report();
  const snap = engine.snapshot();
  const fail = (msg: string): void => void failures.push(`[${sampleName} ${at}] ${msg}`);

  if (cp.text !== undefined && report.text !== cp.text) {
    fail(`文档文本 "${report.text}"，期望 "${cp.text}"`);
  }
  if (cp.labels && !arraysEqual(snap.labels, cp.labels)) {
    fail(`标记序列 ${JSON.stringify(snap.labels)}，期望 ${JSON.stringify(cp.labels)}`);
  }
  if (cp.statuses && !arraysEqual(snap.statuses, cp.statuses)) {
    fail(`状态序列 ${JSON.stringify(snap.statuses)}，期望 ${JSON.stringify(cp.statuses)}`);
  }
  if (cp.conflicts && !arraysEqual(snap.conflicts, cp.conflicts)) {
    fail(`冲突清单 ${JSON.stringify(snap.conflicts)}，期望 ${JSON.stringify(cp.conflicts)}`);
  }
  if (cp.unconverged && !arraysEqual(snap.unconverged, cp.unconverged)) {
    fail(`未收敛清单 ${JSON.stringify(snap.unconverged)}，期望 ${JSON.stringify(cp.unconverged)}`);
  }
  if (cp.cycles && !arraysEqual(snap.cycles, cp.cycles)) {
    fail(`环清单 ${JSON.stringify(snap.cycles)}，期望 ${JSON.stringify(cp.cycles)}`);
  }
  if (cp.dangling && !arraysEqual(report.dangling, cp.dangling)) {
    fail(`悬空清单 ${JSON.stringify(report.dangling)}，期望 ${JSON.stringify(cp.dangling)}`);
  }
  if (cp.candidateAt) {
    for (const [idx, expectedCandidates] of Object.entries(cp.candidateAt)) {
      const actual = snap.candidates[Number(idx)] ?? [];
      if (!arraysEqual(actual, expectedCandidates)) {
        fail(`位置${idx} 候选依据 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expectedCandidates)}`);
      }
    }
  }
  if (cp.ingest) {
    const counts = ingestCounts(engine);
    for (const [kind, expected] of Object.entries(cp.ingest)) {
      if ((counts[kind] ?? 0) !== expected) {
        fail(`输入日志 ${kind} 计数 ${counts[kind] ?? 0}，期望 ${expected}`);
      }
    }
  }
  if (cp.lastDerivedEmpty !== undefined) {
    const empty = changeSet.derived.length === 0;
    if (empty !== cp.lastDerivedEmpty) {
      fail(`末次重推集合为空期望 ${cp.lastDerivedEmpty}，实际 ${JSON.stringify(changeSet.derived)}`);
    }
  }
  if (cp.lastDerived && !arraysEqual(changeSet.derived, cp.lastDerived)) {
    fail(`末次重推位置 ${JSON.stringify(changeSet.derived)}，期望 ${JSON.stringify(cp.lastDerived)}`);
  }
  if (cp.lastChanged && !arraysEqual(changeSet.changed, cp.lastChanged)) {
    fail(`末次实际变化位置 ${JSON.stringify(changeSet.changed)}，期望 ${JSON.stringify(cp.lastChanged)}`);
  }
  return failures;
}

function renderExplanation(node: ExplanationNode, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  const lines = [
    `${indent}位置${node.index} '${node.char}' = ${node.label ?? '∅'} (${node.status})`,
  ];
  for (const via of node.via) {
    lines.push(
      `${indent}  └─ 规则 ${via.ruleId} (优先级 ${via.priority}, 候选 ${via.label}) 依据文本 "${via.evidence}"`,
    );
    for (const dep of via.depInputs) {
      lines.push(...renderExplanation(dep, depth + 2));
    }
  }
  return lines;
}

function runSample(sample: Sample): string[] {
  const failures: string[] = [];
  const engine = new Engine(sample.rules);
  let explanation: string[] | null = null;
  let incrementalChange: ChangeSet = engine.lastChangeSet;

  for (let i = 0; i < sample.ops.length; i++) {
    const step = sample.ops[i];
    if (step.op === 'submit') {
      engine.submit({ source: step.source!, seq: step.seq!, revision: step.revision!, text: step.text! });
    } else if (step.op === 'setRules') {
      engine.setRules(step.rules!);
    } else if (step.op === 'adjudicate') {
      engine.adjudicate(step.index!, step.label!, step.note);
    } else {
      engine.release(step.index!);
    }
    incrementalChange = engine.lastChangeSet;

    // checkpoint 在增量现场校验（变化集是增量重推的直接证据）
    for (const cp of sample.checkpoints ?? []) {
      if (cp.afterOp === i) {
        failures.push(...assertCheckpoint(sample.name, engine, cp, `op${i}`, incrementalChange));
      }
    }
    if (sample.explainAt && sample.explainAt.afterOp === i) {
      explanation = renderExplanation(engine.explain(sample.explainAt.index));
    }

    // 每一步：增量结果必须与整体重推一致
    const before = engine.snapshot();
    engine.recomputeAll();
    const after = engine.snapshot();
    for (const diff of diffSnapshots(before, after)) {
      failures.push(`[${sample.name} op${i}] 增量/整体不一致: ${diff}`);
    }
  }

  failures.push(...assertCheckpoint(sample.name, engine, sample.expect, 'final', incrementalChange));

  // 规则注册顺序反转后结果必须相同（结果不得取决于规则遍历顺序）
  const engineA = executeOps(sample, sample.rules);
  const engineB = executeOps(sample, [...sample.rules].reverse());
  for (const diff of diffSnapshots(engineA.snapshot(), engineB.snapshot())) {
    failures.push(`[${sample.name} final] 规则顺序敏感性: ${diff}`);
  }

  printReport(sample, engine, failures, explanation);
  return failures;
}

function printReport(
  sample: Sample,
  engine: Engine,
  failures: string[],
  explanation: string[] | null,
): void {
  const report = engine.report();
  const ok = failures.length === 0;
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${sample.name} — ${sample.title}`);
  console.log('-'.repeat(78));
  const labels = report.positions
    .map((p) => (p.label === null ? 'CONFLICT' : p.label))
    .map((s, i) => `${i}:${s}`)
    .join('  ');
  console.log(`文档: ${report.text}`);
  console.log(`标记: ${labels}`);
  for (const c of report.conflicts) {
    const parties = c.tied
      .map((t) => `${t.ruleId}->${t.label}(优先级${t.priority},依据"${t.evidence}")`)
      .join('  vs  ');
    console.log(`冲突 位置${c.index}: ${parties}`);
  }
  if (report.unconverged.length) {
    console.log(`未收敛: ${JSON.stringify(report.unconverged)}（达到迭代上限仍在振荡）`);
  }
  if (report.cycles.length) {
    console.log(`依赖环: ${JSON.stringify(report.cycles)}`);
  }
  if (report.dangling.length) {
    for (const d of report.dangling) {
      console.log(`悬空依赖: 位置${d.index} 规则${d.ruleId} 指向不存在的位置${d.target}`);
    }
  }
  for (const entry of report.ingestLog) {
    if (entry.kind !== 'accepted' && entry.kind !== 'corrected') {
      console.log(`输入侧[${entry.kind}] ${entry.fragmentKey} r${entry.revision}: ${entry.note}`);
    }
  }
  if (explanation) {
    console.log('传播路径解释:');
    for (const line of explanation) console.log(`  ${line}`);
  }
  if (!ok) {
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
}

// ---------------------------------------------------------------- 主流程

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, '..', 'samples');
const files = readdirSync(samplesDir).filter((f) => f.endsWith('.json')).sort();

let totalFailures = 0;
for (const file of files) {
  const sample = JSON.parse(readFileSync(join(samplesDir, file), 'utf-8')) as Sample;
  totalFailures += runSample(sample).length;
}

console.log(`\n${'='.repeat(78)}`);
if (totalFailures === 0) {
  console.log(`全部 ${files.length} 组样例通过：标记与依据自洽、增量与整体重推一致、边界状态如实列出。`);
  process.exit(0);
} else {
  console.log(`共 ${totalFailures} 项断言失败。`);
  process.exit(1);
}
