import { WoodType } from '../src/types.ts';
import { SealFont, DEFAULT_DRAFT } from '../src/seal/model.ts';
import {
  validateCarveParams,
  minSizeMm,
  maxSizeMm,
  isFontAvailable,
} from '../src/seal/validation.ts';
import { SealWorkshop } from '../src/seal/workshop.ts';

interface ScenarioResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: ScenarioResult[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  results.push({ name, ok: condition, detail: condition ? '' : detail });
}

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
  if (!result.ok) {
    throw new Error(`setup carve failed: ${JSON.stringify(result.errors)}`);
  }
  return result.seal!;
}

function batchCarveIsolation(rounds: number): void {
  for (let round = 0; round < rounds; round += 1) {
    const ws = new SealWorkshop(fixedClock());
    const seal1 = carveValid(ws, WoodType.Rosewood, 18, SealFont.SealScript, '前印');
    ws.stamp(1, 1);
    ws.stamp(2, 2);

    ws.beginSeal();
    check(
      `A-批量[${round}] 新方印草稿不继承前印参数`,
      JSON.stringify(ws.snapshot().draft) === JSON.stringify(DEFAULT_DRAFT),
    );

    const seal2 = carveValid(ws, WoodType.Pine, 20, SealFont.Regular, '后印');
    const stamps = ws.snapshot().stamps;
    check(`A-批量[${round}] 前印两条盖印记录保留`, stamps.length === 2);
    check(
      `A-批量[${round}] 前印盖印记录参数未被后印覆盖`,
      stamps[0].sealId === seal1.sealId &&
        stamps[1].sealId === seal1.sealId &&
        stamps[0].params.text === '前印' &&
        stamps[0].params.wood === WoodType.Rosewood,
    );

    const r3 = ws.stamp(3, 3, 90);
    check(
      `A-批量[${round}] 后印盖印归属新印且序号连续`,
      r3.sealId === seal2.sealId && r3.seq === 3 && ws.snapshot().stamps.length === 3,
    );

    ws.stamp(4, 4);
    ws.stamp(5, 5);
    const repeated = ws.snapshot().stamps;
    check(
      `A-批量[${round}] 重复盖印同一方印5条记录序号唯一`,
      repeated.length === 5 &&
        new Set(repeated.map((s) => s.seq)).size === 5 &&
        repeated.slice(2).every((s) => s.sealId === seal2.sealId),
    );
  }
}

function batchExportClearCycles(cycles: number): void {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const ws = new SealWorkshop(fixedClock());
    carveValid(ws, WoodType.Boxwood, 21, SealFont.Clerical, '导出');
    ws.stamp(6, 6);
    ws.validateDraft();
    const artifact = ws.export();

    check(`B-批量[${cycle}] 导出产物含盖印记录`, artifact.stamps.length === 1);
    const after = ws.snapshot();
    check(
      `B-批量[${cycle}] 导出后记录/木料/校验/画布全部重置`,
      after.stamps.length === 0 &&
        after.carved === null &&
        after.sealCount === 0 &&
        after.lastValidation === null &&
        JSON.stringify(after.draft) === JSON.stringify(DEFAULT_DRAFT),
    );

    const seal = carveValid(ws, WoodType.Pine, 20, SealFont.Regular, '新方');
    const record = ws.stamp(8, 8);
    check(
      `B-批量[${cycle}] 清空后立即新印无残留（ID/序号重新开始）`,
      seal.sealId === 'seal-1' &&
        record.stampId === 'stamp-1' &&
        record.seq === 1 &&
        record.params.text === '新方' &&
        ws.snapshot().stamps.length === 1,
    );
    ws.clear();
    check(`B-批量[${cycle}] clear 后再次完全干净`, ws.snapshot().stamps.length === 0);
    ws.export();
  }
}

function batchValidationMatrix(repeat: number): void {
  const woods = Object.values(WoodType);
  const fonts = Object.values(SealFont);
  let combos = 0;
  for (const wood of woods) {
    for (const font of fonts) {
      for (const sizeMm of [
        minSizeMm(wood) - 0.1,
        minSizeMm(wood),
        minSizeMm(wood) + 0.1,
        maxSizeMm(wood) - 0.1,
        maxSizeMm(wood),
        maxSizeMm(wood) + 0.1,
      ]) {
        combos += 1;
        const draft = { wood, sizeMm, font, text: '矩' };
        const expected = validateCarveParams(draft);
        for (let pass = 0; pass < repeat; pass += 1) {
          const again = validateCarveParams({ ...draft });
          check(
            `C-矩阵 ${wood}/${font}/${sizeMm} 第${pass}次可重复`,
            JSON.stringify(again) === JSON.stringify(expected),
            `expected ${JSON.stringify(expected)} got ${JSON.stringify(again)}`,
          );
        }
        const ws = new SealWorkshop(fixedClock());
        ws.beginSeal();
        ws.selectWood(wood);
        ws.setSize(sizeMm);
        ws.setFont(font);
        ws.setText('矩');
        const carveResult = ws.carve();
        check(
          `C-矩阵 ${wood}/${font}/${sizeMm} 批量刻制与单次校验一致`,
          carveResult.ok === expected.ok &&
            (expected.ok || JSON.stringify(carveResult.errors) === JSON.stringify(expected.errors)),
        );
      }
    }
  }
  check('C-矩阵 字体可用性与硬度/韧性规则一致', (() => {
    return (
      isFontAvailable(WoodType.Pine, SealFont.Regular) &&
      !isFontAvailable(WoodType.Pine, SealFont.SealScript) &&
      !isFontAvailable(WoodType.Pine, SealFont.Clerical) &&
      isFontAvailable(WoodType.Boxwood, SealFont.Clerical) &&
      isFontAvailable(WoodType.Rosewood, SealFont.SealScript)
    );
  })());
  check(`C-矩阵 组合数量 ${woods.length}×${fonts.length}×6=${woods.length * fonts.length * 6}`, combos === woods.length * fonts.length * 6);
}

batchCarveIsolation(10);
batchExportClearCycles(10);
batchValidationMatrix(5);

const failed = results.filter((r) => !r.ok);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`);
}
console.log('');
console.log(`批量验证完成: ${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.error(`失败 ${failed.length} 项`);
  process.exitCode = 1;
}
