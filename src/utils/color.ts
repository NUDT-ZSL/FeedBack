export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function mixColors(colors: { color: string; weight: number }[]): string {
  if (colors.length === 0) return '#8b7355';
  
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalWeight = 0;

  for (const { color, weight } of colors) {
    const { r, g, b } = hexToRgb(color);
    totalR += r * weight;
    totalG += g * weight;
    totalB += b * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return '#8b7355';

  return rgbToHex(
    Math.round(totalR / totalWeight),
    Math.round(totalG / totalWeight),
    Math.round(totalB / totalWeight)
  );
}

export function getDominantColor(colors: { color: string; weight: number }[]): string {
  if (colors.length === 0) return '#d4d4d4';
  
  let maxWeight = 0;
  let dominantColor = colors[0].color;

  for (const { color, weight } of colors) {
    if (weight > maxWeight) {
      maxWeight = weight;
      dominantColor = color;
    }
  }

  return dominantColor;
}
