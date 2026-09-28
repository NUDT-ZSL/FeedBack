import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GradientEngine, type ColorStop, type GradientConfig } from '../src/core/GradientEngine.ts';

const config: GradientConfig = {
  type: 'linear',
  angle: 90,
  centerX: 50,
  centerY: 50,
};

function hexToRgb(hex: string): [number, number, number] {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function assertRgbInRange(color: string, low: string, high: string): void {
  const actual = hexToRgb(color);
  const a = hexToRgb(low);
  const b = hexToRgb(high);
  actual.forEach((channel, index) => {
    assert.ok(
      channel >= Math.min(a[index], b[index]) &&
      channel <= Math.max(a[index], b[index]),
      `${color} 的通道 ${index}=${channel} 超出两端颜色范围`
    );
    assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
  });
  assert.notEqual(color.toLowerCase(), '#000000');
}

function engine(stops: ColorStop[]): GradientEngine {
  return new GradientEngine(stops, config);
}

describe('颜色插值边界', () => {
  it('相邻锚点倒序输入时会先稳定排序，插值仍落在两端颜色之间', () => {
    const gradient = engine([
      { id: 'high', color: '#0000ff', position: 80 },
      { id: 'low', color: '#ff0000', position: 20 },
      { id: 'middle', color: '#00ff00', position: 50 },
    ]);

    for (const position of [0, 20, 35, 50, 65, 80, 100]) {
      const color = gradient.interpolateColorAt(position);
      assert.match(color, /^#[0-9a-f]{6}$/i);
      assert.notEqual(color.toLowerCase(), '#000000');
    }

    assert.equal(gradient.interpolateColorAt(20), '#ff0000');
    assert.equal(gradient.interpolateColorAt(35), '#808000');
    assert.equal(gradient.interpolateColorAt(50), '#00ff00');
    assert.equal(gradient.interpolateColorAt(65), '#008080');
    assert.equal(gradient.interpolateColorAt(80), '#0000ff');
    assertRgbInRange(gradient.interpolateColorAt(35), '#ff0000', '#00ff00');
    assertRgbInRange(gradient.interpolateColorAt(65), '#00ff00', '#0000ff');
  });

  it('两个锚点位置相同时返回确定的锚点颜色，不除以零也不回退黑色', () => {
    const gradient = engine([
      { id: 'left', color: '#ff0000', position: 40 },
      { id: 'right', color: '#0000ff', position: 40 },
    ]);

    assert.equal(gradient.interpolateColorAt(40), '#ff0000');
    assert.equal(gradient.interpolateColorAt(10), '#ff0000');
    assert.equal(gradient.interpolateColorAt(90), '#0000ff');
  });

  it('多个锚点共用同一位置时，同位置查询使用稳定排序后的首个锚点', () => {
    const gradient = engine([
      { id: 'start', color: '#ff0000', position: 20 },
      { id: 'tie-first', color: '#00ff00', position: 50 },
      { id: 'tie-second', color: '#0000ff', position: 50 },
      { id: 'tie-third', color: '#ffff00', position: 50 },
      { id: 'end', color: '#ffffff', position: 80 },
    ]);

    assert.equal(gradient.interpolateColorAt(50), '#00ff00');
    for (const position of [20, 35, 50, 65, 80]) {
      const color = gradient.interpolateColorAt(position);
      assert.match(color, /^#[0-9a-f]{6}$/i);
      assert.notEqual(color.toLowerCase(), '#000000');
    }
  });
});
