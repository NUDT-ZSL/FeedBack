export interface Note {
  id: string;
  pitch: string;
  frequency: number;
  startTime: number;
  duration: number;
}

export interface Segment {
  id: string;
  name: string;
  notes: Note[];
  createdAt: number;
}

export interface PianoKey {
  note: string;
  frequency: number;
  isBlack: boolean;
  octave: number;
}

export type PlaybackState = 'idle' | 'playing' | 'paused';
