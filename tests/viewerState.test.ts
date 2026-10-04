import { test, assert, assertEqual, assertClose, assertVec3Close } from './harness';
import { ViewerCore } from '../src/core/viewerState';
import { buildMoleculeModel } from '../src/core/moleculeGeometry';
import { worldToScreen } from '../src/core/projection';
import { MOLECULES } from '../src/moleculeData';
import { DEFAULT_TWEEN_DURATION_MS } from '../src/core/tween';

const H2O = MOLECULES[0];
const CO2 = MOLECULES[1];
const C6H6 = MOLECULES[2];

function advance(core: ViewerCore, stepMs: number, untilDone: boolean = true): void {
  let guard = 0;
  do {
    core.update(stepMs);
    guard++;
    if (guard > 100000) throw new Error('补间未收敛');
  } while (untilDone && core.tweening);
}

test('初始状态: 卡片视图, 无分子无标注, 相机在(0,0,8)', () => {
  const core = new ViewerCore(800, 600);
  assertEqual(core.mode, 'cards', '初始模式');
  assert(core.moleculeData === null, '无分子');
  assert(core.selectedAtomIndex === null, '无选中');
  assertVec3Close(core.camera.position, [0, 0, 8], 1e-12, '默认相机位置');
  assert(!core.toggleBestView(), '卡片视图不能切换视角');
  assertEqual(core.clickAt(400, 300).action, 'ignore', '卡片视图点击被忽略');
});

test('选择分子: 进入分子视图并构建模型, 状态与单次操作一致', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(H2O);
  assertEqual(core.mode, 'molecule', '分子视图');
  assert(core.moleculeData === H2O, '分子数据');
  assert(core.molecule !== null && core.molecule.atoms.length === 3, '模型已构建');
  assertVec3Close(core.camera.position, [0, 0, 8], 1e-12, '相机复位');
  assertVec3Close(core.camera.target, [0, 0, 0], 1e-12, '目标复位');
});

test('连续选择分子: A->B->C 最终状态等同直接选择C, 无残留', () => {
  const sequential = new ViewerCore(800, 600);
  sequential.selectMolecule(H2O);
  sequential.clickAt(400, 300);
  sequential.selectMolecule(CO2);
  sequential.clickAt(10, 10);
  sequential.selectMolecule(C6H6);

  const direct = new ViewerCore(800, 600);
  direct.selectMolecule(C6H6);

  assert(sequential.moleculeData === direct.moleculeData, '最终分子一致');
  assertEqual(sequential.selectedAtomIndex, null, '选中状态已清空');
  assertEqual(sequential.hoveredAtomIndex, null, '悬停状态已清空');
  assertVec3Close(sequential.camera.position, direct.camera.position, 1e-12, '相机一致');
  assertVec3Close(sequential.camera.target, direct.camera.target, 1e-12, '目标一致');
  assert(sequential.getLabelState() === null, '无残留标注');
});

test('切换视角: 补间结束后相机停在bestViewAngle, 目标归零', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(CO2);
  assert(core.toggleBestView(), '开始切换');
  assert(core.tweening, '补间中标记为true');
  advance(core, 16);
  assert(!core.tweening, '补间结束');
  assertVec3Close(core.camera.position, CO2.bestViewAngle, 1e-9, '相机到达最佳视角');
  assertVec3Close(core.camera.target, [0, 0, 0], 1e-9, '目标为原点');
});

test('补间未结束再次切换: 被忽略, 最终仍收敛到同一最佳视角', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(H2O);
  core.toggleBestView();
  core.update(500);
  const second = core.toggleBestView();
  assert(!second, '补间中再次切换返回false');
  advance(core, 16);
  assertVec3Close(core.camera.position, H2O.bestViewAngle, 1e-9, '无论是否重复点击终点一致');
});

test('补间中途选择另一分子: 旧补间取消, 相机复位, 不留中间态', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(H2O);
  core.toggleBestView();
  core.update(800);
  const midPos = [...core.camera.position] as [number, number, number];
  assert(Math.abs(midPos[2] - H2O.bestViewAngle[2]) > 1e-6, '确实停在中间态');
  core.selectMolecule(C6H6);
  assert(!core.tweening, '补间已取消');
  assertVec3Close(core.camera.position, [0, 0, 8], 1e-12, '相机复位而非停在中间态');
  assertVec3Close(core.camera.target, [0, 0, 0], 1e-12, '目标复位');
  assert(core.getLabelState() === null, '标注不残留');

  core.toggleBestView();
  advance(core, 16);
  assertVec3Close(core.camera.position, C6H6.bestViewAngle, 1e-9, '新分子视角补间到自己的最佳视角');
});

test('补间中途返回: 状态清空, 再进入后等同首次进入', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(H2O);
  core.clickAt(400, 300);
  core.toggleBestView();
  core.update(900);
  core.back();
  assertEqual(core.mode, 'cards', '返回卡片视图');
  assert(core.moleculeData === null, '分子已卸载');
  assert(!core.tweening, '补间已取消');
  assert(core.getLabelState() === null, '标注已移除');

  core.selectMolecule(H2O);
  const fresh = new ViewerCore(800, 600);
  fresh.selectMolecule(H2O);
  assertVec3Close(core.camera.position, fresh.camera.position, 1e-12, '再进入相机等同首次');
  assertEqual(core.selectedAtomIndex, null, '再进入无选中');
});

test('返回后再进入不同分子: 最终呈现与单次选择一致', () => {
  const core = new ViewerCore(800, 600);
  core.selectMolecule(H2O);
  core.toggleBestView();
  advance(core, 16);
  core.back();
  core.selectMolecule(CO2);

  const direct = new ViewerCore(800, 600);
  direct.selectMolecule(CO2);
  assert(core.moleculeData === CO2, '呈现CO2');
  assertVec3Close(core.camera.position, direct.camera.position, 1e-12, '相机与单次操作一致');
});

test('点击原子: 命中序号正确并产生标注, 再次点击同一原子取消', () => {
  const core = new ViewerCore(800, 800);
  core.selectMolecule(H2O);
  const screen = worldToScreen(
    core.camera,
    core.viewport,
    buildMoleculeModel(H2O).atoms[1].position
  );
  const r1 = core.clickAt(screen.x, screen.y);
  assertEqual(r1.action, 'select', '选中');
  assertEqual(r1.hitIndex, 1, '命中H1');
  assertEqual(core.selectedAtomIndex, 1, '选中序号1');
  const label = core.getLabelState();
  assert(label !== null, '标注存在');
  assertEqual(label!.atomIndex, 1, '标注绑定序号1');
  assertClose(label!.screen.x, screen.x, 1e-9, '标注x为原子屏幕x');
  assertClose(label!.screen.y, screen.y, 1e-9, '标注基准y为原子屏幕y(偏移由UI层负责)');

  const r2 = core.clickAt(screen.x, screen.y);
  assertEqual(r2.action, 'deselect', '再次点击取消');
  assert(core.getLabelState() === null, '标注消失');
});

test('点击空白: 已有标注则关闭, 无标注则无动作', () => {
  const core = new ViewerCore(800, 800);
  core.selectMolecule(H2O);
  assertEqual(core.clickAt(20, 20).action, 'none', '空白无标注');
  core.clickAt(400, 400);
  assert(core.selectedAtomIndex === 0, '先选中O');
  assertEqual(core.clickAt(20, 20).action, 'deselect', '空白点击关闭标注');
  assert(core.getLabelState() === null, '无标注');
});

test('选择/返回后旧标注状态: 选中A再选B, B无标注残留', () => {
  const core = new ViewerCore(800, 800);
  core.selectMolecule(H2O);
  core.clickAt(400, 400);
  assert(core.selectedAtomIndex === 0, 'A中有选中');
  core.selectMolecule(C6H6);
  assert(core.getLabelState() === null, 'B中无A的残留标注');
});

test('移动时标注跟随: 相机转动后标注落点随相机更新', () => {
  const core = new ViewerCore(800, 800);
  core.selectMolecule(H2O);
  const atom1 = buildMoleculeModel(H2O).atoms[1].position;
  const start = worldToScreen(core.camera, core.viewport, atom1);
  core.clickAt(start.x, start.y);
  assertEqual(core.selectedAtomIndex, 1, '选中H1');
  const before = core.getLabelState()!;
  core.syncCamera([2, 1, 8], [0, 0, 0]);
  const after = core.getLabelState()!;
  assert(
    Math.abs(after.screen.x - before.screen.x) + Math.abs(after.screen.y - before.screen.y) > 1e-6,
    '相机变化后标注屏幕落点随之变化'
  );
  const expected = worldToScreen(core.camera, core.viewport, atom1);
  assertClose(after.screen.x, expected.x, 1e-9, '落点x与投影一致');
  assertClose(after.screen.y, expected.y, 1e-9, '落点y与投影一致');
});

test('窗口resize: 宽高比与视口更新, 标注落点按新尺寸重新换算', () => {
  const core = new ViewerCore(800, 800);
  core.selectMolecule(H2O);
  core.clickAt(400, 400);
  const square = core.getLabelState()!;
  core.resize(1600, 800);
  assertClose(core.camera.aspect, 2, 1e-12, 'aspect更新为2');
  assertEqual(core.viewport.width, 1600, '视口宽度更新');
  const wide = core.getLabelState()!;
  const expected = worldToScreen(core.camera, core.viewport, [0, 0, 0]);
  assertClose(wide.screen.x, expected.x, 1e-9, '新宽屏x');
  assertClose(wide.screen.y, expected.y, 1e-9, '新宽屏y');
  assertClose(wide.screen.x, 800, 1e-9, '原点原子仍在水平中线');
  assert(wide.screen.x !== square.screen.x, '落点确实随尺寸变化');
});

test('补间确定性: 固定步长序列推进与一次性推进到总时长终点一致', () => {
  const stepwise = new ViewerCore(800, 600);
  stepwise.selectMolecule(C6H6);
  stepwise.toggleBestView();
  for (let i = 0; i < 125; i++) stepwise.update(16);

  const reference = new ViewerCore(800, 600);
  reference.selectMolecule(C6H6);
  reference.toggleBestView();
  advance(reference, DEFAULT_TWEEN_DURATION_MS);
  assertVec3Close(stepwise.camera.position, reference.camera.position, 1e-6, '逐帧终点一致');
});
