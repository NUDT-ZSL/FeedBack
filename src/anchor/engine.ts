/**
 * 锚点引擎：负责锚点的创建、文档编辑后的增量重排、全量重算与导出。
 *
 * 一致性约定（本模块的核心不变量）：
 *   applyEdit（增量，只重解析受影响锚点）的结果
 *   与 reanchorAll（全量重算）的结果完全一致。
 *
 * 支撑该不变量的两条规则：
 *   1. 锚点解析 resolveAnchor 是确定性纯函数，只依赖 (文档, 锚点自身数据)；
 *   2. 一次编辑只会改变"受影响集合"内锚点的解析结果——
 *      段落未被触碰的锚点，其解析结果不可能变化
 *      （段内解析只看本段文本；段落 id 只在本段被删除时才会失效，
 *        而那种情况该锚点本身就在受影响集合里）。
 */
import type {
  Anchor,
  Annotation,
  DocEdit,
  DocState,
  ExportEntry,
  ResolvedPosition,
} from './types';

/** 上下文采集长度（字符数）。 */
export const CONTEXT_LEN = 32;

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function paragraphIndex(doc: DocState, paragraphId: string): number {
  return doc.paragraphs.findIndex((p) => p.id === paragraphId);
}

export function getParagraph(doc: DocState, paragraphId: string) {
  return doc.paragraphs.find((p) => p.id === paragraphId);
}

function captureContext(text: string, start: number, end: number) {
  return {
    prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: text.slice(end, end + CONTEXT_LEN),
  };
}

/** 在指定段落上创建稳健锚点（采集目标文本与上下文）。 */
export function captureAnchor(
  doc: DocState,
  paragraphId: string,
  start: number,
  end: number,
): Anchor {
  const para = getParagraph(doc, paragraphId);
  if (!para) throw new Error(`paragraph not found: ${paragraphId}`);
  const s = Math.max(0, Math.min(start, para.text.length));
  const e = Math.max(s, Math.min(end, para.text.length));
  return {
    paragraphId,
    start: s,
    end: e,
    exact: para.text.slice(s, e),
    ...captureContext(para.text, s, e),
  };
}

/* ------------------------------------------------------------------ */
/* 锚点解析（确定性纯函数）                                             */
/* ------------------------------------------------------------------ */

/** 候选位置的上下文匹配得分：prefix 反向最长匹配 + suffix 正向最长匹配。 */
function contextScore(text: string, pos: number, anchor: Anchor): number {
  let score = 0;
  const { prefix, suffix, exact } = anchor;
  for (let i = 1; i <= prefix.length && pos - i >= 0; i++) {
    if (text[pos - i] === prefix[prefix.length - i]) score++;
    else break;
  }
  const after = pos + exact.length;
  for (let i = 0; i < suffix.length && after + i < text.length; i++) {
    if (text[after + i] === suffix[i]) score++;
    else break;
  }
  return score;
}

function findOccurrences(text: string, exact: string): number[] {
  const out: number[] = [];
  if (!exact) return out;
  let idx = text.indexOf(exact);
  while (idx !== -1) {
    out.push(idx);
    idx = text.indexOf(exact, idx + 1);
  }
  return out;
}

/** 在单段文本内按 exact + 上下文打分定位；平局取离原偏移最近者（确定性）。 */
function locateInText(text: string, anchor: Anchor): { start: number } | null {
  const occurrences = findOccurrences(text, anchor.exact);
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) return { start: occurrences[0] };
  let best: { start: number; score: number } | null = null;
  for (const start of occurrences) {
    const score = contextScore(text, start, anchor);
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        Math.abs(start - anchor.start) < Math.abs(best.start - anchor.start))
    ) {
      best = { start, score };
    }
  }
  return best ? { start: best.start } : null;
}

/**
 * 全文档搜索（仅当锚点所属段落已不存在时调用）。
 * 接受条件：exact 在全文档唯一，或最佳候选有上下文证据（score > 0）。
 */
function locateInDoc(doc: DocState, anchor: Anchor): ResolvedPosition | null {
  let total = 0;
  let best: (ResolvedPosition & { score: number }) | null = null;
  for (const para of doc.paragraphs) {
    for (const start of findOccurrences(para.text, anchor.exact)) {
      total++;
      const score = contextScore(para.text, start, anchor);
      if (!best || score > best.score) {
        best = { paragraphId: para.id, start, end: start + anchor.exact.length, score };
      }
    }
  }
  if (total === 0 || !best) return null;
  if (total === 1 || best.score > 0) return best;
  return null;
}

/**
 * 解析锚点在文档中的当前位置。返回 null 表示目标文本已删除（批注失效）。
 * 解析优先级：原位命中 → 段内重定位（引用文本 + 上下文）→
 *            （段落已删除时）全文档搜索。
 */
export function resolveAnchor(doc: DocState, anchor: Anchor): ResolvedPosition | null {
  const para = getParagraph(doc, anchor.paragraphId);
  if (para) {
    if (para.text.slice(anchor.start, anchor.end) === anchor.exact) {
      return { paragraphId: para.id, start: anchor.start, end: anchor.end };
    }
    const hit = locateInText(para.text, anchor);
    if (hit) {
      return { paragraphId: para.id, start: hit.start, end: hit.start + anchor.exact.length };
    }
    return null;
  }
  return locateInDoc(doc, anchor);
}

/** 用解析结果刷新锚点（更新偏移并重新采集上下文）。 */
function refreshAnchor(doc: DocState, anchor: Anchor, pos: ResolvedPosition): Anchor {
  const para = getParagraph(doc, pos.paragraphId);
  const text = para ? para.text : '';
  return {
    ...anchor,
    paragraphId: pos.paragraphId,
    start: pos.start,
    end: pos.end,
    ...captureContext(text, pos.start, pos.end),
  };
}

/* ------------------------------------------------------------------ */
/* 文档编辑 + 增量锚点重排                                              */
/* ------------------------------------------------------------------ */

export function applyEditToDoc(doc: DocState, edit: DocEdit): DocState {
  switch (edit.type) {
    case 'insertParagraph': {
      const paragraphs = doc.paragraphs.slice();
      const index = Math.max(0, Math.min(edit.index, paragraphs.length));
      paragraphs.splice(index, 0, edit.paragraph);
      return { paragraphs };
    }
    case 'deleteParagraph':
      return { paragraphs: doc.paragraphs.filter((p) => p.id !== edit.paragraphId) };
    case 'updateParagraphText':
      return {
        paragraphs: doc.paragraphs.map((p) =>
          p.id === edit.paragraphId ? { ...p, text: edit.newText } : p,
        ),
      };
  }
}

export interface ApplyEditResult {
  doc: DocState;
  annotations: Annotation[];
  /** 本次实际进入重解析（resolveAnchor）的批注 id —— 增量性的可观测证据。 */
  resolvedIds: string[];
  /** 本次编辑影响的段落 id。 */
  affectedParagraphIds: string[];
}

/**
 * 应用一次文档编辑，并增量重排锚点。
 * 只触碰受影响段落上的锚点；其余锚点（含存储偏移）完全不动。
 */
export function applyEdit(
  doc: DocState,
  annotations: Annotation[],
  edit: DocEdit,
): ApplyEditResult {
  const nextDoc = applyEditToDoc(doc, edit);
  const resolvedIds: string[] = [];
  const affectedParagraphIds: string[] = [];

  let nextAnnotations: Annotation[] = annotations;

  const reresolve = (ids: Set<string>) => {
    nextAnnotations = nextAnnotations.map((ann) => {
      if (!ids.has(ann.id) || ann.status !== 'anchored') return ann;
      const pos = resolveAnchor(nextDoc, ann.anchor);
      resolvedIds.push(ann.id);
      if (pos) {
        return { ...ann, anchor: refreshAnchor(nextDoc, ann.anchor, pos), status: 'anchored' };
      }
      return { ...ann, status: 'orphaned' };
    });
  };

  switch (edit.type) {
    case 'insertParagraph': {
      // 段落 id 与段内偏移均稳定：没有任何锚点受影响，零重解析。
      break;
    }
    case 'deleteParagraph': {
      affectedParagraphIds.push(edit.paragraphId);
      const ids = new Set(
        annotations
          .filter((a) => a.status === 'anchored' && a.anchor.paragraphId === edit.paragraphId)
          .map((a) => a.id),
      );
      if (ids.size > 0) reresolve(ids);
      break;
    }
    case 'updateParagraphText': {
      affectedParagraphIds.push(edit.paragraphId);
      const para = getParagraph(doc, edit.paragraphId);
      if (!para || para.text === edit.newText) break;
      // 只有本段上的锚点可能受影响；其他段落的锚点解析结果不可能变化。
      const ids = new Set(
        annotations
          .filter(
            (a) => a.status === 'anchored' && a.anchor.paragraphId === edit.paragraphId,
          )
          .map((a) => a.id),
      );
      if (ids.size > 0) reresolve(ids);
      break;
    }
  }

  return { doc: nextDoc, annotations: nextAnnotations, resolvedIds, affectedParagraphIds };
}

/* ------------------------------------------------------------------ */
/* 全量重算（用于校验增量结果、导入恢复等场景）                            */
/* ------------------------------------------------------------------ */

/** 全量重算所有锚点。orphaned 为终态，不参与重算。 */
export function reanchorAll(doc: DocState, annotations: Annotation[]): Annotation[] {
  return annotations.map((ann) => {
    if (ann.status !== 'anchored') return ann;
    const pos = resolveAnchor(doc, ann.anchor);
    if (pos) {
      return { ...ann, anchor: refreshAnchor(doc, ann.anchor, pos), status: 'anchored' };
    }
    return { ...ann, status: 'orphaned' };
  });
}

/* ------------------------------------------------------------------ */
/* 顺序与导出                                                          */
/* ------------------------------------------------------------------ */

function compareInDocOrder(doc: DocState, a: Annotation, b: Annotation): number {
  const pa = paragraphIndex(doc, a.anchor.paragraphId);
  const pb = paragraphIndex(doc, b.anchor.paragraphId);
  if (pa !== pb) return pa - pb;
  if (a.anchor.start !== b.anchor.start) return a.anchor.start - b.anchor.start;
  if (a.anchor.end !== b.anchor.end) return a.anchor.end - b.anchor.end;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 正文顺序（高亮出现顺序）的单一事实来源：
 * 侧栏卡片顺序与高亮顺序都由它派生，二者天然一致。
 * 只包含 anchored 批注；orphaned 由 UI 单独分区展示。
 */
export function orderAnnotations(doc: DocState, annotations: Annotation[]): Annotation[] {
  return annotations
    .filter((a) => a.status === 'anchored')
    .slice()
    .sort((a, b) => compareInDocOrder(doc, a, b));
}

/** 失效批注（目标文本已删除），按最近更新排序，供侧栏"已失效"区展示。 */
export function orphanedAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations
    .filter((a) => a.status === 'orphaned')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 导出批注列表：按正文顺序，且每条都与当前正文锚点对应；
 * 失效批注（指向已删除文本）不出现在导出结果中。
 */
export function exportAnnotations(doc: DocState, annotations: Annotation[]): ExportEntry[] {
  return orderAnnotations(doc, annotations).map((ann) => ({
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

/** 读取锚点当前指向的正文文本（调试与测试校验用）。 */
export function anchoredText(doc: DocState, ann: Annotation): string | null {
  if (ann.status !== 'anchored') return null;
  const para = getParagraph(doc, ann.anchor.paragraphId);
  if (!para) return null;
  return para.text.slice(ann.anchor.start, ann.anchor.end);
}
