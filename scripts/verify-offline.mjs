// 离线验证脚本：
// 1) 频段数据相邻帧变化幅度受限、响应速度保留、暂停回落到达静止且曲线可区分
// 2) 三种可视化模式反复切换后，立方体高度与粒子可见性始终与当前模式一致
// 运行：npm run verify
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.verify-build');

// 编译纯逻辑模块（不依赖 DOM），three 从 node_modules 解析
rmSync(buildDir, { recursive: true, force: true });
execFileSync('npx', [
  'tsc', 'src/spectralSmoother.ts', 'src/sculptureBuilder.ts',
  '--outDir', buildDir, '--module', 'ESNext', '--target', 'ES2020',
  '--moduleResolution', 'bundler', '--skipLibCheck'
], { cwd: root, stdio: 'inherit', shell: true });

const { SpectralSmoother, BAND_SMOOTHER_CONFIG, easeInOutCubic } =
  await import(pathToFileURL(path.join(buildDir, 'spectralSmoother.js')).href);
const { SculptureBuilder, VisualizationMode } =
  await import(pathToFileURL(path.join(buildDir, 'sculptureBuilder.js')).href);
const THREE = await import('three');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}

const DT = 1 / 60;

// ---------- 1. 频段平滑 ----------
console.log('[1] 频段数据时间平滑');
{
  const s = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  // T1: 原始数据在 0/1 间剧烈跳变时，相邻帧输出变化受限
  const bound = 1 - Math.exp(-DT / BAND_SMOOTHER_CONFIG.attackTau);
  let prev = s.update(new Array(16).fill(0), DT, true);
  let maxDelta = 0;
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let f = 0; f < 600; f++) {
    const raw = Array.from({ length: 16 }, () => (rand() > 0.5 ? 1 : 0));
    const out = s.update(raw, DT, true);
    for (let i = 0; i < 16; i++) maxDelta = Math.max(maxDelta, Math.abs(out[i] - prev[i]));
    prev = out;
  }
  check('相邻帧变化幅度受限', maxDelta <= bound + 1e-9,
    `maxDelta=${maxDelta.toFixed(4)} bound=${bound.toFixed(4)}`);

  // T2: 响应速度保留（阶跃后 0.2s 内达到 90%）
  const s2 = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  let t90 = -1;
  for (let f = 0; f < 60; f++) {
    const out = s2.update(new Array(16).fill(1), DT, true);
    if (t90 < 0 && out[0] >= 0.9) t90 = (f + 1) * DT;
  }
  check('响应速度保留(<=0.2s 达 90%)', t90 > 0 && t90 <= 0.2, `t90=${t90}`);

  // T3: 暂停回落在固定时长内精确到达静止
  const s3 = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  for (let f = 0; f < 120; f++) s3.update(new Array(16).fill(0.8), DT, true);
  const framesToRest = Math.ceil(BAND_SMOOTHER_CONFIG.pauseDecayDuration / DT) + 1;
  let out3;
  for (let f = 0; f < framesToRest; f++) out3 = s3.update(new Array(16).fill(0.8), DT, false);
  check('暂停回落精确到达静止(全 0)', out3.every(v => v === 0) && s3.isSettled(),
    `tail=${out3.map(v => v.toFixed(4)).join(',')}`);

  // T4: 暂停回落曲线与播放中释放曲线可区分
  const sPause = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  const sPlay = new SpectralSmoother(BAND_SMOOTHER_CONFIG);
  for (let f = 0; f < 120; f++) {
    sPause.update(new Array(16).fill(0.8), DT, true);
    sPlay.update(new Array(16).fill(0.8), DT, true);
  }
  const probeT = 0.2; // 回落时长的 25%
  const probeFrames = Math.round(probeT / DT);
  let vPause = 0, vPlay = 0;
  for (let f = 0; f < probeFrames; f++) {
    vPause = sPause.update(new Array(16).fill(0.8), DT, false)[0];
    vPlay = sPlay.update(new Array(16).fill(0), DT, true)[0];
  }
  const expectPause = 0.8 * (1 - easeInOutCubic(probeT / BAND_SMOOTHER_CONFIG.pauseDecayDuration));
  const expectPlay = 0.8 * Math.exp(-probeT / BAND_SMOOTHER_CONFIG.releaseTau);
  check('回落曲线与播放释放曲线可区分',
    Math.abs(vPause - expectPause) < 0.02 && Math.abs(vPlay - expectPlay) < 0.02 && vPause > vPlay + 0.3,
    `pause=${vPause.toFixed(3)} play=${vPlay.toFixed(3)}`);
}

// ---------- 2. 模式切换一致性 ----------
console.log('[2] 可视化模式切换一致性');
{
  const scene = new THREE.Scene();
  const builder = new SculptureBuilder();
  builder.init(scene);

  const FREQ = new Array(16).fill(0.8);
  const WAVE = new Array(128).fill(0.5);
  const ZERO_FREQ = new Array(16).fill(0);

  const runFrames = (n) => { for (let i = 0; i < n; i++) builder.update(FREQ, WAVE, DT); };
  const runUntilIdle = (cap = 600) => {
    let n = 0;
    while (builder.isTransitioning() && n < cap) { builder.update(FREQ, WAVE, DT); n++; }
    return n < cap;
  };
  const assertVisibility = (mode, tag) => {
    const cubesShouldShow = mode !== VisualizationMode.PARTICLES;
    check(`${tag}: 立方体可见性=${cubesShouldShow}`, builder.areCubesVisible() === cubesShouldShow);
    check(`${tag}: 粒子可见性=${!cubesShouldShow}`, builder.areParticlesVisible() === !cubesShouldShow);
  };

  check('初始模式为 spectrum', builder.getCurrentMode() === VisualizationMode.SPECTRUM);
  assertVisibility(VisualizationMode.SPECTRUM, '初始');

  runFrames(60);
  check('频谱模式立方体跟随音频起伏', builder.getMaxCubeHeight() > 0.05,
    `maxHeight=${builder.getMaxCubeHeight().toFixed(3)}`);

  // spectrum -> particles -> spectrum 往返（复现原故障序列）
  let p = builder.setMode(VisualizationMode.PARTICLES);
  check('切换后进入过渡态', builder.isTransitioning());
  check('过渡完成', runUntilIdle());
  await p;
  check('模式已切到 particles', builder.getCurrentMode() === VisualizationMode.PARTICLES);
  assertVisibility(VisualizationMode.PARTICLES, 'particles');

  p = builder.setMode(VisualizationMode.SPECTRUM);
  runUntilIdle();
  await p;
  assertVisibility(VisualizationMode.SPECTRUM, '切回 spectrum');
  runFrames(90);
  check('切回后立方体继续跟随音频(不停留)', builder.getMaxCubeHeight() > 0.05,
    `maxHeight=${builder.getMaxCubeHeight().toFixed(3)}`);

  // 三种模式反复切换两轮
  const seq = [
    VisualizationMode.PARTICLES, VisualizationMode.WAVEFORM,
    VisualizationMode.SPECTRUM, VisualizationMode.PARTICLES,
    VisualizationMode.WAVEFORM, VisualizationMode.SPECTRUM
  ];
  for (const mode of seq) {
    const pr = builder.setMode(mode);
    runUntilIdle();
    await pr;
    check(`已切到 ${mode}`, builder.getCurrentMode() === mode);
    assertVisibility(mode, mode);
  }

  // 重复触发同一模式：不产生过渡
  await builder.setMode(VisualizationMode.SPECTRUM);
  check('重复触发同一模式无过渡', !builder.isTransitioning());

  // 快速连续点击：过渡中的第二个请求被忽略，状态仍一致
  const p1 = builder.setMode(VisualizationMode.PARTICLES);
  const p2 = builder.setMode(VisualizationMode.WAVEFORM); // 应被忽略
  runUntilIdle();
  await Promise.all([p1, p2]);
  check('快速连点时仅首个切换生效', builder.getCurrentMode() === VisualizationMode.PARTICLES,
    `mode=${builder.getCurrentMode()}`);
  assertVisibility(VisualizationMode.PARTICLES, '快速连点后');

  // 切回 spectrum，静默输入下立方体回落到静止
  const p3 = builder.setMode(VisualizationMode.SPECTRUM);
  runUntilIdle();
  await p3;
  for (let i = 0; i < 240; i++) builder.update(ZERO_FREQ, WAVE, DT);
  check('静默后立方体回到静止', builder.getMaxCubeHeight() < 0.01,
    `maxHeight=${builder.getMaxCubeHeight().toFixed(4)}`);

  builder.dispose();
}

rmSync(buildDir, { recursive: true, force: true });
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
