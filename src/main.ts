import { SequencerModule, PRESETS } from './sequencer.js';
import { VisualizerModule } from './visualizer.js';
import { RecorderModule } from './recorder.js';
import { UIModule } from './ui.js';

let audioCtx: AudioContext | null = null;
let sequencer: SequencerModule | null = null;
let visualizer: VisualizerModule | null = null;
let recorder: RecorderModule | null = null;
let ui: UIModule | null = null;

function ensureAudioContext(): AudioContext {
  if (!audioCtx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function init(): void {
  const app = document.getElementById('app');
  if (!app) {
    console.error('#app 元素不存在');
    return;
  }

  const ctx = ensureAudioContext();
  sequencer = new SequencerModule(ctx);
  recorder = new RecorderModule(ctx, sequencer.getMediaStream());
  recorder.setBPM(sequencer.getBPM());

  ui = new UIModule(app, sequencer, recorder);
  const refs = ui.build();

  visualizer = new VisualizerModule(refs.visualizerCanvas, sequencer.getAnalyser());
  visualizer.start();

  sequencer.loadPreset(PRESETS[1], true);

  window.addEventListener('resize', () => {
    visualizer?.resize();
    const rec = recorder?.getCurrentRecording();
    if (rec) {
      recorder?.drawWaveform(refs.waveformCanvas, rec.waveform, 0);
    }
  });
}

function bootOnInteraction(): void {
  const tryResume = (): void => {
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'running') {
      document.removeEventListener('click', tryResume);
      document.removeEventListener('keydown', tryResume);
      document.removeEventListener('touchstart', tryResume);
    }
  };
  document.addEventListener('click', tryResume);
  document.addEventListener('keydown', tryResume);
  document.addEventListener('touchstart', tryResume);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
    bootOnInteraction();
  });
} else {
  init();
  bootOnInteraction();
}
