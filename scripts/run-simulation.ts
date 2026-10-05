/**
 * 离线批量复算入口。
 *
 * 用法：
 *   node scripts/run-simulation.ts          # 人类可读报告
 *   node scripts/run-simulation.ts --json   # 机器可读 JSON
 *
 * 覆盖：
 *   1. 同一输入重复推演的稳定性（指纹一致）
 *   2. 多组参数（来水/分流/容量/阈值/水车）场景复算
 *   3. 局部增量重算与整体重算的一致性
 *   4. 连续局部调整后增量链路与整体重算的一致性
 *
 * 任一项校验失败，进程以非零码退出，可直接接入 CI / 批量验收。
 */
import { runFull } from '../src/simulation/engine.ts';
import { runIncremental } from '../src/simulation/incremental.ts';
import { baseParams, scenarios } from '../src/simulation/scenarios.ts';
import type { SimulationParams, SimulationResult } from '../src/simulation/types.ts';
import { resultFingerprint, resultsEqual } from '../src/simulation/verify.ts';

interface ScenarioReport {
  id: string;
  title: string;
  description: string;
  fingerprint: string;
  recomputedFields: string[];
  consistent: boolean;
  fieldConclusions: Array<{
    fieldId: string;
    name: string;
    storageRatio: number;
    deficit: boolean;
    deficitTicks: number;
    basis: string;
  }>;
}

interface BatchReport {
  base: { fingerprint: string; repeatStable: boolean };
  scenarios: ScenarioReport[];
  chained: { consistent: boolean };
  allPassed: boolean;
}

function buildReport(): BatchReport {
  const base = baseParams();
  const baseResult = runFull(base);
  const baseRepeat = runFull(base);
  const repeatStable = resultsEqual(baseResult, baseRepeat);

  const reports: ScenarioReport[] = scenarios().map((scenario) => {
    const next: SimulationParams = scenario.patch(base);
    const full: SimulationResult = runFull(next);
    const incremental: SimulationResult = runIncremental(base, baseResult, next);
    const consistent = resultsEqual(full, incremental);

    return {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      fingerprint: resultFingerprint(full),
      recomputedFields: incremental.meta.recomputedFields,
      consistent,
      fieldConclusions: full.fields.map((field) => ({
        fieldId: field.fieldId,
        name: field.name,
        storageRatio: field.storageRatio,
        deficit: field.deficit,
        deficitTicks: field.deficitTicks,
        basis: field.basis,
      })),
    };
  });

  // 连续局部调整：在增量链路上依次应用所有场景，逐点与整体重算比对
  let chainedConsistent = true;
  let prevParams = base;
  let prevResult: SimulationResult = baseResult;
  for (const scenario of scenarios()) {
    const next = scenario.patch(prevParams);
    const full = runFull(next);
    const incremental = runIncremental(prevParams, prevResult, next);
    if (!resultsEqual(full, incremental)) chainedConsistent = false;
    prevParams = next;
    prevResult = incremental;
  }

  return {
    base: { fingerprint: resultFingerprint(baseResult), repeatStable },
    scenarios: reports,
    chained: { consistent: chainedConsistent },
    allPassed:
      repeatStable && chainedConsistent && reports.every((report) => report.consistent),
  };
}

function printHuman(report: BatchReport): void {
  console.log('灌溉推演 · 离线批量复算报告');
  console.log('=' .repeat(64));
  console.log(`基准输入结果指纹 : ${report.base.fingerprint}`);
  console.log(`重复推演稳定性   : ${report.base.repeatStable ? '通过' : '失败'}`);
  console.log('');

  for (const item of report.scenarios) {
    console.log(`【${item.title}】${item.description}`);
    console.log(`  一致性（增量 ≡ 整体） : ${item.consistent ? '通过' : '失败'}`);
    console.log(`  局部重算田块         : ${item.recomputedFields.join(', ') || '（无，沿用缓存）'}`);
    console.log(`  结果指纹             : ${item.fingerprint}`);
    for (const field of item.fieldConclusions) {
      const ratio = `${(field.storageRatio * 100).toFixed(1)}%`;
      const verdict = field.deficit ? '缺水' : '正常';
      console.log(`  - ${field.name}（${field.fieldId}）蓄水率 ${ratio} ${vercent(verdict)}，缺水 ${field.deficitTicks} 刻`);
    }
    console.log('');
  }

  console.log(`连续局部调整链路一致性 : ${report.chained.consistent ? '通过' : '失败'}`);
  console.log('-'.repeat(64));
  console.log(`总体验收 : ${report.allPassed ? '全部通过' : '存在失败项'}`);
}

function vercent(verdict: string): string {
  return verdict === '缺水' ? '[缺水]' : '[正常]';
}

const report = buildReport();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}

if (!report.allPassed) process.exitCode = 1;
