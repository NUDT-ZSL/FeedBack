/**
 * 文档标注工作台 —— 核心数据模型。
 *
 * 设计要点：批注不再保存"全局偏移"，而是保存"稳健锚点"：
 * 段落稳定 id + 段内偏移 + 引用文本（exact）+ 上下文（prefix/suffix）。
 * 文档增删段落后，锚点通过引擎重解析（resolveAnchor）重新定位，
 * 保证锚点始终落在原目标文本上。
 */

/** 文档段落。id 在段落整个生命周期内稳定，插入/删除其他段落不影响它。 */
export interface Paragraph {
  id: string;
  text: string;
}

export interface DocState {
  paragraphs: Paragraph[];
}

/** 稳健锚点（参考 W3C Web Annotation 的 TextQuoteSelector + TextPositionSelector）。 */
export interface Anchor {
  /** 目标段落 id（主定位键）。 */
  paragraphId: string;
  /** 段内字符偏移（含头不含尾）。 */
  start: number;
  end: number;
  /** 创建/最近一次解析时的目标文本，用于校验与重新定位。 */
  exact: string;
  /** 目标文本前的上下文（最多 CONTEXT_LEN 字符）。 */
  prefix: string;
  /** 目标文本后的上下文（最多 CONTEXT_LEN 字符）。 */
  suffix: string;
}

export type AnnotationStatus = 'anchored' | 'orphaned';

export interface Annotation {
  id: string;
  anchor: Anchor;
  /** 批注正文（用户输入的评论内容）。 */
  body: string;
  /**
   * anchored: 锚点当前指向正文中的目标文本；
   * orphaned: 目标文本已被删除，批注保留在侧栏"已失效"区，不参与导出。
   * 状态是终态的：目标文本被删即失效，之后重新出现的相同文本视为新文本。
   */
  status: AnnotationStatus;
  createdAt: number;
  updatedAt: number;
}

/** 文档编辑操作（文档重排的唯一入口）。 */
export type DocEdit =
  | { type: 'insertParagraph'; index: number; paragraph: Paragraph }
  | { type: 'deleteParagraph'; paragraphId: string }
  | { type: 'updateParagraphText'; paragraphId: string; newText: string };

/** 锚点解析结果：在文档中的当前位置。 */
export interface ResolvedPosition {
  paragraphId: string;
  start: number;
  end: number;
}

/** 导出条目：与当前正文锚点一一对应，绝不包含指向已删除文本的条目。 */
export interface ExportEntry {
  id: string;
  body: string;
  paragraphId: string;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
  createdAt: number;
  updatedAt: number;
}
