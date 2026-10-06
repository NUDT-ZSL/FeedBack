/**
 * 离线样例：固定四诊输入，供 scripts/verify-engine.ts 批量复现推演与裁决过程。
 * 所有记录时刻为逻辑序号，不依赖系统时间。
 */
import { DEFAULT_KNOWLEDGE, type KnowledgeBase, type ModifierRule } from './knowledge.js';
import type { ObservationRecord } from './types.js';

let seq = 0;
function rec(
  kind: ObservationRecord['kind'],
  key: string,
  value: string,
  source: string,
  status: ObservationRecord['status'] = 'pending'
): ObservationRecord {
  seq += 1;
  return {
    id: `fx-${String(seq).padStart(4, '0')}`,
    kind,
    key,
    value,
    source,
    collectedAt: seq,
    status,
  };
}

function build(builder: () => ObservationRecord[]): ObservationRecord[] {
  seq = 0;
  return builder();
}

/** 外感风寒案：恶寒头痛发热 + 浮脉 + 薄苔 */
export const windColdCase = build(() => [
  rec('symptom', 'aversion-cold', 'present', '问诊'),
  rec('symptom', 'headache', 'present', '问诊'),
  rec('symptom', 'fever', 'present', '问诊'),
  rec('pulse', 'pulse', '浮脉', '切诊'),
  rec('tongue', 'tongue', '薄苔', '望诊'),
  rec('constitution', 'constitution', '平和质', '问诊'),
  rec('history', 'history', '无', '问诊'),
]);

/** 脾胃湿热案（湿热质 + 痰湿表现，触发体质⇄证候联动规则） */
export const dampHeatCase = build(() => [
  rec('symptom', 'stomachache', 'present', '问诊'),
  rec('symptom', 'poor-appetite', 'present', '问诊'),
  rec('symptom', 'phlegm', 'present', '问诊'),
  rec('pulse', 'pulse', '滑脉', '切诊'),
  rec('tongue', 'tongue', '腻苔', '望诊'),
  rec('constitution', 'constitution', '湿热质', '问诊'),
  rec('history', 'history', '无', '问诊'),
]);

/**
 * 冲突案：同一脉象被两次切诊采集出互异值（浮脉/沉脉），
 * 期望形成冲突组并暂不参与辨证；裁决采纳浮脉后应与 windColdCase 结论一致。
 */
export const conflictCase = build(() => [
  rec('symptom', 'aversion-cold', 'present', '问诊'),
  rec('symptom', 'headache', 'present', '问诊'),
  rec('symptom', 'fever', 'present', '问诊'),
  rec('pulse', 'pulse', '浮脉', '切诊'),
  rec('pulse', 'pulse', '沉脉', '复诊'),
  rec('tongue', 'tongue', '薄苔', '望诊'),
  rec('constitution', 'constitution', '平和质', '问诊'),
  rec('history', 'history', '无', '问诊'),
]);

/** 气血两虚案（气虚质 + 消渴病史） */
export const deficiencyCase = build(() => [
  rec('symptom', 'fatigue', 'present', '问诊'),
  rec('symptom', 'insomnia', 'present', '问诊'),
  rec('symptom', 'poor-appetite', 'present', '问诊'),
  rec('pulse', 'pulse', '沉脉', '切诊'),
  rec('tongue', 'tongue', '白苔', '望诊'),
  rec('constitution', 'constitution', '气虚质', '问诊'),
  rec('history', 'history', '消渴', '问诊'),
]);

/** 含依赖闭环与指向缺失的知识库（用于验证显式暴露，不被静默跳过） */
export function knowledgeWithCycleAndMissing(): KnowledgeBase {
  const cyclic: ModifierRule = {
    id: 'mod-cyclic-self',
    triggerKind: 'constitution',
    triggerValue: '湿热质',
    syndrome: 'spleen-damp-heat',
    delta: 5,
    dependsOn: ['syndrome:spleen-damp-heat'],
    description: '（样例）自指闭环规则',
  };
  const missing: ModifierRule = {
    id: 'mod-missing-target',
    triggerKind: 'history',
    triggerValue: '喘证',
    syndrome: 'nonexistent-syndrome',
    delta: 5,
    dependsOn: ['syndrome:also-missing'],
    description: '（样例）指向缺失规则',
  };
  return {
    ...DEFAULT_KNOWLEDGE,
    modifiers: [...DEFAULT_KNOWLEDGE.modifiers, cyclic, missing],
  };
}

/** 触发闭环/缺失的输入：湿热质 + 喘证病史 */
export const cycleProbeCase = build(() => [
  rec('symptom', 'stomachache', 'present', '问诊'),
  rec('symptom', 'phlegm', 'present', '问诊'),
  rec('pulse', 'pulse', '滑脉', '切诊'),
  rec('tongue', 'tongue', '腻苔', '望诊'),
  rec('constitution', 'constitution', '湿热质', '问诊'),
  rec('history', 'history', '喘证', '问诊'),
]);

export const ALL_CASES = {
  windColdCase,
  dampHeatCase,
  conflictCase,
  deficiencyCase,
} as const;
