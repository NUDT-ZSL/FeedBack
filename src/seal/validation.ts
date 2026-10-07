import { woodProperties } from '../types.ts';
import type { WoodType } from '../types.ts';
import { SealFont } from './model.ts';
import type { CarveDraft } from './model.ts';

export type ValidationErrorCode =
  | 'text-empty'
  | 'text-too-long'
  | 'size-too-small'
  | 'size-too-large'
  | 'font-not-supported';

export interface ValidationResult {
  ok: boolean;
  errors: ValidationErrorCode[];
}

export const MAX_TEXT_LENGTH = 4;

export function minSizeMm(wood: WoodType): number {
  return 20 - woodProperties[wood].hardness / 10;
}

export function maxSizeMm(wood: WoodType): number {
  return 30 + woodProperties[wood].toughness / 5;
}

const FONT_MIN_HARDNESS: Record<SealFont, number> = {
  [SealFont.SealScript]: 50,
  [SealFont.Clerical]: 0,
  [SealFont.Regular]: 0,
};

const FONT_MIN_TOUGHNESS: Record<SealFont, number> = {
  [SealFont.SealScript]: 0,
  [SealFont.Clerical]: 70,
  [SealFont.Regular]: 0,
};

export function isFontAvailable(wood: WoodType, font: SealFont): boolean {
  const props = woodProperties[wood];
  return props.hardness >= FONT_MIN_HARDNESS[font] && props.toughness >= FONT_MIN_TOUGHNESS[font];
}

export function validateCarveParams(draft: CarveDraft): ValidationResult {
  const errors: ValidationErrorCode[] = [];
  if (draft.text.length === 0) {
    errors.push('text-empty');
  } else if (draft.text.length > MAX_TEXT_LENGTH) {
    errors.push('text-too-long');
  }
  if (!Number.isFinite(draft.sizeMm) || draft.sizeMm < minSizeMm(draft.wood)) {
    errors.push('size-too-small');
  } else if (draft.sizeMm > maxSizeMm(draft.wood)) {
    errors.push('size-too-large');
  }
  if (!isFontAvailable(draft.wood, draft.font)) {
    errors.push('font-not-supported');
  }
  return { ok: errors.length === 0, errors };
}
