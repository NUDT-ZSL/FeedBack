import { describe, expect, it } from 'vitest';
import { CANVAS_PADDING, CELL_SIZE, calculateCharacterSpacing } from '../src/utils/printUtils';
import { createPrintRecord, renderPrintFrame } from '../src/utils/printEngine';
import { makeChar, printOnce } from './helpers';

describe('排版盘到成品的映射', () => {
  it('活字按行列顺序（先行后列）映射到成品，与传入顺序无关', () => {
    const characters = [
      makeChar(2, 1, { id: 'late', char: '迟' }),
      makeChar(0, 0, { id: 'first', char: '先' }),
      makeChar(0, 2, { id: 'mid', char: '中' }),
      makeChar(2, 0, { id: 'row2', char: '行' }),
    ];
    const { frame } = printOnce({ characters, inkLevel: 60, pressure: 60 });
    expect(frame.glyphs.map(g => g.characterId)).toEqual(['first', 'mid', 'row2', 'late']);
    expect(frame.glyphs.map(g => g.char)).toEqual(['先', '中', '行', '迟']);
  });

  it('每个活字的成品坐标 = 版心原点 + 列/行 × 格距 + 版心偏移 + 微调偏移', () => {
    const characters = [
      makeChar(0, 0, { offsetX: 0.5, offsetY: 0 }),
      makeChar(4, 7, { offsetX: -1, offsetY: 1.5 }),
      makeChar(14, 29, { offsetX: 0, offsetY: -0.5 }),
    ];
    // 使用超阈值压力，确保版心偏移非零时也严格成立
    const { record, frame } = printOnce({ characters, inkLevel: 60, pressure: 95 });

    frame.glyphs.forEach(glyph => {
      const source = characters.find(c => c.id === glyph.characterId)!;
      const expectedX = CANVAS_PADDING + source.col * CELL_SIZE + CELL_SIZE / 2
        + record.plateOffsetX + source.offsetX;
      const expectedY = CANVAS_PADDING + source.row * CELL_SIZE + CELL_SIZE / 2
        + record.plateOffsetY + source.offsetY;
      expect(glyph.x).toBeCloseTo(expectedX, 6);
      expect(glyph.y).toBeCloseTo(expectedY, 6);
      expect(glyph.row).toBe(source.row);
      expect(glyph.col).toBe(source.col);
    });
  });

  it('同一版面重复印刷，活字顺序与位置不错乱', () => {
    const characters = Array.from({ length: 20 }, (_, i) =>
      makeChar(Math.floor(i / 5), (i % 5) * 2, { char: `字${i}` })
    );
    const record = createPrintRecord({ characters, inkLevel: 55, pressure: 88 });

    const first = renderPrintFrame(record);
    for (let i = 0; i < 5; i++) {
      const again = renderPrintFrame(record);
      expect(again.glyphs.map(g => g.characterId)).toEqual(first.glyphs.map(g => g.characterId));
      expect(again.glyphs.map(g => [g.x, g.y])).toEqual(first.glyphs.map(g => [g.x, g.y]));
    }
  });

  it('相邻活字间距计算：有右/下邻居时为 0，否则为 6.67mm', () => {
    const a = makeChar(0, 0);
    const right = makeChar(0, 1);
    const bottom = makeChar(1, 0);
    const all = [a, right, bottom];

    expect(calculateCharacterSpacing(a, all)).toEqual({ right: 0, bottom: 0 });
    expect(calculateCharacterSpacing(right, all)).toEqual({ right: 6.67, bottom: 6.67 });
    expect(calculateCharacterSpacing(a, [a])).toEqual({ right: 6.67, bottom: 6.67 });
  });

  it('整版活字（含边界格）都能映射到画布范围内', () => {
    const characters = [
      makeChar(0, 0),
      makeChar(0, 29),
      makeChar(14, 0),
      makeChar(14, 29),
    ];
    const { frame } = printOnce({ characters, inkLevel: 60, pressure: 60 });
    const canvasWidth = CANVAS_PADDING * 2 + 30 * CELL_SIZE;
    const canvasHeight = CANVAS_PADDING * 2 + 15 * CELL_SIZE;
    frame.glyphs.forEach(g => {
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x).toBeLessThanOrEqual(canvasWidth);
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.y).toBeLessThanOrEqual(canvasHeight);
    });
  });
});
