import {
  woodProperties,
  type CarveParams,
  type FontId,
  type ValidationCode,
  type ValidationResult,
  type WoodType,
} from './types.ts';
import { FONT_CATALOG, getFontEntry } from './fonts.ts';

export const MAX_TEXT_CHARS = 4;

export function sizeRangeForWood(wood: WoodType): { min: number; max: number } {
  const props = woodProperties[wood];
  return {
    min: 25 - Math.floor(props.hardness / 5),
    max: 20 + Math.floor(props.toughness / 5),
  };
}

export function availableFontsForWood(wood: WoodType): FontId[] {
  const props = woodProperties[wood];
  return FONT_CATALOG.filter(
    (f) =>
      props.hardness >= f.minHardness &&
      (f.allowedWoods === null || f.allowedWoods.includes(wood)),
  ).map((f) => f.id);
}

export interface ValidationOptions {
  offline?: boolean;
}

export function validateCarveParams(
  wood: WoodType | null,
  params: CarveParams,
  options: ValidationOptions = {},
): ValidationResult {
  if (wood === null) {
    return {
      idle: true,
      ok: false,
      codes: ['NO_WOOD'],
      minSizeMm: null,
      maxSizeMm: null,
      availableFonts: [],
    };
  }

  const codes: ValidationCode[] = [];
  const range = sizeRangeForWood(wood);
  const availableFonts = availableFontsForWood(wood);

  const trimmed = params.text.trim();
  if (trimmed.length === 0) {
    codes.push('EMPTY_TEXT');
  } else if (trimmed.length > MAX_TEXT_CHARS) {
    codes.push('TEXT_TOO_LONG');
  }

  if (params.sizeMm < range.min) {
    codes.push('SIZE_BELOW_MIN');
  } else if (params.sizeMm > range.max) {
    codes.push('SIZE_ABOVE_MAX');
  }

  if (!availableFonts.includes(params.fontId)) {
    codes.push('FONT_UNAVAILABLE');
  } else {
    const entry = getFontEntry(params.fontId);
    if (params.sizeMm < entry.minSizeMm) {
      codes.push('SIZE_BELOW_MIN');
    }
    if (options.offline && entry.remote && !entry.cached) {
      codes.push('FONT_OFFLINE_MISSING');
    }
  }

  return {
    idle: false,
    ok: codes.length === 0,
    codes,
    minSizeMm: range.min,
    maxSizeMm: range.max,
    availableFonts,
  };
}
