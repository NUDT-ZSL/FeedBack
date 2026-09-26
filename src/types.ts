export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface ColorItem {
  hex: string;
  rgb: RGB;
  emotion: string;
  hsl: HSL;
}

export interface ColorPalette {
  id: string;
  colors: ColorItem[];
  timestamp: number;
  isFavorite: boolean;
}

export interface Adjustment {
  lightness: number;
  saturation: number;
}
