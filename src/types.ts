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
  /**
   * 本次印刷的确定性种子，由版面内容（活字位置）与印刷参数（墨量、压力）
   * 共同决定。相同版面、相同参数必定得到相同种子，渲染成品因此可复现。
   */
  seed: number;
}

export type WorkshopPhase = 'typesetting' | 'inking' | 'pressing' | 'revealing' | 'done';

export interface RadicalGroup {
  radical: string;
  name: string;
  characters: string[];
}
