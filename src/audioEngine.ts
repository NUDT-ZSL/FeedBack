const NOTE_FREQUENCIES: Record<string, number> = {
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13,
  'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00,
  'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25,
  'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99,
  'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
};

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private activeOscillators: Map<string, { osc: OscillatorNode; gain: GainNode }> = new Map();

  constructor() {
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window !== 'undefined' && !this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  public resume(): Promise<void> {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      return this.audioContext.resume();
    }
    return Promise.resolve();
  }

  public getFrequency(note: string): number {
    return NOTE_FREQUENCIES[note] || 440;
  }

  public playNote(note: string, duration: number = 0.3): string {
    this.initAudioContext();
    if (!this.audioContext) return '';

    const id = `${note}-${Date.now()}-${Math.random()}`;
    const frequency = NOTE_FREQUENCIES[note] || 440;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

    const attackTime = 0.02;
    const releaseTime = 0.1;
    const now = this.audioContext.currentTime;

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.3, now + attackTime);
    gainNode.gain.setValueAtTime(0.3, now + duration - releaseTime);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);

    this.activeOscillators.set(id, { osc: oscillator, gain: gainNode });

    oscillator.onended = () => {
      this.activeOscillators.delete(id);
    };

    return id;
  }

  public playNoteAtTime(note: string, startTime: number, duration: number = 0.3): string {
    this.initAudioContext();
    if (!this.audioContext) return '';

    const id = `${note}-${startTime}-${Math.random()}`;
    const frequency = NOTE_FREQUENCIES[note] || 440;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);

    const attackTime = 0.02;
    const releaseTime = 0.1;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + attackTime);
    gainNode.gain.setValueAtTime(0.3, startTime + duration - releaseTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);

    this.activeOscillators.set(id, { osc: oscillator, gain: gainNode });

    oscillator.onended = () => {
      this.activeOscillators.delete(id);
    };

    return id;
  }

  public stopNote(id: string) {
    const entry = this.activeOscillators.get(id);
    if (entry) {
      try {
        entry.osc.stop();
      } catch (e) {}
      this.activeOscillators.delete(id);
    }
  }

  public stopAll() {
    this.activeOscillators.forEach((_, id) => {
      this.stopNote(id);
    });
  }

  public getCurrentTime(): number {
    this.initAudioContext();
    return this.audioContext ? this.audioContext.currentTime : 0;
  }
}

export const audioEngine = new AudioEngine();
