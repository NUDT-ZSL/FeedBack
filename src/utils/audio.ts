import * as Tone from 'tone';

let noise: Tone.Noise | null = null;
let filter: Tone.Filter | null = null;
let gain: Tone.Gain | null = null;
let isInitialized = false;

export const initAudio = async () => {
  if (isInitialized) return;
  
  await Tone.start();
  
  noise = new Tone.Noise('brown');
  filter = new Tone.Filter({
    type: 'bandpass',
    frequency: 800,
    Q: 1,
  });
  gain = new Tone.Gain(0);
  
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(Tone.getDestination());
  
  noise.start();
  isInitialized = true;
};

export const startGrindingSound = (force: number = 0.5) => {
  if (!isInitialized || !gain || !filter) return;
  
  const volume = Math.min(0.4, force * 0.3);
  const freq = 400 + force * 600;
  
  gain.gain.setTargetAtTime(volume, Tone.now(), 0.05);
  filter.frequency.setTargetAtTime(freq, Tone.now(), 0.05);
};

export const updateGrindingSound = (force: number) => {
  if (!isInitialized || !gain || !filter) return;
  
  const volume = Math.min(0.4, force * 0.3);
  const freq = 400 + force * 600;
  
  gain.gain.setTargetAtTime(volume, Tone.now(), 0.05);
  filter.frequency.setTargetAtTime(freq, Tone.now(), 0.05);
};

export const stopGrindingSound = () => {
  if (!isInitialized || !gain) return;
  gain.gain.setTargetAtTime(0, Tone.now(), 0.1);
};

export const startPolishingSound = () => {
  if (!isInitialized || !gain || !filter) return;
  
  gain.gain.setTargetAtTime(0.15, Tone.now(), 0.05);
  filter.frequency.setTargetAtTime(2000, Tone.now(), 0.05);
  filter.type = 'highpass';
};

export const updatePolishingSound = (force: number) => {
  if (!isInitialized || !gain || !filter) return;
  
  const volume = Math.min(0.2, force * 0.15);
  const freq = 1500 + force * 1000;
  
  gain.gain.setTargetAtTime(volume, Tone.now(), 0.05);
  filter.frequency.setTargetAtTime(freq, Tone.now(), 0.05);
};

export const stopPolishingSound = () => {
  if (!isInitialized || !gain || !filter) return;
  
  gain.gain.setTargetAtTime(0, Tone.now(), 0.1);
  filter.type = 'bandpass';
};

export const playScratchSound = () => {
  if (!isInitialized) return;
  
  const scratchOsc = new Tone.Oscillator({
    type: 'sawtooth',
    frequency: 1200,
  });
  const scratchGain = new Tone.Gain(0);
  const scratchFilter = new Tone.Filter({
    type: 'highpass',
    frequency: 800,
  });
  
  scratchOsc.connect(scratchFilter);
  scratchFilter.connect(scratchGain);
  scratchGain.connect(Tone.getDestination());
  
  scratchGain.gain.setValueAtTime(0.3, Tone.now());
  scratchGain.gain.exponentialRampToValueAtTime(0.01, Tone.now() + 0.15);
  scratchOsc.frequency.setValueAtTime(1200, Tone.now());
  scratchOsc.frequency.exponentialRampToValueAtTime(400, Tone.now() + 0.15);
  
  scratchOsc.start();
  scratchOsc.stop(Tone.now() + 0.15);
  
  setTimeout(() => {
    scratchOsc.dispose();
    scratchGain.dispose();
    scratchFilter.dispose();
  }, 300);
};

export const playDamageWarning = () => {
  if (!isInitialized) return;
  
  const osc1 = new Tone.Oscillator({ type: 'square', frequency: 440 });
  const osc2 = new Tone.Oscillator({ type: 'square', frequency: 550 });
  const warningGain = new Tone.Gain(0);
  
  osc1.connect(warningGain);
  osc2.connect(warningGain);
  warningGain.connect(Tone.getDestination());
  
  const now = Tone.now();
  warningGain.gain.setValueAtTime(0.2, now);
  warningGain.gain.setValueAtTime(0, now + 0.1);
  warningGain.gain.setValueAtTime(0.2, now + 0.2);
  warningGain.gain.setValueAtTime(0, now + 0.3);
  warningGain.gain.setValueAtTime(0.2, now + 0.4);
  warningGain.gain.setValueAtTime(0, now + 0.5);
  
  osc1.start();
  osc2.start();
  osc1.stop(now + 0.5);
  osc2.stop(now + 0.5);
  
  setTimeout(() => {
    osc1.dispose();
    osc2.dispose();
    warningGain.dispose();
  }, 700);
};

export const disposeAudio = () => {
  if (noise) {
    noise.stop();
    noise.dispose();
    noise = null;
  }
  if (filter) {
    filter.dispose();
    filter = null;
  }
  if (gain) {
    gain.dispose();
    gain = null;
  }
  isInitialized = false;
};
