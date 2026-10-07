/**
 * 离线批量验证入口：node --experimental-strip-types scripts/verify.ts（或 npm run verify）
 *
 * 覆盖三类可观察结果：
 *  A. 参数变化只影响真正相关的层，其余层渲染结果与已生成的导出产物保持稳定；
 *  B. 同一份参数多次渲染、多次导出结果完全一致，导出与页面合成一致；
 *  C. 纹样层叠顺序与洒金密度的边界取值表现稳定，不空白、不错位；
 *  D. 题字与纹样/底色的遮挡关系固定（题字永远在最上层）。
 *
 * 全程使用录制表面（RecordingSurface），无需浏览器，可批量矩阵运行。
 */

import { PaperEngine } from '../src/core/engine.ts';
import { hashSurface, recordingSurfaceFactory, serializeOps } from '../src/core/recording.ts';
import { normalizeRecipe, resolveGoldCount } from '../src/core/recipe.ts';
import { generateGoldFoilParticles } from '../src/core/goldFoil.ts';
import { BASE_COLORS, DEFAULT_RECIPE, LAYER_IDS } from '../src/core/types.ts';
import type { LayerId, PaperRecipe } from '../src/core/types.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

function makeRecipe(patch: Partial<PaperRecipe> = {}): PaperRecipe {
  return normalizeRecipe({ ...DEFAULT_RECIPE, ...patch });
}

function richRecipe(): PaperRecipe {
  return makeRecipe({
    baseColor: '#ffe4b5',
    patterns: [
      { id: 'p1', type: 'plum', scale: 1.2, position: { x: 30, y: 25 }, rotation: 15, opacity: 0.5 },
      { id: 'p2', type: 'bamboo', scale: 0.9, position: { x: 70, y: 60 }, rotation: 340, opacity: 0.4 },
      { id: 'p3', type: 'wave', scale: 1.5, position: { x: 50, y: 85 }, rotation: 0, opacity: 0.35 },
    ],
    goldFoil: { density: 'medium', seed: 7 },
    inscription: { text: '清风徐来', fontSize: 32, color: '#3e2723', position: { x: 85, y: 10 }, align: 'right', vertical: true },
  });
}

function newEngine(recipe: PaperRecipe): PaperEngine {
  return new PaperEngine(recipe, recordingSurfaceFactory);
}

/* ---------- A. 参数变化只影响相关部分 ---------- */
section('A. 参数变化只影响相关层，已生成导出产物不被打乱');
{
  const engine = newEngine(richRecipe());
  engine.render('daylight');
  const before = engine.render('daylight');
  const exportBefore = engine.export('daylight');
  const exportHashBefore = hashSurface(exportBefore.surface);

  // A1: 只改底色 → 仅 base 层失效
  const r1 = engine.setRecipe({ ...richRecipe(), baseColor: '#f5d0c9' });
  check('A1 改底色仅失效 base 层', r1.invalidated.join(',') === 'base', r1.invalidated.join(','));
  const after1 = engine.render('daylight');
  check('A1 其余层指纹不变', ['patterns', 'goldFoil', 'inscription'].every(
    (l) => after1.fingerprints[l as LayerId] === before.fingerprints[l as LayerId],
  ));
  check('A1 其余层来自缓存', ['patterns', 'goldFoil', 'inscription'].every((l) =>
    after1.reusedLayers.includes(l as LayerId),
  ));

  // A2: 只改洒金密度 → 仅 goldFoil 层失效
  const r2 = engine.setRecipe({ ...richRecipe(), baseColor: '#f5d0c9', goldFoil: { density: 'dense', seed: 7 } });
  check('A2 改洒金密度仅失效 goldFoil 层', r2.invalidated.join(',') === 'goldFoil', r2.invalidated.join(','));

  // A3: 只改题字 → 仅 inscription 层失效
  const recipe3 = engine.getRecipe();
  recipe3.inscription = { ...recipe3.inscription, text: '水波不兴' };
  const r3 = engine.setRecipe(recipe3);
  check('A3 改题字仅失效 inscription 层', r3.invalidated.join(',') === 'inscription', r3.invalidated.join(','));

  // A4: 只改印花 → 仅 patterns 层失效
  const recipe4 = engine.getRecipe();
  recipe4.patterns = recipe4.patterns.slice(0, 1);
  const r4 = engine.setRecipe(recipe4);
  check('A4 改印花仅失效 patterns 层', r4.invalidated.join(',') === 'patterns', r4.invalidated.join(','));

  // A5: 改尺寸 → 所有层都真实相关，全部失效
  const r5 = engine.setRecipe({ ...richRecipe(), size: { width: 300, height: 400 } });
  check('A5 改尺寸全部层失效', r5.invalidated.length === LAYER_IDS.length, r5.invalidated.join(','));

  // A6: 无变化 → 无层失效
  const r6 = engine.setRecipe(engine.getRecipe());
  check('A6 相同配方不失效任何层', r6.invalidated.length === 0);

  // A7: 之前生成的导出产物不被后续调参改动
  check('A7 已生成导出产物保持稳定', hashSurface(exportBefore.surface) === exportHashBefore
    && engine.artifacts.includes(exportBefore));
}

/* ---------- B. 多次渲染与导出结果一致 ---------- */
section('B. 同一份参数多次渲染/导出完全一致');
{
  const recipe = richRecipe();
  const engineA = newEngine(recipe);
  const engineB = newEngine(recipe);

  const hashA1 = hashSurface(engineA.render('daylight').surface);
  const hashA2 = hashSurface(engineA.render('daylight').surface);
  check('B1 同一引擎重复渲染一致', hashA1 === hashA2);

  const hashB1 = hashSurface(engineB.render('daylight').surface);
  check('B2 不同引擎同参数渲染一致', hashA1 === hashB1);

  const expA1 = engineA.export('candlelight');
  const expA2 = engineA.export('candlelight');
  check('B3 重复导出复用同一产物', expA1 === expA2);
  const expB1 = engineB.export('candlelight');
  check('B4 不同引擎同参数导出逐字节一致', hashSurface(expA1.surface) === hashSurface(expB1.surface));

  // 导出纸面内容 = 页面合成结果（drawImage 引用同一 composite 指纹）
  const compositeId = engineA.render('candlelight').surface.id;
  check('B5 导出引用页面同一合成结果', serializeOps(expA1.surface).includes(`drawImage ${compositeId}`));

  // 光源切换只影响合成层，不影响内容层缓存
  const day = engineA.render('daylight');
  const candle = engineA.render('candlelight');
  check('B6 切换光源不重绘内容层', candle.renderedLayers.length === 0 && day.compositeKey !== candle.compositeKey);

  // 批量矩阵：所有底色 × 三档密度 × 两种光源，各自渲染两次必须一致
  let matrixOk = true;
  for (const color of BASE_COLORS) {
    for (const density of ['sparse', 'medium', 'dense'] as const) {
      for (const mode of ['daylight', 'candlelight'] as const) {
        const r = makeRecipe({ baseColor: color.hex, goldFoil: { density, seed: 3 } });
        const h1 = hashSurface(newEngine(r).render(mode).surface);
        const h2 = hashSurface(newEngine(r).render(mode).surface);
        if (h1 !== h2) matrixOk = false;
      }
    }
  }
  check('B7 批量矩阵（6底色×3密度×2光源）重复渲染全部一致', matrixOk);
}

/* ---------- C. 边界取值稳定 ---------- */
section('C. 纹样层叠顺序与洒金密度边界取值稳定');
{
  // C1: 层叠顺序 = 数组顺序，重复渲染一致
  const recipe = makeRecipe({
    patterns: [
      { id: 'first', type: 'plum', scale: 1, position: { x: 50, y: 50 }, rotation: 0, opacity: 0.5 },
      { id: 'second', type: 'cloud', scale: 1, position: { x: 50, y: 50 }, rotation: 0, opacity: 0.5 },
    ],
  });
  const engine = newEngine(recipe);
  const layer = engine.renderLayer('patterns').surface;
  const ops = serializeOps(layer);
  const plumFirst = ops.indexOf('#b85c6b') < ops.indexOf('#6d7f93');
  check('C1 印花按数组顺序层叠（先 plum 后 cloud）', plumFirst);
  check('C1 层叠顺序多次渲染一致', serializeOps(newEngine(recipe).renderLayer('patterns').surface) === ops);

  // C2: 洒金密度边界 0 → 无粒子但整体不空白
  const r0 = makeRecipe({ goldFoil: { density: 0, seed: 0 } });
  check('C2 密度 0 解析为 0 片', resolveGoldCount(r0.goldFoil.density) === 0);
  const e0 = newEngine(r0);
  const goldOps0 = serializeOps(e0.renderLayer('goldFoil').surface);
  check('C2 密度 0 洒金层为空但不报错', !goldOps0.includes('fillRect') && !goldOps0.includes('drawImage'));
  check('C2 密度 0 整体渲染不空白', serializeOps(e0.render('daylight').surface).length > 0);

  // C3: 超界密度被夹取，999 与 200 结果一致
  const r999 = makeRecipe({ goldFoil: { density: 999, seed: 1 } });
  const r200 = makeRecipe({ goldFoil: { density: 200, seed: 1 } });
  check('C3 密度 999 夹取到 200', resolveGoldCount(r999.goldFoil.density) === 200);
  check(
    'C3 夹取后渲染结果一致',
    hashSurface(newEngine(r999).renderLayer('goldFoil').surface)
      === hashSurface(newEngine(r200).renderLayer('goldFoil').surface),
  );

  // C4: 三档密度片数精确
  check('C4 稀疏=20 适中=50 密集=100',
    resolveGoldCount('sparse') === 20 && resolveGoldCount('medium') === 50 && resolveGoldCount('dense') === 100);
  const particles = generateGoldFoilParticles(100, 5, { width: 450, height: 600 });
  check('C4 密集档恰好生成 100 片且全部在纸面内', particles.length === 100
    && particles.every((p) => p.x >= 0 && p.x <= 450 && p.y >= 0 && p.y <= 600));

  // C5: 参数越界归一化（缩放/旋转/透明度/位置）
  const wild = normalizeRecipe({
    ...DEFAULT_RECIPE,
    patterns: [{ id: 'w', type: 'plum', scale: 99, position: { x: -20, y: 250 }, rotation: 725, opacity: 0 }],
  });
  const wp = wild.patterns[0];
  check('C5 缩放夹取到 3', wp.scale === 3);
  check('C5 旋转 725° 归一化为 5°', wp.rotation === 5);
  check('C5 透明度夹取到 0.3', wp.opacity === 0.3);
  check('C5 位置夹取到 [0,100]', wp.position.x === 0 && wp.position.y === 100);
  check('C5 归一化后渲染不空白', serializeOps(newEngine(wild).render('daylight').surface).length > 0);

  // C6: 非法输入回退稳定（坏颜色/坏密度/NaN）
  const broken = normalizeRecipe({
    ...DEFAULT_RECIPE,
    baseColor: 'not-a-color',
    goldFoil: { density: Number.NaN, seed: Number.NaN },
  });
  check('C6 非法底色回退默认色', broken.baseColor === DEFAULT_RECIPE.baseColor);
  check('C6 非法密度回退适中 50 片', resolveGoldCount(broken.goldFoil.density) === 50);
  check('C6 非法种子回退 0', broken.goldFoil.seed === 0);

  // C7: 空印花列表、空题字为合法边界
  const minimal = makeRecipe({ patterns: [], inscription: { ...DEFAULT_RECIPE.inscription, text: '' } });
  const minimalOps = serializeOps(newEngine(minimal).render('daylight').surface);
  check('C7 空印花+空题字渲染不空白', minimalOps.length > 0 && !minimalOps.includes('fillText'));

  // C8: 未知印花类型稳定跳过，不影响其它印花
  const withUnknown = makeRecipe({
    patterns: [
      { id: 'u', type: 'unknown-type', scale: 1, position: { x: 20, y: 20 }, rotation: 0, opacity: 0.5 },
      { id: 'k', type: 'plum', scale: 1, position: { x: 60, y: 60 }, rotation: 0, opacity: 0.5 },
    ],
  });
  const unknownOps = serializeOps(newEngine(withUnknown).renderLayer('patterns').surface);
  check('C8 未知印花类型被跳过且已知印花照常绘制', unknownOps.includes('#b85c6b'));
}

/* ---------- D. 题字遮挡关系稳定 ---------- */
section('D. 题字与纹样/底色的遮挡关系固定');
{
  const engine = newEngine(richRecipe());
  const composite = serializeOps(engine.render('daylight').surface);
  const order = ['layer:base:', 'layer:patterns:', 'layer:goldFoil:', 'layer:inscription:'];
  const indices = order.map((token) => {
    const found = composite.match(new RegExp(`drawImage ${token.replace(':', '\\:')}`));
    return found ? composite.indexOf(found[0]) : -1;
  });
  check('D1 层叠顺序 base<patterns<goldFoil<inscription', indices.every((v, i) => v >= 0 && (i === 0 || v > indices[i - 1])));
  check('D2 题字层最后绘制（不被纹样/洒金遮挡）', indices[3] === Math.max(...indices));
  const withText = serializeOps(newEngine(richRecipe()).renderLayer('inscription').surface);
  check('D3 题字内容真实落笔', withText.includes('fillText 清'));
}

/* ---------- 汇总 ---------- */
console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) {
  console.log(`失败项：\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
