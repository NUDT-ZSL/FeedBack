import * as Tone from 'tone'

export type ScaleType = 'major' | 'minor' | 'pentatonic'

const SCALES: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11, 12],
  minor: [0, 2, 3, 5, 7, 8, 10, 12],
  pentatonic: [0, 2, 4, 7, 9, 12, 14, 16],
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export class SoundEngine {
  private synth: Tone.PolySynth
  private initialized = false

  constructor() {
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.2,
        release: 0.8,
      },
    }).toDestination()
  }

  async init() {
    if (!this.initialized) {
      await Tone.start()
      this.initialized = true
    }
  }

  getNoteName(pitchIndex: number, scale: ScaleType = 'major', octave: number = 4): string {
    const scaleNotes = SCALES[scale]
    const noteIndex = scaleNotes[pitchIndex % scaleNotes.length]
    const octaveOffset = Math.floor(pitchIndex / scaleNotes.length)
    return NOTE_NAMES[noteIndex % 12] + (octave + octaveOffset + Math.floor(noteIndex / 12))
  }

  playNote(pitchIndex: number, scale: ScaleType = 'major', velocity: number = 0.8) {
    if (!this.initialized) return
    const noteName = this.getNoteName(pitchIndex, scale)
    this.synth.triggerAttackRelease(noteName, '8n', undefined, velocity)
  }

  playDeleteSound() {
    if (!this.initialized) return
    const noise = new Tone.NoiseSynth({
      envelope: {
        attack: 0.001,
        decay: 0.1,
        sustain: 0,
        release: 0.1,
      },
    }).toDestination()
    noise.triggerAttackRelease('16n')
    setTimeout(() => noise.dispose(), 200)
  }

  setBPM(bpm: number) {
    Tone.Transport.bpm.value = bpm
  }

  getScaleNotes(scale: ScaleType): number[] {
    return SCALES[scale]
  }
}

export const soundEngine = new SoundEngine()
