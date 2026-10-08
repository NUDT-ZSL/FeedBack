import type {
  Anchor,
  Annotation,
  EditJournal,
  Paragraph,
  ResolvedAnchor,
} from './types.js';

/** 上下文指纹半径（字符数）。 */
export const CONTEXT_RADIUS = 32;

const ORPHAN: ResolvedAnchor = {
  status: 'orphaned',
  paragraphId: null,
  paragraphIndex: -1,
  start: -1,
  end: -1,
};

export function orphanResolved(): ResolvedAnchor {
  return { ...ORPHAN };
}

/** 由当前段落与选区创建锚点（保存目标原文与上下文指纹）。 */
export function makeAnchor(
  paragraph: Paragraph,
  start: number,
  end: number,
): Anchor {
  const s = Math.max(0, Math.min(start, paragraph.text.length));
  const e = Math.max(s, Math.min(end, paragraph.text.length));
  return {
    paragraphId: paragraph.id,
    start: s,
    end: e,
    exact: paragraph.text.slice(s, e),
    prefix: paragraph.text.slice(Math.max(0, s - CONTEXT_RADIUS), s),
    suffix: paragraph.text.slice(e, e + CONTEXT_RADIUS),
  };
}

function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) {
    i += 1;
  }
  return i;
}

/** 在 target 中查找 sub 的所有出现位置。 */
function findOccurrences(text: string, exact: string): number[] {
  if (exact.length === 0) return [];
  const result: number[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(exact, from);
    if (idx === -1) break;
    result.push(idx);
    from = idx + Math.max(1, exact.length);
  }
  return result;
}

/**
 * 在单个段落文本内解析锚点。
 * 1) 原偏移处文本未变 → 直接命中（未编辑段落的 O(1) 快路径）；
 * 2) 否则按目标原文全量查找，唯一出现即命中；
 * 3) 多处出现时，用锚点创建时的上下文指纹打分选最佳，平局取距原偏移最近者；
 * 4) 目标原文消失 → 判定 orphaned。
 */
export function resolveInParagraph(
  anchor: Anchor,
  text: string,
): { status: 'resolved'; start: number; end: number } | { status: 'orphaned' } {
  if (anchor.end <= anchor.start || anchor.exact.length === 0) {
    return { status: 'orphaned' };
  }

  if (
    anchor.start >= 0 &&
    anchor.end <= text.length &&
    text.slice(anchor.start, anchor.end) === anchor.exact
  ) {
    return { status: 'resolved', start: anchor.start, end: anchor.end };
  }

  const occurrences = findOccurrences(text, anchor.exact);
  if (occurrences.length === 0) return { status: 'orphaned' };
  if (occurrences.length === 1) {
    const start = occurrences[0];
    return { status: 'resolved', start, end: start + anchor.exact.length };
  }

  let best = occurrences[0];
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const occ of occurrences) {
    const before = text.slice(0, occ);
    const after = text.slice(occ + anchor.exact.length);
    const prefixScore = commonSuffixLength(before, anchor.prefix);
    const suffixScore = commonPrefixLength(after, anchor.suffix);
    const score = prefixScore + suffixScore;
    const distance = Math.abs(occ - anchor.start);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      bestScore = score;
      bestDistance = distance;
      best = occ;
    }
  }
  return { status: 'resolved', start: best, end: best + anchor.exact.length };
}

/** 全量解析单个锚点（需按稳定 id 在当前文档中定位段落）。 */
export function resolveAnchor(
  anchor: Anchor,
  paragraphs: readonly Paragraph[],
): ResolvedAnchor {
  const paragraphIndex = paragraphs.findIndex((p) => p.id === anchor.paragraphId);
  if (paragraphIndex === -1) return orphanResolved();
  const result = resolveInParagraph(anchor, paragraphs[paragraphIndex].text);
  if (result.status === 'orphaned') return orphanResolved();
  return {
    status: 'resolved',
    paragraphId: anchor.paragraphId,
    paragraphIndex,
    start: result.start,
    end: result.end,
  };
}

/**
 * 全量重算：对每条批注按当前文档重新解析。
 * 作为“正确性基准”，增量结果必须与此完全一致。
 */
export function resolveAll(
  annotations: readonly Annotation[],
  paragraphs: readonly Paragraph[],
): Map<string, ResolvedAnchor> {
  const map = new Map<string, ResolvedAnchor>();
  for (const ann of annotations) {
    map.set(ann.id, resolveAnchor(ann.anchor, paragraphs));
  }
  return map;
}

export interface IncrementalStats {
  /** 发生变化的批注数。 */
  touched: number;
  /** 真正做了段落内文本搜索的锚点数（增量只应作用于受影响段落）。 */
  textResolves: number;
}

/**
 * 增量重锚：根据编辑日志，只更新受影响批注。
 * - insert：原位于插入点之后的解析结果仅做下标 +1（无文本搜索）；
 * - delete：锚定被删段落的批注置为 orphaned，其余下标 -1；
 * - update：仅对锚定该段落的批注做段落内重新解析。
 * 幂等：对结构无影响的日志条目（index === -1）直接跳过。
 */
export function remapIncremental(
  annotations: Annotation[],
  journal: EditJournal,
  currentParagraphs: readonly Paragraph[],
): IncrementalStats {
  const stats: IncrementalStats = { touched: 0, textResolves: 0 };

  const mark = (ann: Annotation, next: ResolvedAnchor): void => {
    const prev = ann.resolved;
    if (
      prev.status !== next.status ||
      prev.paragraphId !== next.paragraphId ||
      prev.paragraphIndex !== next.paragraphIndex ||
      prev.start !== next.start ||
      prev.end !== next.end
    ) {
      ann.resolved = next;
      stats.touched += 1;
    }
  };

  for (const entry of journal.entries) {
    if (entry.index === -1) continue;

    if (entry.op.type === 'insert') {
      const insertAt = entry.index;
      for (const ann of annotations) {
        if (ann.resolved.status === 'resolved' && ann.resolved.paragraphIndex >= insertAt) {
          mark(ann, { ...ann.resolved, paragraphIndex: ann.resolved.paragraphIndex + 1 });
        }
      }
      continue;
    }

    if (entry.op.type === 'delete') {
      const removedAt = entry.index;
      const removedId = entry.op.paragraphId;
      for (const ann of annotations) {
        if (ann.anchor.paragraphId === removedId) {
          mark(ann, orphanResolved());
        } else if (
          ann.resolved.status === 'resolved' &&
          ann.resolved.paragraphIndex > removedAt
        ) {
          mark(ann, { ...ann.resolved, paragraphIndex: ann.resolved.paragraphIndex - 1 });
        }
      }
      continue;
    }

    // update：仅重解析锚定该段落的批注（含当前 orphaned 的，文本恢复时可复活）
    const updatedId = entry.op.paragraphId;
    const paragraph = currentParagraphs.find((p) => p.id === updatedId);
    if (!paragraph) continue;
    const paragraphIndex = currentParagraphs.indexOf(paragraph);
    for (const ann of annotations) {
      if (ann.anchor.paragraphId !== updatedId) continue;
      stats.textResolves += 1;
      const result = resolveInParagraph(ann.anchor, paragraph.text);
      if (result.status === 'orphaned') {
        mark(ann, orphanResolved());
      } else {
        mark(ann, {
          status: 'resolved',
          paragraphId: updatedId,
          paragraphIndex,
          start: result.start,
          end: result.end,
        });
      }
    }
  }

  return stats;
}
