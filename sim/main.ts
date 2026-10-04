import { VisualizationMode } from '../src/sculptureBuilder';
import type { SculptureStateSnapshot } from '../src/sculptureBuilder';
import { Harness, DT } from './harness';
import { cameraMaxDistance, clampCameraPositionLength } from '../src/cameraFit';

declare const process: { exitCode?: number };

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string = ''): void {
  results.push({ name, pass, detail });
}

function approxEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function arraysClose(a: number[], b: number[], tolerance: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!approxEqual(a[i], b[i], tolerance)) return false;
  }
  return true;
}

function describeUI(harness: Harness): string {
  const s = harness.ui.last;
  const pct = s.duration > 0 ? ((s.currentTime / s.duration) * 100).toFixed(1) : '0.0';
  return `hasAudio=${s.hasAudio} playing=${s.isPlaying} progress=${pct}% time=${s.currentTime.toFixed(2)}/${s.duration} mode=${s.activeMode} hint=${s.uploadHintVisible} busy=${s.uploadBusy}`;
}

function describeSculpture(snap: SculptureStateSnapshot): string {
  return `mode=${snap.mode} target=${snap.targetMode} transitioning=${snap.transitioning} rotY=${snap.rotationY.toFixed(3)} cubes=${snap.cubesVisible} particles=${snap.particlesVisible} meanH=${snap.meanHeight.toFixed(4)} maxH=${snap.maxHeight.toFixed(4)} emissive=${snap.meanEmissiveIntensity.toFixed(3)} pMeanY=${snap.particleMeanY.toFixed(3)}`;
}

const TRANSITION_SECONDS = 1.2;

async function scenarioPlayPauseFreeze(): Promise<void> {
  console.log('\n[场景1] 上传 → 播放 → 暂停后雕塑保持静态形态');
  const harness = new Harness();
  await harness.upload();
  check('1.1 上传后UI进入已加载状态', harness.ui.last.hasAudio === true &&
    harness.ui.last.uploadHintVisible === false &&
    harness.ui.last.uploadBusy === false &&
    harness.ui.last.isPlaying === false &&
    harness.ui.last.duration === 30, describeUI(harness));

  harness.togglePlay();
  check('1.2 点击播放后UI立即为播放态', harness.ui.last.isPlaying === true, describeUI(harness));

  harness.step(3);
  const playingSnap = harness.snapshot();
  check('1.3 播放中雕塑被音频驱动', playingSnap.maxHeight > 0.05, describeSculpture(playingSnap));

  harness.togglePlay();
  harness.step(2.5);
  const pausedSnap = harness.snapshot();
  harness.step(0.5);
  const pausedSnapLater = harness.snapshot();

  check('1.4 暂停后UI为暂停态', harness.ui.last.isPlaying === false, describeUI(harness));
  check('1.5 暂停后高度回落并保持静态',
    approxEqual(pausedSnap.meanHeight, 0, 1e-3) &&
    arraysClose(pausedSnap.columnHeights, pausedSnapLater.columnHeights, 1e-6) &&
    approxEqual(pausedSnap.meanEmissiveIntensity, pausedSnapLater.meanEmissiveIntensity, 1e-6),
    `${describeSculpture(pausedSnap)}\n         ${describeSculpture(pausedSnapLater)}`);
}

async function scenarioSeekConsistency(): Promise<void> {
  console.log('\n[场景2] 拖动进度后回到对应时间点的形态');
  const a = new Harness();
  await a.upload();
  a.togglePlay();
  a.step(5);
  a.seekTo(12);
  check('2.1 拖动后UI时间立即跳到目标点', approxEqual(a.ui.last.currentTime, 12, 1e-9), describeUI(a));
  a.step(3);
  const snapA = a.snapshot();

  const b = new Harness();
  await b.upload();
  b.seekTo(12);
  b.togglePlay();
  b.step(3);
  const snapB = b.snapshot();

  check('2.2 拖动到12s与从12s起播，形态一致',
    arraysClose(snapA.columnHeights, snapB.columnHeights, 1e-4) &&
    approxEqual(snapA.meanHeight, snapB.meanHeight, 1e-4) &&
    approxEqual(snapA.maxHeight, snapB.maxHeight, 1e-4) &&
    approxEqual(snapA.rotationY, snapB.rotationY, 1e-9),
    `A: ${describeSculpture(snapA)}\n         B: ${describeSculpture(snapB)}`);

  check('2.3 两次UI进度状态一致',
    approxEqual(a.ui.last.currentTime, b.ui.last.currentTime, 1e-9) &&
    a.ui.last.isPlaying === b.ui.last.isPlaying &&
    a.ui.last.activeMode === b.ui.last.activeMode,
    `A: ${describeUI(a)}\n         B: ${describeUI(b)}`);
}

async function scenarioModeTransitionGuard(): Promise<void> {
  console.log('\n[场景3] 模式切换过渡不可重复触发/相互打断');
  const harness = new Harness();
  await harness.upload();
  harness.togglePlay();
  harness.step(1);

  harness.switchMode(VisualizationMode.WAVEFORM);
  check('3.1 首个切换请求被接受并进入过渡',
    harness.sculpture.isTransitioning() === true &&
    harness.sculpture.getTargetMode() === VisualizationMode.WAVEFORM,
    describeSculpture(harness.snapshot()));

  harness.switchMode(VisualizationMode.PARTICLES);
  check('3.2 过渡中再次请求被拒绝',
    harness.sculpture.isTransitioning() === true &&
    harness.sculpture.getCurrentMode() === VisualizationMode.SPECTRUM &&
    harness.sculpture.getTargetMode() === VisualizationMode.WAVEFORM,
    describeSculpture(harness.snapshot()));

  harness.step(0.3);
  harness.switchMode(VisualizationMode.SPECTRUM);
  check('3.3 过渡中途请求仍被拒绝',
    harness.sculpture.getTargetMode() === VisualizationMode.WAVEFORM,
    describeSculpture(harness.snapshot()));

  harness.step(TRANSITION_SECONDS);
  const waveSnap = harness.snapshot();
  check('3.4 过渡完成后进入波形模式且UI同步',
    harness.sculpture.isTransitioning() === false &&
    harness.sculpture.getCurrentMode() === VisualizationMode.WAVEFORM &&
    harness.ui.last.activeMode === VisualizationMode.WAVEFORM &&
    waveSnap.cubesVisible === true,
    `${describeSculpture(waveSnap)}\n         ${describeUI(harness)}`);

  harness.switchMode(VisualizationMode.PARTICLES);
  harness.step(TRANSITION_SECONDS);
  const particlesSnap = harness.snapshot();
  check('3.5 切到粒子云后粒子可见、立方体隐藏',
    harness.sculpture.getCurrentMode() === VisualizationMode.PARTICLES &&
    particlesSnap.particlesVisible === true &&
    particlesSnap.cubesVisible === false,
    describeSculpture(particlesSnap));

  harness.switchMode(VisualizationMode.SPECTRUM);
  harness.step(TRANSITION_SECONDS);
  const spectrumSnap = harness.snapshot();
  check('3.6 切回频谱柱后立方体可见、粒子隐藏',
    harness.sculpture.getCurrentMode() === VisualizationMode.SPECTRUM &&
    spectrumSnap.cubesVisible === true &&
    spectrumSnap.particlesVisible === false,
    describeSculpture(spectrumSnap));

  check('3.7 重复请求当前模式为无操作',
    harness.sculpture.requestModeChange(VisualizationMode.SPECTRUM) === false,
    describeSculpture(harness.snapshot()));
}

async function scenarioUIConsistencySweep(): Promise<void> {
  console.log('\n[场景4] 随机操作序列下雕塑状态与UI状态持续一致');
  const harness = new Harness();
  await harness.upload();

  let seed = 20261004;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const modes = [VisualizationMode.SPECTRUM, VisualizationMode.WAVEFORM, VisualizationMode.PARTICLES];

  let mismatches = 0;
  for (let op = 0; op < 200; op++) {
    const choice = Math.floor(random() * 5);
    if (choice === 0) harness.togglePlay();
    else if (choice === 1) harness.seekTo(random() * 30);
    else if (choice === 2) harness.switchMode(modes[Math.floor(random() * modes.length)]);
    else harness.step(DT * (1 + Math.floor(random() * 30)));

    const ui = harness.ui.last;
    const consistent =
      ui.isPlaying === harness.audio.isPlaying() &&
      approxEqual(ui.currentTime, harness.audio.getCurrentTime(), 1e-9) &&
      ui.duration === harness.audio.getDuration() &&
      ui.hasAudio === harness.audio.hasAudio() &&
      ui.activeMode === harness.sculpture.getTargetMode() &&
      ui.uploadHintVisible === false;
    if (!consistent) mismatches++;
  }

  check('4.1 200次随机操作后UI与音频/雕塑状态零不一致', mismatches === 0,
    `mismatches=${mismatches}, 末次UI: ${describeUI(harness)}\n         末次雕塑: ${describeSculpture(harness.snapshot())}`);
}

async function scenarioEndOfTrack(): Promise<void> {
  console.log('\n[场景5] 播放到结尾自动停止');
  const harness = new Harness();
  await harness.upload();
  harness.seekTo(29.8);
  harness.togglePlay();
  harness.step(0.5);

  check('5.1 播放结束后UI为暂停态并回到00:00',
    harness.audio.isPlaying() === false &&
    harness.ui.last.isPlaying === false &&
    approxEqual(harness.ui.last.currentTime, 0, 1e-9),
    describeUI(harness));
}

async function scenarioReuploadResets(): Promise<void> {
  console.log('\n[场景6] 重新上传后状态重置');
  const harness = new Harness();
  await harness.upload();
  harness.togglePlay();
  harness.step(2);
  await harness.upload();

  check('6.1 重新上传后时间归零、暂停、旋转复位',
    harness.ui.last.currentTime === 0 &&
    harness.ui.last.isPlaying === false &&
    harness.ui.last.uploadHintVisible === false &&
    approxEqual(harness.snapshot().rotationY, 0, 1e-12),
    `${describeUI(harness)}\n         ${describeSculpture(harness.snapshot())}`);
}

function scenarioCameraLayout(): void {
  console.log('\n[场景7] 窗口尺寸变化的相机布局规则');
  check('7.1 小屏最大距离30', cameraMaxDistance(500) === 30);
  check('7.2 中屏最大距离35', cameraMaxDistance(1000) === 35);
  check('7.3 大屏最大距离40', cameraMaxDistance(1400) === 40);
  check('7.4 小屏过远时拉近到22', clampCameraPositionLength(30, 500) === 22);
  check('7.5 小屏未过远时不调整', clampCameraPositionLength(20, 500) === null);
  check('7.6 大屏不做拉近', clampCameraPositionLength(30, 1400) === null);
}

async function main(): Promise<void> {
  console.log('=== 3D声波雕塑 离线批量状态一致性验证 ===');
  await scenarioPlayPauseFreeze();
  await scenarioSeekConsistency();
  await scenarioModeTransitionGuard();
  await scenarioUIConsistencySweep();
  await scenarioEndOfTrack();
  await scenarioReuploadResets();
  scenarioCameraLayout();

  console.log('\n=== 断言明细 ===');
  let passed = 0;
  for (const r of results) {
    if (r.pass) passed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail.replace(/\n/g, '\n        ')}` : ''}`);
  }
  console.log(`\n${passed}/${results.length} 通过`);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main();
