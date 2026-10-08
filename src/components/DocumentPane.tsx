import { useState } from 'react';
import type { Annotation, Paragraph } from '@/annotation/types';

export interface ParagraphSelection {
  paragraphId: string;
  start: number;
  end: number;
}

interface DocumentPaneProps {
  paragraphs: Paragraph[];
  annotations: readonly Annotation[];
  activeAnnotationId: string | null;
  flashParagraphId: string | null;
  onSelection: (sel: ParagraphSelection | null) => void;
  onUpdateParagraph: (paragraphId: string, text: string) => void;
  onInsertAfter: (index: number) => void;
  onDeleteParagraph: (paragraphId: string) => void;
  onActivateAnnotation: (id: string) => void;
}

/** 计算 window 选区相对段落文本的字符偏移（选区需落在该段落内）。 */
function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const measure = (node: Node, offset: number): number => {
    const r = document.createRange();
    r.selectNodeContents(container);
    r.setEnd(node, offset);
    return r.toString().length;
  };
  const start = measure(range.startContainer, range.startOffset);
  const end = measure(range.endContainer, range.endOffset);
  return start < end ? { start, end } : null;
}

interface Segment {
  text: string;
  annotation?: Annotation;
}

function buildSegments(text: string, anns: Annotation[]): Segment[] {
  const sorted = [...anns].sort((a, b) => a.resolved.start - b.resolved.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const ann of sorted) {
    const { start, end } = ann.resolved;
    if (start < cursor || end > text.length) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), annotation: ann });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

export default function DocumentPane(props: DocumentPaneProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  const annotationsByParagraph = new Map<string, Annotation[]>();
  for (const ann of props.annotations) {
    if (ann.resolved.status !== 'resolved' || !ann.resolved.paragraphId) continue;
    const list = annotationsByParagraph.get(ann.resolved.paragraphId) ?? [];
    list.push(ann);
    annotationsByParagraph.set(ann.resolved.paragraphId, list);
  }

  const startEdit = (p: Paragraph) => {
    setEditingId(p.id);
    setDraftText(p.text);
  };

  const commitEdit = () => {
    if (editingId) props.onUpdateParagraph(editingId, draftText);
    setEditingId(null);
  };

  return (
    <div className="doc-pane">
      <h2 className="doc-title">《伤寒杂病论》批注稿</h2>
      <p className="doc-hint">
        选中正文文字即可创建批注；每段支持编辑、在下方插入、删除。编辑后批注锚点自动重定位。
      </p>
      {props.paragraphs.map((p, index) => {
        const anns = annotationsByParagraph.get(p.id) ?? [];
        const segments = buildSegments(p.text, anns);
        return (
          <div
            key={p.id}
            className={`paragraph${props.flashParagraphId === p.id ? ' flash' : ''}`}
            data-paragraph-id={p.id}
          >
            {editingId === p.id ? (
              <div className="paragraph-edit">
                <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} />
                <div className="edit-actions">
                  <button className="btn btn-primary" onClick={commitEdit}>保存</button>
                  <button className="btn" onClick={() => setEditingId(null)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="paragraph-text"
                  onMouseUp={(e) => {
                    const offsets = selectionOffsets(e.currentTarget);
                    props.onSelection(
                      offsets ? { paragraphId: p.id, ...offsets } : null,
                    );
                  }}
                >
                  {segments.map((seg, i) =>
                    seg.annotation ? (
                      <mark
                        key={i}
                        className={`ann${props.activeAnnotationId === seg.annotation.id ? ' active' : ''}`}
                        title={seg.annotation.content}
                        onClick={() => props.onActivateAnnotation(seg.annotation!.id)}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </div>
                <div className="paragraph-actions">
                  <button className="btn" onClick={() => startEdit(p)}>编辑</button>
                  <button className="btn" onClick={() => props.onInsertAfter(index)}>下方插入段落</button>
                  <button className="btn btn-danger" onClick={() => props.onDeleteParagraph(p.id)}>删除段落</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
