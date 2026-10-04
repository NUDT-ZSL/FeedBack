/**
 * 排版 → 上墨 → 施压 → 揭纸 的纯函数流水线。
 *
 * 这条链路原来散落在组件里且依赖 Math.random()，无法离线复现。
 * 这里把链路抽成确定性纯函数：给定相同的输入与 seed，
 * 产出的印刷记录（PrintRecord）和渲染计划（RenderPlan）完全一致，
 * 供 PrintWorkshop / PrintResult 组件与离线验证测试共同使用。
 */
import type { PlacedCharacter, PrintRecord } from '../types';
import {
  CANVAS_PADDING,
  CELL_SIZE,
  calculateInkUniformity,
  calculatePlateOffset,
  formatTimestamp,
  getTextOpacity,
  hasWhiteSpot,
} from './printUtils';
import { hashString, mulberry32, type Rng } from './random';

export const PRESSURE_OFFSET_THRESHOLD = 80;
export const MAX_PLATE_OFFSET_PX = 3;
export const LOW_INK_THRESHOLD = 20;
export const WHITE_SPOT_PROBABILITY = 0.3;
export const LOW_PRESSURE_THRESHOLD = 30;

export interface PrintJob {
  characters: PlacedCharacter[];
  inkLevel: number;
  pressure: number;
  /** 不传时由 id/timestamp 派生，保证同一记录重复执行结果一致 */
  seed?: number;
  id?: string;
  timestamp?: number;
}

function resolveSeed(job: PrintJob): number {
  if (job.seed !== undefined) return job.seed >>> 0;
  if (job.id !== undefined) return hashString(job.id);
  return hashString(String(job.timestamp ?? 0));
}

/**
 * 执行一次完整印刷：上墨（墨色均匀度）→ 施压（版心偏移）→ 生成记录。
 * 相同 job 输入重复执行产出完全相同的 PrintRecord。
 */
export function runPrintPipeline(job: PrintJob): PrintRecord {
  const rng = mulberry32(resolveSeed(job));
  const { x, y } = calculatePlateOffset(job.pressure, rng);
  const inkUniformity = calculateInkUniformity(job.inkLevel, rng);
  return {
    id: job.id ?? `print-${job.timestamp ?? 0}`,
    timestamp: job.timestamp ?? 0,
    inkLevel: job.inkLevel,
    pressure: job.pressure,
    plateOffsetX: x,
    plateOffsetY: y,
    inkUniformity,
    characters: [...job.characters],
  };
}

export interface RenderedGlyph {
  id: string;
  char: string;
  row: number;
  col: number;
  x: number;
  y: number;
  opacity: number;
  whiteSpot: boolean;
  ghost: boolean;
}

export interface RenderPlan {
  /** 按排版盘行列顺序（行优先）排列的成品字形 */
  glyphs: RenderedGlyph[];
  opacity: number;
  ghosting: boolean;
}

/**
 * 由印刷记录推导成品渲染计划：每个活字在宣纸上的位置、透明度、
 * 断墨白点与重影。随机源由记录 id 派生，同一记录重复渲染结果一致。
 */
export function computeRenderPlan(record: PrintRecord, rng?: Rng): RenderPlan {
  const random = rng ?? mulberry32(hashString(record.id));
  const opacity = getTextOpacity(record.pressure, record.inkLevel);
  const ghosting = record.pressure < LOW_PRESSURE_THRESHOLD;

  const sorted = [...record.characters].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  const glyphs = sorted.map((char) => ({
    id: char.id,
    char: char.char,
    row: char.row,
    col: char.col,
    x: CANVAS_PADDING + char.col * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetX + char.offsetX,
    y: CANVAS_PADDING + char.row * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetY + char.offsetY,
    opacity,
    whiteSpot: hasWhiteSpot(record.inkLevel, random),
    ghost: ghosting,
  }));

  return { glyphs, opacity, ghosting };
}

export interface RecordCardEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * 记录卡展示数据，全部取自本次印刷的 PrintRecord，
 * 保证卡片数值与实际印刷参数、版面内容一致。
 */
export function getRecordCardData(record: PrintRecord): RecordCardEntry[] {
  return [
    { key: 'timestamp', label: '印刷时间', value: formatTimestamp(record.timestamp) },
    { key: 'plateOffsetX', label: '版心X偏移', value: `${record.plateOffsetX.toFixed(1)} px` },
    { key: 'plateOffsetY', label: '版心Y偏移', value: `${record.plateOffsetY.toFixed(1)} px` },
    { key: 'inkUniformity', label: '墨色均匀度', value: `${record.inkUniformity}%` },
    { key: 'inkLevel', label: '用墨量', value: `${record.inkLevel}%` },
    { key: 'pressure', label: '压力值', value: `${record.pressure}` },
    { key: 'characterCount', label: '活字数量', value: `${record.characters.length} 个` },
  ];
}
