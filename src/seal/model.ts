import { WoodType } from '../types.ts';

export const SealFont = {
  SealScript: 'zhuanshu',
  Clerical: 'lishu',
  Regular: 'kaishu',
} as const;

export type SealFont = (typeof SealFont)[keyof typeof SealFont];

export interface CarveDraft {
  wood: WoodType;
  sizeMm: number;
  font: SealFont;
  text: string;
}

export interface CarvedSeal {
  sealId: string;
  params: CarveDraft;
  carvedAt: number;
}

export interface StampRecord {
  stampId: string;
  sealId: string;
  params: CarveDraft;
  seq: number;
  x: number;
  y: number;
  rotation: number;
  stampedAt: number;
}

export interface ExportArtifact {
  exportedAt: number;
  sealCount: number;
  stamps: StampRecord[];
}

export const DEFAULT_DRAFT: CarveDraft = {
  wood: WoodType.Pine,
  sizeMm: 20,
  font: SealFont.Regular,
  text: '',
};

export function copyDraft(draft: CarveDraft): CarveDraft {
  return { wood: draft.wood, sizeMm: draft.sizeMm, font: draft.font, text: draft.text };
}
