import { describe, expect, it } from 'vitest';
import { ArtGeneratorSession } from '../src/art/generator';
import { HistoryStore } from '../src/art/historyStore';
import type { CanvasSpec } from '../src/art/types';

const CANVAS: CanvasSpec = { width: 800, height: 600, dpr: 1 };
const fixedClock = () => 1700000000000;

function makeSession(capacity = 10): ArtGeneratorSession {
  return new ArtGeneratorSession({ canvas: CANVAS, capacity, now: fixedClock });
}

function ids(session: ArtGeneratorSession): string[] {
  return session.history.map((item) => item.id);
}

describe('历史记录：选择与不变量', () => {
  it('按 id 选择历史项；选择不存在的 id 时状态保持不变', () => {
    const session = makeSession();
    for (let i = 0; i < 4; i += 1) {
      session.generate(`p${i}`, i);
    }
    expect(session.select('art-2')!.id).toBe('art-2');
    expect(session.currentIndex).toBe(1);
    const snapshotBefore = ids(session);
    const indexBefore = session.currentIndex;
    expect(session.select('art-999')).toBeNull();
    expect(session.currentIndex).toBe(indexBefore);
    expect(ids(session)).toEqual(snapshotBefore);
  });

  it('微调原位更新当前项，不改变序列长度与游标位置', () => {
    const session = makeSession();
    for (let i = 0; i < 3; i += 1) {
      session.generate(`p${i}`, i);
    }
    session.undo(); // 当前 art-2
    session.adjust({ hueShift: 45 });
    expect(session.history).toHaveLength(3);
    expect(session.currentIndex).toBe(1);
    expect(session.current!.id).toBe('art-2');
    expect(session.current!.config.hueShift).toBe(45);
    // 相邻记录不受影响
    expect(session.history[0].config.hueShift).toBe(0);
    expect(session.history[2].config.hueShift).toBe(0);
  });

  it('任意操作序列后不变量成立：id 唯一、游标有效、current 与序列对齐', () => {
    const session = makeSession(4);
    const assertInvariants = () => {
      const all = ids(session);
      expect(new Set(all).size).toBe(all.length);
      if (all.length === 0) {
        expect(session.currentIndex).toBe(-1);
        expect(session.current).toBeNull();
      } else {
        expect(session.currentIndex).toBeGreaterThanOrEqual(0);
        expect(session.currentIndex).toBeLessThan(all.length);
        expect(session.current!.id).toBe(all[session.currentIndex]);
      }
      expect(session.history.length).toBeLessThanOrEqual(4);
    };
    for (let round = 0; round < 12; round += 1) {
      session.generate(`round-${round}`, round * 7 + 1);
      assertInvariants();
      if (round % 3 === 0) session.undo();
      if (round % 4 === 1) session.redo();
      if (round % 5 === 2) session.adjust({ complexity: (round % 10) + 1 });
      assertInvariants();
    }
    session.clear();
    assertInvariants();
  });

  it('HistoryStore 拒绝非法容量', () => {
    expect(() => new HistoryStore(0)).toThrow(RangeError);
    expect(() => new HistoryStore(1.5)).toThrow(RangeError);
  });
});
