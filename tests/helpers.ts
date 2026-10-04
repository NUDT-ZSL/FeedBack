import type { PlacedCharacter } from '../src/types';
import { createPrintRecord, renderPrintFrame, type PrintInput } from '../src/utils/printEngine';

let counter = 0;

/** 构造一个落在排版盘指定位置的活字 */
export function makeChar(
  row: number,
  col: number,
  overrides: Partial<PlacedCharacter> = {}
): PlacedCharacter {
  counter += 1;
  return {
    id: overrides.id ?? `char-${counter}`,
    char: overrides.char ?? '字',
    radical: '木',
    radicalName: '木字旁',
    row,
    col,
    offsetX: 0,
    offsetY: 0,
    ...overrides,
  };
}

/** 执行一次印刷并同时返回记录卡与成品帧 */
export function printOnce(input: PrintInput) {
  const record = createPrintRecord(input);
  const frame = renderPrintFrame(record);
  return { record, frame };
}

/** 在指定种子范围内找到第一个满足条件的种子（用于稳定复现概率性表现） */
export function findSeed(predicate: (seed: number) => boolean, from = 0, to = 2000): number {
  for (let seed = from; seed <= to; seed++) {
    if (predicate(seed)) return seed;
  }
  throw new Error(`未在 [${from}, ${to}] 内找到满足条件的种子`);
}
