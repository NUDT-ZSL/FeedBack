export interface TypeCharacter {
  id: string;
  char: string;
  position?: number;
}

export interface InkColor {
  name: string;
  value: string;
}

export interface FontSizeOption {
  name: string;
  value: number;
}

export interface DragState {
  isDragging: boolean;
  character: TypeCharacter | null;
  source: 'rack' | 'composition';
  sourceIndex?: number;
}

export type InkLevel = 0 | 1 | 2 | 3 | 4;
