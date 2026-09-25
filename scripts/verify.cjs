/**
 * 离线验证脚本（无需浏览器）：
 *   node scripts/verify.cjs   或   npm run verify
 *
 * A 组：频段平滑 —— 帧间变化幅度受限、响应速度保留、暂停回落到达静止且曲线独立
 * B 组：模式切换 —— 任意时刻只有一种模式激活、快速连点不叠加过渡、
 *       切回后立方体高度跟随音频、粒子可见性与当前模式一致
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '.verify');

execSync(
  'npx tsc src/bandSmoother.ts src/sculptureBuilder.ts --outDir .verify ' +
    '--module commonjs --target ES2020 --moduleResolution node --esModuleInterop --skipLibCheck',
  { cwd: root, stdio: 'inherit' }
);

// 项目根 package.json 为 "type": "module"，编译产物是 CommonJS，需单独标记
require('fs').writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

global.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);

const { BandSmoother } = require(path.join(outDir, 'bandSmoother.js'));
const THREE = require('three');
const { SculptureBuilder, VisualizationMode } = require(path.join(outDir, 'sculptureBuilder.js'));

const FPS = 60;
const DT = 1 / FPS;
const frame = (i) => (i * 1000) / FPS;

let failures = 0;
function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

// ---------- A 组：频段时间平滑 ----------
{
  const s = new BandSmoother(0.05, 0.18, 0.35);
  let prev = s.update([0], true, 0)[0];
  let maxDelta = 0;
  for (let i = 1; i <= 600; i++) {
    const v = s.update([i % 2 === 0 ? 1 : 0], true, frame(i))[0]; // 最剧烈的方波输入
    maxDelta = Math.max(maxDelta, Math.abs(v - prev));
    prev = v;
  }
  const bound = 1 - Math.exp(-DT / 0.05);
  check('A1 相邻帧变化幅度受限(方波输入)', maxDelta <= bound + 1e-9,
    `maxDelta=${maxDelta.toFixed(4)} <= ${bound.toFixed(4)}，原始跳变=1.0`);
}
{
  const s = new BandSmoother(0.05, 0.18, 0.35);
  let hit = -1;
  for (let i = 0; i <= 60; i++) {
    if (s.update([1], true, frame(i))[0] >= 0.9 && hit < 0) hit = i / FPS;
  }
  check('A2 上升沿响应速度保留', hit > 0 && hit <= 0.2, `0->0.9 耗时 ${hit}s`);
}
{
  const s = new BandSmoother(0.05, 0.18, 0.35);
  for (let i = 0; i < 120; i++) s.update([1], true, frame(i));
  let prev = 1, mono = true, zeroAt = -1;
  const ratios = [];
  for (let k = 1; k <= 180; k++) {
    const v = s.update([0], false, frame(120 + k))[0];
    if (v > prev + 1e-12) mono = false;
    if (prev > 0 && v > 0) ratios.push(v / prev);
    if (v === 0 && zeroAt < 0) zeroAt = k / FPS;
    prev = v;
  }
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const pauseCurve = Math.exp(-DT / 0.35);
  const playCurve = Math.exp(-DT / 0.18);
  check('A3a 暂停回落单调不反弹', mono);
  check('A3b 暂停回落到达静止(<=2.5s)', zeroAt > 0 && zeroAt <= 2.5, `静止耗时 ${zeroAt}s`);
  check('A3c 回落曲线独立于播放响应',
    Math.abs(avg - pauseCurve) < 0.01 && Math.abs(avg - playCurve) > 0.005,
    `实测=${avg.toFixed(4)} 暂停曲线=${pauseCurve.toFixed(4)} 播放曲线=${playCurve.toFixed(4)}`);
}
// ---------- B 组：模式切换状态机 ----------
async function main() {
  const builder = new SculptureBuilder();
  builder.init(new THREE.Scene());

  const freq = new Array(16).fill(0.8);
  const wave = new Array(128).fill(0.5);
  const step = (n) => { for (let i = 0; i < n; i++) builder.update(freq, wave, DT, true); };
  const runUntilIdle = () => { let g = 0; while (builder.isTransitioning() && g++ < 600) step(1); };

  function assertConsistency(name, mode) {
    const cubes = builder.cubes.flat(2);
    const expectCubes = mode !== VisualizationMode.PARTICLES;
    check(`${name}: 当前模式正确`, builder.getCurrentMode() === mode);
    check(`${name}: 立方体可见性=${expectCubes}`, cubes.every((c) => c.visible === expectCubes));
    check(`${name}: 粒子可见性=${!expectCubes}`, builder.particleSystem.visible === !expectCubes);
    check(`${name}: 立方体位置无错乱`,
      cubes.every((c) => Number.isFinite(c.position.x) && Number.isFinite(c.position.y) && Number.isFinite(c.position.z)));
  }

  step(30);
  assertConsistency('初始', VisualizationMode.SPECTRUM);

  // B1 快速连续点击：仅第一次生效，过渡不叠加
  const p1 = builder.setMode(VisualizationMode.PARTICLES);
  builder.setMode(VisualizationMode.WAVEFORM);
  builder.setMode(VisualizationMode.SPECTRUM);
  builder.setMode(VisualizationMode.PARTICLES);
  runUntilIdle();
  await p1;
  assertConsistency('B1 快速连点', VisualizationMode.PARTICLES);

  // B2 粒子 -> 频谱：旧模式完全退出
  const p2 = builder.setMode(VisualizationMode.SPECTRUM);
  runUntilIdle();
  await p2;
  assertConsistency('B2 切回频谱', VisualizationMode.SPECTRUM);

  // B3 切回后立方体高度继续跟随音频
  freq.fill(0.9);
  step(90);
  const h1 = Math.max(...builder.cubeStates.flat(2).map((s) => s.currentHeight));
  check('B3a 切回后高度跟随音频上升', h1 > 0.2, `maxHeight=${h1.toFixed(3)}`);
  freq.fill(0.1);
  step(90);
  const h2 = Math.max(...builder.cubeStates.flat(2).map((s) => s.currentHeight));
  check('B3b 高度随音频数据下降', h2 < h1, `h1=${h1.toFixed(3)} h2=${h2.toFixed(3)}`);

  // B4 三种模式反复循环切换
  for (const mode of [VisualizationMode.PARTICLES, VisualizationMode.WAVEFORM, VisualizationMode.SPECTRUM]) {
    const p = builder.setMode(mode);
    runUntilIdle();
    await p;
    assertConsistency(`B4 切换到${mode}`, mode);
    step(10);
  }

  // B5 重复触发同一模式不产生过渡
  await builder.setMode(VisualizationMode.SPECTRUM);
  check('B5 重复同模式无额外过渡', !builder.isTransitioning());

  console.log(failures === 0 ? '\n全部验证通过' : `\n${failures} 项验证失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
