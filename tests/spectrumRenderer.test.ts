import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpectrumRenderer } from '../src/spectrumRenderer.ts';
import { setupEnvironment, createCanvas, type TestEnvironment, type FakeCanvas } from './helpers/fakes.ts';

let env: TestEnvironment;
let canvas: FakeCanvas;
let renderer: SpectrumRenderer & { smoothedHeights: number[] };
const W = 800;
const H = 200;

function heights(): number[] {
  return (renderer as unknown as { smoothedHeights: number[] }).smoothedHeights;
}

function setNoData(): void {
  (renderer as unknown as { frequencyData: Uint8Array | null }).frequencyData = null;
}

beforeEach(() => {
  env = setupEnvironment();
  canvas = createCanvas(W, H);
  renderer = new SpectrumRenderer(canvas as unknown as HTMLCanvasElement) as SpectrumRenderer & { smoothedHeights: number[] };
  canvas.ctx.reset();
});

afterEach(() => {
  env.restore();
});

test('无数据时不抛错，柱高单调平滑衰减最终归零', () => {
  // 先注入一帧满幅数据形成非零高度
  const data = new Uint8Array(128).fill(255);
  assert.doesNotThrow(() => renderer.setFrequencyData(data));
  assert.ok(heights().some((h) => h > 0));

  setNoData();
  let prev = [...heights()];
  for (let frame = 0; frame < 300; frame++) {
    assert.doesNotThrow(() => renderer.render());
    const cur = heights();
    for (let i = 0; i < cur.length; i++) {
      assert.ok(cur[i] >= 0, `高度不能为负: ${cur[i]}`);
      assert.ok(cur[i] <= prev[i] + 1e-12, `第 ${frame} 帧高度应单调不增`);
    }
    prev = cur;
  }
  assert.deepEqual(heights(), new Array(64).fill(0), '足够长时间无数据后必须衰减到 0');
});

test('有数据时按 bin 聚合为 64 个柱，值在 0..1 且不越界', () => {
  const data = new Uint8Array(128);
  for (let i = 0; i < 128; i++) data[i] = (i % 2 === 0 ? 100 : 200);

  renderer.setFrequencyData(data);

  const h = heights();
  assert.equal(h.length, 64);
  const expectedEma = 0.3 * (150 / 255);
  for (const v of h) {
    assert.ok(Number.isFinite(v));
    assert.ok(v >= 0 && v <= 1, `柱高超出 [0,1]: ${v}`);
    assert.ok(Math.abs(v - expectedEma) < 1e-9, `bin 聚合或平滑结果不符: ${v}`);
  }

  // fillRects 中还包含背景（宽=W）和柱顶高亮条（高=2），按“宽4且高>2”筛出柱体
  const barRects = canvas.ctx.fillRects.filter((r) => r[2] === 4 && r[3] > 2);
  assert.equal(barRects.length, 64);
  const bottomY = H - 20;
  const maxHeight = H - 40;
  for (const [x, y, w, bh] of barRects) {
    assert.equal(w, 4, '柱宽固定 4px');
    assert.ok(x >= 0 && x + w <= W, `柱 x 越界: ${x}`);
    assert.ok(y >= 0 && y + bh <= H, '柱在垂直方向越界');
    assert.ok(Math.abs(y - (bottomY - bh)) < 1e-9);
    assert.ok(bh <= maxHeight, '柱高不得超过最大可绘制高度');
  }
});

test('持续相同输入时 EMA 平滑收敛到输入均值', () => {
  const data = new Uint8Array(128).fill(128);
  renderer.setFrequencyData(data);
  const first = heights()[0];

  renderer.setFrequencyData(data);
  const second = heights()[0];
  assert.ok(second > first, 'EMA 应向输入方向上升');

  for (let i = 0; i < 200; i++) renderer.setFrequencyData(data);
  const target = 128 / 255;
  assert.ok(Math.abs(heights()[0] - target) < 1e-6, `应收敛到 ${target}`);
});

test('数据长度不能被 64 整除时不越界、不 NaN', () => {
  const data = new Uint8Array(100).fill(80);
  assert.doesNotThrow(() => renderer.setFrequencyData(data));
  for (const v of heights()) {
    assert.ok(Number.isFinite(v));
    assert.ok(v >= 0 && v <= 1);
  }
  for (const [x, y, w, h] of canvas.ctx.fillRects) {
    assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, `fillRect 越界: ${[x, y, w, h]}`);
  }
});

test('数据长度小于柱数（binSize=0）时安全降级，不产生 NaN', () => {
  const data = new Uint8Array(10).fill(255);
  assert.doesNotThrow(() => renderer.setFrequencyData(data));
  assert.ok(heights().every((v) => Number.isFinite(v) && v >= 0 && v <= 1));
});

test('每次渲染都闭合光晕路径并恢复绘制状态', () => {
  renderer.setFrequencyData(new Uint8Array(128).fill(100));
  assert.equal(canvas.ctx.openPaths, 0, 'beginPath 必须闭合');
  const arc = canvas.ctx.calls.find((c) => c.method === 'arc');
  assert.ok(arc, '应绘制径向光晕');
  const saveCount = canvas.ctx.calls.filter((c) => c.method === 'save').length;
  const restoreCount = canvas.ctx.calls.filter((c) => c.method === 'restore').length;
  assert.equal(saveCount, restoreCount, 'save/restore 必须配对');
});
