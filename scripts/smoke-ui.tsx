/**
 * UI 冒烟：SSR 渲染问诊室初始态，并模拟一次完整问诊流程校验 store 状态。
 * 注：zustand v5 在 SSR 下渲染 getInitialState，故推演结果以 store 状态断言为准。
 * 用法：npx tsx scripts/smoke-ui.tsx
 */
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import assert from 'node:assert/strict';
import ClinicRoom from '../src/components/clinic/ClinicRoom';
import { useClinicStore } from '../src/stores/clinicStore';

const html = renderToString(createElement(ClinicRoom));
assert.ok(html.includes('太医署') && html.includes('尚无采集记录'), '初始渲染失败');
console.log('✓ 初始渲染（采集面板 + 空结果占位）');

const s = useClinicStore.getState();
s.collect('symptom', 'fever', 'true', 'wenwen');
s.collect('tongue', 'thin-white', 'true', 'wang');
s.collect('pulse', 'floating', 'true', 'qie');
s.collect('pulse', 'floating', 'false', 'qie');
s.deduce();
let st = useClinicStore.getState();
assert.equal(st.result?.conflicts.length, 1, '应识别出脉象冲突');
assert.equal(
  st.result?.syndromes.filter((x) => x.score >= x.threshold && x.status === 'concluded').length,
  0,
  '冲突未裁决时风寒不应成立',
);
console.log('✓ 采集 + 辨证：冲突保留，未裁决项不参与辨证');

st.adjudicate({ kind: 'pulse', key: 'floating', decision: 'pick', recordId: 'rec-0003' });
st = useClinicStore.getState();
const top = st.result?.syndromes
  .filter((x) => x.status === 'concluded' && x.score >= x.threshold)
  .sort((a, b) => b.score - a.score)[0];
assert.equal(top?.name, '外感风寒');
assert.equal(st.result?.formulas[0]?.name, '桂枝汤');
assert.equal(st.result?.efficacy[0]?.effectiveRate, 80);
assert.ok((st.result?.dosages[0]?.composition.length ?? 0) === 5);
console.log('✓ 裁决后增量重推：外感风寒 / 桂枝汤 / 剂量配比 / 疗效预估 80%');

st.correct('rec-0004', 'true');
st = useClinicStore.getState();
assert.equal(st.result?.conflicts.length, 0, '修正后取值一致，冲突消解');
assert.equal(st.result?.formulas[0]?.name, '桂枝汤');
console.log('✓ 修正记录后冲突消解，结论稳定');

st.reset();
st = useClinicStore.getState();
assert.equal(st.records.length, 0);
assert.equal(st.result, null);
console.log('✓ 新建诊案重置');
console.log('\nUI 冒烟全部通过。');
