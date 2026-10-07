/**
 * 离线批量验证入口：npm run verify
 * 覆盖：多印章增删切换、参数/历史状态隔离、刷新序列化恢复、盖印预览与导出正确性。
 * 仅依赖纯逻辑模块（无 DOM / React），Node 22 直接运行 TypeScript。
 */
import {
  addSeal,
  canRedo,
  canUndo,
  createWorkshop,
  deserializeWorkshop,
  getActiveSeal,
  redo,
  removeSeal,
  selectSeal,
  serializeWorkshop,
  setStrokeOffset,
  undo,
  updateSeal,
} from '../src/utils/workshopCore.ts';
import type { WorkshopState } from '../src/types/index.ts';
import { generateSealSVG, layoutGlyphs } from '../src/utils/sealGenerator.ts';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name + (detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''));
  }
}

function assert(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

let clock = 1_700_000_000_000;
const now = () => clock++;
const id = (n: number) => `fixed-id-${n}`;

/* ---------- 1. 新增多印：彼此独立、不沿用上一方参数 ---------- */

let ws = createWorkshop();
check('空白工坊无选中印章', ws.activeId === null && ws.seals.length === 0, ws);

ws = addSeal(ws, id(1), now());
const seal1 = getActiveSeal(ws)!;
assert('新增首方即选中', seal1.id, id(1));
assert('新印文字为初始空值', seal1.text, '');
assert('新印字体为初始值', seal1.font, 'xiaozhuan');
assert('新印尺寸为初始值', seal1.size, '1cun');
assert('新印刀法为初始值', seal1.style, 'yangke');
assert('新印无笔画偏移', seal1.strokeOffsets, {});
assert('新印历史为空', seal1.history, { past: [], future: [] });

// 修改第一方印全部参数
ws = updateSeal(ws, id(1), { text: '印章书画', font: 'jiudiezhuan', size: '2cun', style: 'yinke' }, now());
ws = setStrokeOffset(ws, id(1), 0, { x: 12, y: -6 }, now());

// 新增第二方印
ws = addSeal(ws, id(2), now());
const seal2 = getActiveSeal(ws)!;
assert('第二方自动选中', seal2.id, id(2));
check('第二方不沿用第一方文字', seal2.text === '', seal2.text);
check('第二方不沿用第一方字体', seal2.font === 'xiaozhuan', seal2.font);
check('第二方不沿用第一方尺寸', seal2.size === '1cun', seal2.size);
check('第二方不沿用第一方刀法', seal2.style === 'yangke', seal2.style);
check('第二方不沿用第一方偏移', Object.keys(seal2.strokeOffsets).length === 0);

// 第一方状态不受新增影响
const s1After = ws.seals.find((s) => s.id === id(1))!;
assert('第一方文字保留', s1After.text, '印章书画');
assert('第一方偏移保留', s1After.strokeOffsets[0], { x: 12, y: -6 });
assert('第一方历史仍有两条（含偏移）', s1After.history.past.length, 2);

/* ---------- 2. 切换隔离：改 A 不影响 B，来回切换状态各自保留 ---------- */

ws = updateSeal(ws, id(2), { text: '山高水长', font: 'miaozhuan', size: '1.5cun' }, now());
ws = setStrokeOffset(ws, id(2), 1, { x: 0, y: 9 }, now());

ws = selectSeal(ws, id(1));
check('切回第一方文字正确', getActiveSeal(ws)!.text === '印章书画');
ws = updateSeal(ws, id(1), { text: '第一方印' }, now());

ws = selectSeal(ws, id(2));
check('切到第二方文字不被第一方修改波及', getActiveSeal(ws)!.text === '山高水长');
assert('第二方偏移不被波及', getActiveSeal(ws)!.strokeOffsets[1], { x: 0, y: 9 });

/* ---------- 3. 撤销/重做只影响当前印章 ---------- */

check('第二方可撤销', canUndo(ws));
ws = undo(ws);
assert('第二方先撤销偏移修改（文字仍在）', getActiveSeal(ws)!.text, '山高水长');
check('偏移随撤销恢复为无', getActiveSeal(ws)!.strokeOffsets[1] === undefined);
ws = undo(ws);
assert('第二方再次撤销回到空文字', getActiveSeal(ws)!.text, '');
check('撤销后可重做', canRedo(ws));

// 切到第一方：它的历史栈不受第二方撤销影响
ws = selectSeal(ws, id(1));
check('第一方历史独立（仍可撤销最近一次改名）', canUndo(ws));
assert('第一方文字仍为「第一方印」', getActiveSeal(ws)!.text, '第一方印');
ws = undo(ws);
assert('第一方撤销恢复「印章书画」', getActiveSeal(ws)!.text, '印章书画');

// 切回第二方重做，互不干扰
ws = selectSeal(ws, id(2));
ws = redo(ws);
ws = redo(ws);
assert('第二方重做恢复文字与偏移', getActiveSeal(ws)!.text, '山高水长');
assert('第二方重做恢复偏移', getActiveSeal(ws)!.strokeOffsets[1], { x: 0, y: 9 });

// 无历史时撤销是安全空操作
ws = addSeal(ws, id(3), now());
const before = JSON.stringify(ws);
ws = undo(ws);
check('无历史撤销为 no-op', JSON.stringify(ws) === before);
ws = redo(ws);
check('无未来栈重做为 no-op', JSON.stringify(ws) === before);

/* ---------- 4. 删除：自动选中相邻；删空回到引导态 ---------- */

// 当前选中第三方（排在末尾），删除后应选相邻的前者
assert('当前选中第三方', getActiveSeal(ws)!.id, id(3));
ws = removeSeal(ws, id(3));
check('删除末尾选中方后自动选中前一方', ws.activeId === id(2), ws.activeId);
check('删除后剩余两方', ws.seals.length === 2);

// 删除未选中的一方不改变选中
ws = removeSeal(ws, id(1));
check('删除非选中方不改变选中', ws.activeId === id(2));
check('仅剩一方', ws.seals.length === 1);

// 删除不存在的 id 为 no-op
const snapshot = JSON.stringify(ws);
ws = removeSeal(ws, 'not-exist');
check('删除不存在印章为 no-op', JSON.stringify(ws) === snapshot);

ws = removeSeal(ws, id(2));
check('最后一方删除后回到空白引导态', ws.activeId === null && ws.seals.length === 0, ws);

// 删除中间一方时优先后邻
ws = addSeal(addSeal(addSeal(createWorkshop(), id(1), now()), id(2), now()), id(3), now());
ws = selectSeal(ws, id(2));
ws = removeSeal(ws, id(2));
check('删除中间选中方后优先后邻', ws.activeId === id(3), ws.activeId);
assert('印章顺序保持', ws.seals.map((s) => s.id), [id(1), id(3)]);

/* ---------- 5. 刷新恢复：数量/顺序/参数/偏移/历史完整保留 ---------- */

let restored: WorkshopState;
{
  let w = createWorkshop();
  w = addSeal(w, id(1), now());
  w = updateSeal(w, id(1), { text: '甲乙丙丁', font: 'miaozhuan', size: '2cun', style: 'yinke' }, now());
  w = setStrokeOffset(w, id(1), 2, { x: -15, y: 8 }, now());
  w = updateSeal(w, id(1), { text: '甲乙丙' }, now());
  w = addSeal(w, id(2), now());
  w = updateSeal(w, id(2), { text: '戊己庚' }, now());
  w = selectSeal(w, id(1));
  restored = deserializeWorkshop(serializeWorkshop(w));

  assert('恢复后印章数量一致', restored.seals.length, 2);
  assert('恢复后顺序一致', restored.seals.map((s) => s.id), [id(1), id(2)]);
  assert('恢复后选中方一致', restored.activeId, id(1));

  const r1 = restored.seals[0];
  assert('恢复文字', r1.text, '甲乙丙');
  assert('恢复字体', r1.font, 'miaozhuan');
  assert('恢复尺寸', r1.size, '2cun');
  assert('恢复刀法', r1.style, 'yinke');
  assert('恢复笔画偏移（一字不差）', r1.strokeOffsets[2], { x: -15, y: 8 });
  assert('恢复历史 past 长度', r1.history.past.length, 3);
  assert('恢复历史首帧偏移也保留', r1.history.past[2].strokeOffsets[2], { x: -15, y: 8 });
  assert('恢复历史首帧文字', r1.history.past[0].text, '');

  const r2 = restored.seals[1];
  assert('第二方文字恢复', r2.text, '戊己庚');
  assert('第二方为初始字体（不串参数）', r2.font, 'xiaozhuan');
  assert('第二方历史保留', r2.history.past.length, 1);
}

// 恢复后仍可继续撤销，且历史可用
restored = undo(restored);
assert('恢复后撤销得到上一帧文字', getActiveSeal(restored)!.text, '甲乙丙丁');

// 脏数据安全回退
check('null 输入回退空白', deserializeWorkshop(null).seals.length === 0);
check('乱码 JSON 回退空白', deserializeWorkshop('{not-json').seals.length === 0);
const tampered = serializeWorkshop(addSeal(createWorkshop(), id(1), now())).replace('"xiaozhuan"', '"kaiti"');
check('非法字体印章被丢弃', deserializeWorkshop(tampered).seals.length === 0);
{
  const badOffset = {
    version: 1,
    activeId: id(1),
    seals: [
      {
        id: id(1),
        name: 'x',
        createdAt: 1,
        updatedAt: 1,
        text: '印',
        font: 'xiaozhuan',
        size: '1cun',
        style: 'yangke',
        strokeOffsets: { 0: { x: 5, y: 7 }, 9: { x: 1, y: 1 }, a: { x: 1, y: 1 } },
        history: { past: [], future: [] },
      },
    ],
  };
  const safe = deserializeWorkshop(JSON.stringify(badOffset));
  assert('非法序号偏移被清洗，合法偏移保留', safe.seals[0].strokeOffsets, { 0: { x: 5, y: 7 } });
}

/* ---------- 6. 盖印预览 / 导出始终反映当前印章最新状态 ---------- */

{
  let w = createWorkshop();
  w = addSeal(w, id(1), now());
  w = updateSeal(w, id(1), { text: '印章' }, now());
  const a = getActiveSeal(w)!;
  const svgA = generateSealSVG(a, { mode: 'stamp' });
  check('导出包含 2 个字的路径', svgA.split('<path ').length - 1 === 2);
  check('阳刻导出为朱文（红字）', svgA.includes('fill="#b5342a"') && !svgA.includes(`fill="${'#b5342a'}" width`));
  const glyphsA = layoutGlyphs(a);
  assert('布局字数与输入一致', glyphsA.length, 2);
  // 首字章法位置：右上 (0.75, 0.25)，200px → (150, 50)
  assert('章法位置：右上', { x: glyphsA[0].cx, y: glyphsA[0].cy }, { x: 150, y: 50 });
  assert('章法位置：左上', { x: glyphsA[1].cx, y: glyphsA[1].cy }, { x: 50, y: 50 });

  // 修改参数后立即反映
  w = updateSeal(w, id(1), { text: '印', style: 'yinke', size: '2cun' }, now());
  const a2 = getActiveSeal(w)!;
  const svgA2 = generateSealSVG(a2, { mode: 'stamp' });
  check('导出随文字变化刷新', svgA2.split('<path ').length - 1 === 1);
  check('阴刻导出为白文（红底白字）', svgA2.includes('fill="#ffffff"') && svgA2.includes('fill="#b5342a"'));
  check('导出随尺寸变化（400 画布）', svgA2.includes('width="400" height="400"'));
  check('SVG 带印章 id 归属', svgA2.includes(`data-seal-id="${id(1)}"`));

  // 笔画偏移必须体现在导出中
  w = setStrokeOffset(w, id(1), 0, { x: 10, y: -4 }, now());
  const a3 = getActiveSeal(w)!;
  // 400px 首字右上：cx=300, box=200 → base (200,0)，加偏移 (210,-4)
  check('导出反映笔画偏移', generateSealSVG(a3, { mode: 'stamp' }).includes('translate(210.00,-4.00'));

  // 切换到第二方：导出内容是第二方，不残留第一方
  w = addSeal(w, id(2), now());
  w = updateSeal(w, id(2), { text: '山水' }, now());
  const b = getActiveSeal(w)!;
  const svgB = generateSealSVG(b, { mode: 'stamp' });
  check('第二方导出归属自己', svgB.includes(`data-seal-id="${id(2)}"`));
  check('第二方导出不含第一方 id', !svgB.includes(id(1)));
  check('第二方导出为 2 字而非第一方的 1 字', svgB.split('<path ').length - 1 === 2);
  const svgA3 = generateSealSVG(a3, { mode: 'stamp' });
  check('两方导出内容互不相同', svgA3 !== svgB);
  // 第一方内容依旧稳定可取（无状态串扰）
  check('第一方仍是 1 字偏移版', svgA3.split('<path ').length - 1 === 1 && svgA3.includes('translate(210.00,-4.00'));
}

/* ---------- 汇总 ---------- */

console.log(`\n批量验证结果：${passed} 通过，${failed} 失败`);
if (failures.length > 0) {
  console.error('\n失败项：');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('全部关键路径验证通过 ✔');
