export type InstrumentType = 'piano' | 'guitar' | 'bass';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private trackGains: Map<string, { gain: GainNode; pan: StereoPannerNode }> = new Map();
  private playingOscillators: Map<string, { osc: OscillatorNode; gain: GainNode }[]> = new Map();
  private scheduledNotes: Map<string, { stop: () => void }[]> = new Map();

  async init(): Promise<void> {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.audioContext.destination);
  }

  resume(): void {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  getContext(): AudioContext | null {
    return this.audioContext;
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime || 0;
  }

  setupTrack(trackId: string, volume: number = 0.7, pan: number = 0): void {
    if (!this.audioContext || !this.masterGain) return;
    if (this.trackGains.has(trackId)) return;

    const gainNode = this.audioContext.createGain();
    const panNode = this.audioContext.createStereoPanner();
    gainNode.gain.value = volume;
    panNode.pan.value = pan;
    gainNode.connect(panNode);
    panNode.connect(this.masterGain);
    this.trackGains.set(trackId, { gain: gainNode, pan: panNode });
  }

  setTrackVolume(trackId: string, volume: number): void {
    const track = this.trackGains.get(trackId);
    if (track) {
      track.gain.gain.setTargetAtTime(volume, this.audioContext?.currentTime || 0, 0.01);
    }
  }

  setTrackPan(trackId: string, pan: number): void {
    const track = this.trackGains.get(trackId);
    if (track) {
      track.pan.pan.setTargetAtTime(pan, this.audioContext?.currentTime || 0, 0.01);
    }
  }

  playNote(trackId: string, instrument: InstrumentType, midi: number, duration: number = 0.5): void {
    if (!this.audioContext || !this.trackGains.has(trackId)) return;

    const trackOutput = this.trackGains.get(trackId)!;
    const freq = midiToFrequency(midi);
    const now = this.audioContext.currentTime;

    const oscillators = this.createInstrumentSound(instrument, freq, now, duration);
    oscillators.forEach(({ osc, gain }) => {
      gain.connect(trackOutput.gain);
      osc.start(now);
      osc.stop(now + duration + 0.1);
    });

    const noteId = `${trackId}-${midi}-${Date.now()}`;
    if (!this.playingOscillators.has(noteId)) {
      this.playingOscillators.set(noteId, oscillators);
    }

    setTimeout(() => {
      this.playingOscillators.delete(noteId);
    }, (duration + 0.2) * 1000);
  }

  private createInstrumentSound(
    instrument: InstrumentType,
    freq: number,
    startTime: number,
    duration: number
  ): { osc: OscillatorNode; gain: GainNode }[] {
    if (!this.audioContext) return [];

    const ctx = this.audioContext;
    const oscillators: { osc: OscillatorNode; gain: GainNode }[] = [];

    if (instrument === 'piano') {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.value = freq;
      gain1.gain.setValueAtTime(0, startTime);
      gain1.gain.linearRampToValueAtTime(0.6, startTime + 0.01);
      gain1.gain.exponentialRampToValueAtTime(0.3, startTime + duration * 0.3);
      gain1.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc1.connect(gain1);
      oscillators.push({ osc: osc1, gain: gain1 });

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2;
      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.2, startTime + 0.005);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.5);
      osc2.connect(gain2);
      oscillators.push({ osc: osc2, gain: gain2 });
    } else if (instrument === 'guitar') {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.value = freq;
      gain1.gain.setValueAtTime(0, startTime);
      gain1.gain.linearRampToValueAtTime(0.4, startTime + 0.003);
      gain1.gain.exponentialRampToValueAtTime(0.2, startTime + duration * 0.2);
      gain1.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc1.connect(gain1);
      oscillators.push({ osc: osc1, gain: gain1 });

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'square';
      osc2.frequency.value = freq;
      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.15, startTime + 0.003);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.7);
      osc2.connect(gain2);
      oscillators.push({ osc: osc2, gain: gain2 });
    } else if (instrument === 'bass') {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = freq / 2;
      gain1.gain.setValueAtTime(0, startTime);
      gain1.gain.linearRampToValueAtTime(0.7, startTime + 0.01);
      gain1.gain.exponentialRampToValueAtTime(0.4, startTime + duration * 0.3);
      gain1.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc1.connect(gain1);
      oscillators.push({ osc: osc1, gain: gain1 });

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.value = freq;
      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(0.2, startTime + 0.01);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.6);
      osc2.connect(gain2);
      oscillators.push({ osc: osc2, gain: gain2 });
    }

    return oscillators;
  }

  scheduleNote(
    scheduleId: string,
    trackId: string,
    instrument: InstrumentType,
    midi: number,
    startTime: number,
    duration: number
  ): void {
    if (!this.audioContext || !this.trackGains.has(trackId)) return;

    const trackOutput = this.trackGains.get(trackId)!;
    const freq = midiToFrequency(midi);

    const oscillators = this.createInstrumentSound(instrument, freq, startTime, duration);
    oscillators.forEach(({ osc, gain }) => {
      gain.connect(trackOutput.gain);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.1);
    });

    if (!this.scheduledNotes.has(scheduleId)) {
      this.scheduledNotes.set(scheduleId, []);
    }
    this.scheduledNotes.get(scheduleId)!.push({
      stop: () => {
        oscillators.forEach(({ osc }) => {
          try { osc.stop(); } catch (e) {}
        });
      }
    });
  }

  stopScheduled(scheduleId: string): void {
    const notes = this.scheduledNotes.get(scheduleId);
    if (notes) {
      notes.forEach(n => n.stop());
      this.scheduledNotes.delete(scheduleId);
    }
  }

  stopAll(): void {
    this.scheduledNotes.forEach((notes) => {
      notes.forEach(n => n.stop());
    });
    this.scheduledNotes.clear();
  }

  dispose(): void {
    this.stopAll();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.trackGains.clear();
    this.playingOscillators.clear();
  }
}

export const audioEngine = new AudioEngine();
