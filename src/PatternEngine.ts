export enum WeaveType {
  WARP_UP = 'warp_up',
  WEFT_VISIBLE = 'weft_visible',
  MIXED = 'mixed',
}

export interface Pattern {
  id: string;
  name: string;
  pixelData: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface PatternMapping {
  weaveTypes: WeaveType[][];
  colorScheme: string[];
  heddleSequence: number[][];
}

const SILK_COLORS: string[] = [
  '#cc2936',
  '#ffe066',
  '#1f4e79',
  '#d6ecf0',
  '#8b0000',
  '#2e8b57',
  '#9932cc',
  '#ff6347',
  '#4682b4',
  '#daa520',
  '#8b4513',
  '#2f4f4f',
];

function generateBajiPattern(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const cx = 32, cy = 32;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const pattern = Math.sin(angle * 8) * 10 + dist * 2;
      const wave = Math.sin(pattern * 0.3);
      data[y * 64 + x] = Math.floor(128 + wave * 127);
    }
  }
  return data;
}

function generateDragonPhoenixPattern(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dragon = Math.sin(x * 0.2 + y * 0.1) * Math.cos(y * 0.15);
      const phoenix = Math.cos(x * 0.15 - y * 0.2) * Math.sin(x * 0.1);
      const combined = dragon * 0.6 + phoenix * 0.4;
      data[y * 64 + x] = Math.floor(128 + combined * 127);
    }
  }
  return data;
}

function generateLotusPattern(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const cx = 32, cy = 32;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const petals = Math.cos(angle * 6) * Math.exp(-dist * 0.05);
      const vine = Math.sin(x * 0.1 + y * 0.05) * 0.3;
      data[y * 64 + x] = Math.floor(128 + (petals + vine) * 127);
    }
  }
  return data;
}

function generateWavePattern(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const wave1 = Math.sin(x * 0.15 + y * 0.05) * 0.5;
      const wave2 = Math.sin(x * 0.1 - y * 0.1) * 0.3;
      const wave3 = Math.cos(x * 0.2 + y * 0.15) * 0.2;
      const cliffs = y < 20 ? (20 - y) * 0.05 : 0;
      data[y * 64 + x] = Math.floor(128 + (wave1 + wave2 + wave3 - cliffs) * 127);
    }
  }
  return data;
}

export const PRESET_PATTERNS: Pattern[] = [
  { id: 'baji', name: '八吉图案', pixelData: generateBajiPattern(), width: 64, height: 64 },
  { id: 'dragon-phoenix', name: '龙凤纹', pixelData: generateDragonPhoenixPattern(), width: 64, height: 64 },
  { id: 'lotus', name: '缠枝莲', pixelData: generateLotusPattern(), width: 64, height: 64 },
  { id: 'wave', name: '海水江崖', pixelData: generateWavePattern(), width: 64, height: 64 },
];

export function mapPatternToWeave(patternData: Uint8ClampedArray): PatternMapping {
  const weaveMatrix: WeaveType[][] = [];
  const heddleSequence: number[][] = [];

  for (let y = 0; y < 64; y++) {
    const row: WeaveType[] = [];
    const heddleRow: number[] = [];
    for (let x = 0; x < 64; x++) {
      const gray = patternData[y * 64 + x];
      let type: WeaveType;
      let heddleUp: number;

      if (gray > 180) {
        type = WeaveType.WARP_UP;
        heddleUp = 1;
      } else if (gray < 80) {
        type = WeaveType.WEFT_VISIBLE;
        heddleUp = 0;
      } else {
        type = WeaveType.MIXED;
        heddleUp = (x + y) % 2;
      }

      row.push(type);
      heddleRow.push(heddleUp);
    }
    weaveMatrix.push(row);
    heddleSequence.push(heddleRow);
  }

  return {
    weaveTypes: weaveMatrix,
    colorScheme: generateColorScheme(weaveMatrix),
    heddleSequence,
  };
}

function generateColorScheme(weaveMatrix: WeaveType[][]): string[] {
  const scheme: string[] = [];
  let colorIndex = 0;
  for (let y = 0; y < weaveMatrix.length; y++) {
    let warpCount = 0;
    let weftCount = 0;
    for (let x = 0; x < weaveMatrix[y].length; x++) {
      if (weaveMatrix[y][x] === WeaveType.WARP_UP) warpCount++;
      else if (weaveMatrix[y][x] === WeaveType.WEFT_VISIBLE) weftCount++;
    }
    const ratio = warpCount / (warpCount + weftCount + 1);
    if (ratio > 0.6) colorIndex = 0;
    else if (ratio > 0.3) colorIndex = 2;
    else colorIndex = 1;
    scheme.push(SILK_COLORS[colorIndex % SILK_COLORS.length]);
  }
  return scheme;
}

export function getHeddlePositionsForRow(
  mapping: PatternMapping,
  rowIndex: number,
  totalHeddles: number = 108
): number[] {
  const positions: number[] = new Array(totalHeddles).fill(0);
  const heddleRow = mapping.heddleSequence[rowIndex % 64];
  const scale = totalHeddles / 64;

  for (let i = 0; i < totalHeddles; i++) {
    const patternX = Math.floor(i / scale);
    positions[i] = heddleRow[Math.min(patternX, 63)];
  }

  return positions;
}

export function getSilkColorsForPattern(
  mapping: PatternMapping,
  totalThreads: number = 108
): string[] {
  const colors: string[] = new Array(totalThreads);
  const scale = totalThreads / 64;

  for (let i = 0; i < totalThreads; i++) {
    const patternX = Math.floor(i / scale);
    const weaveType = mapping.weaveTypes[0][Math.min(patternX, 63)];
    if (weaveType === WeaveType.WARP_UP) {
      colors[i] = SILK_COLORS[0];
    } else if (weaveType === WeaveType.WEFT_VISIBLE) {
      colors[i] = SILK_COLORS[1];
    } else {
      colors[i] = SILK_COLORS[2];
    }
  }

  return colors;
}

export const SILK_COLORS_EXPORT = SILK_COLORS;
