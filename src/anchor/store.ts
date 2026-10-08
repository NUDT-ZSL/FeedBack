/**
 * 批注存储：文档状态 + 批注集合 + 增量维护的正文顺序索引。
 *
 * 顺序索引按"段落桶"组织：每个段落一个按 (start, end, createdAt, id)
 * 排序的批注 id 桶，正文顺序 = 按段落顺序拼接各桶。
 * 文档编辑后只重建受影响段落的桶，不做全量重排；
 * orderedIds / export 均从该索引派生，保证侧栏、正文、导出三者顺序同源。
 */
import {
  anchoredText,
  applyEdit,
  captureAnchor,
  exportAnnotations,
  orderAnnotations,
  orphanedAnnotations,
  reanchorAll,
} from './engine';
import type { Annotation, DocEdit, DocState, ExportEntry } from './types';

export interface StoreOptions {
  now?: () => number;
  genId?: () => string;
}

export interface StoreSnapshot {
  doc: DocState;
  /** 全部批注（含失效），按创建顺序。 */
  annotations: Annotation[];
  /** 正文顺序的 anchored 批注 id（侧栏卡片顺序 = 正文高亮顺序）。 */
  orderedIds: string[];
  /** 失效批注 id（目标文本已删除）。 */
  orphanIds: string[];
  /** 上一次编辑实际重解析的批注 id（增量性指标，用于 UI 展示与测试）。 */
  lastResolvedIds: string[];
}

const defaultNow = () => Date.now();
const defaultGenId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ann-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export class AnnotationStore {
  private doc: DocState;
  private annotations = new Map<string, Annotation>();
  private creationOrder: string[] = [];
  /** paragraphId -> 该段内 anchored 批注 id（有序）。 */
  private buckets = new Map<string, string[]>();
  private orphanIds: string[] = [];
  private lastResolvedIds: string[] = [];

  private now: () => number;
  private genId: () => string;
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot | null = null;

  constructor(doc: DocState, annotations: Annotation[] = [], opts: StoreOptions = {}) {
    this.doc = doc;
    this.now = opts.now ?? defaultNow;
    this.genId = opts.genId ?? defaultGenId;
    for (const ann of annotations) {
      this.annotations.set(ann.id, ann);
      this.creationOrder.push(ann.id);
    }
    this.rebuildIndex();
  }

  /* ---------------- 订阅（供 React useSyncExternalStore） ---------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): StoreSnapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        doc: this.doc,
        annotations: this.creationOrder.map((id) => this.annotations.get(id)!),
        orderedIds: this.flattenOrder(),
        orphanIds: [...this.orphanIds],
        lastResolvedIds: [...this.lastResolvedIds],
      };
    }
    return this.snapshot;
  };

  private emit() {
    this.snapshot = null;
    for (const fn of this.listeners) fn();
  }

  /* ---------------- 顺序索引（增量维护） ---------------- */

  private compareIds(aId: string, bId: string): number {
    const a = this.annotations.get(aId)!;
    const b = this.annotations.get(bId)!;
    if (a.anchor.start !== b.anchor.start) return a.anchor.start - b.anchor.start;
    if (a.anchor.end !== b.anchor.end) return a.anchor.end - b.anchor.end;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  }

  private insertIntoBucket(paragraphId: string, annId: string) {
    const bucket = this.buckets.get(paragraphId) ?? [];
    const idx = bucket.findIndex((id) => this.compareIds(id, annId) > 0);
    bucket.splice(idx === -1 ? bucket.length : idx, 0, annId);
    this.buckets.set(paragraphId, bucket);
  }

  private removeFromBucket(paragraphId: string, annId: string) {
    const bucket = this.buckets.get(paragraphId);
    if (!bucket) return;
    const idx = bucket.indexOf(annId);
    if (idx !== -1) bucket.splice(idx, 1);
    if (bucket.length === 0) this.buckets.delete(paragraphId);
  }

  /** 全量重建索引（仅初始化与 reanchorAll 时调用）。 */
  private rebuildIndex() {
    this.buckets.clear();
    this.orphanIds = [];
    for (const id of this.creationOrder) {
      const ann = this.annotations.get(id)!;
      if (ann.status === 'anchored') this.insertIntoBucket(ann.anchor.paragraphId, id);
      else this.orphanIds.push(id);
    }
    this.orphanIds.sort((a, b) => {
      const ua = this.annotations.get(a)!.updatedAt;
      const ub = this.annotations.get(b)!.updatedAt;
      return ub - ua;
    });
  }

  private flattenOrder(): string[] {
    const out: string[] = [];
    for (const para of this.doc.paragraphs) {
      const bucket = this.buckets.get(para.id);
      if (bucket) out.push(...bucket);
    }
    return out;
  }

  /* ---------------- 批注行为（创建 / 编辑 / 删除，行为保持不变） ---------------- */

  addAnnotation(paragraphId: string, start: number, end: number, body: string): Annotation {
    const anchor = captureAnchor(this.doc, paragraphId, start, end);
    const ts = this.now();
    const ann: Annotation = {
      id: this.genId(),
      anchor,
      body,
      status: 'anchored',
      createdAt: ts,
      updatedAt: ts,
    };
    this.annotations.set(ann.id, ann);
    this.creationOrder.push(ann.id);
    this.insertIntoBucket(paragraphId, ann.id);
    this.emit();
    return ann;
  }

  updateBody(id: string, body: string) {
    const ann = this.annotations.get(id);
    if (!ann) return;
    this.annotations.set(id, { ...ann, body, updatedAt: this.now() });
    this.emit();
  }

  removeAnnotation(id: string) {
    const ann = this.annotations.get(id);
    if (!ann) return;
    if (ann.status === 'anchored') this.removeFromBucket(ann.anchor.paragraphId, id);
    else this.orphanIds = this.orphanIds.filter((x) => x !== id);
    this.annotations.delete(id);
    this.creationOrder = this.creationOrder.filter((x) => x !== id);
    this.emit();
  }

  /* ---------------- 文档编辑（增量重排入口） ---------------- */

  /**
   * 应用文档编辑。引擎只重解析受影响锚点；
   * 顺序索引只重建被触碰段落的桶。返回本次重解析的批注 id。
   */
  applyEdit(edit: DocEdit): string[] {
    const before = new Map(
      [...this.annotations.values()].map((a) => [a.id, a] as const),
    );
    const result = applyEdit(this.doc, [...this.annotations.values()], edit);
    this.doc = result.doc;

    const touchedBuckets = new Set<string>();
    for (const next of result.annotations) {
      const prev = before.get(next.id);
      if (!prev || prev === next) continue;
      this.annotations.set(next.id, next);
      if (prev.status === 'anchored') {
        this.removeFromBucket(prev.anchor.paragraphId, next.id);
        touchedBuckets.add(prev.anchor.paragraphId);
      } else {
        this.orphanIds = this.orphanIds.filter((x) => x !== next.id);
      }
      if (next.status === 'anchored') {
        this.insertIntoBucket(next.anchor.paragraphId, next.id);
        touchedBuckets.add(next.anchor.paragraphId);
      } else {
        this.orphanIds.unshift(next.id);
      }
    }
    // 段内文本编辑可能改变同段多个锚点的相对顺序：只重排被触碰的桶。
    for (const paragraphId of touchedBuckets) {
      const bucket = this.buckets.get(paragraphId);
      if (bucket) bucket.sort((a, b) => this.compareIds(a, b));
    }

    this.lastResolvedIds = result.resolvedIds;
    this.emit();
    return result.resolvedIds;
  }

  /** 全量重算（校验/修复入口）。结果与连续增量编辑一致。 */
  reanchorAll() {
    const anns = reanchorAll(this.doc, [...this.annotations.values()]);
    for (const ann of anns) this.annotations.set(ann.id, ann);
    this.rebuildIndex();
    this.emit();
  }

  /* ---------------- 派生数据（单一事实来源） ---------------- */

  getDoc(): DocState {
    return this.doc;
  }

  getAnnotation(id: string): Annotation | undefined {
    return this.annotations.get(id);
  }

  /** 正文顺序的 anchored 批注（侧栏卡片顺序的数据源）。 */
  orderedAnnotations(): Annotation[] {
    return this.flattenOrder().map((id) => this.annotations.get(id)!);
  }

  orphanedAnnotations(): Annotation[] {
    return this.orphanIds.map((id) => this.annotations.get(id)!);
  }

  /** 导出：与侧栏同一顺序来源，且只含当前有效锚点。 */
  export(): ExportEntry[] {
    const doc = this.doc;
    return this.orderedAnnotations().map((ann) => ({
      id: ann.id,
      body: ann.body,
      paragraphId: ann.anchor.paragraphId,
      start: ann.anchor.start,
      end: ann.anchor.end,
      exact: ann.anchor.exact,
      prefix: ann.anchor.prefix,
      suffix: ann.anchor.suffix,
      createdAt: ann.createdAt,
      updatedAt: ann.updatedAt,
    }));
  }

  /* ---------------- 持久化（离线 localStorage） ---------------- */

  toJSON(): string {
    return JSON.stringify({
      doc: this.doc,
      annotations: this.creationOrder.map((id) => this.annotations.get(id)!),
    });
  }

  static fromJSON(json: string, opts: StoreOptions = {}): AnnotationStore {
    const data = JSON.parse(json) as { doc: DocState; annotations: Annotation[] };
    return new AnnotationStore(data.doc, data.annotations, opts);
  }
}

// 重新导出引擎能力，便于 UI 与测试统一从 store 模块取用。
export { anchoredText, exportAnnotations, orderAnnotations, orphanedAnnotations };
