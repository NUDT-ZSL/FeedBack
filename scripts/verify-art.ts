// 离线验收脚本：用 mock 2D 上下文记录全部绘制调用，验证渲染管线约定。
// 运行：node_modules/.bin/esbuild scripts/verify-art.ts --bundle --platform=node --format=cjs --outfile=/tmp/verify-art.cjs --alias:@=./src && node /tmp/verify-art.cjs
import { generateShapes } from '@/art/generate';
import { renderComposition, CANVAS_WIDTH, CANVAS_HEIGHT } from '@/art/composite';
import type { ArtLayer, Shape } from '@/art/types';

function mockContext() {
  const calls: string[] = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    fill: () => calls.push(`fill:${ctx.fillStyle}:a=${ctx.globalAlpha}:op=${ctx.globalCompositeOperation}`),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect:${ctx.fillStyle}:${x},${y},${w},${h}`),
    translate: (x: number, y: number) => calls.push(`translate:${x.toFixed(6)},${y.toFixed(6)}`),
    rotate: (r: number) => calls.push(`rotate:${r.toFixed(6)}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc:${x.toFixed(6)},${y.toFixed(6)},${r.toFixed(6)}`),
    rect: (x: number, y: number, w: number, h: number) =>
      calls.push(`rect:${x.toFixed(6)},${y.toFixed(6)},${w.toFixed(6)},${h.toFixed(6)}`),
    moveTo: (x: number, y: number) => calls.push(`moveTo:${x.toFixed(6)},${y.toFixed(6)}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo:${x.toFixed(6)},${y.toFixed(6)}`),
    closePath: () => calls.push('closePath'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

let nextId = 0;
function makeLayer(patch: Partial<ArtLayer> = {}): ArtLayer {
  nextId += 1;
  return {
    id: `L${nextId}`,
    name: `L${nextId}`,
    shape: 'mixed',
    count: 30,
    minSize: 0.02,
    maxSize: 0.1,
    rotation: 90,
    seed: 12345,
    opacity: 0.8,
    blendMode: 'source-over',
    visible: true,
    ...patch,
  };
}

function snapshot(layers: ArtLayer[]): string {
  const shapesByLayer = new Map<string, Shape[]>();
  for (const l of layers) shapesByLayer.set(l.id, generateShapes(l));
  const { ctx, calls } = mockContext();
  renderComposition(ctx, { layers, shapesByLayer });
  return calls.join('\n');
}

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
}

// 1. 同参数重算 → 形状序列逐位一致
{
  const layer = makeLayer({ seed: 42 });
  const a = JSON.stringify(generateShapes(layer));
  const b = JSON.stringify(generateShapes(layer));
  check('同种子同参数重算形状序列一致', a === b);
}

// 2. 不同种子 → 序列不同；种子相同 → 画面快照一致
{
  const l1 = makeLayer({ seed: 1 });
  const l2 = makeLayer({ seed: 2 });
  check('不同种子产生不同形状序列', JSON.stringify(generateShapes(l1)) !== JSON.stringify(generateShapes(l2)));
  const s1 = snapshot([makeLayer({ seed: 7 })]);
  const s2 = snapshot([makeLayer({ seed: 7 })]);
  check('同参数完整渲染快照逐像素一致', s1 === s2);
}

// 3. 边界：count=0 / 尺寸区间颠倒 / 尺寸为 0 → 不产生形状，不崩溃
{
  check('count=0 不产生形状', generateShapes(makeLayer({ count: 0 })).length === 0);
  check('count<0 不产生形状', generateShapes(makeLayer({ count: -5 })).length === 0);
  check('区间颠倒自动交换', generateShapes(makeLayer({ minSize: 0.2, maxSize: 0.05 })).length === 30);
  check('区间颠倒且上限<=0 不产生形状', generateShapes(makeLayer({ minSize: -0.1, maxSize: -0.2 })).length === 0);
  check('尺寸为 0 不产生形状', generateShapes(makeLayer({ minSize: 0, maxSize: 0 })).length === 0);
}

// 4. 极端透明度 / 全部混合模式 → 渲染稳定不抛错
{
  const modes = ['source-over','multiply','screen','overlay','darken','lighten','color-dodge','color-burn',
    'hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity'] as const;
  let ok = true;
  for (const mode of modes) {
    for (const opacity of [0, 1, -0.5, 1.5, NaN]) {
      try { snapshot([makeLayer({ blendMode: mode, opacity })]); } catch { ok = false; }
    }
  }
  check('极端透明度与全部混合模式渲染稳定', ok);
  const s = snapshot([makeLayer({ opacity: 0 })]);
  check('opacity=0 时形状仍以 alpha=0 绘制（画面稳定）', s.includes('a=0'));
}

// 5. 合成参数（透明度/混合模式/可见性/顺序）不影响形状序列
{
  const base = makeLayer({ seed: 99 });
  const before = JSON.stringify(generateShapes(base));
  const reordered = [makeLayer({ seed: 1 }), base, makeLayer({ seed: 2 })];
  snapshot(reordered); // 模拟一次完整合成
  const after = JSON.stringify(generateShapes({ ...base, opacity: 0.1, blendMode: 'multiply', visible: false }));
  check('合成参数变化后形状序列不变', before === after);
}

// 6. 隐藏/删除图层 === 从未添加该层
{
  const a = makeLayer({ seed: 11 });
  const b = makeLayer({ seed: 22, blendMode: 'screen' });
  const c = makeLayer({ seed: 33 });
  const withHidden = snapshot([a, { ...b, visible: false }, c]);
  const withoutB = snapshot([a, c]);
  check('隐藏图层 === 从未添加该层', withHidden === withoutB);
}

// 7. 图层顺序影响合成结果
{
  const a = makeLayer({ seed: 11 });
  const b = makeLayer({ seed: 22 });
  check('图层顺序改变合成结果', snapshot([a, b]) !== snapshot([b, a]));
}

// 8. 背景始终先填充，画布尺寸固定
{
  const s = snapshot([]);
  check(`空图层列表仍输出背景（${CANVAS_WIDTH}x${CANVAS_HEIGHT}）`, s.includes(`fillRect:#0f0f1a:0,0,${CANVAS_WIDTH},${CANVAS_HEIGHT}`));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
