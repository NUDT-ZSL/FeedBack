export class AudioManager {
  private audioContext: AudioContext | null = null;
  private furnaceOscillator: OscillatorNode | null = null;
  private furnaceGain: GainNode | null = null;
  private isPlaying: boolean = false;

  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  resume() {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  startFurnaceSound() {
    if (!this.audioContext) this.init();
    if (this.isPlaying || !this.audioContext) return;

    this.furnaceOscillator = this.audioContext.createOscillator();
    this.furnaceGain = this.audioContext.createGain();

    this.furnaceOscillator.type = 'sawtooth';
    this.furnaceOscillator.frequency.setValueAtTime(60, this.audioContext.currentTime);

    this.furnaceGain.gain.setValueAtTime(0.05, this.audioContext.currentTime);

    const filter = this.audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, this.audioContext.currentTime);

    this.furnaceOscillator.connect(filter);
    filter.connect(this.furnaceGain);
    this.furnaceGain.connect(this.audioContext.destination);

    this.furnaceOscillator.start();
    this.isPlaying = true;
  }

  updateFurnaceSound(airflow: number, temperature: number) {
    if (!this.furnaceOscillator || !this.furnaceGain || !this.audioContext) return;

    const baseFreq = 60 + airflow * 2 + temperature * 0.5;
    const volume = 0.03 + airflow * 0.0015 + temperature * 0.001;

    this.furnaceOscillator.frequency.setTargetAtTime(
      Math.min(240, baseFreq),
      this.audioContext.currentTime,
      0.1
    );

    this.furnaceGain.gain.setTargetAtTime(
      Math.min(0.15, volume),
      this.audioContext.currentTime,
      0.1
    );
  }

  stopFurnaceSound() {
    if (this.furnaceOscillator) {
      this.furnaceOscillator.stop();
      this.furnaceOscillator.disconnect();
      this.furnaceOscillator = null;
    }
    if (this.furnaceGain) {
      this.furnaceGain.disconnect();
      this.furnaceGain = null;
    }
    this.isPlaying = false;
  }

  playDropSound() {
    if (!this.audioContext) this.init();
    if (!this.audioContext) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.2);

    gain.gain.setValueAtTime(0.2, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.2);
  }

  playSuccessSound() {
    if (!this.audioContext) this.init();
    if (!this.audioContext) return;

    const frequencies = [523.25, 659.25, 783.99, 1046.50];
    
    frequencies.forEach((freq, i) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.audioContext!.currentTime + i * 0.1);

      gain.gain.setValueAtTime(0, this.audioContext!.currentTime + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.15, this.audioContext!.currentTime + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext!.currentTime + i * 0.1 + 0.3);

      osc.connect(gain);
      gain.connect(this.audioContext!.destination);

      osc.start(this.audioContext!.currentTime + i * 0.1);
      osc.stop(this.audioContext!.currentTime + i * 0.1 + 0.3);
    });
  }

  playClickSound() {
    if (!this.audioContext) this.init();
    if (!this.audioContext) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(400, this.audioContext.currentTime);

    gain.gain.setValueAtTime(0.1, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.05);
  }
}

export const audioManager = new AudioManager();
