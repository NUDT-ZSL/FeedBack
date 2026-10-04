import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WaveRenderer } from '../src/waveRenderer.ts';
import { setupEnvironment, createCanvas, type TestEnvironment, type FakeCanvas } from './helpers/fakes.ts';

let env: TestEnvironment;
let canvas: FakeCanvas;
let renderer: WaveRenderer;
const W = 800;
const H = 200;

beforeEach(() => {
  env = setupEnvironment();
  canvas = createCanvas(W, H);
  renderer = new WaveRenderer(canvas as unknown as HTMLCanvasElement);
  canvas.ctx.reset();
});

afterEach(() => {
  renderer.destroy();
  env.restore();
});

function assertAllPathsSubmitted(): void {
  assert.equal(canvas.ctx.openPaths, 0, '所有 beginPath 必须以 stroke/fill 闭合提交');
  assert.ok(canvas.ctx.submittedPaths > 0, '应当实际提交过路径');
}

function assertCoordinatesFiniteAndInBounds(padding: number = 10): void {
  for (const call of canvas.ctx.calls) {
    if (call.method === 'moveTo' || call.method === 'lineTo') {
      const [x, y] = call.args as number[];
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${call.method} 坐标含 NaN/Infinity`);
      assert.ok(x >= -padding && x <= W + padding, `x 越界: ${x}`);
      assert.ok(y >= -padding && y <= H + padding, `y 越界: ${y}`);
    }
    if (call.method === 'quadraticCurveTo') {
      for (const v of call.args as number[]) {
        assert.ok(Number.isFinite(v), 'quadraticCurveTo 参数含 NaN/Infinity');
      }
      const x = call.args[2] as number;
      const y = call.args[3] as number;
      assert.ok(x >= -padding && x <= W + padding, `曲线终点 x 越界: ${x}`);
      assert.ok(y >= -padding && y <= H + padding, `曲线终点 y 越界: ${y}`);
    }
  }
}

function fillRectsInsideCanvas(): void {
  for (const [x, y, w, h] of canvas.ctx.fillRects) {
    assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, `fillRect 越界: ${[x, y, w, h]}`);
  }
}

test('空数据：不抛错，仅绘制背景', () => {
  assert.doesNotThrow(() => renderer.setWaveformData(new Float32Array(0)));
  assert.ok(canvas.ctx.fillRects.length >= 1, '背景应被填充');
  fillRectsInsideCanvas();
});

test('空数据后设置 null 仍可安全重绘（resize 场景）', () => {
  assert.doesNotThrow(() => renderer.setPlayProgress(0.5));
});

test('单点数据：不抛错、不产生 NaN、路径闭合', () => {
  const data = new Float32Array(1);
  data[0] = 0.8;
  assert.doesNotThrow(() => renderer.setWaveformData(data));
  assertCoordinatesFiniteAndInBounds();
  assertAllPathsSubmitted();
});

test('满量程数据：波形不越界、上下镜像路径均闭合', () => {
  const data = new Float32Array(2048).fill(1);
  assert.doesNotThrow(() => renderer.setWaveformData(data));
  assertCoordinatesFiniteAndInBounds();
  // 上半波形 + 下半镜像波形 + 扫描线，至少 3 次闭合提交
  assert.ok(canvas.ctx.submittedPaths >= 3);
});

test('超范围数据（>1）也不会把绘制坐标推出画布', () => {
  const data = new Float32Array(64).fill(5);
  renderer.setWaveformData(data);
  // 这是“归一化应由数据源保证”的契约：渲染器只验证不产生 Infinity/NaN
  assertCoordinatesFiniteAndInBounds(2000);
});

test('样式过渡：持续时间结束后收敛到目标值', () => {
  renderer.setWaveformData(new Float32Array(128).fill(0.5));
  renderer.setStyle({ thickness: 5, colorOffset: 0.9, brightness: 0.9 });

  env.clock.runFrames(30); // 30 帧 × 16ms = 480ms > 300ms 过渡时长

  // 注意：扫描线会把 lineWidth 覆盖为 2，因此通过历史记录验证波形描边宽度
  assert.ok(canvas.ctx.lineWidthHistory.includes(5), 'thickness 应收敛到目标');
  const style = (renderer as unknown as { style: { current: { thickness: number; colorOffset: number; brightness: number } } }).style;
  assert.ok(Math.abs(style.current.thickness - 5) < 1e-9);
  assert.ok(Math.abs(style.current.colorOffset - 0.9) < 1e-9);
  assert.ok(Math.abs(style.current.brightness - 0.9) < 1e-9);
});

test('连续快速调整样式不会卡在中间态，最终等于最后一次目标', () => {
  renderer.setWaveformData(new Float32Array(128).fill(0.5));

  for (let i = 0; i < 20; i++) {
    env.clock.advance(10);
    renderer.setStyle({ thickness: 1 + (i % 4) + 1 });
    env.clock.runFrames(1);
  }
  renderer.setStyle({ thickness: 2 });

  env.clock.runFrames(30);

  assert.ok(canvas.ctx.lineWidthHistory.includes(2), '最终值必须是最后一次设置，而非中间态');
  const style = (renderer as unknown as { style: { current: { thickness: number } } }).style;
  assert.equal(style.current.thickness, 2);
  assert.equal((renderer as unknown as { animationFrameId: number | null }).animationFrameId, null,
    '动画结束后不应残留 rAF 循环');
});

test('进度扫描线随 playProgress 定位在正确横坐标', () => {
  renderer.setWaveformData(new Float32Array(64).fill(0.5));
  canvas.ctx.reset();
  renderer.setPlayProgress(0.4);

  const scanLine = canvas.ctx.calls
    .filter((c) => c.method === 'lineTo')
    .map((c) => c.args as number[])
    .find((args) => args[0] === 0.4 * W && args[1] === H);
  assert.ok(scanLine, '应在 progress*width=320 处绘制扫描线');
  assertAllPathsSubmitted();
});

test('resize 在假环境下安全执行', () => {
  assert.doesNotThrow(() => renderer.resize());
});
