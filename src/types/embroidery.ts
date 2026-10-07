export type StitchType = 'straight' | 'diagonal' | 'twist' | 'seed';

export type ThreadColor = '#c0392b' | '#f1c40f' | '#27ae60' | '#2980b9' | '#8e44ad' | '#fadbd8';

export interface StitchPoint {
  x: number;
  y: number;
  pressure: number;
  timestamp: number;
}

export interface StitchSegment {
  id: string;
  type: StitchType;
  color: ThreadColor;
  points: StitchPoint[];
  radius: number;
}

export interface EmbroideryData {
  segments: StitchSegment[];
  name: string;
  createdAt: number;
}

export const THREAD_COLORS: ThreadColor[] = [
  '#c0392b',
  '#f1c40f',
  '#27ae60',
  '#2980b9',
  '#8e44ad',
  '#fadbd8',
];

export const STITCH_TYPES: { type: StitchType; name: string }[] = [
  { type: 'straight', name: '直针' },
  { type: 'diagonal', name: '斜针' },
  { type: 'twist', name: '缠针' },
  { type: 'seed', name: '打籽针' },
];
