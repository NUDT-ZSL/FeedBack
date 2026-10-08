/**
 * 正文面板：渲染段落与高亮，支持选区创建批注、段落级编辑（插入/删除/改文）。
 * 高亮顺序由批注在文档中的位置决定，与侧栏共用同一顺序来源。
 */
import { useMemo, useRef, useState } from 'react';
import type { Annotation, DocState } from '../anchor/types';

export interface PendingSelection {
  paragraphId: string;
  start: number;
  end: number;
  rect: { left: number; top: number };
}

interface DocumentPaneProps {
  doc: DocState;
  annotations: Annotation[];
  selectedId: string | null;
  editingParagraphId: string | null;
  onSelect(id: string): void;
  onCreateAnnotation(paragraphId: string, start: number, end: number, body: string): void;
  onInsertParagraph(index: number): void;
  onDeleteParagraph(paragraphId: string): void;
  onUpdateParagraphText(paragraphId: string, newText: string): void;
  onEditingParagraphChange(paragraphId: string | null): void;
  registerMark(id: string, el: HTMLElement | null): void;
}

interface Segment {
  text: string;
  ann?: Annotation;
}

function buildSegments(text: string, anns: Annotation[]): Segment[] {
  const sorted = anns
    .filter((a) => a.status === 'anchored')
    .slice()
    .sort((a, b) => a.anchor.start - b.anchor.start || a.anchor.end - b.anchor.end);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const ann of sorted) {
    const s = Math.max(cursor, Math.min(ann.anchor.start, text.length));
    const e = Math.max(s, Math.min(ann.anchor.end, text.length));
    if (s > cursor) segments.push({ text: text.slice(cursor, s) });
    if (e > s) segments.push({ text: text.slice(s, e), ann });
    cursor = e;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

export default function DocumentPane(props: DocumentPaneProps) {
  const {
    doc,
    annotations,
    selectedId,
    editingParagraphId,
    onSelect,
    onCreateAnnotation,
    onInsertParagraph,
    onDeleteParagraph,
    onUpdateParagraphText,
    onEditingParagraphChange,
    registerMark,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [draftText, setDraftText] = useState('');

  const byParagraph = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const ann of annotations) {
      if (ann.status !== 'anchored') continue;
      const list = map.get(ann.anchor.paragraphId) ?? [];
      list.push(ann);
      map.set(ann.anchor.paragraphId, list);
    }
    return map;
  }, [annotations]);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    const container = containerRef.current;
    if (!sel || sel.isCollapsed || !container) return;
    const anchorEl =
      sel.anchorNode instanceof Element
        ? sel.anchorNode
        : sel.anchorNode?.parentElement ?? null;
    const focusEl =
      sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement ?? null;
    const paraAnchor = anchorEl?.closest('[data-para-id]');
    const paraFocus = focusEl?.closest('[data-para-id]');
    if (!paraAnchor || paraAnchor !== paraFocus || !container.contains(paraAnchor)) return;
    const paragraphId = paraAnchor.getAttribute('data-para-id')!;
    const start = offsetWithin(
      paraAnchor as HTMLElement,
      sel.anchorNode!,
      sel.anchorOffset,
    );
    const end = offsetWithin(paraAnchor as HTMLElement, sel.focusNode!, sel.focusOffset);
    const s = Math.min(start, end);
    const e = Math.max(start, end);
    if (e <= s) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setPending({
      paragraphId,
      start: s,
      end: e,
      rect: { left: rect.left + rect.width / 2, top: rect.bottom + window.scrollY },
    });
    setDraftBody('');
  };

  const submitAnnotation = () => {
    if (!pending) return;
    const body = draftBody.trim();
    if (!body) return;
    onCreateAnnotation(pending.paragraphId, pending.start, pending.end, body);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="doc-pane" ref={containerRef} onMouseUp={handleMouseUp}>
      {doc.paragraphs.map((para, index) => {
        const anns = byParagraph.get(para.id) ?? [];
        const editing = editingParagraphId === para.id;
        return (
          <div className="para-block" key={para.id}>
            <div className="para-toolbar">
              <button
                type="button"
                title="在上方插入段落"
                onClick={() => onInsertParagraph(index)}
              >
                ↑ 插入
              </button>
              <button
                type="button"
                title="在下方插入段落"
                onClick={() => onInsertParagraph(index + 1)}
              >
                ↓ 插入
              </button>
              <button
                type="button"
                title="编辑本段文本"
                onClick={() => {
                  setDraftText(para.text);
                  onEditingParagraphChange(para.id);
                }}
              >
                编辑
              </button>
              <button
                type="button"
                className="danger"
                title="删除本段（其上的批注将失效）"
                onClick={() => onDeleteParagraph(para.id)}
              >
                删除
              </button>
            </div>
            {editing ? (
              <div className="para-editor">
                <textarea
                  autoFocus
                  value={draftText}
                  rows={Math.max(2, Math.ceil(draftText.length / 40))}
                  onChange={(e) => setDraftText(e.target.value)}
                />
                <div className="para-editor-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      onUpdateParagraphText(para.id, draftText);
                      onEditingParagraphChange(null);
                    }}
                  >
                    保存
                  </button>
                  <button type="button" onClick={() => onEditingParagraphChange(null)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <p className="para-text" data-para-id={para.id}>
                {para.text.length === 0 ? (
                  <span className="para-empty">（空段落，点击“编辑”输入内容）</span>
                ) : (
                  buildSegments(para.text, anns).map((seg, i) =>
                    seg.ann ? (
                      <mark
                        key={seg.ann.id}
                        ref={(el) => registerMark(seg.ann!.id, el)}
                        className={
                          seg.ann.id === selectedId ? 'hl hl-selected' : 'hl'
                        }
                        onClick={() => onSelect(seg.ann!.id)}
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={`t${i}`}>{seg.text}</span>
                    ),
                  )
                )}
              </p>
            )}
          </div>
        );
      })}

      {pending && (
        <div
          className="ann-popover"
          style={{ left: pending.rect.left, top: pending.rect.top + 8 }}
        >
          <div className="ann-popover-quote">
            “
            {(() => {
              const para = doc.paragraphs.find((p) => p.id === pending.paragraphId);
              const text = para ? para.text.slice(pending.start, pending.end) : '';
              return text.length > 40 ? `${text.slice(0, 40)}…` : text;
            })()}
            ”
          </div>
          <textarea
            autoFocus
            placeholder="输入批注内容…"
            value={draftBody}
            rows={3}
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAnnotation();
            }}
          />
          <div className="ann-popover-actions">
            <button type="button" className="primary" onClick={submitAnnotation}>
              添加批注
            </button>
            <button type="button" onClick={() => setPending(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
