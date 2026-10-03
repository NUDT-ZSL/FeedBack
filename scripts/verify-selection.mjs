// 离线验证：选中态 / 高亮 / 信息面板 与建筑集合的一致性
// 运行：npm run verify
import * as THREE from 'three';
import { CityBuilder } from '../node_modules/.cache/city-verify/cityBuilder.js';

globalThis.requestAnimationFrame = (cb) =>
  setTimeout(() => cb(performance.now()), 5);

let passed = 0;
function assert(condition, message) {
  if (!condition) {
    console.error('  ✗ 断言失败:', message);
    process.exitCode = 1;
    throw new Error(message);
  }
  passed++;
}

async function waitFor(condition, message, timeoutMs = 15000) {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeoutMs) {
      console.error('  ✗ 等待超时:', message);
      process.exitCode = 1;
      throw new Error('timeout: ' + message);
    }
    await new Promise((r) => setTimeout(r, 30));
  }
}

// 复刻 main.ts 中的选中链路：selected / 高亮 / 面板 单一事实源
function createSelectionModel(builder) {
  let selected = null;
  let panelVisible = false;
  let clearedCount = 0;

  builder.onCityCleared = () => {
    selected = null;
    panelVisible = false;
    clearedCount++;
  };
  builder.onBuildingRemoved = (b) => {
    if (selected && selected.id === b.id) {
      selected = null;
      panelVisible = false;
    }
  };

  return {
    select(building) {
      if (selected) builder.setHighlight(selected, false);
      selected = building;
      builder.setHighlight(building, true);
      panelVisible = true;
    },
    toggle(building) {
      if (selected && selected.id === building.id) {
        builder.setHighlight(selected, false);
        selected = null;
        panelVisible = false;
      } else {
        this.select(building);
      }
    },
    invariant(label) {
      const all = builder.getBuildings();
      const highlighted = all.filter((b) => b.isHighlighted);
      assert(highlighted.length <= 1, `${label}: 至多一栋高亮，实际 ${highlighted.length}`);
      if (selected) {
        assert(builder.getBuilding(selected.id) === selected, `${label}: 选中建筑仍在集合中`);
        assert(selected.isHighlighted, `${label}: 选中建筑必须高亮`);
        assert(panelVisible === true, `${label}: 选中时面板必须可见`);
        assert(highlighted[0] === selected, `${label}: 高亮必须指向选中建筑`);
      } else {
        assert(panelVisible === false, `${label}: 无选中时面板必须隐藏`);
        assert(highlighted.length === 0, `${label}: 无选中时不得有高亮`);
      }
    },
    isSelected(building) {
      return selected?.id === building.id;
    },
    get panelVisible() {
      return panelVisible;
    },
    get clearedCount() {
      return clearedCount;
    },
    get selected() {
      return selected;
    }
  };
}

async function main() {
  const scene = new THREE.Scene();
  const builder = new CityBuilder(scene, {
    gridSize: 10,
    density: 0.7,
    buildingSpacing: 2.5,
    heightDistribution: 'pyramid',
    colorTheme: 'sunset'
  });
  const selection = createSelectionModel(builder);

  // 1) 生成 → 建筑数量符合密度
  console.log('[1] 生成城市');
  builder.generateCity();
  await waitFor(() => builder.getBuildings().length === 70, '初始 70 栋');
  const ids1 = new Set(builder.getBuildings().map((b) => b.id));
  assert(ids1.size === 70, 'id 唯一');
  const target1 = builder.getBuildings()[10];
  selection.select(target1);
  selection.invariant('初始选中');
  console.log('    选中 #' + target1.id + '，面板可见=' + selection.panelVisible);

  // 2) 重新生成 → 选中/高亮/面板随旧集合整体失效
  console.log('[2] 重新生成城市（问题一）');
  builder.generateCity();
  assert(selection.panelVisible === false, '重新生成后面板立即隐藏');
  assert(selection.selected === null, '重新生成后选中态清空');
  await waitFor(() => builder.getBuildings().length === 70, '重建后 70 栋');
  const ids2 = new Set(builder.getBuildings().map((b) => b.id));
  assert(builder.getBuildings().every((b) => !b.isHighlighted), '新城市无残留高亮');
  assert(builder.getBuildings().every((b) => !ids1.has(b.id)), '新建筑全部使用新 id（不继承旧选中）');
  selection.invariant('重建后');

  // 3) 再生成后点击与旧建筑同网格位的新建筑：id 不同，应正常选中而非误判切换（问题三/验收链路）
  const sameCell = builder.getBuildings().find(
    (b) => b.gridX === target1.gridX && b.gridZ === target1.gridZ
  );
  if (sameCell) {
    console.log('[3] 点击同格新建筑 #' + sameCell.id);
    assert(sameCell.id !== target1.id, '同格新建筑 id 不同');
    selection.select(sameCell);
    assert(selection.selected === sameCell && sameCell.isHighlighted, '同格新建筑可被选中');
    selection.invariant('同格点击后');
    selection.toggle(sameCell);
    assert(selection.panelVisible === false && !sameCell.isHighlighted, '重复点击：面板与高亮同步关闭');
    selection.invariant('重复点击关闭后');
    selection.toggle(sameCell);
    assert(selection.panelVisible === true && sameCell.isHighlighted, '再次点击：面板与高亮同步打开');
    selection.invariant('重复点击打开后');
  }

  // 4) 密度下调 → 增量删除；若删掉的是选中建筑，三者一并失效（问题四）
  console.log('[4] 密度 0.7 → 0.4 增量删除（问题四）');
  if (!selection.selected) {
    selection.select(builder.getBuildings()[0]);
  }
  const selectedId = selection.selected.id;
  builder.updateParams({ density: 0.4 });
  await waitFor(() => builder.getBuildings().length === 40, '增量删除到 40 栋');
  const stillExists = !!builder.getBuilding(selectedId);
  if (stillExists) {
    assert(selection.panelVisible === true && selection.selected.isHighlighted, '选中建筑仍在：状态保留');
  } else {
    assert(selection.panelVisible === false && selection.selected === null, '选中建筑被删：面板隐藏、选中清空');
  }
  selection.invariant('密度调整后');

  // 5) 强制删除当前选中建筑（removeBuilding 完成后触发 onBuildingRemoved）
  console.log('[5] 直接移除当前选中建筑');
  const victim = builder.getBuildings()[0];
  selection.select(victim);
  builder.removeBuilding(victim, 0.05);
  await waitFor(() => !builder.getBuilding(victim.id), '移除动画结束');
  assert(selection.panelVisible === false && selection.selected === null, '移除选中建筑后三者失效');
  selection.invariant('移除后');

  // 6) 间距调整等价链路：clearCity → updateParams → generateCity（问题二）
  console.log('[6] 调整建筑间距触发整城重建（问题二）');
  selection.select(builder.getBuildings()[0]);
  builder.clearCity();
  assert(builder.getBuildings().length === 0 && selection.panelVisible === false, 'clearCity 同步清空选中与面板');
  builder.updateParams({ buildingSpacing: 3.0 });
  builder.generateCity();
  await waitFor(() => builder.getBuildings().length === 40, '按 0.4 密度重建 40 栋');
  assert(builder.getBuildings().every((b) => !b.isHighlighted), '重建后无旧高亮残留');
  selection.invariant('间距重建后');
  const next = builder.getBuildings()[5];
  selection.select(next);
  const other = builder.getBuildings()[6];
  selection.select(other);
  assert(next.isHighlighted === false && other.isHighlighted === true, '切换选中：旧高亮清除，新高亮唯一');
  selection.invariant('切换选中后');

  // 7) 连续快速重新生成：过期 setTimeout 不得向新城市塞入旧建筑（集合一致性）
  console.log('[7] 连续快速生成 ×3（验收：连续操作后集合一致）');
  builder.generateCity();
  builder.generateCity();
  builder.generateCity();
  await new Promise((r) => setTimeout(r, 5000));
  assert(builder.getBuildings().length === 40, '建筑数量精确为目标值，无过期批次泄漏');
  assert(builder.getBuildings().every((b) => !b.isHighlighted), '快速重建后无高亮残留');
  selection.invariant('快速重建后');

  // 8) 对已移除建筑设置高亮应为安全空操作
  console.log('[8] 失效建筑保护');
  builder.setHighlight(victim, true);
  assert(!victim.isHighlighted, '已移除建筑不会被点亮');

  console.log(`\n全部通过：${passed} 条断言，选中态 / 高亮 / 面板 / 建筑集合始终一致。`);
}

main().catch((err) => {
  console.error('\n验证失败:', err.message);
  process.exitCode = 1;
});
