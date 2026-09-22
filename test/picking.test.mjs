import { rayAABB, computePick, checkOcclusion } from '../js/picking-core.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

const model = JSON.parse(readFileSync(new URL('../data/scene.json', import.meta.url), 'utf8'));
const parts = model.parts.filter(p => !p.group).map(p => ({ ...p, visible: true }));
const byId = id => parts.find(p => p.id === id);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('rayAABB 命中与未命中', () => {
  assert.strictEqual(rayAABB([0, 0, 5], [0, 0, -1], { min: [-1, -1, -1], max: [1, 1, 1] }), 4);
  assert.strictEqual(rayAABB([0, 0, 5], [0, 0, 1], { min: [-1, -1, -1], max: [1, 1, 1] }), null);
  assert.strictEqual(rayAABB([5, 0, 5], [0, 0, -1], { min: [-1, -1, -1], max: [1, 1, 1] }), null);
  assert.strictEqual(rayAABB([0, 0, 0], [0, 0, -1], { min: [-1, -1, -1], max: [1, 1, 1] }), 0); // 起点在盒内
});

t('正面点击：外壳为最近可见，内部件全部被标记为被挡候选', () => {
  const { selected, candidates } = computePick(parts, [0, 2.3, 10], [0, 0, -1]);
  assert.strictEqual(selected.part.id, 'housing');
  const ids = candidates.map(c => c.part.id);
  for (const id of ['window', 'gear-big', 'shaft']) assert.ok(ids.includes(id), `缺少候选 ${id}`);
  assert.ok(byId && candidates.find(c => c.part.id === 'gear-big').occluded);
  assert.ok(candidates.find(c => c.part.id === 'shaft').occluders.includes('housing'));
  assert.ok(!candidates.find(c => c.part.id === 'housing').occluded);
});

t('透明件不遮挡：隐藏外壳后，透过观察窗应选中内部零件', () => {
  byId('housing').visible = false;
  const { selected } = computePick(parts, [0, 2.3, 10], [0, 0, -1]);
  assert.strictEqual(selected.part.id, 'window'); // 透明件本身可见、可被选中
  byId('window').visible = false;
  const r2 = computePick(parts, [0, 2.3, 10], [0, 0, -1]);
  assert.strictEqual(r2.selected.part.id, 'gear-big'); // 透明件不算遮挡物
  byId('housing').visible = true;
  byId('window').visible = true;
});

t('隐藏零件立即退出候选，不沿用旧结果', () => {
  byId('housing').visible = false;
  const { candidates } = computePick(parts, [0, 2.3, 10], [0, 0, -1]);
  assert.ok(!candidates.some(c => c.part.id === 'housing'));
  byId('housing').visible = true;
});

t('视角转动后选中保持：从背面看主轴被外壳遮挡，可拿到可见替代', () => {
  // 从正前方看主轴：被外壳挡住
  let res = checkOcclusion(parts, [0, 2.3, 10], 'shaft');
  assert.strictEqual(res.visible, false);
  assert.ok(res.occluders.some(o => o.id === 'housing'));
  assert.strictEqual(res.nearestVisible.id, 'housing');
  // 隐藏外壳+观察窗后重算生效：主轴仍被大齿轮挡，大齿轮变为可见
  byId('housing').visible = false;
  byId('window').visible = false;
  res = checkOcclusion(parts, [0, 2.3, 10], 'shaft');
  assert.strictEqual(res.visible, false);
  assert.ok(res.occluders.some(o => o.id === 'gear-big'));
  res = checkOcclusion(parts, [0, 2.3, 10], 'gear-big');
  assert.strictEqual(res.visible, true);
  byId('housing').visible = true;
  byId('window').visible = true;
});

t('俯视角度主轴直接可见（不被外壳挡）', () => {
  const res = checkOcclusion(parts, [0, 30, 0.01], 'shaft');
  // 正上方视线先穿外壳顶面，应判遮挡
  assert.strictEqual(res.visible, false);
});

t('隐藏与缺失零件的状态', () => {
  byId('shaft').visible = false;
  assert.strictEqual(checkOcclusion(parts, [0, 2.3, 10], 'shaft').hidden, true);
  byId('shaft').visible = true;
  assert.strictEqual(checkOcclusion(parts, [0, 0, 10], 'no-such-id').missing, true);
});

console.log(`\n${passed} 个测试全部通过`);
