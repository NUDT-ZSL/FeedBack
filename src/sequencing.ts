export const SIXTEENTH_NOTE_BEATS = 0.25
export const NOTE_LIGHT_DURATION_MS = 200

export interface NoteSlot {
  pitchIndex: number
  beatPosition: number
}

export const quantizeBeat = (
  beat: number,
  grid: number = SIXTEENTH_NOTE_BEATS
): number => Math.round(beat / grid) * grid

export const quantizeRecordedBeat = (elapsedMs: number, bpm: number): number =>
  quantizeBeat((elapsedMs / 1000) * (bpm / 60))

export const findNoteInSlot = <T extends NoteSlot>(
  notes: readonly T[],
  pitchIndex: number,
  beatPosition: number
): T | undefined =>
  notes.find(
    note => note.pitchIndex === pitchIndex && note.beatPosition === beatPosition
  )

export const beatToMs = (beatPosition: number, bpm: number): number =>
  (beatPosition * 60000) / bpm

export interface SchedulableNote extends NoteSlot {
  id: string
}

export interface PlaybackEvent {
  noteId: string
  pitchIndex: number
  beatPosition: number
  timeMs: number
}

export const buildPlaybackSchedule = (
  notes: readonly SchedulableNote[],
  bpm: number
): PlaybackEvent[] =>
  [...notes]
    .sort(
      (a, b) =>
        a.beatPosition - b.beatPosition || a.pitchIndex - b.pitchIndex
    )
    .map(note => ({
      noteId: note.id,
      pitchIndex: note.pitchIndex,
      beatPosition: note.beatPosition,
      timeMs: beatToMs(note.beatPosition, bpm),
    }))

export class PlaybackCursor {
  private index = 0
  private readonly events: readonly PlaybackEvent[]

  constructor(events: readonly PlaybackEvent[]) {
    this.events = events
  }

  advance(elapsedMs: number): PlaybackEvent[] {
    const due: PlaybackEvent[] = []
    while (
      this.index < this.events.length &&
      this.events[this.index].timeMs <= elapsedMs
    ) {
      due.push(this.events[this.index])
      this.index += 1
    }
    return due
  }

  get done(): boolean {
    return this.index >= this.events.length
  }

  get endMs(): number {
    if (this.events.length === 0) return 0
    return this.events[this.events.length - 1].timeMs + 1000
  }
}

interface HighlightTrigger {
  noteId: string
  expiresAt: number
}

export class HighlightTracker {
  private triggers: HighlightTrigger[] = []

  fire(
    noteId: string,
    now: number,
    durationMs: number = NOTE_LIGHT_DURATION_MS
  ): void {
    this.triggers.push({ noteId, expiresAt: now + durationMs })
  }

  activeNoteIds(now: number): Set<string> {
    this.triggers = this.triggers.filter(trigger => trigger.expiresAt > now)
    return new Set(this.triggers.map(trigger => trigger.noteId))
  }

  clear(): void {
    this.triggers = []
  }
}
