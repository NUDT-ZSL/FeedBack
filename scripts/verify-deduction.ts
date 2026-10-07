/**
 * 离线验收：对固定样例批量校验
 *  1) 幂等：同一组四诊输入重复推演，输出严格一致；
 *  2) 冲突保留：重复采集不覆盖，未裁决的冲突项不参与辨证；
 *  3) 依赖问题暴露：依赖闭环 / 指向缺失被明确标记，相关证候 blocked；
 *  4) 增量等价：裁决或修正后只重推受影响节点，结果与全量重推深度一致。
 *
 * 用法：npx tsx scripts/verify-deduction.ts（失败时退出码非 0）
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  buildDependencyPlan,
  DeductionSession,
  resolveInputs,
  runSyndromeStage,
  resolveInputs as resolveInputsFn,
  type Adjudication,
  type CollectionConflict,
  type DeductionResult,
  type ExamSource,
  type RecordKind,
  type SyndromeRule,
} from '../src/diagnosis/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', 'samples', 'cases');

interface CaseFile {
  id: string;
  records: {
    kind: RecordKind;
    key: string;
    value: string;
    source: ExamSource;
    recordedAt: number;
    note?: string;
  }[];
  adjudications: Adjudication[];
  expect?: { topSyndrome?: string | null; topFormula?: string | null };
  incremental?: {
    adjudicate?: Adjudication;
    correct?: { recordId: string; newValue: string };
    changedGroupKeys: string[];
    expectBefore?: Record<string, unknown>;
    expectAfter?: Record<string, unknown>;
  };
}

const stableSerialize = (value: unknown): string =>
  JSON.stringify(value, (key, val) => {
    if (val instanceof Map) return Object.fromEntries([...val.entries()].sort());
    return val;
  });

const publicView = (r: DeductionResult) => ({
  syndromes: r.syndromes,
  formulas: r.formulas,
  dosages: r.dosages,
  efficacy: r.efficacy,
  conflicts: r.conflicts,
  dependencyIssues: r.dependencyIssues,
});

function topSyndrome(result: DeductionResult): string | null {
  const concluded = result.syndromes
    .filter((s) => s.status === 'concluded' && s.score >= s.threshold)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.syndromeId < b.syndromeId ? -1 : 1));
  return concluded[0]?.syndromeId ?? null;
}

function buildSession(file: CaseFile): DeductionSession {
  const session = new DeductionSession();
  file.records.forEach((r) => session.collect(r));
  file.adjudications.forEach((a) => session.adjudicate(a));
  return session;
}

function loadCases(): CaseFile[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(CASES_DIR, f), 'utf-8')) as CaseFile);
}

function verifyIdempotency(files: CaseFile[]) {
  for (const file of files) {
    const first = publicView(buildSession(file).deduceFull());
    const second = publicView(buildSession(file).deduceFull());
    const third = publicView(buildSession(file).deduceFull());
    assert.equal(stableSerialize(first), stableSerialize(second), `${file.id}: 重复推演结果不一致`);
    assert.equal(stableSerialize(first), stableSerialize(third), `${file.id}: 三次推演结果不一致`);
  }
}

function verifyExpectations(files: CaseFile[]) {
  for (const file of files) {
    if (!file.expect) continue;
    const result = buildSession(file).deduceFull();
    if (file.expect.topSyndrome !== undefined) {
      assert.equal(topSyndrome(result), file.expect.topSyndrome, `${file.id}: 首选证候不符`);
    }
    if (file.expect.topFormula !== undefined) {
      assert.equal(result.formulas[0]?.formulaId ?? null, file.expect.topFormula, `${file.id}: 首选方剂不符`);
    }
  }
}

function verifyConflictPreservation() {
  // 同一项脉象在不同时刻被两个入口采集为相反取值。
  const file: CaseFile = {
    id: 'synthetic-conflict',
    records: [
      { kind: 'pulse', key: 'floating', value: 'true', source: 'qie', recordedAt: 1 },
      { kind: 'pulse', key: 'floating', value: 'false', source: 'qie', recordedAt: 2 },
      { kind: 'pulse', key: 'floating', value: 'true', source: 'wang', recordedAt: 3 },
    ],
    adjudications: [],
  };
  const session = buildSession(file);
  const conflicts: CollectionConflict[] = session.getConflicts();
  assert.equal(conflicts.length, 1, '应当恰好识别出 1 个冲突');
  assert.equal(conflicts[0].kind, 'pulse');
  assert.equal(conflicts[0].key, 'floating');
  assert.equal(conflicts[0].records.length, 3, '冲突必须保留全部来源记录，不得覆盖');
  assert.equal(conflicts[0].resolvedRecordId, null, '未裁决冲突不能被静默采用任何一方');
  assert.deepEqual(
    conflicts[0].records.map((r) => r.id),
    ['rec-0001', 'rec-0002', 'rec-0003'],
    '冲突记录按采集时刻稳定排序',
  );
  const resolved = resolveInputs(session.getRecords(), []);
  assert.ok(!('pulse:floating' in resolved.findings), '未裁决冲突项不得进入辨证输入');

  // 裁决采信第一条记录后，该项才参与辨证。
  const adj: Adjudication = { kind: 'pulse', key: 'floating', decision: 'pick', recordId: 'rec-0001' };
  const resolvedAfter = resolveInputs(session.getRecords(), [adj]);
  assert.equal(resolvedAfter.findings['pulse:floating']?.value, 'true');
  assert.equal(resolvedAfter.findings['pulse:floating']?.sourceRecordId, 'rec-0001');

  // 无冲突的重复采集（取值相同）不产生冲突，取最早记录作为来源。
  const session2 = buildSession({
    id: 'synthetic-dup-same',
    records: [
      { kind: 'symptom', key: 'fever', value: 'true', source: 'wenwen', recordedAt: 5 },
      { kind: 'symptom', key: 'fever', value: 'true', source: 'qie', recordedAt: 6 },
    ],
    adjudications: [],
  });
  assert.equal(session2.getConflicts().length, 0);
  assert.equal(session2.resolve().findings['symptom:fever']?.sourceRecordId, 'rec-0001');
}

function verifyDependencyIssues() {
  // 1) 依赖闭环：A -> B -> A。
  const cyclicRules: SyndromeRule[] = [
    {
      id: 'syn-a',
      name: '证甲',
      threshold: 5,
      evidenceWeights: { 'symptom:fever': 3 },
      modifiers: {},
      dependsOn: { 'syn-b': 2 },
    },
    {
      id: 'syn-b',
      name: '证乙',
      threshold: 5,
      evidenceWeights: { 'symptom:cough': 3 },
      modifiers: {},
      dependsOn: { 'syn-a': 2 },
    },
  ];
  const plan = buildDependencyPlan(cyclicRules);
  assert.ok(plan.issues.some((i) => i.type === 'dependency_cycle'), '必须检出依赖闭环');
  assert.deepEqual([...plan.blocked.keys()].sort(), ['syn-a', 'syn-b'], '闭环内证候必须全部阻断');
  const inputs = resolveInputsFn(
    [
      { id: 'r1', kind: 'symptom', key: 'fever', value: 'true', source: 'wenwen', recordedAt: 1, seq: 1 },
      { id: 'r2', kind: 'symptom', key: 'cough', value: 'true', source: 'wenwen', recordedAt: 1, seq: 2 },
    ],
    [],
  );
  const stage = runSyndromeStage(inputs, plan, cyclicRules);
  assert.ok(stage.syndromes.every((s) => s.status === 'blocked'), '闭环证候不得静默评估');
  assert.ok(stage.syndromes.every((s) => s.blockReason?.includes('依赖闭环')));

  // 2) 指向缺失：规则依赖不存在的证候、引用未知命名空间的修正项。
  const missingRules: SyndromeRule[] = [
    {
      id: 'syn-x',
      name: '证丙',
      threshold: 5,
      evidenceWeights: { 'symptom:fever': 3 },
      modifiers: { 'unknown:foo': { delta: 1, reason: 'bad' } },
      dependsOn: { 'syn-ghost': 1 },
    },
  ];
  const plan2 = buildDependencyPlan(missingRules);
  assert.equal(plan2.issues.filter((i) => i.type === 'missing_reference').length, 2);
  assert.ok(plan2.blocked.has('syn-x'), '指向缺失的证候必须阻断并暴露原因');
}

function verifyIncremental(files: CaseFile[]) {
  for (const file of files) {
    if (!file.incremental) continue;
    const step = file.incremental;

    // 变更前快照。
    const session = buildSession(file);
    const before = session.deduceFull();
    if (step.expectBefore) {
      if ('unresolvedConflict' in step.expectBefore) {
        const key = step.expectBefore.unresolvedConflict as string;
        assert.ok(
          before.conflicts.some((c) => `${c.kind}:${c.key}` === key && c.resolvedRecordId === null),
          `${file.id}: 冲突应处于未裁决状态`,
        );
      }
      if (step.expectBefore.topSyndrome !== undefined) {
        assert.equal(topSyndrome(before), step.expectBefore.topSyndrome as string | null, `${file.id}: 变更前首选证候不符`);
      }
      if (typeof step.expectBefore.formulaPresent === 'string') {
        assert.ok(
          before.formulas.some((f) => f.formulaId === step.expectBefore!.formulaPresent),
          `${file.id}: 变更前方剂应在列`,
        );
      }
    }

    // 应用裁决/修正并增量重推。
    if (step.adjudicate) session.adjudicate(step.adjudicate);
    if (step.correct) session.correctRecord(step.correct.recordId, step.correct.newValue);
    const incremental = session.deduceIncremental(step.changedGroupKeys);

    // 全量重推同一状态：必须与增量结果深度一致。
    const rebuilt = buildSession(file);
    if (step.adjudicate) rebuilt.adjudicate(step.adjudicate);
    if (step.correct) {
      // 重建全量基线时同样修改记录取值。
      rebuilt.correctRecord(step.correct.recordId, step.correct.newValue);
    }
    const fullAgain = rebuilt.deduceFull();

    assert.equal(
      stableSerialize(publicView(incremental)),
      stableSerialize(publicView(fullAgain)),
      `${file.id}: 增量重推与全量重推结果不一致`,
    );

    if (step.expectAfter) {
      if (step.expectAfter.topSyndrome !== undefined) {
        assert.equal(topSyndrome(incremental), step.expectAfter.topSyndrome as string | null, `${file.id}: 变更后首选证候不符`);
      }
      if (step.expectAfter.topFormula !== undefined) {
        assert.equal(incremental.formulas[0]?.formulaId ?? null, step.expectAfter.topFormula as string, `${file.id}: 变更后首选方剂不符`);
      }
      if (typeof step.expectAfter.formulaAbsent === 'string') {
        assert.ok(
          !incremental.formulas.some((f) => f.formulaId === step.expectAfter!.formulaAbsent),
          `${file.id}: 受影响方剂应退出候选`,
        );
      }
    }
  }

  // 无实际变化的“空增量”也必须与全量一致。
  const anyCase = files.find((f) => f.expect) ?? files[0];
  const s = buildSession(anyCase);
  const full = s.deduceFull();
  const noopInc = s.deduceIncremental(['symptom:__not_collected__']);
  assert.equal(
    stableSerialize(publicView(noopInc)),
    stableSerialize(publicView(full)),
    `${anyCase.id}: 无关改动不应改变任何推演结论`,
  );
}

function main() {
  const files = loadCases();
  assert.ok(files.length >= 5, '至少需要 5 个固定样例');
  const checks: [string, () => void][] = [
    ['确定性（同输入多次推演一致）', () => verifyIdempotency(files)],
    ['样例预期（证候与首选方剂）', () => verifyExpectations(files)],
    ['冲突保留与裁决', verifyConflictPreservation],
    ['依赖闭环 / 指向缺失暴露', verifyDependencyIssues],
    ['增量重推等价于全量重推', () => verifyIncremental(files)],
  ];
  let passed = 0;
  for (const [name, fn] of checks) {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  }
  console.log(`\n全部 ${passed} 项离线验收通过（${files.length} 个固定样例）。`);
}

main();
