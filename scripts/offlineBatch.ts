/**
 * 离线批量一致性验证入口（npm run verify）
 *
 * 在无浏览器/无 Web Audio/无 WebGL 的 Node 环境中，用确定性 Mock 音频引擎 +
 * 真实 SculptureBuilder + 记录型 UIView，批量回放「上传/播放/暂停/拖动进度/
 * 切换模式」操作序列，逐帧校验雕塑状态与 UI 状态是否一致，并输出报告。
 */
import * as THREE from 'three';
import {
  AppController,
  AudioEngine,
  UIView,
  UIViewState
} from '../src/appController';
import {
  SculptureBuilder,
  SculptureStateSnapshot,
  VisualizationMode
} from '../src/sculptureBuilder';

const DT = 1 / 60;
const MOCK_DURATION = 8;

class MockAudioEngine implements AudioEngine {
  private time = 0;
  private playing = false;
  private loaded = false;
  failNextLoad = false;

  async loadAudio(_file: File): Promise<void> {
    if (this.failNextLoad) {
      this.failNextLoad = false;
      throw new Error('mock decode failure');
    }
    this.loaded = true;
    this.playing = false;
    this.time = 0;
  }

  play(): void {
    if (this.loaded && !this.playing) this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  seek(time: number): void {
    this.time = Math.max(0, Math.min(time, this.getDuration()));
  }

  advance(delta: number): void {
    if (!this.playing) return;
    this.time += delta;
    if (this.time >= this.getDuration()) {
      this.playing = false;
      this.time = 0;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  hasAudio(): boolean {
    return this.loaded;
  }

  getCurrentTime(): number {
    return this.time;
  }

  getDuration(): number {
    return this.loaded ? MOCK_DURATION : 0;
  }

  getFrequencyBands(bands: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < bands; i++) {
      result.push(0.5 + 0.5 * Math.sin(this.time * 1.7 + i * 0.9));
    }
    return result;
  }

  getWaveformData(samples: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < samples; i++) {
      result.push(0.5 + 0.5 * Math.sin(this.time * 3 + i * 0.2));
    }
    return result;
  }
}

class RecordingUIView implements UIView {
  lastState: UIViewState | null = null;
  renderCount = 0;
  uploading = false;
  uploadErrors = 0;
  fileDialogOpens = 0;

  render(state: UIViewState): void {
    this.lastState = { ...state };
    this.renderCount++;
  }

  setUploading(uploading: boolean): void {
    this.uploading = uploading;
  }

  notifyUploadError(): void {
    this.uploadErrors++;
  }

  openFileDialog(): void {
    this.fileDialogOpens++;
  }
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail = ''): void {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function arraysEqual(a: number[], b: number[], epsilon = 1e-9): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
}

function maxAbs(a: number[]): number {
  return a.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
}

const audio = new MockAudioEngine();
const sculpture = new SculptureBuilder();
const ui = new RecordingUIView();
const controller = new AppController(audio, sculpture, ui);

sculpture.init(new THREE.Scene());

let frameInvariantsViolated = 0;

function step(seconds: number): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    audio.advance(DT);
    controller.tick(DT);

    const state = ui.lastState!;
    if (
      state.isPlaying !== audio.isPlaying() ||
      state.hasAudio !== audio.hasAudio() ||
      Math.abs(state.currentTime - audio.getCurrentTime()) > 1e-9 ||
      Math.abs(state.duration - audio.getDuration()) > 1e-9 ||
      state.selectedMode !== sculpture.getTargetMode() ||
      state.isTransitioning !== sculpture.isTransitioning()
    ) {
      frameInvariantsViolated++;
    }
  }
}

function snap(): SculptureStateSnapshot {
  return sculpture.getStateSnapshot();
}

async function main(): Promise<void> {
  console.log('\n[1] 初始状态（未加载音频）');
  step(0.5);
  check('UI 已渲染且 hasAudio=false', ui.lastState !== null && ui.lastState.hasAudio === false);
  check('播放/暂停意图在无音频时打开文件对话框', (() => {
    controller.onPlayPause();
    return ui.fileDialogOpens === 1;
  })());
  check('雕塑高度保持为 0', maxAbs(snap().heights) === 0);

  console.log('\n[2] 上传音频');
  const uploadDone = (async () => {
    controller.onUpload({ name: 'mock.mp3' } as File);
    await Promise.resolve();
  })();
  await uploadDone;
  await new Promise(resolve => setTimeout(resolve, 0));
  check('上传后雕塑旋转角已重置', Math.abs(snap().rotationY) < 1e-9);
  step(DT);
  check('上传后 hasAudio 同步到 UI', ui.lastState!.hasAudio === true);
  check('上传后进度归零', ui.lastState!.currentTime === 0 && ui.lastState!.duration === MOCK_DURATION);
  check('上传后未处于上传中状态', ui.uploading === false);

  console.log('\n[3] 上传失败路径');
  audio.failNextLoad = true;
  controller.onUpload({ name: 'bad.mp3' } as File);
  await new Promise(resolve => setTimeout(resolve, 0));
  check('解码失败通知 UI 报错', ui.uploadErrors === 1);
  check('失败后 hasAudio 保持为 true（沿用旧音频）', ui.lastState!.hasAudio === true);

  console.log('\n[4] 播放 1.5s');
  controller.onPlayPause();
  const beforePlay = snap();
  step(1.5);
  const afterPlay = snap();
  check('播放中 UI 显示播放态', ui.lastState!.isPlaying === true);
  check('播放中雕塑高度随音频推进', !arraysEqual(beforePlay.heights, afterPlay.heights));
  check('进度与时间一致', Math.abs(ui.lastState!.currentTime - audio.getCurrentTime()) < 1e-9);

  console.log('\n[5] 暂停后雕塑冻结');
  controller.onPlayPause();
  step(DT);
  const frozenA = snap();
  const timeAtPause = audio.getCurrentTime();
  step(0.8);
  const frozenB = snap();
  check('UI 显示暂停态', ui.lastState!.isPlaying === false);
  check('暂停后雕塑高度冻结', arraysEqual(frozenA.heights, frozenB.heights));
  check('暂停后雕塑颜色冻结', arraysEqual(frozenA.colors, frozenB.colors));
  check('暂停后进度不再推进', audio.getCurrentTime() === timeAtPause && timeAtPause > 0);

  console.log('\n[6] 暂停中拖动进度到 75%');
  controller.onSeek(0.75);
  step(DT);
  check('音频时间跳转到 6s', Math.abs(audio.getCurrentTime() - 6) < 1e-9);
  check('UI 进度同步到 75%', Math.abs(ui.lastState!.currentTime / ui.lastState!.duration - 0.75) < 1e-9);
  check('拖动后雕塑旋转角重置', Math.abs(snap().rotationY) < 0.02);

  console.log('\n[7] 恢复播放，雕塑从新时间点推进');
  const beforeResume = snap();
  controller.onPlayPause();
  step(1.0);
  const afterResume = snap();
  check('恢复播放后雕塑继续演化', !arraysEqual(beforeResume.heights, afterResume.heights));
  check('恢复播放后时间从 6s 继续前进', audio.getCurrentTime() > 6.5);

  console.log('\n[8] 切换模式：频谱 -> 波形，过渡期间防止重复触发');
  controller.onModeChange(VisualizationMode.WAVEFORM);
  step(DT);
  check('切换立即进入过渡态', snap().transitioning === true);
  check('UI 按钮立即高亮目标模式', ui.lastState!.selectedMode === VisualizationMode.WAVEFORM);
  controller.onModeChange(VisualizationMode.PARTICLES);
  step(DT);
  check('过渡期间再次切换被忽略', snap().targetMode === VisualizationMode.WAVEFORM);
  controller.onModeChange(VisualizationMode.WAVEFORM);
  step(DT);
  check('重复切换到同一目标被忽略', snap().targetMode === VisualizationMode.WAVEFORM);
  step(1.2);
  check('过渡完成后进入波形模式', snap().mode === VisualizationMode.WAVEFORM && snap().transitioning === false);
  check('波形模式下立方体可见、粒子隐藏', snap().cubesVisible === true && snap().particlesVisible === false);

  console.log('\n[9] 切换模式：波形 -> 粒子云');
  controller.onModeChange(VisualizationMode.PARTICLES);
  step(1.2);
  check('过渡完成后进入粒子模式', snap().mode === VisualizationMode.PARTICLES && snap().transitioning === false);
  check('粒子模式下粒子可见、立方体隐藏', snap().particlesVisible === true && snap().cubesVisible === false);

  console.log('\n[10] 粒子模式下暂停冻结');
  if (!audio.isPlaying()) {
    controller.onSeek(0.25);
    controller.togglePlayPause();
    step(0.5);
  }
  controller.onPlayPause();
  step(DT);
  const frozenParticlesA = snap();
  step(0.5);
  const frozenParticlesB = snap();
  check('粒子模式下暂停后粒子位置冻结', arraysEqual(frozenParticlesA.particlePositions, frozenParticlesB.particlePositions));

  console.log('\n[11] 过渡期间暂停，过渡不被打断');
  controller.onModeChange(VisualizationMode.SPECTRUM);
  step(0.2);
  check('过渡进行中', snap().transitioning === true);
  step(1.2);
  check('暂停中过渡仍正常完成', snap().mode === VisualizationMode.SPECTRUM && snap().transitioning === false);
  check('回到频谱模式立方体可见', snap().cubesVisible === true);

  console.log('\n[12] 播放到自然结束');
  controller.onSeek(0.99);
  if (!audio.isPlaying()) {
    controller.togglePlayPause();
  }
  step(0.5);
  check('播放结束后 UI 回到暂停态', ui.lastState!.isPlaying === false && audio.isPlaying() === false);
  check('结束后进度归零', ui.lastState!.currentTime === 0);

  console.log('\n[13] 逐帧不变量');
  check('全程 UI/音频/雕塑状态逐帧一致', frameInvariantsViolated === 0, `violated=${frameInvariantsViolated}`);

  const failed = results.filter(r => !r.pass);
  console.log(`\n========================================`);
  console.log(`总计 ${results.length} 项检查，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length > 0) {
    console.log('失败项:');
    failed.forEach(f => console.log(`  - ${f.name}`));
  }
  console.log(`========================================\n`);

  sculpture.dispose();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('离线批量验证执行出错:', error);
  process.exit(1);
});
