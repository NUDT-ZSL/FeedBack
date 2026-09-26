const MEMBER_COLORS = [
  { h: 240, s: 60, l: 50 },
  { h: 200, s: 60, l: 50 },
  { h: 280, s: 60, l: 50 },
  { h: 160, s: 60, l: 50 },
  { h: 20, s: 60, l: 50 },
  { h: 340, s: 60, l: 50 },
  { h: 50, s: 60, l: 50 },
  { h: 120, s: 60, l: 50 },
];

export function getMemberColor(index: number): string {
  const color = MEMBER_COLORS[index % MEMBER_COLORS.length];
  return `hsl(${color.h}, ${color.s}%, ${color.l}%)`;
}

export function lightenColor(hslStr: string, percent: number): string {
  const match = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return hslStr;
  const h = parseInt(match[1]);
  const s = parseInt(match[2]);
  const l = Math.min(100, parseInt(match[3]) + percent);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function rgbaFromHsl(hslStr: string, alpha: number): string {
  const match = hslStr.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return `rgba(99, 102, 241, ${alpha})`;
  const h = parseInt(match[1]);
  const s = parseInt(match[2]) / 100;
  const l = parseInt(match[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else if (h >= 300 && h < 360) { r = c; g = 0; b = x; }
  return `rgba(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)}, ${alpha})`;
}
