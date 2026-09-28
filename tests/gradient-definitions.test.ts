import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GradientEngine,
  type ColorStop,
  type GradientConfig,
  type GradientType,
} from '../src/core/GradientEngine.ts';

function config(type: GradientType): GradientConfig {
  return { type, angle: 135, centerX: 35, centerY: 65 };
}

function parseStops(definition: string): Array<{ offset: string; color: string }> {
  const matches = [...definition.matchAll(
    /<stop\s+offset="([^"]+)"\s+stop-color="([^"]+)"\s+\/>/g
  )];
  return matches.map(match => ({
    offset: match[1],
    color: match[2],
  }));
}

function assertDefinition(definition: string, stops: ColorStop[]): void {
  const parsed = parseStops(definition);
  const expected = [...stops].sort((a, b) => a.position - b.position);

  assert.equal(parsed.length, stops.length);
  assert.deepEqual(parsed.map(stop => stop.color), expected.map(stop => stop.color));
  assert.deepEqual(
    parsed.map(stop => stop.offset),
    expected.map(stop => `${stop.position.toFixed(2)}%`)
  );

  const offsets = parsed.map(stop => Number.parseFloat(stop.offset));
  offsets.forEach((offset, index) => {
    if (index > 0) assert.ok(offset >= offsets[index - 1]);
  });
}

const twoStops: ColorStop[] = [
  { id: 'a', color: '#ff0000', position: 10 },
  { id: 'b', color: '#0000ff', position: 90 },
];

const multipleStops: ColorStop[] = [
  { id: 'd', color: '#0000ff', position: 100 },
  { id: 'a', color: '#ff0000', position: 0 },
  { id: 'c', color: '#00ff00', position: 66.666 },
  { id: 'b', color: '#ffff00', position: 33.333 },
];

const repeatedStops: ColorStop[] = [
  { id: 'r1', color: '#ff0000', position: 50 },
  { id: 'r2', color: '#00ff00', position: 0 },
  { id: 'r3', color: '#0000ff', position: 50 },
  { id: 'r4', color: '#ffffff', position: 50 },
];

const cases = [
  ['两个锚点', twoStops],
  ['多个锚点', multipleStops],
  ['重复位置锚点', repeatedStops],
] as const;

describe('渐变 SVG 定义', () => {
  for (const type of ['linear', 'radial', 'conic'] as GradientType[]) {
    for (const [caseName, stops] of cases) {
      it(`${type} / ${caseName}：包含全部锚点且顺序与位置一致`, () => {
        const definition = new GradientEngine(stops, config(type)).generateGradientDef();

        assertDefinition(definition, stops);
        if (type === 'linear') {
          assert.match(definition, /^<linearGradient\b/);
        } else if (type === 'radial') {
          assert.match(definition, /^<radialGradient\b/);
        } else {
          assert.match(definition, /gradientTransform="rotate\(135 \.5 \.5\)"/);
        }
      });
    }
  }

  it('重复位置保持稳定排序，输入顺序中的第一个重复锚点最先出现', () => {
    const definition = new GradientEngine(repeatedStops, config('conic')).generateGradientDef();
    const colorsAtFifty = parseStops(definition)
      .filter(stop => stop.offset === '50.00%')
      .map(stop => stop.color);

    assert.deepEqual(colorsAtFifty, ['#ff0000', '#0000ff', '#ffffff']);
  });
});
