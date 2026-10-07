import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WoodType } from '../src/types.ts';
import { SealFont, DEFAULT_DRAFT } from '../src/seal/model.ts';
import {
  validateCarveParams,
  minSizeMm,
  maxSizeMm,
  isFontAvailable,
} from '../src/seal/validation.ts';
import { SealWorkshop } from '../src/seal/workshop.ts';

function fixedClock(start = 1_000_000): () => number {
  let t = start;
  return () => (t += 1000);
}

function carveValid(
  ws: SealWorkshop,
  wood: WoodType,
  sizeMm: number,
  font: SealFont,
  text: string,
) {
  ws.beginSeal();
  ws.selectWood(wood);
  ws.setSize(sizeMm);
  ws.setFont(font);
  ws.setText(text);
  const result = ws.carve();
  assert.equal(result.ok, true, `carve should succeed: ${JSON.stringify(result)}`);
  return result.seal!;
}

test('A1: beginSeal 后草稿不继承前一方印的木料/尺寸/字体/文字', () => {
  const ws = new SealWorkshop(fixedClock());
  carveValid(ws, WoodType.Rosewood, 18, SealFont.SealScript, '甲乙');
  ws.beginSeal();
  assert.deepEqual(ws.snapshot().draft, DEFAULT_DRAFT);
});

test('A2: 切换木料类型后校验基于新木料而非旧木料', () => {
  const ws = new SealWorkshop(fixedClock());
  ws.beginSeal();
  ws.selectWood(WoodType.Rosewood);
  ws.setFont(SealFont.SealScript);
  ws.setText('印');
  assert.equal(ws.validateDraft().ok, true);
  ws.selectWood(WoodType.Pine);
  const after = ws.validateDraft();
  assert.equal(after.ok, false);
  assert.ok(after.errors.includes('font-not-supported'));
});

test('A3: 修改尺寸后重新校验，不沿用旧木料的尺寸边界', () => {
  const ws = new SealWorkshop(fixedClock());
  ws.beginSeal();
  ws.selectWood(WoodType.Rosewood);
  ws.setSize(minSizeMm(WoodType.Rosewood));
  ws.setText('印');
  assert.equal(ws.validateDraft().ok, true);
  ws.selectWood(WoodType.Pine);
  const after = ws.validateDraft();
  assert.equal(after.ok, false);
  assert.ok(after.errors.includes('size-too-small'));
});

test('A4: 刻制后修改草稿不影响已刻印快照与已盖印记录', () => {
  const ws = new SealWorkshop(fixedClock());
  const seal = carveValid(ws, WoodType.Boxwood, 20, SealFont.Clerical, '平安');
  const record = ws.stamp(10, 20);
  ws.setText('篡改');
  ws.setSize(99);
  ws.selectWood(WoodType.Pine);
  const snap = ws.snapshot();
  assert.equal(snap.carved!.sealId, seal.sealId);
  assert.deepEqual(snap.carved!.params, {
    wood: WoodType.Boxwood,
    sizeMm: 20,
    font: SealFont.Clerical,
    text: '平安',
  });
  assert.deepEqual(snap.stamps[0], record);
  assert.equal(snap.stamps[0].params.text, '平安');
});

test('A5: 重复盖印同一方印产生递增记录且不互相覆盖', () => {
  const ws = new SealWorkshop(fixedClock());
  const seal = carveValid(ws, WoodType.Pine, 20, SealFont.Regular, '福');
  const r1 = ws.stamp(0, 0);
  const r2 = ws.stamp(5, 5, 15);
  const r3 = ws.stamp(9, 9);
  const stamps = ws.snapshot().stamps;
  assert.equal(stamps.length, 3);
  assert.deepEqual(stamps.map((s) => s.seq), [1, 2, 3]);
  assert.deepEqual(
    stamps.map((s) => s.sealId),
    [seal.sealId, seal.sealId, seal.sealId],
  );
  assert.deepEqual(stamps[0], r1);
  assert.deepEqual(stamps[1], r2);
  assert.deepEqual(stamps[2], r3);
  assert.equal(stamps[1].rotation, 15);
});

test('A6: 连续刻多方印时新印盖印不污染前印记录', () => {
  const ws = new SealWorkshop(fixedClock());
  const seal1 = carveValid(ws, WoodType.Pine, 20, SealFont.Regular, '一');
  ws.stamp(1, 1);
  const seal2 = carveValid(ws, WoodType.Rosewood, 15, SealFont.SealScript, '二');
  ws.stamp(2, 2);
  const stamps = ws.snapshot().stamps;
  assert.equal(stamps.length, 2);
  assert.equal(stamps[0].sealId, seal1.sealId);
  assert.equal(stamps[0].params.text, '一');
  assert.equal(stamps[1].sealId, seal2.sealId);
  assert.equal(stamps[1].params.text, '二');
  assert.equal(stamps[1].params.wood, WoodType.Rosewood);
});

test('B1: 导出后画布、已盖印记录、当前木料与校验结果全部重置', () => {
  const ws = new SealWorkshop(fixedClock());
  carveValid(ws, WoodType.Rosewood, 18, SealFont.SealScript, '出口');
  ws.stamp(3, 4);
  ws.stamp(5, 6);
  const artifact = ws.export();
  assert.equal(artifact.stamps.length, 2);
  assert.equal(artifact.sealCount, 1);
  const snap = ws.snapshot();
  assert.equal(snap.stamps.length, 0);
  assert.equal(snap.carved, null);
  assert.deepEqual(snap.draft, DEFAULT_DRAFT);
  assert.equal(snap.lastValidation, null);
  assert.equal(snap.sealCount, 0);
});

test('B2: 导出清空后立即开始新一方印无残留状态', () => {
  const ws = new SealWorkshop(fixedClock());
  carveValid(ws, WoodType.Rosewood, 18, SealFont.SealScript, '旧');
  ws.stamp(1, 1);
  ws.export();
  const seal = carveValid(ws, WoodType.Pine, 20, SealFont.Regular, '新');
  assert.equal(seal.sealId, 'seal-1');
  const record = ws.stamp(7, 7);
  assert.equal(record.stampId, 'stamp-1');
  assert.equal(record.seq, 1);
  assert.equal(record.params.text, '新');
  assert.equal(ws.snapshot().stamps.length, 1);
});

test('B3: clear 与 export 的状态重置行为一致', () => {
  const build = () => {
    const ws = new SealWorkshop(fixedClock());
    carveValid(ws, WoodType.Boxwood, 22, SealFont.Clerical, '清');
    ws.stamp(1, 2);
    return ws;
  };
  const exported = build();
  exported.export();
  const cleared = build();
  cleared.clear();
  assert.deepEqual(cleared.snapshot(), exported.snapshot());
});

test('B4: 空状态导出返回空产物且不报错', () => {
  const ws = new SealWorkshop(fixedClock());
  const artifact = ws.export();
  assert.equal(artifact.stamps.length, 0);
  assert.equal(artifact.sealCount, 0);
  assert.equal(ws.snapshot().sealCount, 0);
});

test('B5: 未刻制直接盖印抛出错误而非产生脏记录', () => {
  const ws = new SealWorkshop(fixedClock());
  assert.throws(() => ws.stamp(0, 0), /no carved seal/);
  assert.equal(ws.snapshot().stamps.length, 0);
});

test('C1: 各木料尺寸边界值校验稳定（边界合法，越界非法）', () => {
  for (const wood of Object.values(WoodType)) {
    const base = { wood, font: SealFont.Regular, text: '印' };
    assert.equal(validateCarveParams({ ...base, sizeMm: minSizeMm(wood) }).ok, true);
    assert.equal(validateCarveParams({ ...base, sizeMm: maxSizeMm(wood) }).ok, true);
    const below = validateCarveParams({ ...base, sizeMm: minSizeMm(wood) - 0.1 });
    assert.deepEqual(below.errors, ['size-too-small']);
    const above = validateCarveParams({ ...base, sizeMm: maxSizeMm(wood) + 0.1 });
    assert.deepEqual(above.errors, ['size-too-large']);
  }
});

test('C2: 木料属性决定字体可用性', () => {
  assert.equal(isFontAvailable(WoodType.Pine, SealFont.SealScript), false);
  assert.equal(isFontAvailable(WoodType.Pine, SealFont.Clerical), false);
  assert.equal(isFontAvailable(WoodType.Pine, SealFont.Regular), true);
  assert.equal(isFontAvailable(WoodType.Boxwood, SealFont.SealScript), true);
  assert.equal(isFontAvailable(WoodType.Boxwood, SealFont.Clerical), true);
  assert.equal(isFontAvailable(WoodType.Rosewood, SealFont.SealScript), true);
  assert.equal(isFontAvailable(WoodType.Rosewood, SealFont.Clerical), true);
});

test('C3: 校验为纯函数，重复调用结果一致', () => {
  const draft = {
    wood: WoodType.Pine,
    sizeMm: minSizeMm(WoodType.Pine),
    font: SealFont.SealScript,
    text: '印',
  };
  const first = validateCarveParams(draft);
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(validateCarveParams(draft), first);
  }
  assert.deepEqual(draft, {
    wood: WoodType.Pine,
    sizeMm: minSizeMm(WoodType.Pine),
    font: SealFont.SealScript,
    text: '印',
  });
});

test('C4: 批量刻制结果与单次校验逐一一致（木料×尺寸×字体矩阵）', () => {
  const sizes = (wood: WoodType) => [
    minSizeMm(wood) - 0.1,
    minSizeMm(wood),
    (minSizeMm(wood) + maxSizeMm(wood)) / 2,
    maxSizeMm(wood),
    maxSizeMm(wood) + 0.1,
  ];
  for (const wood of Object.values(WoodType)) {
    for (const font of Object.values(SealFont)) {
      for (const sizeMm of sizes(wood)) {
        const draft = { wood, sizeMm, font, text: '验' };
        const expected = validateCarveParams(draft);
        const ws = new SealWorkshop(fixedClock());
        ws.beginSeal();
        ws.selectWood(wood);
        ws.setSize(sizeMm);
        ws.setFont(font);
        ws.setText('验');
        const result = ws.carve();
        assert.equal(
          result.ok,
          expected.ok,
          `mismatch for ${wood}/${font}/${sizeMm}: ${JSON.stringify(expected.errors)}`,
        );
        if (!expected.ok) {
          assert.deepEqual(result.errors, expected.errors);
        }
      }
    }
  }
});

test('C5: 文字长度边界（空/4字/5字）', () => {
  const base = { wood: WoodType.Pine, sizeMm: 20, font: SealFont.Regular };
  assert.ok(validateCarveParams({ ...base, text: '' }).errors.includes('text-empty'));
  assert.equal(validateCarveParams({ ...base, text: '四字印章' }).ok, true);
  assert.ok(validateCarveParams({ ...base, text: '五字印章超' }).errors.includes('text-too-long'));
});
