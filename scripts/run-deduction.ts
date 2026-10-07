/**
 * 离线批量推演：读取 samples/cases 下的全部固定样例，
 * 输出证候、候选方剂排序、剂量配比与疗效预估到 samples/out/results.json。
 * 不依赖网络或外部账号；重复运行产物内容一致。
 *
 * 用法：npx tsx scripts/run-deduction.ts
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeductionSession,
  type Adjudication,
  type CollectionRecord,
  type DeductionResult,
  type ExamSource,
  type RecordKind,
} from '../src/diagnosis/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, '..', 'samples', 'cases');
const OUT_DIR = path.join(__dirname, '..', 'samples', 'out');

interface CaseRecord {
  kind: RecordKind;
  key: string;
  value: string;
  source: ExamSource;
  recordedAt: number;
  note?: string;
}
interface CaseFile {
  id: string;
  description: string;
  records: CaseRecord[];
  adjudications: Adjudication[];
  incremental?: {
    adjudicate?: Adjudication;
    correct?: { recordId: string; newValue: string };
    changedGroupKeys: string[];
  };
}

function topSyndrome(result: DeductionResult): string | null {
  const concluded = result.syndromes
    .filter((s) => s.status === 'concluded' && s.score >= s.threshold)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.syndromeId < b.syndromeId ? -1 : 1));
  return concluded[0]?.syndromeId ?? null;
}

function runCase(file: CaseFile) {
  const session = new DeductionSession();
  file.records.forEach((r) => session.collect(r));
  file.adjudications.forEach((a) => session.adjudicate(a));
  const before = session.deduceFull();
  let after: DeductionResult | null = null;
  if (file.incremental) {
    if (file.incremental.adjudicate) session.adjudicate(file.incremental.adjudicate);
    if (file.incremental.correct) {
      session.correctRecord(file.incremental.correct.recordId, file.incremental.correct.newValue);
    }
    after = session.deduceIncremental(file.incremental.changedGroupKeys);
  }
  return { before, after };
}

function summarize(result: DeductionResult) {
  return {
    topSyndrome: topSyndrome(result),
    syndromes: result.syndromes.map((s) => ({
      id: s.syndromeId,
      name: s.name,
      status: s.status,
      score: s.score,
      threshold: s.threshold,
      blockReason: s.blockReason ?? null,
    })),
    formulas: result.formulas.map((f) => ({
      rank: f.rank,
      id: f.formulaId,
      name: f.name,
      matchScore: f.matchScore,
      contraindications: f.contraindications,
    })),
    dosages: result.dosages.map((d) => ({
      formula: d.name,
      natureBias: d.natureBias,
      composition: d.composition.map((h) => ({
        herb: h.name,
        role: h.role,
        baseGrams: h.baseGrams,
        factor: h.factor,
        grams: h.grams,
        adjustment: h.adjustment ?? null,
      })),
    })),
    efficacy: result.efficacy.map((e) => ({
      formula: e.name,
      effectiveRate: `${e.effectiveRate}%`,
      estimatedCourses: e.estimatedCourses,
      constitutionFit: e.constitutionFit,
      riskNotes: e.riskNotes,
    })),
    conflicts: result.conflicts.map((c) => ({
      key: `${c.kind}:${c.key}`,
      values: c.records.map((r: CollectionRecord) => ({
        recordId: r.id,
        source: r.source,
        recordedAt: r.recordedAt,
        value: r.value,
      })),
      resolvedRecordId: c.resolvedRecordId,
    })),
    dependencyIssues: result.dependencyIssues,
  };
}

function main() {
  const files = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(CASES_DIR, f), 'utf-8')) as CaseFile);

  const output: Record<string, unknown> = {};
  console.log(`太医署问诊推演 · 离线批量执行（共 ${files.length} 个样例）\n`);
  for (const file of files) {
    const { before, after } = runCase(file);
    output[file.id] = {
      description: file.description,
      before: summarize(before),
      after: after ? summarize(after) : null,
    };
    console.log(`● ${file.id}`);
    console.log(`  证候：${summarize(before).topSyndrome ?? '（无成立证候）'} | 首选方：${before.formulas[0]?.name ?? '—'}`);
    if (after) {
      console.log(`  裁决/修正后：${summarize(after).topSyndrome ?? '（无成立证候）'} | 首选方：${after.formulas[0]?.name ?? '—'}`);
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const serialized = JSON.stringify(output, null, 2);
  writeFileSync(path.join(OUT_DIR, 'results.json'), `${serialized}\n`, 'utf-8');
  console.log(`\n完整结果已写入 samples/out/results.json`);
}

main();
