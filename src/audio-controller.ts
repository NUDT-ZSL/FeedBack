export class AudioController {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private timeData: Uint8Array = new Uint8Array(0);
  private beatHistory: number[] = [];
  private lastBeatTime: number = 0;
  private beatThreshold: number = 1.3;
  private isPlaying: boolean = false;
  private audioBuffer: AudioBuffer | null = null;
  private bpm: number = 120;
  private beatDetected: boolean = false;
  private beatIntensity: number = 0;
  private energyLevel: number = 0;
  private bassEnergy: number = 0;
  private midEnergy: number = 0;
  private highEnergy: number = 0;

  constructor() {}

  async loadAudio(url: string): Promise<void> {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0.7;

    const bufferLength = this.analyser.frequencyBinCount;
    this.frequencyData = new Uint8Array(bufferLength);
    this.timeData = new Uint8Array(bufferLength);

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn('Failed to load audio file, generating synthetic beat track');
      this.audioBuffer = this.generateSynthTrack();
    }
  }

  private generateSynthTrack(): AudioBuffer {
    if (!this.audioContext) return new AudioBuffer({ length: 1, sampleRate: 44100 });

    const sampleRate = this.audioContext.sampleRate;
    const duration = 180;
    const bpm = 128;
    const beatDuration = 60 / bpm;
    const totalBeats = Math.floor(duration / beatDuration);
    const length = sampleRate * duration;

    const buffer = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);

      for (let beat = 0; beat < totalBeats; beat++) {
        const beatStart = Math.floor(beat * beatDuration * sampleRate);
        const isKick = beat % 1 === 0;
        const isSnare = beat % 2 === 1;
        const isHihat = true;

        if (isKick) {
          const kickLength = Math.floor(0.15 * sampleRate);
          for (let i = 0; i < kickLength; i++) {
            const t = i / sampleRate;
            const freq = 60 + 80 * Math.exp(-t * 30);
            const env = Math.exp(-t * 15);
            const idx = beatStart + i;
            if (idx < length) {
              data[idx] += Math.sin(2 * Math.PI * freq * t) * env * 0.8;
            }
          }
        }

        if (isSnare) {
          const snareLength = Math.floor(0.12 * sampleRate);
          for (let i = 0; i < snareLength; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-t * 20);
            const noise = (Math.random() * 2 - 1) * 0.5;
            const idx = beatStart + i;
            if (idx < length) {
              data[idx] += noise * env * 0.4;
            }
          }
        }

        if (isHihat) {
          const hihatStart = Math.floor((beat + 0.5) * beatDuration * sampleRate);
          const hihatLength = Math.floor(0.05 * sampleRate);
          for (let i = 0; i < hihatLength; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-t * 60);
            const noise = (Math.random() * 2 - 1) * 0.3;
            const idx = hihatStart + i;
            if (idx < length) {
              data[idx] += noise * env * 0.15;
            }
          }
        }

        const barBeat = beat % 4;
        if (barBeat === 0 || barBeat === 2) {
          const bassFreq = barBeat === 0 ? 55 : 73;
          const bassLength = Math.floor(beatDuration * 0.8 * sampleRate);
          for (let i = 0; i < bassLength; i++) {
            const t = i / sampleRate;
            const env = Math.min(1, t * 20) * Math.exp(-t * 2);
            const idx = beatStart + i;
            if (idx < length) {
              data[idx] += Math.sin(2 * Math.PI * bassFreq * t) * env * 0.25;
            }
          }
        }

        if (beat % 8 >= 4) {
          const leadFreq = 220 + (beat % 4) * 55;
          const leadLength = Math.floor(beatDuration * 0.9 * sampleRate);
          for (let i = 0; i < leadLength; i++) {
            const t = i / sampleRate;
            const env = Math.min(1, t * 10) * Math.exp(-t * 3);
            const wave = Math.sin(2 * Math.PI * leadFreq * t) * 0.5 +
                         Math.sin(2 * Math.PI * leadFreq * 2 * t) * 0.25;
            const idx = beatStart + i;
            if (idx < length) {
              data[idx] += wave * env * 0.12;
            }
          }
        }
      }
    }

    this.bpm = bpm;
    return buffer;
  }

  play(): void {
    if (!this.audioContext || !this.audioBuffer || !this.analyser || !this.gainNode) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.source = this.audioContext.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.loop = true;

    this.source.connect(this.gainNode);
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    this.source.start();
    this.isPlaying = true;
    this.lastBeatTime = performance.now();
  }

  pause(): void {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.isPlaying = false;
  }

  stop(): void {
    this.pause();
  }

  update(): void {
    if (!this.analyser || !this.isPlaying) {
      this.beatDetected = false;
      this.beatIntensity = 0;
      this.energyLevel = 0;
      return;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.timeData);

    const bufferLength = this.frequencyData.length;
    const bassEnd = Math.floor(bufferLength * 0.1);
    const midEnd = Math.floor(bufferLength * 0.5);

    let bassSum = 0;
    let midSum = 0;
    let highSum = 0;
    let totalSum = 0;

    for (let i = 0; i < bassEnd; i++) {
      bassSum += this.frequencyData[i];
    }
    for (let i = bassEnd; i < midEnd; i++) {
      midSum += this.frequencyData[i];
    }
    for (let i = midEnd; i < bufferLength; i++) {
      highSum += this.frequencyData[i];
    }
    for (let i = 0; i < bufferLength; i++) {
      totalSum += this.frequencyData[i];
    }

    this.bassEnergy = bassSum / bassEnd / 255;
    this.midEnergy = midSum / (midEnd - bassEnd) / 255;
    this.highEnergy = highSum / (bufferLength - midEnd) / 255;
    this.energyLevel = totalSum / bufferLength / 255;

    this.beatHistory.push(this.bassEnergy);
    if (this.beatHistory.length > 40) {
      this.beatHistory.shift();
    }

    const historyAvg = this.beatHistory.reduce((a, b) => a + b, 0) / this.beatHistory.length;
    const now = performance.now();
    const minBeatInterval = 300;

    if (this.bassEnergy > historyAvg * this.beatThreshold &&
        this.bassEnergy > 0.3 &&
        (now - this.lastBeatTime) > minBeatInterval) {
      this.beatDetected = true;
      this.beatIntensity = Math.min(1, this.bassEnergy);
      this.lastBeatTime = now;
    } else {
      this.beatDetected = false;
      this.beatIntensity *= 0.9;
    }
  }

  isBeatDetected(): boolean {
    return this.beatDetected;
  }

  getBeatIntensity(): number {
    return this.beatIntensity;
  }

  getEnergyLevel(): number {
    return this.energyLevel;
  }

  getBassEnergy(): number {
    return this.bassEnergy;
  }

  getMidEnergy(): number {
    return this.midEnergy;
  }

  getHighEnergy(): number {
    return this.highEnergy;
  }

  getFrequencyData(): Uint8Array {
    return this.frequencyData;
  }

  getBPM(): number {
    return this.bpm;
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  getCurrentTime(): number {
    if (!this.audioContext) return 0;
    return this.audioContext.currentTime;
  }
}
