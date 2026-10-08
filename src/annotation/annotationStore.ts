import { remapIncremental, resolveAll, resolveAnchor } from './anchorEngine.js';
import type {
  Annotation,
  CreateAnnotationInput,
  EditJournal,
  ExportedAnnotation,
  Paragraph,
} from './types.js';

let idCounter = 0;

function createAnnotationId(): string {
  idCounter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `a_${Date.now().toString(36)}_${idCounter}_${rand}`;
}

/**
 * 批注存储：单一事实来源。
 * 内部列表始终保持“正文出现顺序”（resolved 优先按段落下标+偏移，
 * orphaned 批注按创建时间附后），侧栏直接按此顺序渲染，无需二次排序。
 */
export class AnnotationStore {
  private annotations: Annotation[] = [];
  private lastStats = { touched: 0, textResolves: 0 };

  private comparator(a: Annotation, b: Annotation): number {
    const ra = a.resolved;
    const rb = b.resolved;
    if (ra.status === 'resolved' && rb.status === 'resolved') {
      if (ra.paragraphIndex !== rb.paragraphIndex) {
        return ra.paragraphIndex - rb.paragraphIndex;
      }
      if (ra.start !== rb.start) return ra.start - rb.start;
    } else if (ra.status !== rb.status) {
      return ra.status === 'resolved' ? -1 : 1;
    }
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  private resort(): void {
    this.annotations.sort((x, y) => this.comparator(x, y));
  }

  create(input: CreateAnnotationInput, paragraphs: readonly Paragraph[]): Annotation {
    const now = Date.now();
    const annotation: Annotation = {
      id: createAnnotationId(),
      anchor: { ...input.anchor },
      resolved: resolveAnchor(input.anchor, paragraphs),
      content: input.content,
      createdAt: now,
      updatedAt: now,
    };
    this.annotations.push(annotation);
    this.resort();
    return annotation;
  }

  updateContent(id: string, content: string): Annotation | undefined {
    const ann = this.annotations.find((x) => x.id === id);
    if (!ann) return undefined;
    ann.content = content;
    ann.updatedAt = Date.now();
    return ann;
  }

  remove(id: string): boolean {
    const idx = this.annotations.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    this.annotations.splice(idx, 1);
    return true;
  }

  /**
   * 文档编辑后调用：按编辑日志增量重锚，只更新受影响批注，
   * 然后按正文顺序重排。结果与 resolveAll 全量重算一致。
   */
  applyJournal(journal: EditJournal, paragraphs: readonly Paragraph[]): void {
    this.lastStats = remapIncremental(this.annotations, journal, paragraphs);
    this.resort();
  }

  /** 全量重算（用于校验增量结果，或从持久化恢复后重建）。 */
  resolveAllNow(paragraphs: readonly Paragraph[]): void {
    const map = resolveAll(this.annotations, paragraphs);
    for (const ann of this.annotations) {
      ann.resolved = map.get(ann.id)!;
    }
    this.resort();
  }

  /** 侧栏/正文渲染顺序：始终按当前正文出现顺序。 */
  ordered(): readonly Annotation[] {
    return this.annotations;
  }

  get(id: string): Annotation | undefined {
    return this.annotations.find((x) => x.id === id);
  }

  size(): number {
    return this.annotations.length;
  }

  /** 最近一次增量重锚的统计（性能验收用）。 */
  stats(): { touched: number; textResolves: number } {
    return { ...this.lastStats };
  }

  /**
   * 导出：仅包含当前仍解析到正文的批注，
   * 条目中的段落下标/偏移与当前文档一致，绝不包含指向已删除文本的条目。
   */
  export(): ExportedAnnotation[] {
    return this.annotations
      .filter((ann) => ann.resolved.status === 'resolved')
      .map((ann) => ({
        id: ann.id,
        content: ann.content,
        paragraphId: ann.resolved.paragraphId!,
        paragraphIndex: ann.resolved.paragraphIndex,
        start: ann.resolved.start,
        end: ann.resolved.end,
        quote: ann.anchor.exact,
        createdAt: ann.createdAt,
        updatedAt: ann.updatedAt,
      }));
  }
}
