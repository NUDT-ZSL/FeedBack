import { describe, expect, it } from 'vitest';
import { ArtGeneratorSession } from '../src/art/generator';
import type { CanvasSpec } from '../src/art/types';

const CANVAS: CanvasSpec = { width: 800, height: 600, dpr: 1 };
const fixedClock = () => 1700000000000;

function makeSession(capacity = 10): ArtGeneratorSession {
  return new ArtGeneratorSession({ canvas: CANVAS, capacity, now: fixedClock });
}

function ids(session: ArtGeneratorSession): string[] {
  return session.history.map((item) => item.id);
}

describe('历史记录：序列与选中项收敛到确定状态', () => {
  it('连续生成超过容量上限时，只保留最近 N 条且游标指向最新', () => {
    const session = makeSession(10);
    for (let i = 0; i < 15; i += 1) {
      session.generate(`prompt ${i}`, i);
    }
    expect(session.history).toHaveLength(10);
    expect(ids(session)).toEqual([
      'art-6', 'art-7', 'art-8', 'art-9', 'art-10',
      'art-11', 'art-12', 'art-13', 'art-14', 'art-15',
    ]);
    expect(session.currentIndex).toBe(9);
    expect(session.current!.id).toBe('art-15');
    expect(session.canUndo).toBe(true);
    expect(session.canRedo).toBe(false);
  });

  it('撤销 / 重做按确定顺序移动，到达边界后变为无副作用的空操作', () => {
    const session = makeSession();
    for (let i = 0; i < 4; i += 1) {
      session.generate(`p${i}`, i);
    }
    expect(session.undo()!.id).toBe('art-3');
    expect(session.undo()!.id).toBe('art-2');
    expect(session.undo()!.id).toBe('art-1');
    // 已到最旧端：继续撤销状态不变
    expect(session.undo()!.id).toBe('art-1');
    expect(session.currentIndex).toBe(0);
    expect(session.canUndo).toBe(false);

    expect(session.redo()!.id).toBe('art-2');
    expect(session.redo()!.id).toBe('art-3');
    expect(session.redo()!.id).toBe('art-4');
    // 已到最新端：继续重做状态不变
    expect(session.redo()!.id).toBe('art-4');
    expect(session.canRedo).toBe(false);
  });

  it('撤销后生成新记录会丢弃重做尾部，不残留已删除项', () => {
    const session = makeSession();
    for (let i = 0; i < 5; i += 1) {
      session.generate(`p${i}`, i);
    }
    session.undo();
    session.undo();
    session.undo(); // 当前 art-2，尾部 art-3/4/5 待重做
    session.generate('new branch', 100);
    expect(session.canRedo).toBe(false);
    const remaining = ids(session);
    expect(remaining).toEqual(['art-1', 'art-2', 'art-6']);
    expect(remaining).not.toContain('art-3');
    expect(remaining).not.toContain('art-4');
    expect(remaining).not.toContain('art-5');
    expect(session.current!.id).toBe('art-6');
  });

  it('撤销到底再连续生成触发驱逐时，游标与序列仍然对齐', () => {
    const session = makeSession(3);
    for (let i = 0; i < 3; i += 1) {
      session.generate(`p${i}`, i);
    }
    session.undo();
    session.undo(); // 当前 art-1
    session.generate('a', 10); // 丢弃尾部后驱逐最旧
    session.generate('b', 11);
    expect(ids(session)).toEqual(['art-1', 'art-4', 'art-5']);
    expect(session.currentIndex).toBe(2);
    expect(session.current!.id).toBe('art-5');
    expect(session.undo()!.id).toBe('art-4');
    expect(session.undo()!.id).toBe('art-1');
  });

  it('清空后状态归零，且可以重新开始生成', () => {
    const session = makeSession();
    for (let i = 0; i < 5; i += 1) {
      session.generate(`p${i}`, i);
    }
    session.clear();
    expect(session.history).toHaveLength(0);
    expect(session.current).toBeNull();
    expect(session.currentIndex).toBe(-1);
    expect(session.canUndo).toBe(false);
    expect(session.canRedo).toBe(false);
    expect(session.getPreviewPlan()).toBeNull();
    expect(session.exportCurrent()).toBeNull();

    session.generate('restart', 1);
    expect(session.history).toHaveLength(1);
    expect(session.current!.id).toBe('art-6'); // id 序号不回退，避免与已清空项混淆
  });
});
