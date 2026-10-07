import { BellNote } from '../types';

export class AudioManager {
  private audioContext: AudioContext | null = null;
  private bellBuffers: Map<BellNote, AudioBuffer> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    await this.preloadBellSounds();
    this.initialized = true;
  }

  private async preloadBellSounds() {
    const frequencies: Record<BellNote, number> = {
      'Do': 261.63,
      'Re': 293.66,
      'Mi': 329.63,
      'Fa': 349.23,
      'Sol': 392.00,
      'La': 440.00,
      'Si': 493.88,
    };

    for (const [note, freq] of Object.entries(frequencies)) {
      const buffer = this.generateBellTone(freq as number);
      this.bellBuffers.set(note as BellNote, buffer);
    }
  }

  private generateBellTone(frequency: number): AudioBuffer {
    if (!this.audioContext) throw new Error('AudioContext not initialized');
    
    const duration = 1.5;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < channelData.length; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-t * 2.5);
        const fundamental = Math.sin(2 * Math.PI * frequency * t);
        const harmonic1 = 0.5 * Math.sin(2 * Math.PI * frequency * 2 * t);
        const harmonic2 = 0.25 * Math.sin(2 * Math.PI * frequency * 3 * t);
        const inharmonic = 0.15 * Math.sin(2 * Math.PI * frequency * 1.4 * t);
        channelData[i] = envelope * (fundamental + harmonic1 + harmonic2 + inharmonic) * 0.3;
      }
    }
    
    return buffer;
  }

  playBell(note: BellNote): number {
    const startTime = performance.now();
    if (!this.audioContext || !this.initialized) {
      this.init().then(() => this.playBell(note));
      return startTime;
    }
    
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const buffer = this.bellBuffers.get(note);
    if (!buffer) return startTime;

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = 0.5;
    
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start();
    
    return startTime;
  }

  playPropSound(propName: string) {
    if (!this.audioContext || !this.initialized) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const duration = 0.8;
    const sampleRate = this.audioContext.sampleRate;
    const buffer = this.audioContext.createBuffer(2, sampleRate * duration, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = buffer.getChannelData(channel);
      
      if (propName === 'sword') {
        for (let i = 0; i < channelData.length; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 8);
          const noise = (Math.random() * 2 - 1) * 0.3;
          const sweep = Math.sin(2 * Math.PI * (800 + 400 * t) * t);
          channelData[i] = envelope * (noise * 0.5 + sweep * 0.5) * 0.25;
        }
      } else if (propName === 'fan') {
        for (let i = 0; i < channelData.length; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 4);
          const rustle = (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 50 * t);
          channelData[i] = envelope * rustle * 0.2;
        }
      } else if (propName === 'drum') {
        for (let i = 0; i < channelData.length; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 15);
          const tone = Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t * 10);
          channelData[i] = envelope * tone * 0.4;
        }
      } else {
        for (let i = 0; i < channelData.length; i++) {
          const t = i / sampleRate;
          const envelope = Math.exp(-t * 6);
          const chime = Math.sin(2 * Math.PI * 600 * t) * Math.exp(-t * 3);
          channelData[i] = envelope * chime * 0.2;
        }
      }
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    source.buffer = buffer;
    gainNode.gain.value = 0.4;
    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start();
  }

  getLatency(): number {
    return this.audioContext ? this.audioContext.baseLatency * 1000 : 0;
  }
}

export const audioManager = new AudioManager();
