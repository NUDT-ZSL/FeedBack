/**
 * 离线文档批注 —— 核心数据模型
 *
 * 设计要点（锚点与重排状态一致性）：
 * - 每个段落拥有创建时即固定的稳定 id（paragraphId），段落增删只改变顺序，不改变 id。
 * - 批注锚点(Anchor)记录“稳定段落 id + 字符偏移 + 目标原文 + 上下文指纹”，
 *   锚点数据本身在编辑过程中不被改写。
 * - ResolvedAnchor 是锚点在“当前文档”上的解析结果（当前段落下标/偏移），
 *   每次编辑仅对受影响批注做增量重算，全量重算可随时复算得到完全相同的结果。
 */

/** 文档段落：id 稳定，text 可编辑。 */
export interface Paragraph {
  id: string;
  text: string;
}

/** 对文档的一次原子编辑：插入段落 / 删除段落 / 修改段落文本。 */
export type EditOp =
  | { type: 'insert'; index: number; paragraph: Paragraph }
  | { type: 'delete'; paragraphId: string }
  | { type: 'update'; paragraphId: string; text: string };

/** 编辑日志条目：记录编辑结果及增量重锚所需的上下文。 */
export interface EditJournalEntry {
  op: EditOp;
  /** insert: 插入位置；delete: 被删段落原下标。 */
  index: number;
  /** delete: 被删除的段落原文（导出/审计可追溯，不用于重锚）。 */
  removedParagraph?: Paragraph;
  /** update: 修改前文本，用于把旧偏移映射到新文本。 */
  oldText?: string;
}

/** 一批编辑构成一个日志，增量重锚的输入。 */
export interface EditJournal {
  entries: EditJournalEntry[];
}

/**
 * 不可变批注锚点。
 * - paragraphId：目标段落稳定 id
 * - start/end：创建时段落内字符偏移（半开区间 [start, end)）
 * - exact：被批注的目标原文快照
 * - prefix/suffix：目标前后的上下文指纹，文本被局部编辑时用于模糊重定位
 */
export interface Anchor {
  paragraphId: string;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export type AnchorStatus = 'resolved' | 'orphaned';

/** 锚点在当前文档上的解析结果。 */
export interface ResolvedAnchor {
  status: AnchorStatus;
  /** orphaned 时为 null。 */
  paragraphId: string | null;
  /** 当前文档中的段落下标，orphaned 时为 -1。 */
  paragraphIndex: number;
  /** 当前段落内偏移，orphaned 时为 -1。 */
  start: number;
  end: number;
}

export interface Annotation {
  id: string;
  anchor: Anchor;
  /** 当前解析结果（增量维护，等价于对当前文档全量重算）。 */
  resolved: ResolvedAnchor;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** 导出条目：只包含仍与当前正文对应的批注。 */
export interface ExportedAnnotation {
  id: string;
  content: string;
  paragraphId: string;
  paragraphIndex: number;
  start: number;
  end: number;
  quote: string;
  createdAt: number;
  updatedAt: number;
}

/** 新建批注时的输入。 */
export interface CreateAnnotationInput {
  anchor: Anchor;
  content: string;
}
