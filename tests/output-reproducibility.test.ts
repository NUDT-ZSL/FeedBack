import { describe, expect, it } from 'vitest';
import {
  CANVAS_PADDING,
  CELL_SIZE,
  HIGH_PRESSURE_THRESHOLD,
  LOW_PRESSURE_THRESHOLD,
  LOW_INK_THRESHOLD,
  MAX_PLATE_OFFSET,
  calculatePlateOffset,
  getTextOpacity,
  hasWhiteSpot,
} from '../src/utils/printUtils';
import { mulberry32 } from '../src/utils/random';
import {
  createPrintRecord,
  renderPrintFrame,
  TEXTURE_SPECKLE_COUNT,
  type PrintFrame,
} from '../src/utils/printEngine';
import { findSeed, makeChar, printOnce } from './helpers';

/** 对一张成品帧做可比对的序列化快照 */
function frameSignature(frame: PrintFrame): string {
  return JSON.stringify({
    offsets: [frame.record.plateOffsetX, frame.record.plateOffsetY],
    textOpacity: frame.textOpacity,
    glyphs: frame.glyphs.map(g => [
      g.characterId, g.row, g.col, round(g.x), round(g.y), g.opacity, g.whiteSpot, g.ghost,
    ]),
    speckles: frame.textureSpeckles.map(s => [round(s.x), round(s.y), s.dark]),
    whiteSpotCount: frame.whiteSpotCount,
    hasGhosting: frame.hasGhosting,
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

describe('成品呈现：重复渲染稳定可复现', () => {
  it('相同记录重复渲染，位置/透明度/断墨白点/纹理全部一致', () => {
    const characters = [
      makeChar(0, 0, { char: '毕' }),
      makeChar(0, 1, { char: '昇' }),
      makeChar(1, 2, { char: '印' }),
      makeChar(3, 5, { char: '坊', offsetX: 1.5, offsetY: -0.5 }),
    ];
    const record = createPrintRecord({ characters, inkLevel: 55, pressure: 60 });

    const first = frameSignature(renderPrintFrame(record));
    for (let i = 0; i < 10; i++) {
      expect(frameSignature(renderPrintFrame(record))).toBe(first);
    }
  });

  it('相同版面与参数分别印刷，记录与成品也完全一致', () => {
    const build = () => [makeChar(1, 1, { id: 'c1', char: '宋' }), makeChar(1, 2, { id: 'c2', char: '版' })];
    const a = printOnce({ characters: build(), inkLevel: 70, pressure: 65 });
    const b = printOnce({ characters: build(), inkLevel: 70, pressure: 65 });

    expect(a.record.seed).toBe(b.record.seed);
    expect(a.record.plateOffsetX).toBe(b.record.plateOffsetX);
    expect(a.record.plateOffsetY).toBe(b.record.plateOffsetY);
    expect(a.record.inkUniformity).toBe(b.record.inkUniformity);
    expect(frameSignature(a.frame)).toBe(frameSignature(b.frame));
  });

  it('位置对版面/参数变化敏感：不同压力或不同墨量产生不同种子', () => {
    const characters = [makeChar(0, 0)];
    const base = createPrintRecord({ characters, inkLevel: 50, pressure: 50 });
    expect(createPrintRecord({ characters, inkLevel: 50, pressure: 51 }).seed).not.toBe(base.seed);
    expect(createPrintRecord({ characters, inkLevel: 49, pressure: 50 }).seed).not.toBe(base.seed);
    expect(
      createPrintRecord({ characters: [makeChar(1, 0)], inkLevel: 50, pressure: 50 }).seed
    ).not.toBe(base.seed);
  });
});

describe('成品呈现：压力超阈值的版心偏移', () => {
  it(`压力 > ${HIGH_PRESSURE_THRESHOLD} 时偏移落在 [-${MAX_PLATE_OFFSET}, ${MAX_PLATE_OFFSET}] px 约定范围内`, () => {
    for (let pressure = HIGH_PRESSURE_THRESHOLD + 1; pressure <= 100; pressure++) {
      const { record, frame } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 60, pressure });
      expect(Math.abs(record.plateOffsetX)).toBeLessThanOrEqual(MAX_PLATE_OFFSET);
      expect(Math.abs(record.plateOffsetY)).toBeLessThanOrEqual(MAX_PLATE_OFFSET);
      frame.glyphs.forEach(g => {
        const expectedX = CANVAS_PADDING + g.col * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetX;
        const expectedY = CANVAS_PADDING + g.row * CELL_SIZE + CELL_SIZE / 2 + record.plateOffsetY;
        expect(g.x).toBeCloseTo(expectedX, 6);
        expect(g.y).toBeCloseTo(expectedY, 6);
      });
    }
  });

  it('高压力下偏移由随机流决定但对同一种子稳定', () => {
    const rngA = mulberry32(12345);
    const rngB = mulberry32(12345);
    expect(calculatePlateOffset(95, rngA)).toEqual(calculatePlateOffset(95, rngB));

    const record = createPrintRecord({ characters: [makeChar(0, 0)], inkLevel: 60, pressure: 95, seed: 777 });
    const again = createPrintRecord({ characters: [makeChar(0, 0)], inkLevel: 60, pressure: 95, seed: 777 });
    expect(again.plateOffsetX).toBe(record.plateOffsetX);
    expect(again.plateOffsetY).toBe(record.plateOffsetY);
  });

  it(`压力不超过 ${HIGH_PRESSURE_THRESHOLD} 时版心不偏移`, () => {
    for (const pressure of [0, 20, LOW_PRESSURE_THRESHOLD, 50, 80]) {
      const { record } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 60, pressure });
      expect(record.plateOffsetX).toBe(0);
      expect(record.plateOffsetY).toBe(0);
    }
  });
});

describe('成品呈现：墨量过低的断墨白点', () => {
  it(`墨量 >= ${LOW_INK_THRESHOLD} 时任何种子都不出现白点`, () => {
    for (const inkLevel of [LOW_INK_THRESHOLD, 21, 50, 100]) {
      for (let seed = 0; seed < 300; seed++) {
        expect(hasWhiteSpot(inkLevel, mulberry32(seed))).toBe(false);
      }
    }
  });

  it(`墨量 < ${LOW_INK_THRESHOLD} 时能稳定观察到白点（不是永不发生）`, () => {
    let observed = 0;
    for (let seed = 0; seed < 1000; seed++) {
      if (hasWhiteSpot(10, mulberry32(seed))) observed++;
    }
    expect(observed).toBeGreaterThan(0);
  });

  it('低墨量印刷帧中白点文字透明度降为基础透明度的 0.3，且重复渲染一致', () => {
    const characters = Array.from({ length: 12 }, (_, i) => makeChar(0, i));
    const seed = findSeed(s => {
      const { frame } = printOnce({ characters, inkLevel: 10, pressure: 60, seed: s });
      return frame.whiteSpotCount > 0 && frame.whiteSpotCount < characters.length;
    });

    const first = renderPrintFrame(createPrintRecord({ characters, inkLevel: 10, pressure: 60, seed }));
    const second = renderPrintFrame(createPrintRecord({ characters, inkLevel: 10, pressure: 60, seed }));

    const spotted = first.glyphs.filter(g => g.whiteSpot);
    expect(spotted.length).toBeGreaterThan(0);
    spotted.forEach(g => {
      expect(g.opacity).toBeCloseTo(first.textOpacity * 0.3, 10);
    });
    expect(second.glyphs.map(g => g.whiteSpot)).toEqual(first.glyphs.map(g => g.whiteSpot));
    expect(second.whiteSpotCount).toBe(first.whiteSpotCount);
  });
});

describe('成品呈现：压力过低的重影', () => {
  it(`压力 < ${LOW_PRESSURE_THRESHOLD} 时整版重影可被观察到`, () => {
    const characters = [makeChar(0, 0), makeChar(2, 3)];
    for (const pressure of [0, 10, 29]) {
      const { frame } = printOnce({ characters, inkLevel: 80, pressure });
      expect(frame.hasGhosting).toBe(true);
      frame.glyphs.forEach(g => {
        expect(g.ghost).toBe(true);
        expect(g.ghostX - g.x).toBeCloseTo(0.5, 6);
        expect(g.ghostY - g.y).toBeCloseTo(0.5, 6);
      });
    }
  });

  it(`压力 >= ${LOW_PRESSURE_THRESHOLD} 时不出现重影`, () => {
    const characters = [makeChar(0, 0)];
    for (const pressure of [LOW_PRESSURE_THRESHOLD, 50, 100]) {
      const { frame } = printOnce({ characters, inkLevel: 80, pressure });
      expect(frame.hasGhosting).toBe(false);
      frame.glyphs.forEach(g => expect(g.ghost).toBe(false));
    }
  });

  it('低压重影在重复渲染中位置与透明度稳定', () => {
    const characters = [makeChar(0, 0, { char: '模' })];
    const { record, frame } = printOnce({ characters, inkLevel: 80, pressure: 15 });
    const again = renderPrintFrame(record);
    expect(again.glyphs[0].ghostX).toBe(frame.glyphs[0].ghostX);
    expect(again.glyphs[0].ghostY).toBe(frame.glyphs[0].ghostY);
  });

  it('压力/墨量越高文字越清晰，透明度恒在 [0.2, 1]', () => {
    expect(getTextOpacity(0, 100)).toBeLessThan(getTextOpacity(29, 100));
    expect(getTextOpacity(30, 100)).toBeLessThan(getTextOpacity(100, 100));
    expect(getTextOpacity(100, 100)).toBeLessThanOrEqual(1);
    expect(getTextOpacity(0, 0)).toBeGreaterThanOrEqual(0.2);
    for (let p = 0; p <= 100; p += 5) {
      for (let ink = 0; ink <= 100; ink += 25) {
        const opacity = getTextOpacity(p, ink);
        expect(opacity).toBeGreaterThanOrEqual(0.2);
        expect(opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('成品呈现：纸张纹理同样可复现', () => {
  it('纹理噪点数量固定且同一记录重复渲染坐标一致', () => {
    const { record, frame } = printOnce({ characters: [makeChar(0, 0)], inkLevel: 50, pressure: 50 });
    expect(frame.textureSpeckles).toHaveLength(TEXTURE_SPECKLE_COUNT);
    const again = renderPrintFrame(record);
    expect(again.textureSpeckles).toEqual(frame.textureSpeckles);
  });
});
