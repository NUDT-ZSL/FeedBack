/**
 * 印刷引擎：排版 → 上墨 → 施压 → 揭纸 整条链路的纯函数实现。
 *
 * 这里不依赖 DOM / Canvas / 浏览器，输入排版盘上的活字与墨量、压力，
 * 输出印刷记录卡数据与成品渲染帧。所有随机性都来自由版面内容和
 * 印刷参数决定的确定性种子，因此：
 *  - 同一份记录重复渲染，文字位置、透明度、断墨白点完全一致；
 *  - 离线测试可以在 Node 环境下精确回归每一个像素级结论。
 */
import type { PlacedCharacter, PrintRecord } from '../types';
import { hashSeed, streamRng } from './random';
import {
  CANVAS_PADDING,
  CELL_SIZE,
  GHOST_OFFSET,
  LOW_PRESSURE_THRESHOLD,
  calculateInkUniformity,
  calculatePlateOffset,
  getTextOpacity,
  hasWhiteSpot,
} from './printUtils';

export interface PrintInput {
  /** 排版盘上已落位的活字（含行列与微调偏移） */
  characters: PlacedCharacter[];
  /** 墨量 0-100 */
  inkLevel: number;
  /** 压力 0-100 */
  pressure: number;
  id?: string;
  timestamp?: number;
  /** 测试或重放场景可显式指定种子；缺省时由版面与参数推导 */
  seed?: number;
}

/** 成品上的单个印刷文字 */
export interface PrintedGlyph {
  char: string;
  characterId: string;
  row: number;
  col: number;
  /** 文字中心在成品画布上的坐标（含版心偏移与活字微调偏移） */
  x: number;
  y: number;
  /** 实际渲染透明度（断墨白点时为 opacity * 0.3） */
  opacity: number;
  /** 该字是否出现断墨白点 */
  whiteSpot: boolean;
  /** 该字是否带低压重影 */
  ghost: boolean;
  ghostX: number;
  ghostY: number;
}

/** 一次印刷的完整渲染帧：记录卡 + 成品内容 */
export interface PrintFrame {
  record: PrintRecord;
  /** 按排版盘行列顺序（先行后列）排列的印刷文字 */
  glyphs: PrintedGlyph[];
  /** 文字基础透明度（未叠加断墨衰减） */
  textOpacity: number;
  /** 压力过低时整版出现重影 */
  hasGhosting: boolean;
  /** 本次印刷出现断墨白点的活字数量 */
  whiteSpotCount: number;
  /** 纸张纹理噪点坐标，同样由种子决定，重复渲染保持一致 */
  textureSpeckles: Array<{ x: number; y: number; dark: boolean }>;
}

/** 版面签名：只由活字身份与落位决定，与印刷参数无关 */
export function layoutSignature(characters: PlacedCharacter[]): string {
  return characters
    .map(c => `${c.id}@${c.row},${c.col}:${c.offsetX},${c.offsetY}`)
    .join('|');
}

/** 由版面内容与印刷参数推导确定性种子 */
export function derivePrintSeed(characters: PlacedCharacter[], inkLevel: number, pressure: number): number {
  return hashSeed([layoutSignature(characters), inkLevel, pressure]);
}

/**
 * 执行一次印刷，生成印刷记录卡。
 * 记录卡上的版心偏移、墨色均匀度、用墨量、压力值、活字数量全部
 * 来自本次实际使用的参数与版面内容。
 */
export function createPrintRecord(input: PrintInput): PrintRecord {
  const characters = [...input.characters];
  const seed = input.seed ?? derivePrintSeed(characters, input.inkLevel, input.pressure);
  const offset = calculatePlateOffset(input.pressure, streamRng(seed, 'plate-offset'));
  return {
    id: input.id ?? `print-${seed.toString(16)}`,
    timestamp: input.timestamp ?? 0,
    inkLevel: input.inkLevel,
    pressure: input.pressure,
    plateOffsetX: offset.x,
    plateOffsetY: offset.y,
    inkUniformity: calculateInkUniformity(input.inkLevel, streamRng(seed, 'ink-uniformity')),
    characters,
    seed,
  };
}

/** 纸张纹理噪点数量 */
export const TEXTURE_SPECKLE_COUNT = 500;

/**
 * 根据印刷记录渲染成品帧。对同一份记录重复调用，返回的每一个
 * 字形位置、透明度、断墨白点、重影与纹理噪点都完全一致。
 */
export function renderPrintFrame(record: PrintRecord): PrintFrame {
  const seed = record.seed ?? derivePrintSeed(record.characters, record.inkLevel, record.pressure);
  const textOpacity = getTextOpacity(record.pressure, record.inkLevel);
  const hasGhosting = record.pressure < LOW_PRESSURE_THRESHOLD;

  const sortedChars = [...record.characters].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const glyphs: PrintedGlyph[] = sortedChars.map(char => {
    // 每个活字使用独立的随机流，断墨判定只取决于种子与该字的落位
    const spotRng = streamRng(seed, `white-spot:${char.id}:${char.row}:${char.col}`);
    const whiteSpot = hasWhiteSpot(record.inkLevel, spotRng);
    const x = CANVAS_PADDING + char.col * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetX + char.offsetX;
    const y = CANVAS_PADDING + char.row * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetY + char.offsetY;
    return {
      char: char.char,
      characterId: char.id,
      row: char.row,
      col: char.col,
      x,
      y,
      opacity: whiteSpot ? textOpacity * 0.3 : textOpacity,
      whiteSpot,
      ghost: hasGhosting,
      ghostX: x + GHOST_OFFSET,
      ghostY: y + GHOST_OFFSET,
    };
  });

  const textureRng = streamRng(seed, 'paper-texture');
  const canvasWidth = CANVAS_PADDING * 2 + 30 * CELL_SIZE;
  const canvasHeight = CANVAS_PADDING * 2 + 15 * CELL_SIZE;
  const textureSpeckles = Array.from({ length: TEXTURE_SPECKLE_COUNT }, () => ({
    x: textureRng() * canvasWidth,
    y: textureRng() * canvasHeight,
    dark: textureRng() > 0.5,
  }));

  return {
    record,
    glyphs,
    textOpacity,
    hasGhosting,
    whiteSpotCount: glyphs.filter(g => g.whiteSpot).length,
    textureSpeckles,
  };
}
