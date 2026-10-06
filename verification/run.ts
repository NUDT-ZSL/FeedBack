/**
 * 判定链路离线批量验证入口。
 *
 * 运行方式：npm run verify（或 node verification/run.ts）
 * 纯本地运行：不访问网络、不依赖外部服务，输入全部来自 verification/fixtures。
 * 输出：控制台摘要 + verification/report/verdict-report.json（确定性内容，可逐字节比较）。
 * 退出码：全部通过为 0，任一检查失败为 1。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay } from '../src/replay/engine.ts';
import { conflictScope, correctionScope, rederiveScope } from '../src/replay/incremental.ts';
import { stableStringify } from '../src/replay/canonical.ts';
import type { Dataset, ReplayVerdict, SpatialRecord } from '../src/replay/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(here, 'fixtures', name), 'utf8')) as T;
}

function verdictHash(verdict: ReplayVerdict): string {
  return createHash('sha256').update(stableStringify(verdict)).digest('hex');
}

/** 确定性伪随机数（mulberry32），保证洗牌序列可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function shuffleDataset(dataset: Dataset, seed: number): Dataset {
  const rand = mulberry32(seed);
  return {
    records: shuffled(dataset.records, rand),
    events: shuffled(dataset.events, rand),
    adjudications: shuffled(dataset.adjudications, rand),
  };
}

interface CheckResult {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
}

const base = loadFixture<Dataset>('base-dataset.json');
const broken = loadFixture<Dataset>('broken-links-dataset.json');
const correction = loadFixture<{ correctionRecord: SpatialRecord }>('correction.json');

const checks: Array<() => CheckResult> = [
  // 1. 回放结论对导入顺序不敏感。
  () => {
    const reference = verdictHash(replay(base));
    const hashes: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      hashes.push(verdictHash(replay(shuffleDataset(base, seed * 1000 + 7))));
    }
    const distinct = [...new Set([reference, ...hashes])];
    return {
      name: 'order-invariance',
      passed: distinct.length === 1,
      details: { permutations: hashes.length + 1, referenceHash: reference, distinctHashes: distinct },
    };
  },

  // 2. 矛盾裁决只重推受影响对象与时间区间，且与整体重推一致。
  () => {
    const conflictId = 'mirror-A|20|temperature';
    const adjudication = base.adjudications.find((a) => a.conflictId === conflictId);
    if (!adjudication) throw new Error(`fixture missing adjudication for ${conflictId}`);
    const before: Dataset = {
      ...base,
      adjudications: base.adjudications.filter((a) => a.conflictId !== conflictId),
    };
    const verdictBefore = replay(before);
    const anomalyVisible = verdictBefore.anomalies.some(
      (a) => a.type === 'unresolved-conflict' && a.conflictId === conflictId,
    );
    const scope = conflictScope(base, conflictId);
    const incremental = rederiveScope(verdictBefore, base, scope);
    const full = replay(base);
    const untouchedObjectPreserved =
      stableStringify(incremental.objectStates['mirror-B']) ===
      stableStringify(verdictBefore.objectStates['mirror-B']);
    return {
      name: 'adjudication-scoped-replay',
      passed:
        anomalyVisible &&
        untouchedObjectPreserved &&
        stableStringify(incremental) === stableStringify(full),
      details: {
        scope,
        unresolvedConflictVisibleBeforeAdjudication: anomalyVisible,
        untouchedObjectPreserved,
        incrementalHash: verdictHash(incremental),
        fullReplayHash: verdictHash(full),
      },
    };
  },

  // 3. 事件关联缺失或成环不被静默跳过，以异常形式进入结论。
  () => {
    const verdict = replay(broken);
    const missing = verdict.anomalies.filter((a) => a.type === 'missing-dependency');
    const cycles = verdict.anomalies.filter((a) => a.type === 'dependency-cycle');
    const excludedFromImpacts =
      !('x1' in verdict.eventImpacts) && !('x2' in verdict.eventImpacts) && !('x3' in verdict.eventImpacts);
    const validEventStillImpacted = 'x4' in verdict.eventImpacts;
    const fixed: Dataset = {
      ...broken,
      events: broken.events
        .filter((e) => e.id !== 'x1')
        .map((e) => (e.id === 'x3' ? { ...e, dependsOn: [] } : e)),
    };
    const fixedVerdict = replay(fixed);
    return {
      name: 'anomaly-visibility',
      passed:
        missing.length === 1 &&
        cycles.length === 1 &&
        excludedFromImpacts &&
        validEventStillImpacted &&
        fixedVerdict.anomalies.length === 0,
      details: {
        anomalies: verdict.anomalies,
        invalidEventsExcludedFromImpacts: excludedFromImpacts,
        validEventStillImpacted,
        anomaliesAfterFix: fixedVerdict.anomalies.length,
      },
    };
  },

  // 4. 记录修正后，受影响范围的重推与全量重推结果一致。
  () => {
    const corrected: Dataset = { ...base, records: [...base.records, correction.correctionRecord] };
    const verdictBefore = replay(base);
    const scope = correctionScope(corrected, correction.correctionRecord.id);
    const incremental = rederiveScope(verdictBefore, corrected, scope);
    const full = replay(corrected);
    const untouchedObjectPreserved =
      stableStringify(incremental.objectStates['mirror-A']) ===
      stableStringify(verdictBefore.objectStates['mirror-A']);
    return {
      name: 'correction-scoped-replay',
      passed: untouchedObjectPreserved && stableStringify(incremental) === stableStringify(full),
      details: {
        scope,
        untouchedObjectPreserved,
        incrementalHash: verdictHash(incremental),
        fullReplayHash: verdictHash(full),
      },
    };
  },

  // 5. 输入变化（裁决翻转 / 修正值变化）必须暴露为结论差异，而非静默通过。
  () => {
    const reference = verdictHash(replay(base));
    const flipped: Dataset = {
      ...base,
      adjudications: base.adjudications.map((a) =>
        a.conflictId === 'mirror-A|20|temperature' ? { ...a, winnerRecordId: 'r2' } : a,
      ),
    };
    const flippedHash = verdictHash(replay(flipped));
    const corrected: Dataset = { ...base, records: [...base.records, correction.correctionRecord] };
    const correctedHash = verdictHash(replay(corrected));
    const alteredCorrection: Dataset = {
      ...base,
      records: [...base.records, { ...correction.correctionRecord, value: 'shelf-5' }],
    };
    const alteredHash = verdictHash(replay(alteredCorrection));
    return {
      name: 'difference-exposure',
      passed:
        flippedHash !== reference && correctedHash !== reference && alteredHash !== correctedHash,
      details: { referenceHash: reference, flippedHash, correctedHash, alteredHash },
    };
  },
];

const results: CheckResult[] = [];
let failed = 0;
for (const check of checks) {
  const result = check();
  results.push(result);
  const mark = result.passed ? 'PASS' : 'FAIL';
  if (!result.passed) failed++;
  console.log(`[${mark}] ${result.name}`);
  console.log(`       ${stableStringify(result.details)}`);
}

const report = {
  suite: 'replay-judgment-chain-verification',
  deterministic: true,
  checks: results,
  overall: failed === 0 ? 'pass' : 'fail',
};
const reportDir = path.join(here, 'report');
mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'verdict-report.json');
writeFileSync(reportPath, `${stableStringify(report, 2)}\n`);
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}，报告已写入 ${reportPath}`);
process.exit(failed === 0 ? 0 : 1);
