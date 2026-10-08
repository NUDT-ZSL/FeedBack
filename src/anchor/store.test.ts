/**
 * 批注存储验收测试：
 * - 增量维护的顺序索引（侧栏顺序）始终等于全量排序结果；
 * - 连续随机编辑后侧栏顺序 == 正文高亮扫描顺序；
 * - 创建/编辑/删除/导出行为符合预期；
 * - 离线持久化往返一致。
 */
import { describe, expect, it } from 'vitest';
import { exportAnnotations, orderAnnotations } from './engine';
import { AnnotationStore } from './store';
import type { Annotation, DocState } from './types';

let counter = 0;
const opts = { now: () => ++counter, genId: () => `id-${++counter}` };

function docFrom(texts: string[]): DocState {
  return { paragraphs: texts.map((text, i) => ({ id: `p${i}`, text })) };
}

/** 可复现的伪随机数生成器（mulberry32）。 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = [
  '需求文档评审纪要与结论。',
  '锚点必须在段落增删后保持稳定。',
  '侧栏卡片顺序应与正文高亮一致。',
  '连续编辑只更新受影响的锚点。',
  '导出列表不得包含已删除文本的条目。',
  '离线运行不依赖任何外部服务。',
];

describe('顺序索引：增量维护 == 全量排序 == 正文扫描', () => {
  it('固定种子的连续随机编辑序列下三者始终一致', () => {
    const rand = mulberry32(20261008);
    const store = new AnnotationStore(docFrom(TEXTS.slice()), [], opts);

    // 初始随机创建若干批注
    for (let i = 0; i < 10; i++) {
      const doc = store.getDoc();
      const para = doc.paragraphs[Math.floor(rand() * doc.paragraphs.length)];
      if (para.text.length < 4) continue;
      const s = Math.floor(rand() * (para.text.length - 3));
      const len = 1 + Math.floor(rand() * Math.min(6, para.text.length - s));
      store.addAnnotation(para.id, s, s + len, `随机批注${i}`);
    }

    const assertConsistent = () => {
      const doc = store.getDoc();
      const all: Annotation[] = store.getSnapshot().annotations;
      // 侧栏顺序 vs 全量排序
      const storeOrder = store.orderedAnnotations().map((a) => a.id);
      const fullOrder = orderAnnotations(doc, all).map((a) => a.id);
      expect(storeOrder).toEqual(fullOrder);
      // 侧栏顺序 vs 正文高亮扫描顺序
      const scanOrder: string[] = [];
      for (const para of doc.paragraphs) {
        const ids = all
          .filter((a) => a.status === 'anchored' && a.anchor.paragraphId === para.id)
          .sort(
            (a, b) =>
              a.anchor.start - b.anchor.start ||
              a.anchor.end - b.anchor.end ||
              a.createdAt - b.createdAt ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          )
          .map((a) => a.id);
        scanOrder.push(...ids);
      }
      expect(storeOrder).toEqual(scanOrder);
      // 导出：增量顺序与全量导出深比较
      expect(store.export()).toEqual(exportAnnotations(doc, all));
      // 失效区与全量口径一致
      const orphanIds = store.orphanedAnnotations().map((a) => a.id);
      expect(orphanIds.sort()).toEqual(
        all.filter((a) => a.status === 'orphaned').map((a) => a.id).sort(),
      );
    };

    assertConsistent();

    for (let step = 0; step < 60; step++) {
      const doc = store.getDoc();
      const kind = rand();
      if (kind < 0.35) {
        const index = Math.floor(rand() * (doc.paragraphs.length + 1));
        store.applyEdit({
          type: 'insertParagraph',
          index,
          paragraph: { id: `new-${step}`, text: `第${step}步插入的段落，包含稳定文本片段${step % 4}。` },
        });
      } else if (kind < 0.6 && doc.paragraphs.length > 1) {
        const para = doc.paragraphs[Math.floor(rand() * doc.paragraphs.length)];
        store.applyEdit({ type: 'deleteParagraph', paragraphId: para.id });
      } else {
        const para = doc.paragraphs[Math.floor(rand() * doc.paragraphs.length)];
        const mode = Math.floor(rand() * 3);
        let newText = para.text;
        if (mode === 0) newText = `前缀补充${step}：` + para.text;
        else if (mode === 1 && para.text.length > 8) {
          newText = para.text.slice(0, 2) + para.text.slice(6); // 删除若干字符
        } else {
          newText = para.text + `（末尾补充${step}）`;
        }
        store.applyEdit({ type: 'updateParagraphText', paragraphId: para.id, newText });
      }
      assertConsistent();
    }

    // 最终：每个有效锚点确实指向自己的 exact；导出与正文一致
    const doc = store.getDoc();
    for (const entry of store.export()) {
      const para = doc.paragraphs.find((p) => p.id === entry.paragraphId)!;
      expect(para.text.slice(entry.start, entry.end)).toBe(entry.exact);
    }
  }, 20000);

  it('插入段落零重解析，编辑文本只重解析本段锚点', () => {
    const store = new AnnotationStore(docFrom(TEXTS.slice()), [], opts);
    store.addAnnotation('p1', 0, 2, '批注一');
    store.addAnnotation('p2', 0, 2, '批注二');

    expect(
      store.applyEdit({
        type: 'insertParagraph',
        index: 0,
        paragraph: { id: 'h', text: '新段落' },
      }),
    ).toEqual([]);

    const resolved = store.applyEdit({
      type: 'updateParagraphText',
      paragraphId: 'p1',
      newText: '锚点必须在段落增删后保持稳定（强调）。',
    });
    expect(resolved).toHaveLength(1); // 只触碰 p1 上的 1 个锚点
  });
});

describe('批注行为：创建 / 编辑 / 删除', () => {
  it('创建即按正文位置入序；编辑正文不改变锚点；删除即从顺序与导出中移除', () => {
    const store = new AnnotationStore(docFrom(TEXTS.slice()), [], opts);
    const a = store.addAnnotation('p2', 0, 2, '顺序');
    const b = store.addAnnotation('p0', 0, 2, '需求');
    expect(store.orderedAnnotations().map((x) => x.id)).toEqual([b.id, a.id]);

    store.updateBody(a.id, '新的批注正文');
    expect(store.getAnnotation(a.id)!.body).toBe('新的批注正文');
    expect(store.orderedAnnotations().map((x) => x.id)).toEqual([b.id, a.id]);

    store.removeAnnotation(b.id);
    expect(store.orderedAnnotations().map((x) => x.id)).toEqual([a.id]);
    expect(store.export().map((x) => x.id)).toEqual([a.id]);
  });
});

describe('离线持久化', () => {
  it('toJSON/fromJSON 往返后顺序与导出一致', () => {
    const store = new AnnotationStore(docFrom(TEXTS.slice()), [], opts);
    store.addAnnotation('p1', 2, 4, '一');
    store.addAnnotation('p1', 8, 10, '二');
    store.addAnnotation('p3', 0, 2, '三');
    store.applyEdit({ type: 'deleteParagraph', paragraphId: 'p0' });

    const restored = AnnotationStore.fromJSON(store.toJSON(), opts);
    expect(restored.orderedAnnotations().map((a) => a.id)).toEqual(
      store.orderedAnnotations().map((a) => a.id),
    );
    expect(restored.export()).toEqual(store.export());
  });
});
