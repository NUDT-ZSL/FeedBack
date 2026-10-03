/*
 * 离线一致性验证：建筑选中态 / 高亮 / 信息面板三者始终指向同一栋建筑。
 * 运行方式：npm run verify
 * CityBuilder 与 SelectionController 不依赖 DOM/WebGL，可在 Node 中直接实例化。
 */
const assert = require('node:assert');

// createBuilding 的升起动画使用 requestAnimationFrame，Node 下补一个帧驱动。
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);

const THREE = require('three');
const { CityBuilder } = require('../.verify/cityBuilder.js');
const { SelectionController } = require('../.verify/selection.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, timeoutMs = 15000, label = '') {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时: ${label}`);
    }
    await sleep(50);
  }
}

function makeHarness(initialParams) {
  const panel = { visible: false, shownId: null };
  const builder = new CityBuilder(new THREE.Scene(), initialParams);
  const selection = new SelectionController(builder, {
    showPanel: (building) => {
      panel.visible = true;
      panel.shownId = building.id;
    },
    hidePanel: () => {
      panel.visible = false;
    }
  });
  builder.onBuildingRemoved = (building) => selection.handleBuildingRemoved(building);
  return { builder, selection, panel };
}

function checkConsistency(harness, label) {
  const { builder, selection, panel } = harness;
  const buildings = builder.getBuildings();
  const highlighted = buildings.filter((b) => b.isHighlighted);

  assert.ok(highlighted.length <= 1, `${label}: 存在多栋高亮建筑 (${highlighted.length})`);

  // 高亮标志与材质自发光必须一致。
  for (const building of buildings) {
    const emissive = building.mesh.material.emissive;
    const expected = building.color
      .clone()
      .multiplyScalar(building.isHighlighted ? 0.6 : 0.1);
    assert.ok(
      Math.abs(emissive.r - expected.r) < 1e-4 &&
        Math.abs(emissive.g - expected.g) < 1e-4 &&
        Math.abs(emissive.b - expected.b) < 1e-4,
      `${label}: 建筑 ${building.id} 的自发光与高亮状态不一致`
    );
  }

  if (selection.selectedId === null) {
    assert.strictEqual(panel.visible, false, `${label}: 无选中但面板可见`);
    assert.strictEqual(highlighted.length, 0, `${label}: 无选中但存在高亮`);
  } else {
    const selected = buildings.find((b) => b.id === selection.selectedId);
    assert.ok(selected, `${label}: 选中建筑已不在建筑集合中`);
    assert.strictEqual(panel.visible, true, `${label}: 有选中但面板隐藏`);
    assert.strictEqual(panel.shownId, selected.id, `${label}: 面板指向了另一栋建筑`);
    assert.strictEqual(highlighted.length, 1, `${label}: 有选中但高亮数量不为 1`);
    assert.strictEqual(highlighted[0].id, selected.id, `${label}: 高亮指向了另一栋建筑`);
  }
}

async function waitForBuildings(harness, expectedCount) {
  await waitFor(
    () =>
      harness.builder.getBuildings().length === expectedCount &&
      harness.builder.getBuildings().every((b) => !b.isAnimating),
    15000,
    `等待 ${expectedCount} 栋建筑生成/动画结束`
  );
}

async function main() {
  const params = {
    gridSize: 8,
    density: 0.7,
    buildingSpacing: 2.5,
    minHeight: 5,
    maxHeight: 50,
    heightDistribution: 'pyramid',
    colorTheme: 'sunset'
  };
  let density = params.density;
  const targetCount = () => Math.floor(params.gridSize * params.gridSize * density);
  const setDensity = (harness, value) => {
    density = value;
    harness.builder.updateParams({ density: value });
  };

  let harness = makeHarness(params);

  // 初始生成：无选中、无高亮、面板隐藏。
  harness.builder.generateCity();
  await waitForBuildings(harness, targetCount());
  checkConsistency(harness, '初始生成');

  // 场景一：点击 A，选中 / 高亮 / 面板三者一致。
  const a = harness.builder.getBuildings()[0];
  harness.selection.handleBuildingClick(a);
  checkConsistency(harness, '首次点击 A');
  assert.strictEqual(harness.selection.selectedId, a.id);

  // 场景三：同栋建筑连续快速点击 6 次，显隐与高亮稳定切换、无残留。
  for (let i = 0; i < 6; i++) {
    harness.selection.handleBuildingClick(a);
    checkConsistency(harness, `重复点击 A 第 ${i + 1} 次`);
  }
  assert.strictEqual(harness.selection.selectedId, a.id, '偶数次切换后应回到选中态');
  harness.selection.handleBuildingClick(a);
  checkConsistency(harness, '第 7 次点击 A');
  assert.strictEqual(harness.selection.selectedId, null, '奇数次切换后应为未选中');

  // 场景二：选中 A 后再点击 B，旧高亮必须清除，至多一栋高亮。
  harness.selection.handleBuildingClick(a);
  const b = harness.builder.getBuildings()[1];
  harness.selection.handleBuildingClick(b);
  checkConsistency(harness, '从 A 切换到 B');
  assert.strictEqual(a.isHighlighted, false, 'A 的旧高亮残留');
  assert.strictEqual(b.isHighlighted, true, 'B 未高亮');

  // 场景一验收：重新生成前先失效选中；清空后新建筑不继承任何选中状态。
  const staleBuilding = b;
  harness.selection.clear();
  harness.builder.generateCity();
  checkConsistency(harness, '重新生成后立即检查');
  await waitForBuildings(harness, targetCount());
  checkConsistency(harness, '重新生成完成');
  assert.ok(
    harness.builder.getBuildings().every((x) => !x.isHighlighted),
    '新建筑继承了旧高亮'
  );

  // 过期引用不能被选中。
  harness.selection.select(staleBuilding);
  assert.strictEqual(harness.selection.selectedId, null, '已消失建筑不应可被选中');

  // 场景二验收：调建筑间距触发整城重建，选中态随旧集合失效。
  const c = harness.builder.getBuildings()[2];
  harness.selection.handleBuildingClick(c);
  checkConsistency(harness, '间距调整前选中 C');
  harness.selection.clear();
  harness.builder.clearCity();
  harness.builder.updateParams({ buildingSpacing: 3.0 });
  harness.builder.generateCity();
  checkConsistency(harness, '间距重建后立即检查');
  await waitForBuildings(harness, targetCount());
  checkConsistency(harness, '间距重建完成');

  // 场景四：密度增量减少。先部分减少，选中存活时三者仍一致。
  const d = harness.builder.getBuildings()[3];
  harness.selection.handleBuildingClick(d);
  setDensity(harness, 0.3);
  await waitForBuildings(harness, targetCount());
  checkConsistency(harness, '密度部分降低后');

  // 场景四：密度降为 0，当前选中必然被增量删除，选中态/高亮/面板一并失效。
  setDensity(harness, 0);
  await waitForBuildings(harness, 0);
  checkConsistency(harness, '选中建筑被增量移除');
  assert.strictEqual(harness.selection.selectedId, null);
  assert.strictEqual(harness.panel.visible, false);

  // 场景四：再增量加回建筑，新建筑不继承旧选中状态。
  setDensity(harness, 0.6);
  await waitForBuildings(harness, targetCount());
  checkConsistency(harness, '密度增量回升');
  assert.ok(
    harness.builder.getBuildings().every((x) => !x.isHighlighted),
    '新增建筑不应带高亮'
  );

  // 高度分布变化触发增量重建：集合不变时选中保持，集合变化时自动失效。
  const e = harness.builder.getBuildings()[0];
  harness.selection.handleBuildingClick(e);
  harness.builder.updateParams({ heightDistribution: 'uniform' });
  await sleep(1200);
  checkConsistency(harness, '高度分布变化后');

  // 连续操作：再生成 -> 点击新建筑，最终三者一致。
  harness.selection.clear();
  harness.builder.generateCity();
  await waitForBuildings(harness, targetCount());
  const f = harness.builder.getBuildings()[0];
  harness.selection.handleBuildingClick(f);
  checkConsistency(harness, '连续操作终点');

  console.log('全部通过：选中态 / 高亮 / 信息面板与建筑集合始终一致。');
}

main().catch((error) => {
  console.error('验证失败:', error.message);
  process.exitCode = 1;
});
