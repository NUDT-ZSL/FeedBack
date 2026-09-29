// 渐变定义生成回归测试：
// 线性 / 径向 / 角向三种类型，在锚点数量为 2、多个、位置重复时，
// 生成的 SVG 定义必须包含全部锚点，且顺序与位置一致（按位置升序）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GradientEngine } from '../src/core/GradientEngine.ts';

const BASE_CONFIG = { type: 'linear', angle: 135, centerX: 50, centerY: 50 };

function makeEngine(type, stops) {
  return new GradientEngine(
    stops.map((s, i) => ({ id: `stop_${i}`, color: s.color, position: s.position })),
    { ...BASE_CONFIG, type }
  );
}

function parseStops(def) {
  const stops = [];
  const re = /<stop offset="([\d.]+)%" stop-color="([^"]+)" \/>/g;
  let m;
  while ((m = re.exec(def)) !== null) {
    stops.push({ offset: Number(m[1]), color: m[2] });
  }
  return stops;
}

const TWO_STOPS = [
  { color: '#ff0000', position: 0 },
  { color: '#0000ff', position: 100 },
];

const MANY_STOPS = [
  { color: '#7c4dff', position: 0 },
  { color: '#536dfe', position: 20 },
  { color: '#448aff', position: 40 },
  { color: '#40c4ff', position: 60 },
  { color: '#18ffff', position: 80 },
  { color: '#64ffda', position: 100 },
];

const DUP_POSITION_STOPS = [
  { color: '#ff0000', position: 0 },
  { color: '#00ff00', position: 50 },
  { color: '#0000ff', position: 50 },
  { color: '#ffff00', position: 100 },
];

const TYPES = ['linear', 'radial', 'conic'];

for (const type of TYPES) {
  test(`${type}: 2 个锚点时 SVG 定义包含全部锚点且按位置升序`, () => {
    const def = makeEngine(type, TWO_STOPS).generateGradientDef();
    assert.notEqual(def, '', `${type} 定义不得为空`);
    const stops = parseStops(def);
    assert.equal(stops.length, 2, `${type} 应包含 2 个 stop`);
    assert.deepEqual(stops.map(s => s.offset), [0, 100]);
    assert.deepEqual(stops.map(s => s.color), ['#ff0000', '#0000ff']);
  });

  test(`${type}: 多个锚点乱序输入时全部保留且按位置升序`, () => {
    const shuffled = [MANY_STOPS[3], MANY_STOPS[0], MANY_STOPS[5], MANY_STOPS[1], MANY_STOPS[4], MANY_STOPS[2]];
    const def = makeEngine(type, shuffled).generateGradientDef();
    const stops = parseStops(def);
    assert.equal(stops.length, MANY_STOPS.length, `${type} 不得丢失锚点`);
    const offsets = stops.map(s => s.offset);
    assert.deepEqual(offsets, [0, 20, 40, 60, 80, 100], `${type} 锚点顺序应与位置一致`);
    for (const s of MANY_STOPS) {
      assert.ok(
        stops.some(p => p.color === s.color && p.offset === s.position),
        `${type} 缺少锚点 ${s.color}@${s.position}`
      );
    }
  });

  test(`${type}: 位置重复的锚点全部保留且顺序稳定`, () => {
    const def = makeEngine(type, DUP_POSITION_STOPS).generateGradientDef();
    const stops = parseStops(def);
    assert.equal(stops.length, 4, `${type} 重复位置的锚点不得被去重丢弃`);
    const offsets = stops.map(s => s.offset);
    assert.deepEqual(offsets, [0, 50, 50, 100], `${type} 偏移应非递减且保留重复位置`);
    for (const s of DUP_POSITION_STOPS) {
      assert.ok(
        stops.some(p => p.color === s.color),
        `${type} 缺少颜色 ${s.color} 的锚点`
      );
    }
  });
}

test('三种类型生成各自正确的 SVG 标签', () => {
  assert.match(
    makeEngine('linear', TWO_STOPS).generateGradientDef(),
    /^<linearGradient /
  );
  assert.match(
    makeEngine('radial', TWO_STOPS).generateGradientDef(),
    /^<radialGradient /
  );
  const conicDef = makeEngine('conic', TWO_STOPS).generateGradientDef();
  assert.match(conicDef, /gradientTransform="rotate\(135 /, '角向渐变应携带旋转角度');
});

test('CSS 渐变字符串同样包含全部锚点且按位置升序', () => {
  for (const type of TYPES) {
    const css = makeEngine(type, DUP_POSITION_STOPS).generateCSS();
    const offsets = [...css.matchAll(/(#[0-9a-f]{6}) ([\d.]+)%/g)].map(m =>
      Number(m[2])
    );
    assert.equal(offsets.length, 4, `${type} CSS 不得丢失锚点`);
    assert.deepEqual(offsets, [0, 50, 50, 100], `${type} CSS 锚点应升序`);
  }
});
