export const SUBDIVISIONS_PER_BEAT = 4

export interface ScheduledNote {
  id: string
  pitchIndex: number
  beatPosition: number
  timestamp: number
}

export const quantizeBeat = (beat: number): number =>
  Math.round(beat * SUBDIVISIONS_PER_BEAT) / SUBDIVISIONS_PER_BEAT

export const beatToMs = (beat: number, bpm: number): number => (beat * 60000) / bpm

export const msToBeat = (ms: number, bpm: number): number => (ms / 1000) * (bpm / 60)

export const recordBeatPosition = (elapsedMs: number, bpm: number): number =>
  quantizeBeat(msToBeat(elapsedMs, bpm))

export const findNoteAt = <T extends { pitchIndex: number; beatPosition: number }>(
  notes: T[],
  pitchIndex: number,
  beatPosition: number
): T | undefined =>
  notes.find(n => n.pitchIndex === pitchIndex && n.beatPosition === beatPosition)

export interface PlaybackEvent<T> {
  note: T
  timeMs: number
}

export const buildPlaybackSchedule = <T extends { pitchIndex: number; beatPosition: number }>(
  notes: T[],
  bpm: number
): PlaybackEvent<T>[] =>
  [...notes]
    .sort((a, b) => a.beatPosition - b.beatPosition)
    .map(note => ({ note, timeMs: beatToMs(note.beatPosition, bpm) }))

export const applyLightUp = (counts: Map<string, number>, noteId: string): Map<string, number> => {
  const next = new Map(counts)
  next.set(noteId, (next.get(noteId) ?? 0) + 1)
  return next
}

export const applyLightDown = (counts: Map<string, number>, noteId: string): Map<string, number> => {
  const remaining = (counts.get(noteId) ?? 1) - 1
  const next = new Map(counts)
  if (remaining > 0) {
    next.set(noteId, remaining)
  } else {
    next.delete(noteId)
  }
  return next
}

export const isNoteLit = (counts: Map<string, number>, noteId: string): boolean =>
  (counts.get(noteId) ?? 0) > 0
