/**
 * 批注锚点一致性 —— 批量离线验证入口
 *
 * 运行：npm run verify
 * 覆盖验收项：
 *  1. 插入段落后锚点不漂移
 *  2. 删除目标段落后批注按预期处理（orphaned，不导出；删除其他段落不受影响）
 *  3. 连续多次编辑后侧栏顺序与正文高亮顺序一致
 *  4. 导出结果与当前锚点一致，无指向已删除文本的条目
 *  5. 增量重锚结果与全量重算一致，且只更新受影响批注
 *  6. 段落文本局部编辑后锚点模糊重定位
 */
import { AnnotationStore } from '../src/annotation/annotationStore.js';
import { resolveAll, makeAnchor } from '../src/annotation/anchorEngine.js';
import { DocumentModel, createParagraph } from '../src/annotation/documentModel.js';
import type { Annotation, EditOp, Paragraph } from '../src/annotation/types.js';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

function docFrom(texts: string[]): DocumentModel {
  return new DocumentModel(texts.map((t) => createParagraph(t)));
}

/** 独立校验：导出条目与当前文档逐条对应。 */
function exportMatchesDocument(
  store: AnnotationStore,
  doc: DocumentModel,
): { ok: boolean; detail: string } {
  const exported = store.export();
  for (const item of exported) {
    const p = doc.paragraphs[item.paragraphIndex];
    if (!p) return { ok: false, detail: `条目 ${item.id} 的段落下标越界` };
    if (p.id !== item.paragraphId) {
      return { ok: false, detail: `条目 ${item.id} 的段落 id 与下标不一致` };
    }
    if (p.text.slice(item.start, item.end) !== item.quote) {
      return {
        ok: false,
        detail: `条目 ${item.id} 的偏移与当前正文不匹配: "${p.text.slice(item.start, item.end)}" != "${item.quote}"`,
      };
    }
  }
  return { ok: true, detail: '' };
}

/** 独立校验：store 顺序 == 按当前文档位置排序。 */
function orderMatchesDocument(store: AnnotationStore): boolean {
  const list = store.ordered();
  const key = (a: Annotation): [number, number] =>
    a.resolved.status === 'resolved'
      ? [a.resolved.paragraphIndex, a.resolved.start]
      : [Number.MAX_SAFE_INTEGER, a.createdAt];
  for (let i = 1; i < list.length; i += 1) {
    const [pi, si] = key(list[i - 1]);
    const [pj, sj] = key(list[i]);
    if (pi > pj || (pi === pj && si > sj)) return false;
  }
  return true;
}

/** 独立校验：增量维护的 resolved 与全量重算逐条一致。 */
function incrementalEqualsFull(store: AnnotationStore, doc: DocumentModel): boolean {
  const full = resolveAll(store.ordered(), doc.paragraphs);
  for (const ann of store.ordered()) {
    const f = full.get(ann.id)!;
    const r = ann.resolved;
    if (
      f.status !== r.status ||
      f.paragraphId !== r.paragraphId ||
      f.paragraphIndex !== r.paragraphIndex ||
      f.start !== r.start ||
      f.end !== r.end
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- 场景 1
section('场景1：插入段落后锚点不漂移');
{
  const doc = docFrom(['第一段：春眠不觉晓。', '第二段：处处闻啼鸟。', '第三段：夜来风雨声。']);
  const store = new AnnotationStore();
  const target = doc.paragraphs[1];
  const start = target.text.indexOf('处处');
  const ann = store.create(
    { anchor: makeAnchor(target, start, start + 4), content: '名句' },
    doc.paragraphs,
  );

  const journal = doc.applyEdits([
    { type: 'insert', index: 0, paragraph: createParagraph('新增：卷首语。') },
    { type: 'insert', index: 2, paragraph: createParagraph('新增：插入到目标段之前。') },
  ]);
  store.applyJournal(journal, doc.paragraphs);

  const r = store.get(ann.id)!.resolved;
  check('锚点仍指向原段落 id', r.paragraphId === target.id);
  check('段落下标随插入后移 2 位', r.paragraphIndex === 3, `实际 ${r.paragraphIndex}`);
  check('段内偏移不变', doc.paragraphs[3].text.slice(r.start, r.end) === '处处闻啼');
  check('侧栏顺序与正文一致', orderMatchesDocument(store));
  check('增量结果与全量重算一致', incrementalEqualsFull(store, doc));
}

// ---------------------------------------------------------------- 场景 2
section('场景2：删除段落的处理');
{
  const doc = docFrom(['甲：红豆生南国。', '乙：春来发几枝。', '丙：愿君多采撷。']);
  const store = new AnnotationStore();
  const pB = doc.paragraphs[1];
  const pC = doc.paragraphs[2];
  const annB = store.create(
    { anchor: makeAnchor(pB, 2, 6), content: '批注在乙段' },
    doc.paragraphs,
  );
  const annC = store.create(
    { anchor: makeAnchor(pC, 2, 6), content: '批注在丙段' },
    doc.paragraphs,
  );

  // 2a. 删除非目标段落（甲）：乙、丙上的批注不受影响
  let journal = doc.applyEdits([{ type: 'delete', paragraphId: doc.paragraphs[0].id }]);
  store.applyJournal(journal, doc.paragraphs);
  check(
    '删除相邻段落后批注不漂移',
    store.get(annB.id)!.resolved.status === 'resolved' &&
      store.get(annB.id)!.resolved.paragraphIndex === 0 &&
      doc.paragraphs[0].text.slice(
        store.get(annB.id)!.resolved.start,
        store.get(annB.id)!.resolved.end,
      ) === '春来发几',
  );

  // 2b. 删除目标段落（乙）：批注转为 orphaned，不消失、不错挂
  journal = doc.applyEdits([{ type: 'delete', paragraphId: pB.id }]);
  store.applyJournal(journal, doc.paragraphs);
  const rb = store.get(annB.id)!.resolved;
  check('目标段落被删后批注标记为 orphaned', rb.status === 'orphaned');
  check('orphaned 批注仍保留在列表中（可查看/删除）', store.get(annB.id) !== undefined);
  check('丙段批注不受影响且下标前移', store.get(annC.id)!.resolved.paragraphIndex === 0);

  const exported = store.export();
  check(
    '导出不含指向已删除文本的条目',
    exported.length === 1 && exported[0].id === annC.id,
    `导出 ${exported.length} 条`,
  );
  const m = exportMatchesDocument(store, doc);
  check('导出条目与当前正文一致', m.ok, m.detail);
  check('增量结果与全量重算一致', incrementalEqualsFull(store, doc));
}

// ---------------------------------------------------------------- 场景 3
section('场景3：连续多次编辑后侧栏顺序与正文一致');
{
  const doc = docFrom([
    '其一：床前明月光。',
    '其二：疑是地上霜。',
    '其三：举头望明月。',
    '其四：低头思故乡。',
  ]);
  const store = new AnnotationStore();
  const quotes = ['床前明月', '地上霜', '望明月', '思故乡'];
  const ids: string[] = [];
  doc.paragraphs.forEach((p, i) => {
    const s = p.text.indexOf(quotes[i]);
    const ann = store.create(
      { anchor: makeAnchor(p, s, s + quotes[i].length), content: `批注${i + 1}` },
      doc.paragraphs,
    );
    ids.push(ann.id);
  });

  const xu = createParagraph('序：静夜思组诗。');
  const bu = createParagraph('补：明月几时有。');
  const cha = createParagraph('插：举杯邀明月。');
  const [p0, p1, p2, p3] = doc.paragraphs;
  // 逐步应用：插序 → 删其二 → 中部插补 → 修订序 → 删序 → 前部再插
  const ops: EditOp[] = [
    { type: 'insert', index: 0, paragraph: xu },
    { type: 'delete', paragraphId: p1.id },
    { type: 'insert', index: 3, paragraph: bu },
    { type: 'update', paragraphId: xu.id, text: '序：静夜思组诗（修订）。' },
    { type: 'delete', paragraphId: xu.id },
    { type: 'insert', index: 1, paragraph: cha },
  ];
  for (const op of ops) {
    const journal = doc.applyEdits([op]);
    store.applyJournal(journal, doc.paragraphs);
    if (!orderMatchesDocument(store)) break;
  }

  check('每次编辑后侧栏顺序均与正文一致', orderMatchesDocument(store));
  check('被删段落（其二）的批注已 orphaned', store.get(ids[1])!.resolved.status === 'orphaned');
  void p3;
  check(
    '其余批注仍解析到原段落',
    [ids[0], ids[2], ids[3]].every((id) => store.get(id)!.resolved.status === 'resolved'),
  );
  // 正文高亮出现顺序 == 侧栏顺序（resolved 部分）
  const highlightOrder = store
    .ordered()
    .filter((a) => a.resolved.status === 'resolved')
    .map((a) => `${a.resolved.paragraphIndex}:${a.resolved.start}`);
  const sorted = [...highlightOrder].sort((x, y) => {
    const [pi, si] = x.split(':').map(Number);
    const [pj, sj] = y.split(':').map(Number);
    return pi - pj || si - sj;
  });
  check('侧栏卡片顺序 == 正文高亮顺序', JSON.stringify(highlightOrder) === JSON.stringify(sorted));
  check('增量结果与全量重算一致', incrementalEqualsFull(store, doc));
  const m = exportMatchesDocument(store, doc);
  check('导出结果与当前锚点一致', m.ok, m.detail);
}

// ---------------------------------------------------------------- 场景 4
section('场景4：段落文本局部编辑后的模糊重定位');
{
  const doc = docFrom(['正文：他拿起戥子称量药材，动作娴熟。']);
  const store = new AnnotationStore();
  const p = doc.paragraphs[0];
  const s = p.text.indexOf('戥子');
  const ann = store.create(
    { anchor: makeAnchor(p, s, s + 2), content: '术语：戥子' },
    doc.paragraphs,
  );

  // 在目标文本之前插入内容 → 偏移应后移，仍指向“戥子”
  let journal = doc.applyEdits([
    { type: 'update', paragraphId: p.id, text: '正文：只见他不慌不忙地拿起戥子称量药材，动作娴熟。' },
  ]);
  store.applyJournal(journal, doc.paragraphs);
  let r = store.get(ann.id)!.resolved;
  check(
    '前文插入后锚点后移且不漂移',
    r.status === 'resolved' && doc.paragraphs[0].text.slice(r.start, r.end) === '戥子',
    `解析到 "${doc.paragraphs[0].text.slice(r.start, r.end)}"`,
  );

  // 删除目标文本 → orphaned
  journal = doc.applyEdits([
    { type: 'update', paragraphId: p.id, text: '正文：只见他不慌不忙地称量药材，动作娴熟。' },
  ]);
  store.applyJournal(journal, doc.paragraphs);
  r = store.get(ann.id)!.resolved;
  check('目标文本被删后批注转为 orphaned', r.status === 'orphaned');

  // 文本恢复 → 批注复活
  journal = doc.applyEdits([
    { type: 'update', paragraphId: p.id, text: '正文：只见他拿起戥子，称量药材，动作娴熟。' },
  ]);
  store.applyJournal(journal, doc.paragraphs);
  r = store.get(ann.id)!.resolved;
  check(
    '目标文本恢复后批注重新解析',
    r.status === 'resolved' && doc.paragraphs[0].text.slice(r.start, r.end) === '戥子',
  );
  check('增量结果与全量重算一致', incrementalEqualsFull(store, doc));
}

// ---------------------------------------------------------------- 场景 5
section('场景5：增量重锚的性能与等价性（200 次随机编辑）');
{
  // 可复现的伪随机序列
  let seed = 42;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const base = [
    '第一段：药性平和，味甘。',
    '第二段：君臣佐使，配伍有度。',
    '第三段：文火慢煎，三碗水煎成一碗。',
    '第四段：晨起温服，忌食生冷。',
    '第五段：药材需置阴凉干燥处。',
    '第六段：小儿酌减，孕妇慎用。',
  ];
  const doc = docFrom(base);
  const store = new AnnotationStore();

  // 每段两条批注
  const quotes = ['药性平和', '君臣佐使', '文火慢煎', '晨起温服', '阴凉干燥', '小儿酌减'];
  doc.paragraphs.forEach((p, i) => {
    const s = p.text.indexOf(quotes[i]);
    store.create({ anchor: makeAnchor(p, s, s + quotes[i].length), content: `重点${i}` }, doc.paragraphs);
    store.create({ anchor: makeAnchor(p, 0, 3), content: `段首${i}` }, doc.paragraphs);
  });

  let allEqual = true;
  let orderOk = true;
  let exportOk = true;
  let exportDetail = '';
  let updateOps = 0;
  let selectiveOk = true;

  for (let step = 0; step < 200; step += 1) {
    const roll = rand();
    let op: EditOp;
    if (roll < 0.35 || doc.paragraphs.length < 2) {
      op = {
        type: 'insert',
        index: Math.floor(rand() * (doc.paragraphs.length + 1)),
        paragraph: createParagraph(`插入段落 #${step}：随机文本 ${Math.floor(rand() * 1000)}。`),
      };
    } else if (roll < 0.6) {
      const victim = doc.paragraphs[Math.floor(rand() * doc.paragraphs.length)];
      op = { type: 'delete', paragraphId: victim.id };
    } else {
      const target = doc.paragraphs[Math.floor(rand() * doc.paragraphs.length)];
      const extra = rand() < 0.5 ? `（修订${step}）` : '';
      op = { type: 'update', paragraphId: target.id, text: target.text + extra };
      updateOps += 1;
    }
    const journal = doc.applyEdits([op]);
    store.applyJournal(journal, doc.paragraphs);

    if (op.type === 'update') {
      // 性能：一次 update 最多只应重解析锚定该段的批注（每段至多 2 条）
      const stats = store.stats();
      if (stats.textResolves > 2) selectiveOk = false;
    } else {
      // 性能：insert/delete 不应触发任何段落内文本搜索
      if (store.stats().textResolves !== 0) selectiveOk = false;
    }

    if (!incrementalEqualsFull(store, doc)) {
      allEqual = false;
      break;
    }
    if (!orderMatchesDocument(store)) {
      orderOk = false;
      break;
    }
    const m = exportMatchesDocument(store, doc);
    if (!m.ok) {
      exportOk = false;
      exportDetail = m.detail;
      break;
    }
  }

  check('200 次编辑中增量结果始终与全量重算一致', allEqual);
  check('200 次编辑中侧栏顺序始终与正文一致', orderOk);
  check('200 次编辑中导出始终与当前锚点一致', exportOk, exportDetail);
  check(
    `增量重锚只更新受影响部分（${updateOps} 次文本编辑，insert/delete 零文本搜索）`,
    selectiveOk,
  );
}

// ---------------------------------------------------------------- 汇总
console.log(`\n========================================`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('失败项：');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('全部验证通过 ✔');
