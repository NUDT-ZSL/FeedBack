import assert from 'node:assert/strict';
import { createPaletteStore } from '../src/state/paletteStore.ts';
import type { DerivedPalette, PaletteStore, Transition } from '../src/state/paletteStore.ts';

let idCounter = 0;
const idGen = () => `c${++idCounter}`;
let assertions = 0;
function check(fn: () => void): void {
  fn();
  assertions++;
}

function fmtDerived(derived: DerivedPalette): string {
  const body = derived.colors
    .map((c) => `${c.hex}(h=${c.h},s=${c.s},l=${c.l})`)
    .join(' ');
  const note = derived.note ? ` [${derived.note}]` : '';
  return `${derived.status}${note} | ${body || '(空)'}`;
}

function show(t: Transition): void {
  const flags = [t.accepted ? 'OK' : 'REJECTED'];
  if (t.noop) flags.push('noop');
  const reason = t.reason ? ` -- ${t.reason}` : '';
  console.log(`  #${t.seq} [${t.entry}] ${t.kind} ${flags.join('/')}${reason}`);
  console.log(`     最终色板: ${fmtDerived(t.derived)}`);
}

function derivedShape(derived: DerivedPalette) {
  return derived.colors.map((c) => [c.hex, c.h, c.s, c.l, c.sourceIndex]);
}

function newStore(): PaletteStore {
  return createPaletteStore({ idGenerator: idGen });
}

// 场景 1：连续提交相同或等价输入，色板与滑杆保持稳定
function scenario1(): void {
  console.log('\n场景 1：重复 / 等价输入的幂等性（#FFF vs #ffffff、RGB 与 HEX 互转）');
  const store = newStore();

  let t = store.addColor('#FFF');
  show(t);
  check(() => assert.equal(t.derived.colors.length, 1));
  check(() => assert.equal(t.derived.colors[0].hex, '#ffffff'));
  check(() => assert.deepEqual([t.derived.colors[0].s, t.derived.colors[0].l], [0, 100]));

  t = store.addColor('#ffffff');
  show(t);
  check(() => assert.equal(t.noop, true));
  check(() => assert.equal(t.derived.colors.length, 1));

  t = store.addColor({ r: 255, g: 255, b: 255 });
  show(t);
  check(() => assert.equal(t.noop, true));
  check(() => assert.equal(t.derived.colors.length, 1));

  t = store.addColor('FF0000');
  show(t);
  check(() => assert.equal(t.derived.colors.length, 2));
  check(() => assert.equal(t.derived.colors[1].hex, '#ff0000'));

  const [white, red] = store.getState().colors;

  t = store.setHex(white.id, '#FFF');
  show(t);
  check(() => assert.equal(t.noop, true));
  t = store.setHex(white.id, 'ffffff');
  show(t);
  check(() => assert.equal(t.noop, true));
  t = store.setRgb(white.id, 255, 255, 255);
  show(t);
  check(() => assert.equal(t.noop, true));

  t = store.setLightness(red.id, 60);
  show(t);
  check(() => assert.equal(t.derived.colors[1].hex, '#ff3333'));
  check(() => assert.equal(t.derived.colors[1].s, 100));
  check(() => assert.equal(t.derived.colors[1].l, 60));

  t = store.setLightness(red.id, 60);
  show(t);
  check(() => assert.equal(t.noop, true));

  t = store.setSaturation(red.id, 100);
  show(t);
  check(() => assert.equal(t.noop, true));
  check(() => assert.equal(t.derived.colors[1].l, 60));

  t = store.setHex(red.id, '#ff3333');
  show(t);
  check(() => assert.equal(t.noop, true));

  t = store.setRgb(red.id, 255, 51, 51);
  show(t);
  check(() => assert.equal(t.noop, true));
  check(() => assert.deepEqual(
    [t.derived.colors[1].h, t.derived.colors[1].s, t.derived.colors[1].l],
    [0, 100, 60]
  ));
}

// 场景 2：拖动排序与预设规则应用的顺序可交换
function scenario2(): void {
  console.log('\n场景 2：拖动排序与预设规则交错 / 顺序颠倒，结果收敛一致');
  const build = () => {
    const store = newStore();
    store.addColor('#ff0000');
    store.addColor('#00ff00');
    store.addColor('#0000ff');
    return store;
  };
  const pathA = build();
  console.log(' 路径 A：先拖动排序，再应用互补规则');
  show(pathA.reorder(0, 2));
  show(pathA.applyPreset('complementary'));

  const pathB = build();
  console.log(' 路径 B：先应用互补规则，再拖动排序');
  show(pathB.applyPreset('complementary'));
  show(pathB.reorder(0, 2));

  check(() => assert.deepEqual(derivedShape(pathA.getDerived()), derivedShape(pathB.getDerived())));
  check(() => assert.deepEqual(
    pathA.getState().colors.map((c) => c.hex),
    pathB.getState().colors.map((c) => c.hex)
  ));
  check(() => assert.deepEqual(
    pathA.getDerived().colors.map((c) => c.hex),
    ['#00ff00', '#ff00ff']
  ));
  console.log(` 两条路径最终色板一致: ${fmtDerived(pathA.getDerived())}`);
}

// 场景 3：删除颜色后基于剩余集合重新推导
function scenario3(): void {
  console.log('\n场景 3：删除颜色后重新推导（不残留已删除颜色的影响）');
  const store = newStore();
  store.addColor('#ff0000');
  store.addColor('#00ff00');
  store.addColor('#0000ff');
  const [red, green] = store.getState().colors;

  let t = store.applyPreset('triadic');
  show(t);
  check(() => assert.deepEqual(
    t.derived.colors.map((c) => c.hex),
    ['#ff0000', '#00ff00', '#0000ff']
  ));

  t = store.removeColor(red.id);
  show(t);
  check(() => assert.deepEqual(
    t.derived.colors.map((c) => c.hex),
    ['#00ff00', '#0000ff', '#ff0000']
  ));
  check(() => assert.equal(t.derived.colors[0].hex, '#00ff00'));

  const fresh = newStore();
  fresh.addColor('#00ff00');
  fresh.addColor('#0000ff');
  fresh.applyPreset('triadic');
  check(() => assert.deepEqual(derivedShape(store.getDerived()), derivedShape(fresh.getDerived())));
  console.log(' 删除后与"仅含剩余颜色"的全新推导完全一致，无残留');

  const plain = newStore();
  plain.addColor('#ff0000');
  plain.addColor('#00ff00');
  plain.addColor('#0000ff');
  const middle = plain.getState().colors[1];
  t = plain.removeColor(middle.id);
  show(t);
  check(() => assert.deepEqual(t.state.colors.map((c) => c.hex), ['#ff0000', '#0000ff']));
  check(() => assert.deepEqual(
    t.state.colors.map((c) => [c.s, c.l]),
    [[100, 50], [100, 50]]
  ));
  void green;
}

// 场景 4：项目保存 / 加载往返一致，旧格式可还原
function scenario4(): void {
  console.log('\n场景 4：保存 / 加载往返 + 旧数据还原');
  const store = newStore();
  store.addColor('#ff0000');
  store.addColor('#00ff00');
  const [red, green] = store.getState().colors;
  store.setLightness(red.id, 60);
  store.setSaturation(green.id, 40);
  store.applyPreset('complementary');
  const before = store.getState();

  const saved = store.serialize('验收项目');
  console.log(` 已保存项目（${saved.length} 字节）`);

  const restored = newStore();
  const t = restored.load(saved);
  show(t);
  check(() => assert.equal(t.accepted, true));
  check(() => assert.deepEqual(restored.getState(), before));
  check(() => assert.deepEqual(derivedShape(restored.getDerived()), derivedShape(store.getDerived())));
  console.log(' 往返后颜色集合、顺序、各颜色亮度/饱和度、激活规则完全一致');

  const legacy = newStore();
  const legacyLoad = legacy.load(JSON.stringify(['#FFF', 'ff0000', '#00FF00']));
  show(legacyLoad);
  check(() => assert.equal(legacyLoad.accepted, true));
  check(() => assert.deepEqual(
    legacyLoad.state.colors.map((c) => c.hex),
    ['#ffffff', '#ff0000', '#00ff00']
  ));
  const editAfterLegacy = legacy.setLightness(legacy.getState().colors[0].id, 30);
  show(editAfterLegacy);
  check(() => assert.equal(editAfterLegacy.accepted, true));
  check(() => assert.equal(editAfterLegacy.state.colors[0].l, 30));
  console.log(' 旧格式（HEX 字符串数组）加载后可继续编辑');

  const partial = newStore();
  const partialLoad = partial.load(JSON.stringify(['#ff0000', 'not-a-color', '#00ff00']));
  show(partialLoad);
  check(() => assert.equal(partialLoad.state.colors.length, 2));

  const garbage = newStore();
  garbage.addColor('#ff0000');
  const before2 = JSON.stringify(garbage.getState());
  const bad = garbage.load('{{{ not json');
  show(bad);
  check(() => assert.equal(bad.accepted, false));
  check(() => assert.equal(JSON.stringify(garbage.getState()), before2));
}

// 场景 5：越界 / 非法输入被拒绝，保持上一份有效状态
function scenario5(): void {
  console.log('\n场景 5：非法输入拒绝（保持上一份有效状态）');
  const store = newStore();
  store.addColor('#ff0000');
  store.addColor('#00ff00');
  const [red] = store.getState().colors;
  const snapshot = JSON.stringify(store.getState());
  const derivedSnapshot = JSON.stringify(derivedShape(store.getDerived()));

  const attempts: Array<[string, () => Transition]> = [
    ['HEX 5 位', () => store.setHex(red.id, '#12345')],
    ['HEX 4 位无井号', () => store.setHex(red.id, 'ffff')],
    ['HEX 非法字符', () => store.setHex(red.id, '#gggggg')],
    ['HEX 空串', () => store.setHex(red.id, '')],
    ['HEX 非字符串', () => store.setHex(red.id, 123)],
    ['RGB 越界 256', () => store.setRgb(red.id, 256, 0, 0)],
    ['RGB 负数', () => store.setRgb(red.id, -1, 0, 0)],
    ['RGB 小数', () => store.setRgb(red.id, 0.5, 0, 0)],
    ['RGB NaN', () => store.setRgb(red.id, NaN, 0, 0)],
    ['RGB 字符串', () => store.setRgb(red.id, '255', 0, 0)],
    ['亮度 150', () => store.setLightness(red.id, 150)],
    ['亮度 -1', () => store.setLightness(red.id, -1)],
    ['亮度 NaN', () => store.setLightness(red.id, NaN)],
    ['饱和度 101', () => store.setSaturation(red.id, 101)],
    ['拖动越界', () => store.reorder(0, 5)],
    ['拖动负索引', () => store.reorder(-1, 0)],
    ['拖动小数索引', () => store.reorder(0, 1.5)],
    ['删除不存在 id', () => store.removeColor('no-such-id')],
    ['未知规则', () => store.applyPreset('nope')],
    ['规则数量 0', () => store.applyPreset('complementary', 0)],
    ['规则数量小数', () => store.applyPreset('monochromatic', 2.5)],
    ['新增非法颜色', () => store.addColor('#xyz')]
  ];
  for (const [label, run] of attempts) {
    const t = run();
    console.log(`  拒绝 ${label}: ${t.reason}`);
    check(() => assert.equal(t.accepted, false));
    check(() => assert.equal(JSON.stringify(store.getState()), snapshot));
    check(() => assert.equal(JSON.stringify(derivedShape(store.getDerived())), derivedSnapshot));
  }

  const empty = newStore();
  const t = empty.applyPreset('complementary');
  show(t);
  check(() => assert.equal(t.accepted, false));
  check(() => assert.equal(t.derived.colors.length, 0));
  check(() => assert.equal(t.derived.status, 'identity'));
}

// 场景 6：预设规则在颜色数量不足时的可观察结果
function scenario6(): void {
  console.log('\n场景 6：预设规则边界（数量不足 / 数量为 1）');
  const store = newStore();
  store.addColor('#ff0000');

  let t = store.applyPreset('complementary');
  show(t);
  check(() => assert.equal(t.derived.status, 'ok'));
  check(() => assert.deepEqual(t.derived.colors.map((c) => c.hex), ['#ff0000', '#00ffff']));

  t = store.applyPreset('triadic');
  show(t);
  check(() => assert.deepEqual(
    t.derived.colors.map((c) => c.hex),
    ['#ff0000', '#00ff00', '#0000ff']
  ));

  t = store.applyPreset('monochromatic', 1);
  show(t);
  check(() => assert.equal(t.derived.status, 'ok'));
  check(() => assert.equal(t.derived.colors.length, 1));

  t = store.applyPreset('monochromatic', 5);
  show(t);
  check(() => assert.equal(t.derived.colors.length, 5));

  t = store.applyPreset('analogous');
  show(t);
  check(() => assert.equal(t.derived.colors.length, 3));
  check(() => assert.equal(t.derived.colors[1].hex, '#ff0000'));

  t = store.clearPreset();
  show(t);
  check(() => assert.equal(t.derived.status, 'identity'));
  check(() => assert.deepEqual(t.derived.colors.map((c) => c.hex), ['#ff0000']));
}

console.log('=== 配色方案状态链路离线验证 ===');
scenario1();
scenario2();
scenario3();
scenario4();
scenario5();
scenario6();
console.log(`\n全部场景通过，共 ${assertions} 项断言。`);
