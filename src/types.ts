export interface Card {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionType = 'arrow' | 'dashed';

export interface Connection {
  id: string;
  fromCardId: string;
  toCardId: string;
  type: ConnectionType;
  color: string;
  label: string;
}

export interface CanvasState {
  version: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  cards: Card[];
  connections: Connection[];
}

export interface OutlineStep {
  cardId: string;
  order: number;
}

export type ToolMode = 'select' | 'boxSelect' | 'connect';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CANVAS_STORAGE_VERSION = 1;
export const STORAGE_KEY = 'inspiration-board-state';

export const CARD_COLORS = [
  '#2a2a4e',
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#34495e',
  '#e91e63',
  '#00bcd4',
  '#795548',
];

export const CONNECTION_COLORS = [
  '#aaaaaa',
  '#ff6b6b',
  '#ffd93d',
  '#6bcb77',
  '#4d96ff',
  '#9b59b6',
];

export const GRID_SIZE = 50;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;
export const DEFAULT_CARD_WIDTH = 200;
export const DEFAULT_CARD_HEIGHT = 150;
export const MIN_CARD_WIDTH = 160;
export const MIN_CARD_HEIGHT = 120;
export const TITLE_MAX_LENGTH = 30;
export const CONTENT_MAX_LENGTH = 200;
export const LABEL_MAX_LENGTH = 10;
