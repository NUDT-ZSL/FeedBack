export interface Character {
  id: string;
  char: string;
  radical: string;
  radicalName: string;
}

export interface PlacedCharacter extends Character {
  row: number;
  col: number;
  offsetX: number;
  offsetY: number;
}

export interface GridCell {
  row: number;
  col: number;
  occupied: boolean;
  characterId: string | null;
}

export interface PrintRecord {
  id: string;
  timestamp: number;
  inkLevel: number;
  pressure: number;
  plateOffsetX: number;
  plateOffsetY: number;
  inkUniformity: number;
  characters: PlacedCharacter[];
}

export type WorkshopPhase = 'typesetting' | 'inking' | 'pressing' | 'revealing' | 'done';

export interface RadicalGroup {
  radical: string;
  name: string;
  characters: string[];
}
