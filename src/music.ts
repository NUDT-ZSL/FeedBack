export class MusicManager {
  private audioContext: AudioContext | null = null;
  private isPlaying: boolean = false;
  private bpm: number = 120;
  private beatInterval: number = 0.5;
  private beatTime: number = 0;
  private beatCount: number = 0;
  private onBeatCallback: ((intensity: number) => void) | null = null;
  private masterGain: GainNode | null = null;

  private noteFrequencies: number[] = [
    261.63,
    293.66,
    329.63,
    349.23,
    392.00,
    440.00
  ];

  constructor() {
    this.beatInterval = 60 / this.bpm;
  }

  async init(): Promise<void> {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(this.audioContext.destination);
  }

  resume(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  startBeat(): void {
    if (!this.audioContext || this.isPlaying) return;
    this.isPlaying = true;
    this.beatTime = 0;
    this.beatCount = 0;
  }

  stopBeat(): void {
    this.isPlaying = false;
  }

  setOnBeatCallback(callback: (intensity: number) => void): void {
    this.onBeatCallback = callback;
  }

  update(deltaTime: number): number {
    if (!this.isPlaying || !this.audioContext) return 0;

    this.beatTime += deltaTime;
    let beatIntensity = 0;

    if (this.beatTime >= this.beatInterval) {
      this.beatTime -= this.beatInterval;
      this.beatCount++;

      const isStrongBeat = this.beatCount % 2 === 1;
      beatIntensity = isStrongBeat ? 1 : 0.5;

      this.playDrum(isStrongBeat);
      this.playBass(isStrongBeat);
      this.playChord();
      this.playMelody();

      if (this.onBeatCallback) {
        this.onBeatCallback(beatIntensity);
      }
    }

    return beatIntensity;
  }

  private playDrum(isStrong: boolean): void {
    if (!this.audioContext || !this.masterGain) return;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = isStrong ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(isStrong ? 100 : 200, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(isStrong ? 30 : 80, this.audioContext.currentTime + 0.1);

    gain.gain.setValueAtTime(isStrong ? 0.5 : 0.2, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.15);
  }

  private playBass(isStrong: boolean): void {
    if (!this.audioContext || !this.masterGain) return;
    if (!isStrong) return;

    const bassNotes = [65.41, 73.42, 82.41, 73.42];
    const noteIndex = Math.floor(this.beatCount / 4) % bassNotes.length;

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const filter = this.audioContext.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(bassNotes[noteIndex], this.audioContext.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, this.audioContext.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.2);

    gain.gain.setValueAtTime(0.15, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.3);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.3);
  }

  private playChord(): void {
    if (!this.audioContext || !this.masterGain) return;
    if (this.beatCount % 4 !== 1) return;

    const chordProgressions = [
      [261.63, 329.63, 392.00],
      [220.00, 261.63, 329.63],
      [246.94, 293.66, 369.99],
      [196.00, 246.94, 293.66]
    ];

    const chordIndex = Math.floor((this.beatCount - 1) / 16) % chordProgressions.length;
    const chord = chordProgressions[chordIndex];

    chord.forEach((freq, i) => {
      const osc = this.audioContext!.createOscillator();
      const gain = this.audioContext!.createGain();
      const filter = this.audioContext!.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.audioContext!.currentTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, this.audioContext!.currentTime);

      gain.gain.setValueAtTime(0, this.audioContext!.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, this.audioContext!.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext!.currentTime + 0.8);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);

      osc.start();
      osc.stop(this.audioContext!.currentTime + 0.8);
    });
  }

  private playMelody(): void {
    if (!this.audioContext || !this.masterGain) return;

    const melodyPattern = [
      [0, 2, 4, 2],
      [5, 4, 2, 0],
      [2, 4, 5, 7],
      [4, 2, 0, -1]
    ];

    const patternIndex = Math.floor((this.beatCount - 1) / 4) % melodyPattern.length;
    const noteIndex = (this.beatCount - 1) % 4;
    const note = melodyPattern[patternIndex][noteIndex];

    if (note < 0) return;

    const baseFreq = this.noteFrequencies[note % this.noteFrequencies.length];
    const octave = Math.floor(note / this.noteFrequencies.length);
    const freq = baseFreq * Math.pow(2, octave);

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, this.audioContext.currentTime);

    gain.gain.setValueAtTime(0, this.audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, this.audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.3);
  }

  playNote(noteIndex: number): void {
    if (!this.audioContext || !this.masterGain) return;

    const freq = this.noteFrequencies[noteIndex % this.noteFrequencies.length];

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const osc2 = this.audioContext.createOscillator();
    const gain2 = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, this.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.01, this.audioContext.currentTime + 0.5);

    gain.gain.setValueAtTime(0, this.audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 1.5);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, this.audioContext.currentTime);

    gain2.gain.setValueAtTime(0, this.audioContext.currentTime);
    gain2.gain.linearRampToValueAtTime(0.08, this.audioContext.currentTime + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.8);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc2.connect(gain2);
    gain2.connect(this.masterGain);

    osc.start();
    osc.stop(this.audioContext.currentTime + 1.5);
    osc2.start();
    osc2.stop(this.audioContext.currentTime + 0.8);
  }

  getBeatProgress(): number {
    return this.beatTime / this.beatInterval;
  }

  getBeatCount(): number {
    return this.beatCount;
  }

  dispose(): void {
    this.stopBeat();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
