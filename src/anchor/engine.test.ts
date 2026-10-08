/**
 * 锚点引擎验收测试：
 * 1. 插入段落后锚点不漂移；
 * 2. 删除目标段落后批注按预期失效（不漂移、不丢失数据、不导出）；
 * 3. 连续多次编辑后顺序正确，且增量重排结果与全量重算严格一致；
 * 4. 导出列表与当前正文锚点一一对应。
 */
import { describe, expect, it } from 'vitest';
import {
  anchoredText,
  applyEdit,
  applyEditToDoc,
  captureAnchor,
  exportAnnotations,
  orderAnnotations,
  reanchorAll,
} from './engine';
import type { Annotation, DocEdit, DocState } from './types';

let seq = 0;
const nextId = () => `ann-${++seq}`;

function docFrom(texts: string[]): DocState {
  return { paragraphs: texts.map((text, i) => ({ id: `p${i}`, text })) };
}

function mkAnn(doc: DocState, paragraphId: string, start: number, end: number, body = ''): Annotation {
  const ts = ++seq;
  return {
    id: nextId(),
    anchor: captureAnchor(doc, paragraphId, start, end),
    body: body || `批注${ts}`,
    status: 'anchored',
    createdAt: ts,
    updatedAt: ts,
  };
}

function annOn(doc: DocState, paragraphId: string, exact: string, body?: string): Annotation {
  const para = doc.paragraphs.find((p) => p.id === paragraphId)!;
  const start = para.text.indexOf(exact);
  if (start < 0) throw new Error(`"${exact}" not in ${paragraphId}`);
  return mkAnn(doc, paragraphId, start, start + exact.length, body);
}

/** 全量重算世界：每次编辑后对所有锚点从头重算。 */
function fullRecompute(doc: DocState, anns: Annotation[], edit: DocEdit) {
  const nextDoc = applyEditToDoc(doc, edit);
  return { doc: nextDoc, anns: reanchorAll(nextDoc, anns) };
}

const strip = (anns: Annotation[]) =>
  anns.map((a) => ({ id: a.id, status: a.status, anchor: a.anchor, body: a.body }));

describe('锚点定位：插入/删除段落后不漂移', () => {
  it('插入段落后，已有批注仍指向原目标文本，且零锚点重解析', () => {
    const doc = docFrom(['第一段：项目启动。', '第二段：锚点稳定性是关键指标。', '第三段：收尾。']);
    const ann = annOn(doc, 'p1', '锚点稳定性');

    let r = applyEdit(doc, [ann], {
      type: 'insertParagraph',
      index: 0,
      paragraph: { id: 'p-new-1', text: '新插入的头部段落。' },
    });
    expect(r.resolvedIds).toEqual([]);
    r = applyEdit(r.doc, r.annotations, {
      type: 'insertParagraph',
      index: 2,
      paragraph: { id: 'p-new-2', text: '新插入的中间段落。' },
    });
    expect(r.resolvedIds).toEqual([]);

    const after = r.annotations[0];
    expect(after.status).toBe('anchored');
    expect(after.anchor.paragraphId).toBe('p1');
    expect(anchoredText(r.doc, after)).toBe('锚点稳定性');
  });

  it('删除非目标段落，批注不受影响', () => {
    const doc = docFrom(['第一段。', '第二段：核心指标必须闭环。', '第三段。']);
    const ann = annOn(doc, 'p1', '核心指标');
    const r = applyEdit(doc, [ann], { type: 'deleteParagraph', paragraphId: 'p0' });
    expect(r.resolvedIds).toEqual([]);
    expect(r.annotations[0].status).toBe('anchored');
    expect(anchoredText(r.doc, r.annotations[0])).toBe('核心指标');
  });

  it('删除目标段落后批注失效：不漂移到相邻段落、不消失、不导出', () => {
    const doc = docFrom(['邻段一：项目背景。', '目标段：验收标准缺失需要补齐。', '邻段二：后续计划。']);
    const target = annOn(doc, 'p1', '验收标准缺失');
    const neighbor = annOn(doc, 'p2', '后续计划');
    const r = applyEdit(doc, [target, neighbor], { type: 'deleteParagraph', paragraphId: 'p1' });

    const [t, n] = r.annotations;
    expect(r.resolvedIds).toEqual([target.id]);
    // 失效而非漂移：不会挂到相邻段落
    expect(t.status).toBe('orphaned');
    expect(t.anchor.paragraphId).toBe('p1');
    // 相邻段落上的批注完全不受影响
    expect(n.status).toBe('anchored');
    expect(anchoredText(r.doc, n)).toBe('后续计划');
    // 顺序与导出均不包含失效批注
    expect(orderAnnotations(r.doc, r.annotations).map((a) => a.id)).toEqual([n.id]);
    expect(exportAnnotations(r.doc, r.annotations).map((e) => e.id)).toEqual([n.id]);
  });

  it('段内文本编辑：锚点跟随目标文本移动', () => {
    const doc = docFrom(['核心指标必须在本季度闭环。']);
    const ann = annOn(doc, 'p0', '本季度');
    const para = doc.paragraphs[0];
    const r = applyEdit(doc, [ann], {
      type: 'updateParagraphText',
      paragraphId: 'p0',
      newText: `（补充说明：经评审确认）${para.text}`,
    });
    expect(r.resolvedIds).toEqual([ann.id]);
    expect(r.annotations[0].status).toBe('anchored');
    expect(anchoredText(r.doc, r.annotations[0])).toBe('本季度');
  });

  it('段内文本编辑：目标文本被删则批注失效', () => {
    const doc = docFrom(['核心指标必须在本季度闭环。']);
    const ann = annOn(doc, 'p0', '本季度');
    const r = applyEdit(doc, [ann], {
      type: 'updateParagraphText',
      paragraphId: 'p0',
      newText: '核心指标必须闭环。',
    });
    expect(r.annotations[0].status).toBe('orphaned');
    expect(exportAnnotations(r.doc, r.annotations)).toEqual([]);
  });

  it('编辑其他段落不会触碰本段锚点', () => {
    const doc = docFrom(['第一段：术语约定。', '第二段：核心指标必须闭环。']);
    const ann = annOn(doc, 'p1', '核心指标');
    const r = applyEdit(doc, [ann], {
      type: 'updateParagraphText',
      paragraphId: 'p0',
      newText: '第一段：术语约定（已更新）。',
    });
    expect(r.resolvedIds).toEqual([]);
    expect(r.annotations[0]).toBe(ann); // 对象引用不变：完全未被触碰
  });
});

describe('增量重排与全量重算一致', () => {
  it('连续多次编辑：每步增量结果 == 全量重算结果，且只重解析受影响锚点', () => {
    const doc0 = docFrom([
      '引言：标注工作台需要稳定的锚点机制。',
      '背景：三轮走查发现术语不一致的问题。',
      '术语：锚点是批注与正文之间的稳定链接。',
      '指标：定位准确率应达到百分之百。',
      '风险：旧偏移会导致批注漂移或丢失。',
      '计划：本周完成锚点引擎重构。',
    ]);
    let anns0 = [
      annOn(doc0, 'p0', '稳定的锚点机制'),
      annOn(doc0, 'p1', '术语不一致'),
      annOn(doc0, 'p2', '稳定链接'),
      annOn(doc0, 'p3', '百分之百'),
      annOn(doc0, 'p4', '批注漂移'),
      annOn(doc0, 'p5', '锚点引擎重构'),
    ];

    const edits: DocEdit[] = [
      { type: 'insertParagraph', index: 0, paragraph: { id: 'x1', text: '新增头部说明段落。' } },
      { type: 'insertParagraph', index: 3, paragraph: { id: 'x2', text: '新增中间过渡段落。' } },
      { type: 'updateParagraphText', paragraphId: 'p3', newText: '指标：定位准确率与召回率都应达到百分之百。' },
      { type: 'deleteParagraph', paragraphId: 'p4' }, // 删除带批注的目标段
      { type: 'updateParagraphText', paragraphId: 'p1', newText: '背景：三轮走查发现术语不一致、口径模糊的问题。' },
      { type: 'insertParagraph', index: 6, paragraph: { id: 'x3', text: '新增尾部附录段落。' } },
      { type: 'deleteParagraph', paragraphId: 'x1' },
      { type: 'updateParagraphText', paragraphId: 'p5', newText: '计划：本周完成锚点引擎重构与增量重排验证。' },
      { type: 'deleteParagraph', paragraphId: 'p0' },
      { type: 'insertParagraph', index: 1, paragraph: { id: 'x4', text: '补充：评审结论已归档。' } },
    ];

    // 增量世界：每步只重解析受影响锚点
    let incDoc = doc0;
    let incAnns = anns0;
    // 全量世界：每步对所有锚点从头重算
    let fullDoc = doc0;
    let fullAnns = anns0;

    let totalResolved = 0;
    let insertCount = 0;

    edits.forEach((edit, step) => {
      const r = applyEdit(incDoc, incAnns, edit);
      incDoc = r.doc;
      incAnns = r.annotations;
      totalResolved += r.resolvedIds.length;
      if (edit.type === 'insertParagraph') {
        insertCount++;
        expect(r.resolvedIds).toEqual([]); // 插入段落零重解析
      }

      const f = fullRecompute(fullDoc, fullAnns, edit);
      fullDoc = f.doc;
      fullAnns = f.anns;

      expect(strip(incAnns)).toEqual(strip(fullAnns));
      expect(incDoc).toEqual(fullDoc);

      // 每一步后：所有 anchored 批注都落在其 exact 上
      for (const ann of incAnns) {
        if (ann.status === 'anchored') {
          expect(anchoredText(incDoc, ann)).toBe(ann.anchor.exact);
        }
      }
      void step;
    });

    // 增量性：总重解析次数远小于"全量重算"的 批注数 × 编辑数
    expect(totalResolved).toBeLessThan(anns0.length * edits.length);
    expect(insertCount).toBeGreaterThan(0);

    // 删除目标段落后：p0 与 p4 上的批注失效，其余仍锚定
    const orphaned = incAnns.filter((a) => a.status === 'orphaned');
    expect(orphaned.map((a) => a.anchor.exact).sort()).toEqual(['批注漂移', '稳定的锚点机制']);
    expect(incAnns.filter((a) => a.status === 'anchored')).toHaveLength(4);
  });
});

describe('侧栏与正文顺序一致', () => {
  it('多次编辑后，批注顺序始终等于正文高亮出现顺序', () => {
    const doc0 = docFrom([
      '甲：需求评审已完成。',
      '乙：锚点重构是本周重点。',
      '丙：导出格式保持不变。',
    ]);
    let anns = [
      annOn(doc0, 'p2', '导出格式'), // 故意按乱序创建
      annOn(doc0, 'p0', '需求评审'),
      annOn(doc0, 'p1', '锚点重构'),
    ];
    let doc = doc0;

    const edits: DocEdit[] = [
      { type: 'insertParagraph', index: 0, paragraph: { id: 'h', text: '头部新增段落。' } },
      { type: 'updateParagraphText', paragraphId: 'p1', newText: '乙：锚点重构（含增量重排）是本周重点。' },
      { type: 'deleteParagraph', paragraphId: 'h' },
      { type: 'insertParagraph', index: 2, paragraph: { id: 'm', text: '中间插入的段落。' } },
    ];
    for (const edit of edits) {
      const r = applyEdit(doc, anns, edit);
      doc = r.doc;
      anns = r.annotations;
    }

    // 期望顺序：按文档段落顺序 + 段内偏移扫描得到
    const expected: string[] = [];
    for (const para of doc.paragraphs) {
      const inPara = anns
        .filter((a) => a.status === 'anchored' && a.anchor.paragraphId === para.id)
        .sort((a, b) => a.anchor.start - b.anchor.start);
      expected.push(...inPara.map((a) => a.id));
    }
    expect(orderAnnotations(doc, anns).map((a) => a.id)).toEqual(expected);
    expect(expected).toHaveLength(3);
  });
});

describe('导出与当前锚点一致', () => {
  it('重排后导出条目与正文一一对应，无指向已删除文本的条目', () => {
    const doc0 = docFrom([
      '第一段：项目启动会已召开。',
      '第二段：关键里程碑需要复核。',
      '第三段：风险登记册待更新。',
    ]);
    let anns = [
      annOn(doc0, 'p0', '项目启动会'),
      annOn(doc0, 'p1', '关键里程碑'),
      annOn(doc0, 'p2', '风险登记册'),
    ];
    let doc = doc0;

    const edits: DocEdit[] = [
      { type: 'insertParagraph', index: 1, paragraph: { id: 'n1', text: '插入：会议纪要已同步。' } },
      { type: 'deleteParagraph', paragraphId: 'p1' }, // 删除带批注的段落
      { type: 'updateParagraphText', paragraphId: 'p2', newText: '第三段：风险登记册与问题日志待更新。' },
    ];
    for (const edit of edits) {
      const r = applyEdit(doc, anns, edit);
      doc = r.doc;
      anns = r.annotations;
    }

    const exported = exportAnnotations(doc, anns);
    // 失效批注不出现在导出中
    expect(exported).toHaveLength(2);
    // 每条导出条目都与当前正文锚点对应
    for (const entry of exported) {
      const para = doc.paragraphs.find((p) => p.id === entry.paragraphId)!;
      expect(para.text.slice(entry.start, entry.end)).toBe(entry.exact);
    }
    // 导出顺序与正文顺序一致
    expect(exported.map((e) => e.exact)).toEqual(['项目启动会', '风险登记册']);
  });
});
