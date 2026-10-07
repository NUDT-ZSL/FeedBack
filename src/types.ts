export enum WoodType {
  Pine = 'pine',
  Rosewood = 'rosewood',
  Boxwood = 'boxwood',
}

export type FontId = 'mashan' | 'zhuanshu' | 'kaishu' | 'miao' | 'tiexian';

export interface WoodProperties {
  weight: number;
  toughness: number;
  durability: number;
  hardness: number;
  grain: number;
}

export const woodProperties: Record<WoodType, WoodProperties> = {
  [WoodType.Pine]: {
    weight: 450,
    toughness: 60,
    durability: 50,
    hardness: 40,
    grain: 60,
  },
  [WoodType.Rosewood]: {
    weight: 850,
    toughness: 85,
    durability: 90,
    hardness: 88,
    grain: 55,
  },
  [WoodType.Boxwood]: {
    weight: 750,
    toughness: 95,
    durability: 92,
    hardness: 70,
    grain: 92,
  },
};

export const woodLabels: Record<WoodType, string> = {
  [WoodType.Pine]: '松木',
  [WoodType.Rosewood]: '紫檀',
  [WoodType.Boxwood]: '黄杨',
};

export interface CarveParams {
  sizeMm: number;
  fontId: FontId;
  text: string;
}

export type ValidationCode =
  | 'NO_WOOD'
  | 'EMPTY_TEXT'
  | 'TEXT_TOO_LONG'
  | 'SIZE_BELOW_MIN'
  | 'SIZE_ABOVE_MAX'
  | 'FONT_UNAVAILABLE'
  | 'FONT_OFFLINE_MISSING';

export interface ValidationResult {
  idle: boolean;
  ok: boolean;
  codes: ValidationCode[];
  minSizeMm: number | null;
  maxSizeMm: number | null;
  availableFonts: FontId[];
}

export interface CarvedSeal {
  sealId: string;
  wood: WoodType;
  woodSnapshot: WoodProperties;
  params: CarveParams;
  createdAt: number;
}

export type SealPhase = 'idle' | 'drafting' | 'carved';

export interface StampRecord {
  recordId: string;
  sealId: string;
  wood: WoodType;
  text: string;
  fontId: FontId;
  sizeMm: number;
  x: number;
  y: number;
  rotation: number;
  stampedAt: number;
}

export interface ExportedArtwork {
  exportedAt: number;
  format: 'image/svg+xml';
  width: number;
  height: number;
  inkColor: string;
  recordCount: number;
  bytes: number;
  svg: string;
}
