/**
 * 离线验收脚本：不依赖外部账号或在线服务，使用本地固定样例批量执行，
 * 校验推演的一致性、冲突裁决、增量重推与依赖异常暴露。
 *
 * 运行：npm run verify:engine
 */
import { DiagnosisSession, runInference } from '../src/engine/index.js';
import {
  ALL_CASES,
  conflictCase,
  cycleProbeCase,
  knowledgeWithCycleAndMissing,
} from '../src/engine/fixtures.js';
import type { InferenceResult, ObservationRecord } from '../src/engine/types.js';

let failures = 0;
const checks: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  checks.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/* ---------- 1. 批量执行 + 重复运行结论一致 ---------- */
for (const [caseName, records] of Object.entries(ALL_CASES)) {
  const runs = [1, 2, 3].map(() => runInference({ records }));
  const [first, ...rest] = runs.map(stableJson);
  check(`重复推演一致/${caseName}`, rest.every((j) => j === first));
}

/* ---------- 2. 证候判定 / 方剂排序 / 剂量配比 / 疗效预估 ---------- */
const cold = runInference({ records: ALL_CASES.windColdCase });
check(
  '风寒案证候首位',
  cold.syndromes[0].name === '外感风寒',
  cold.syndromes[0]?.name
);
check('风寒案首方为桂枝汤', cold.formulas[0]?.name === '桂枝汤', cold.formulas[0]?.name);
check(
  '桂枝汤剂量配比君臣有序',
  cold.formulas[0]?.herbs[0].role === '君' &&
    Math.abs(
      cold.formulas[0]!.herbs.reduce((s, h) => s + h.ratio, 0) - 1
    ) < 1e-6
);
check('疗效预估含有效率与取效日', cold.efficacy[0]?.expectedRate > 0 && cold.efficacy[0]?.onsetDays >= 1);

const damp = runInference({ records: ALL_CASES.dampHeatCase });
check('湿热案证候首位', damp.syndromes[0].name === '脾胃湿热', damp.syndromes[0]?.name);
check('湿热案首方为平胃散', damp.formulas[0]?.name === '平胃散', damp.formulas[0]?.name);
check(
  '湿热质⇄痰湿联动规则生效',
  damp.syndromes.some((s) =>
    s.contributions.some((c) => c.from === 'mod:mod-shire-dampheat' && c.delta === 10)
  )
);

const def = runInference({ records: ALL_CASES.deficiencyCase });
check('虚损案证候首位', def.syndromes[0].name === '气血两虚', def.syndromes[0]?.name);
check('虚损案首方为八珍汤', def.formulas[0]?.name === '八珍汤', def.formulas[0]?.name);
check(
  '消渴病史反映在疗效备注',
  def.efficacy.some((e) => e.notes.some((n) => n.includes('消渴')))
);

/* ---------- 3. 重复采集冲突：保留冲突、裁决后参与辨证 ---------- */
const conflictBefore = runInference({ records: conflictCase });
const pulseRecs = conflictCase.filter((r) => r.kind === 'pulse');
check(
  '冲突脉象在裁决前全部暂不参与',
  pulseRecs.every((r) => conflictBefore.withheldRecordIds.includes(r.id)) &&
    conflictBefore.diagnostics.some((d) => d.type === 'unresolved-conflict' && d.key === 'pulse')
);
check(
  '裁决前证候加减分不含脉象',
  !conflictBefore.syndromes[0]?.contributions.some((c) => c.detail.includes('脉象'))
);

// 裁决：采纳「浮脉」记录（按来源+时刻区分，后采的沉脉被弃用）
const resolved: ObservationRecord[] = conflictCase.map((r) => {
  if (r.kind !== 'pulse') return { ...r };
  if (r.value === '浮脉') return { ...r, status: 'adjudicated' };
  return { ...r, status: 'rejected' };
});
const conflictAfter = runInference({ records: resolved });
check('裁决后无未决冲突诊断', !conflictAfter.diagnostics.some((d) => d.type === 'unresolved-conflict'));
check(
  '裁决后浮脉参与辨证',
  conflictAfter.syndromes.some((s) =>
    s.contributions.some((c) => c.detail.includes('浮脉') && c.delta === 9)
  )
);
const coldStable = runInference({ records: ALL_CASES.windColdCase });
check(
  '不同入口同组输入结论一致',
  conflictAfter.syndromes[0]?.syndromeId === coldStable.syndromes[0]?.syndromeId &&
    conflictAfter.formulas[0]?.formulaId === coldStable.formulas[0]?.formulaId,
  `${conflictAfter.syndromes[0]?.syndromeId} vs ${coldStable.syndromes[0]?.syndromeId}`
);

/* ---------- 4. 增量重推与全量重推逐字节一致 ---------- */
{
  const session = new DiagnosisSession();
  const src: ObservationRecord[] = conflictCase;
  const kinds = src.map((r) => ({ kind: r.kind, key: r.key, value: r.value, source: r.source }));
  kinds.forEach((k) => session.collect(k.kind, k.key, k.value, k.source));

  let step = 0;
  const full1 = runInference({ records: session.getRecords() });
  check(`增量#${step} 与全量一致`, stableJson(session.getResult()) === stableJson(full1));

  // 裁决第一条脉象（浮脉）
  step += 1;
  session.adjudicate('pulse', 'pulse', session.getRecords().find((r) => r.kind === 'pulse' && r.value === '浮脉')!.id);
  const full2 = runInference({ records: session.getRecords() });
  check(`增量#${step} 裁决后与全量一致`, stableJson(session.getResult()) === stableJson(full2));

  // 修正：把舌象从薄苔改为白苔
  step += 1;
  const tongueId = session.getRecords().find((r) => r.kind === 'tongue')!.id;
  session.correct(tongueId, '白苔', '复诊');
  const full3 = runInference({ records: session.getRecords() });
  check(`增量#${step} 修正后与全量一致`, stableJson(session.getResult()) === stableJson(full3));

  // 再追加一条咳嗽采集，仅影响含咳嗽权重的证候
  step += 1;
  session.collect('symptom', 'cough', 'present', '问诊');
  const full4 = runInference({ records: session.getRecords() });
  check(`增量#${step} 追加采集后与全量一致`, stableJson(session.getResult()) === stableJson(full4));

  // 全量缓存入口同样一致
  check('显式全量重推一致', stableJson(session.runFull()) === stableJson(full4));
}

/* ---------- 5. 依赖闭环与指向缺失必须显式暴露 ---------- */
{
  const kb = knowledgeWithCycleAndMissing();
  const probe = runInference({ records: cycleProbeCase }, kb);
  const cycleDiag = probe.diagnostics.find((d) => d.type === 'dependency-cycle');
  check(
    '依赖闭环被检出并暴露',
    !!cycleDiag &&
      cycleDiag.type === 'dependency-cycle' &&
      cycleDiag.nodes.includes('mod:mod-cyclic-self') &&
      cycleDiag.nodes.includes('syn:spleen-damp-heat'),
    cycleDiag?.detail
  );
  const missingCount = probe.diagnostics.filter((d) => d.type === 'missing-reference').length;
  check('指向缺失被检出（规则目标证候 + 依赖证候）', missingCount >= 2, `${missingCount} 条`);
  // 闭环规则不生效（不静默参与），证候仍确定性产出
  check(
    '闭环规则不计入加减分',
    !probe.syndromes.some((s) =>
      s.contributions.some((c) => c.from === 'mod:mod-cyclic-self')
    )
  );
  const again = runInference({ records: cycleProbeCase }, kb);
  check('异常知识库下推演仍可重复', stableJson(probe) === stableJson(again));
}

/* ---------- 汇总输出 ---------- */
function summarize(result: InferenceResult, label: string): void {
  const topSyn = result.syndromes[0];
  const topFor = result.formulas[0];
  console.log(
    `  ${label.padEnd(10)} 证候=${topSyn?.name ?? '—'.padEnd(6)} 方剂=${topFor?.name ?? '—'.padEnd(6)} 有效率=${result.efficacy[0]?.expectedRate ?? '-'}% 诊断=${result.diagnostics.length}`
  );
}

console.log('\n=== 太医署辨证推演 · 离线批量验收 ===');
for (const [name, records] of Object.entries(ALL_CASES)) summarize(runInference({ records }), name);
console.log('\n--- 校验明细 ---');
for (const line of checks) console.log(line);
console.log(`\n共 ${checks.length} 项，失败 ${failures} 项`);
if (failures > 0) process.exit(1);
console.log('全部通过。');
