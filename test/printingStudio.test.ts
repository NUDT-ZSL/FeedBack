import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrintingStudio,
  GRID_CAPACITY,
  FAIL_REASONS,
  type ExportRecord
} from '../src/state/printingStudio.ts';
import { COMMON_CHARACTERS, INK_COLORS, FONT_SIZES } from '../src/data/characters.ts';

function makeStudio(): PrintingStudio {
  let tick = 0;
  return new PrintingStudio(COMMON_CHARACTERS, () => ++tick);
}

function placeChar(studio: PrintingStudio, charId: string, cell: number): void {
  assert.equal(studio.takeFromRack(charId).ok, true, `取字 ${charId} 应成功`);
  assert.equal(studio.placeOnGrid(cell).ok, true, `落位 ${charId} -> ${cell} 应成功`);
}

function assertConsistent(studio: PrintingStudio): void {
  assert.deepEqual(studio.checkInvariants(), [], '状态不变量必须全部成立');
}

describe('字架取字与版盘落位：字符归属唯一性', () => {
  it('取字后字符离开字架且全库唯一，落位后归属版盘唯一格位', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    assert.equal(studio.takeFromRack(target.id).ok, true);
    assert.equal(studio.locationOf(target.id)?.where, 'held');
    assert.equal(studio.rack.some((item) => item.id === target.id), false);
    assertConsistent(studio);

    assert.equal(studio.placeOnGrid(0).ok, true);
    assert.deepEqual(studio.locationOf(target.id), { where: 'grid', position: 0 });
    assert.equal(studio.grid[0]?.id, target.id);
    assert.equal(studio.grid.filter((cell) => cell?.id === target.id).length, 1);
    assertConsistent(studio);
  });

  it('每个字模实例在字架/持字/版盘中最多出现一次', () => {
    const studio = makeStudio();
    const ids = studio.rack.slice(0, 10).map((item) => item.id);
    ids.forEach((id, index) => placeChar(studio, id, index));
    const allLocations = ids.map((id) => studio.locationOf(id));
    assert.equal(allLocations.every((loc) => loc?.where === 'grid'), true);
    assert.equal(new Set(studio.grid.filter(Boolean).map((cell) => cell!.id)).size, 10);
    assertConsistent(studio);
  });

  it('同一字符不能从字架取两次', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    assert.equal(studio.takeFromRack(target.id).ok, true);
    const again = studio.takeFromRack(target.id);
    assert.equal(again.ok, false);
    assert.equal(again.reason, FAIL_REASONS.ALREADY_HOLDING);
    assertConsistent(studio);
  });
});

describe('重复放置与取回同步', () => {
  it('已落位字符不能再次放置', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    placeChar(studio, target.id, 3);
    const retry = studio.takeFromRack(target.id);
    assert.equal(retry.ok, false);
    assert.equal(retry.reason, FAIL_REASONS.CHARACTER_ALREADY_PLACED);
    assert.equal(studio.grid[3]?.id, target.id);
    assertConsistent(studio);
  });

  it('目标格已被占用时拒绝落位且持字状态不变', () => {
    const studio = makeStudio();
    const first = studio.rack[0];
    const second = studio.rack[1];
    placeChar(studio, first.id, 5);
    assert.equal(studio.takeFromRack(second.id).ok, true);
    const result = studio.placeOnGrid(5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, FAIL_REASONS.CELL_OCCUPIED);
    assert.equal(studio.held?.id, second.id, '落位失败后字模仍应在手中');
    assert.equal(studio.grid[5]?.id, first.id);
    assertConsistent(studio);
  });

  it('从版盘取回后格位释放、position 清除、字符回到字架', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    placeChar(studio, target.id, 7);
    const rackSizeBefore = studio.rack.length;

    assert.equal(studio.returnToRack(7).ok, true);
    assert.equal(studio.grid[7], null, '原格位必须释放');
    assert.equal(target.position, undefined, '取回后 position 必须清除');
    assert.equal(studio.rack.length, rackSizeBefore + 1);
    assert.equal(studio.locationOf(target.id)?.where, 'rack');
    assert.equal(studio.placedCount, 0);
    assertConsistent(studio);
  });

  it('取回后可再次放回任意空格', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    placeChar(studio, target.id, 2);
    assert.equal(studio.returnToRack(2).ok, true);
    placeChar(studio, target.id, 40);
    assert.deepEqual(studio.locationOf(target.id), { where: 'grid', position: 40 });
    assert.equal(studio.grid[40]?.position, 40);
    assertConsistent(studio);
  });

  it('对空格取回与越界取回均被拒绝且不改变状态', () => {
    const studio = makeStudio();
    placeChar(studio, studio.rack[0].id, 0);
    const before = studio.grid.map((cell) => cell?.id ?? null);
    assert.equal(studio.returnToRack(1).reason, FAIL_REASONS.CELL_EMPTY);
    assert.equal(studio.returnToRack(-1).reason, FAIL_REASONS.CELL_OUT_OF_RANGE);
    assert.equal(studio.returnToRack(GRID_CAPACITY).reason, FAIL_REASONS.CELL_OUT_OF_RANGE);
    assert.deepEqual(studio.grid.map((cell) => cell?.id ?? null), before);
    assertConsistent(studio);
  });

  it('版盘内换位同步更新双方 position，越界移动回弹原位', () => {
    const studio = makeStudio();
    const first = studio.rack[0];
    const second = studio.rack[1];
    placeChar(studio, first.id, 0);
    placeChar(studio, second.id, 8);

    assert.equal(studio.moveOnGrid(0, 8).ok, true);
    assert.equal(studio.grid[8]?.id, first.id);
    assert.equal(studio.grid[0]?.id, second.id);
    assert.equal(first.position, 8);
    assert.equal(second.position, 0);

    const bounce = studio.moveOnGrid(8, GRID_CAPACITY + 3);
    assert.equal(bounce.ok, false);
    assert.equal(bounce.reason, FAIL_REASONS.CELL_OUT_OF_RANGE);
    assert.equal(studio.grid[8]?.id, first.id, '越界移动后字模必须留在原位');
    assert.equal(first.position, 8);
    assertConsistent(studio);
  });
});

describe('墨色与字号全局设置一致性', () => {
  it('切换墨色后已落位与后续落位字符表现一致', () => {
    const studio = makeStudio();
    placeChar(studio, studio.rack[0].id, 0);
    placeChar(studio, studio.rack[1].id, 1);
    assert.equal(studio.setInkColor('淡').ok, true);
    placeChar(studio, studio.rack[0].id, 2);

    const view = studio.getPlacedView();
    assert.equal(view.length, 3);
    for (const item of view) {
      assert.equal(item.inkColor, '#666666', `落位 ${item.position} 的墨色必须跟随全局设置`);
      assert.equal(item.inkName, '淡');
    }
    assertConsistent(studio);
  });

  it('切换字号后全部落位字符统一缩放', () => {
    const studio = makeStudio();
    placeChar(studio, studio.rack[0].id, 0);
    assert.equal(studio.setFontSize('特大').ok, true);
    placeChar(studio, studio.rack[0].id, 1);
    const sizes = new Set(studio.getPlacedView().map((item) => item.fontSize));
    assert.deepEqual([...sizes], [52]);
    assertConsistent(studio);
  });

  it('快速连续切换设置后最终状态确定且全局一致', () => {
    const studio = makeStudio();
    for (let index = 0; index < 6; index += 1) {
      placeChar(studio, studio.rack[0].id, index);
    }
    for (let round = 0; round < 50; round += 1) {
      const ink = INK_COLORS[round % INK_COLORS.length];
      const size = FONT_SIZES[round % FONT_SIZES.length];
      assert.equal(studio.setInkColor(ink.name).ok, true);
      assert.equal(studio.setFontSize(size.name).ok, true);
    }
    const expectedInk = INK_COLORS[(50 - 1) % INK_COLORS.length];
    const expectedSize = FONT_SIZES[(50 - 1) % FONT_SIZES.length];
    assert.equal(studio.inkColor.value, expectedInk.value);
    assert.equal(studio.fontSize.value, expectedSize.value);
    for (const item of studio.getPlacedView()) {
      assert.equal(item.inkColor, expectedInk.value);
      assert.equal(item.fontSize, expectedSize.value);
    }
    assertConsistent(studio);
  });

  it('非法墨色与字号被拒绝且当前设置不变', () => {
    const studio = makeStudio();
    const inkBefore = studio.inkColor;
    const sizeBefore = studio.fontSize;
    assert.equal(studio.setInkColor('不存在').reason, FAIL_REASONS.UNKNOWN_INK);
    assert.equal(studio.setFontSize('超大').reason, FAIL_REASONS.UNKNOWN_FONT_SIZE);
    assert.equal(studio.inkColor, inkBefore);
    assert.equal(studio.fontSize, sizeBefore);
    assertConsistent(studio);
  });
});

describe('导出与清空链路', () => {
  it('空版盘导出为合法空记录', () => {
    const studio = makeStudio();
    const record = studio.exportComposition();
    assert.equal(record.sequence, 1);
    assert.deepEqual(record.cells, []);
    assert.equal(record.inkColor.value, studio.inkColor.value);
    assert.equal(record.fontSize.value, studio.fontSize.value);
    assertConsistent(studio);
  });

  it('连续导出结果一致且互不影响', () => {
    const studio = makeStudio();
    placeChar(studio, studio.rack[0].id, 4);
    placeChar(studio, studio.rack[0].id, 9);
    const first = studio.exportComposition();
    const second = studio.exportComposition();
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.deepEqual(
      second.cells.map((cell) => [cell.char, cell.position, cell.inkColor, cell.fontSize]),
      first.cells.map((cell) => [cell.char, cell.position, cell.inkColor, cell.fontSize])
    );
    assert.notEqual(first.exportedAt, second.exportedAt);
    assertConsistent(studio);
  });

  it('导出快照不可变：后续排样与设置切换不污染历史记录', () => {
    const studio = makeStudio();
    placeChar(studio, studio.rack[0].id, 0);
    const snapshot: ExportRecord = studio.exportComposition();
    const snapshotJson = JSON.stringify(snapshot);

    placeChar(studio, studio.rack[0].id, 1);
    studio.setInkColor('清');
    studio.setFontSize('小号');
    studio.clearComposition();

    assert.equal(JSON.stringify(snapshot), snapshotJson, '历史导出记录必须保持导出时刻状态');
    assert.equal(snapshot.cells.length, 1);
    assertConsistent(studio);
  });

  it('导出后清空再排样无旧状态残留', () => {
    const studio = makeStudio();
    const firstBatch = studio.rack.slice(0, 5).map((item) => item.id);
    firstBatch.forEach((id, index) => placeChar(studio, id, index));
    studio.exportComposition();

    assert.equal(studio.clearComposition().ok, true);
    assert.equal(studio.placedCount, 0);
    assert.equal(studio.grid.every((cell) => cell === null), true);
    assert.equal(studio.rack.length, COMMON_CHARACTERS.length, '清空后字架必须完整回收');
    assert.equal(studio.held, null);

    const secondBatch = studio.rack.slice(0, 3).map((item) => item.id);
    secondBatch.forEach((id, index) => placeChar(studio, id, 10 + index));
    const record = studio.exportComposition();
    assert.equal(record.sequence, 2);
    assert.equal(record.cells.length, 3, '新导出不得包含清空前的字符');
    assert.deepEqual(
      record.cells.map((cell) => cell.id).sort(),
      [...secondBatch].sort()
    );
    for (const id of firstBatch) {
      if (!secondBatch.includes(id)) {
        assert.equal(record.cells.some((cell) => cell.id === id), false, `旧字符 ${id} 不得残留`);
      }
    }
    assertConsistent(studio);
  });

  it('清空保留当前墨色与字号设置', () => {
    const studio = makeStudio();
    studio.setInkColor('重');
    studio.setFontSize('大号');
    placeChar(studio, studio.rack[0].id, 0);
    studio.clearComposition();
    assert.equal(studio.inkColor.name, '重');
    assert.equal(studio.fontSize.name, '大号');
    assertConsistent(studio);
  });
});

describe('边界路径', () => {
  it('版盘满格后继续落位被拒绝且状态不变', () => {
    const studio = makeStudio();
    for (let cell = 0; cell < GRID_CAPACITY; cell += 1) {
      placeChar(studio, studio.rack[0].id, cell);
    }
    assert.equal(studio.isGridFull, true);
    assert.equal(studio.placedCount, GRID_CAPACITY);

    const overflow = studio.rack[0];
    assert.equal(studio.takeFromRack(overflow.id).ok, true);
    const snapshot = studio.grid.map((cell) => cell?.id ?? null);
    for (const cell of [0, GRID_CAPACITY - 1]) {
      const result = studio.placeOnGrid(cell);
      assert.equal(result.ok, false);
      assert.equal(result.reason, FAIL_REASONS.GRID_FULL);
    }
    assert.deepEqual(studio.grid.map((cell) => cell?.id ?? null), snapshot, '满格拒绝后版盘不得变化');
    assert.equal(studio.returnHeldToRack().ok, true);
    assertConsistent(studio);
  });

  it('越界格位落位被拒绝', () => {
    const studio = makeStudio();
    assert.equal(studio.takeFromRack(studio.rack[0].id).ok, true);
    assert.equal(studio.placeOnGrid(-1).reason, FAIL_REASONS.CELL_OUT_OF_RANGE);
    assert.equal(studio.placeOnGrid(GRID_CAPACITY).reason, FAIL_REASONS.CELL_OUT_OF_RANGE);
    assert.equal(studio.placedCount, 0);
    assertConsistent(studio);
  });

  it('未取字直接落位被拒绝', () => {
    const studio = makeStudio();
    const result = studio.placeOnGrid(0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, FAIL_REASONS.NOT_HOLDING);
    assertConsistent(studio);
  });

  it('取字后取消（持字回架）不留下中间态', () => {
    const studio = makeStudio();
    const target = studio.rack[0];
    const rackSize = studio.rack.length;
    assert.equal(studio.takeFromRack(target.id).ok, true);
    assert.equal(studio.returnHeldToRack().ok, true);
    assert.equal(studio.held, null);
    assert.equal(studio.rack.length, rackSize);
    assert.equal(studio.locationOf(target.id)?.where, 'rack');
    assertConsistent(studio);
  });

  it('高频混合操作序列后状态保持一致', () => {
    const studio = makeStudio();
    let cursor = 0;
    for (let round = 0; round < 200; round += 1) {
      const step = round % 7;
      if (step === 0 && studio.rack.length > 0 && !studio.held) {
        studio.takeFromRack(studio.rack[0].id);
      } else if (step === 1 && studio.held) {
        studio.placeOnGrid(cursor % GRID_CAPACITY);
        cursor += 3;
      } else if (step === 2) {
        studio.setInkColor(INK_COLORS[round % INK_COLORS.length].name);
      } else if (step === 3) {
        studio.setFontSize(FONT_SIZES[round % FONT_SIZES.length].name);
      } else if (step === 4 && studio.placedCount > 0) {
        const occupied = studio.grid.findIndex((cell) => cell !== null);
        studio.returnToRack(occupied);
      } else if (step === 5) {
        studio.exportComposition();
      } else if (step === 6 && studio.placedCount > 10) {
        studio.clearComposition();
      }
      assertConsistent(studio);
    }
  });
});
