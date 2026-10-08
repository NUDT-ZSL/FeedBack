import type { EditJournal, EditJournalEntry, EditOp, Paragraph } from './types.js';

let idCounter = 0;

/** 生成稳定的段落 id（仅依赖内置随机源，离线可用）。 */
export function createParagraphId(): string {
  idCounter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `p_${Date.now().toString(36)}_${idCounter}_${rand}`;
}

export function createParagraph(text: string, id?: string): Paragraph {
  return { id: id ?? createParagraphId(), text };
}

/**
 * 文档模型：维护有序段落，所有编辑都产出 EditJournal，
 * 供锚点引擎做增量重定位（不在此处处理批注）。
 */
export class DocumentModel {
  paragraphs: Paragraph[];

  constructor(paragraphs: Paragraph[] = []) {
    // 外部传入的段落确保有 id 且不重复
    const seen = new Set<string>();
    this.paragraphs = paragraphs.map((p) => {
      if (!p.id || seen.has(p.id)) {
        const fresh = createParagraph(p.text);
        seen.add(fresh.id);
        return fresh;
      }
      seen.add(p.id);
      return { ...p };
    });
  }

  indexOf(paragraphId: string): number {
    return this.paragraphs.findIndex((p) => p.id === paragraphId);
  }

  applyEdit(op: EditOp): EditJournalEntry {
    const entry = this.applyEditMutable(op);
    return entry;
  }

  applyEdits(ops: EditOp[]): EditJournal {
    const entries: EditJournalEntry[] = [];
    for (const op of ops) {
      entries.push(this.applyEditMutable(op));
    }
    return { entries };
  }

  private applyEditMutable(op: EditOp): EditJournalEntry {
    if (op.type === 'insert') {
      const index = Math.max(0, Math.min(op.index, this.paragraphs.length));
      const paragraph = createParagraph(op.paragraph.text, op.paragraph.id);
      this.paragraphs.splice(index, 0, paragraph);
      return { op: { type: 'insert', index, paragraph: { ...paragraph } }, index };
    }

    if (op.type === 'delete') {
      const index = this.indexOf(op.paragraphId);
      if (index === -1) {
        // 幂等：段落已不存在（例如重复删除），不产生结构变化
        return { op, index: -1 };
      }
      const removed = this.paragraphs.splice(index, 1)[0];
      return { op, index, removedParagraph: { ...removed } };
    }

    // update
    const index = this.indexOf(op.paragraphId);
    if (index === -1) {
      return { op, index: -1 };
    }
    const oldText = this.paragraphs[index].text;
    if (oldText === op.text) {
      return { op, index, oldText };
    }
    this.paragraphs[index] = { ...this.paragraphs[index], text: op.text };
    return { op, index, oldText };
  }
}
