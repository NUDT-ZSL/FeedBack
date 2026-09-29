// 颜色插值回归测试：
// - 锚点位置相同时结果稳定落在端点颜色之间，不出现 NaN / 越界 / 黑色兜底
// - 相邻锚点位置倒序输入时（引擎内部排序）插值结果仍在两端颜色之间
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GradientEngine } from '../src/core/GradientEngine.ts';

const CONFIG = { type: 'linear', angle: 90, centerX: 50, centerY: 50 };

function makeEngine(stops) {
  return new GradientEngine(
    stops.map((s, i) => ({ id: `s${i}`, color: s.color, position: s.position })),
    CONFIG
  );
}

function hexToRgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/, `结果必须是合法 hex 颜色，实际: ${hex}`);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function assertBetween(resultHex, colorA, colorB, context) {
  const r = hexToRgb(resultHex);
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  for (const ch of ['r', 'g', 'b']) {
    const lo = Math.min(a[ch], b[ch]);
    const hi = Math.max(a[ch], b[ch]);
    assert.ok(
      r[ch] >= lo && r[ch] <= hi,
      `${context}: 通道 ${ch}=${r[ch]} 越界 [${lo}, ${hi}]`
    );
  }
}

test('锚点位置相同：插值返回端点颜色之一，不出现 NaN 或黑色兜底', () => {
  const engine = makeEngine([
    { color: '#ff0000', position: 50 },
    { color: '#0000ff', position: 50 },
  ]);
  const at = engine.interpolateColorAt(50);
  assert.match(at, /^#[0-9a-f]{6}$/, '相同位置插值不得产生非法颜色');
  assert.notEqual(at, '#000000', '相同位置插值不得退化为黑色兜底');
  assert.ok(
    at === '#ff0000' || at === '#0000ff',
    `相同位置插值应返回某一端点颜色，实际: ${at}`
  );
  // 相同位置两侧也应稳定返回端点颜色
  assert.equal(engine.interpolateColorAt(49.9), '#ff0000');
  assert.equal(engine.interpolateColorAt(50.1), '#0000ff');
});

test('锚点位置相同且三个锚点：中间重复位置不导致除零或越界', () => {
  const engine = makeEngine([
    { color: '#ff0000', position: 50 },
    { color: '#00ff00', position: 50 },
    { color: '#0000ff', position: 100 },
  ]);
  // 重复位置左侧：结果应落在第一段两端 (#ff0000, #00ff00) 之间
  for (const pos of [0, 25, 50]) {
    const result = engine.interpolateColorAt(pos);
    assert.match(result, /^#[0-9a-f]{6}$/, `位置 ${pos} 结果非法: ${result}`);
    assertBetween(result, '#ff0000', '#00ff00', `位置 ${pos}`);
  }
  // 重复位置右侧：结果应落在第二段两端 (#00ff00, #0000ff) 之间
  for (const pos of [75, 100]) {
    const result = engine.interpolateColorAt(pos);
    assert.match(result, /^#[0-9a-f]{6}$/, `位置 ${pos} 结果非法: ${result}`);
    assertBetween(result, '#00ff00', '#0000ff', `位置 ${pos}`);
  }
});

test('相邻锚点位置倒序输入：中点插值稳定落在两端颜色之间', () => {
  // 故意以位置倒序提供锚点
  const engine = makeEngine([
    { color: '#ffffff', position: 80 },
    { color: '#000000', position: 20 },
  ]);
  const mid = engine.interpolateColorAt(50);
  assert.notEqual(mid, '#000000', '倒序锚点中点不得返回黑色兜底');
  const { r, g, b } = hexToRgb(mid);
  // 黑到白的中点应为中灰（127 或 128）
  for (const v of [r, g, b]) {
    assert.ok(v === 127 || v === 128, `中点灰度异常: ${mid}`);
  }
});

test('倒序锚点、通道反向变化：全位置扫描结果均在端点范围内', () => {
  const engine = makeEngine([
    { color: '#0000ff', position: 90 },
    { color: '#ff0000', position: 10 },
  ]);
  for (let pos = 0; pos <= 100; pos += 5) {
    const result = engine.interpolateColorAt(pos);
    assertBetween(result, '#ff0000', '#0000ff', `位置 ${pos}`);
    assert.notEqual(result, '#000000', `位置 ${pos} 不应返回黑色兜底`);
  }
});

test('多锚点倒序输入：各区间插值均在相邻端点颜色之间', () => {
  const stops = [
    { color: '#18ffff', position: 80 },
    { color: '#7c4dff', position: 0 },
    { color: '#448aff', position: 40 },
    { color: '#536dfe', position: 20 },
  ];
  const engine = makeEngine(stops);
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    const midPos = (left.position + right.position) / 2;
    const result = engine.interpolateColorAt(midPos);
    assertBetween(result, left.color, right.color, `区间 ${left.position}-${right.position}`);
  }
});
