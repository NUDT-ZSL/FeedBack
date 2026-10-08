import { useRef, useState } from 'react';
import DocumentPane, { type ParagraphSelection } from '@/components/DocumentPane';
import SidebarPane from '@/components/SidebarPane';
import { AnnotationStore } from '@/annotation/annotationStore';
import { makeAnchor, resolveAll } from '@/annotation/anchorEngine';
import { createParagraph, DocumentModel } from '@/annotation/documentModel';
import { createSampleParagraphs } from '@/annotation/sampleDocument';
import type { EditOp } from '@/annotation/types';

interface Workbench {
  doc: DocumentModel;
  store: AnnotationStore;
}

export default function Home() {
  const wbRef = useRef<Workbench | null>(null);
  if (!wbRef.current) {
    wbRef.current = {
      doc: new DocumentModel(createSampleParagraphs()),
      store: new AnnotationStore(),
    };
  }
  const wb = wbRef.current;

  const [, setVersion] = useState(0);
  const rerender = () => setVersion((v) => v + 1);

  const [draft, setDraft] = useState<{ selection: ParagraphSelection; quote: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flashParagraphId, setFlashParagraphId] = useState<string | null>(null);
  const [selfCheck, setSelfCheck] = useState<string>('');

  const applyOps = (ops: EditOp[]) => {
    const journal = wb.doc.applyEdits(ops);
    wb.store.applyJournal(journal, wb.doc.paragraphs);
    rerender();
  };

  const handleSelection = (sel: ParagraphSelection | null) => {
    if (!sel) return;
    const paragraph = wb.doc.paragraphs.find((p) => p.id === sel.paragraphId);
    if (!paragraph) return;
    setDraft({ selection: sel, quote: paragraph.text.slice(sel.start, sel.end) });
  };

  const handleCreate = (content: string) => {
    if (!draft) return;
    const paragraph = wb.doc.paragraphs.find((p) => p.id === draft.selection.paragraphId);
    if (!paragraph) return;
    const anchor = makeAnchor(paragraph, draft.selection.start, draft.selection.end);
    const ann = wb.store.create({ anchor, content }, wb.doc.paragraphs);
    setDraft(null);
    setActiveId(ann.id);
    window.getSelection()?.removeAllRanges();
    rerender();
  };

  const handleExport = () => {
    const exported = wb.store.export();
    const payload = {
      exportedAt: new Date().toISOString(),
      document: wb.doc.paragraphs.map((p, i) => ({ index: i, id: p.id, text: p.text })),
      annotations: exported,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 一键自检：增量维护的锚点 vs 全量重算 + 导出与正文逐条比对。 */
  const handleSelfCheck = () => {
    const full = resolveAll(wb.store.ordered(), wb.doc.paragraphs);
    let consistent = true;
    for (const ann of wb.store.ordered()) {
      const f = full.get(ann.id)!;
      const r = ann.resolved;
      if (
        f.status !== r.status ||
        f.paragraphIndex !== r.paragraphIndex ||
        f.start !== r.start ||
        f.end !== r.end
      ) {
        consistent = false;
        break;
      }
    }
    let exportOk = true;
    for (const item of wb.store.export()) {
      const p = wb.doc.paragraphs[item.paragraphIndex];
      if (!p || p.id !== item.paragraphId || p.text.slice(item.start, item.end) !== item.quote) {
        exportOk = false;
        break;
      }
    }
    setSelfCheck(
      consistent && exportOk
        ? `自检通过：${wb.store.size()} 条批注锚点与全量重算一致，导出与正文一致`
        : '自检失败：锚点与全量重算不一致，请运行 npm run verify 排查',
    );
  };

  const handleLocate = (id: string) => {
    const ann = wb.store.get(id);
    if (!ann || ann.resolved.status !== 'resolved' || !ann.resolved.paragraphId) return;
    setActiveId(id);
    setFlashParagraphId(ann.resolved.paragraphId);
    document
      .querySelector(`[data-paragraph-id="${ann.resolved.paragraphId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setFlashParagraphId(null), 1600);
  };

  const resolvedCount = wb.store.ordered().filter((a) => a.resolved.status === 'resolved').length;
  const orphanCount = wb.store.size() - resolvedCount;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>离线文档批注工作台</h1>
        <span className="stat">
          批注 {resolvedCount} 条{orphanCount > 0 ? ` · 已失效 ${orphanCount} 条` : ''} · 段落 {wb.doc.paragraphs.length} 段
        </span>
        <span className="spacer" />
        {selfCheck && <span className="selfcheck">{selfCheck}</span>}
        <button className="btn" onClick={handleSelfCheck}>一致性自检</button>
        <button className="btn btn-primary" onClick={handleExport}>导出批注 JSON</button>
      </header>
      <main className="layout">
        <DocumentPane
          paragraphs={wb.doc.paragraphs}
          annotations={wb.store.ordered()}
          activeAnnotationId={activeId}
          flashParagraphId={flashParagraphId}
          onSelection={handleSelection}
          onUpdateParagraph={(id, text) => applyOps([{ type: 'update', paragraphId: id, text }])}
          onInsertAfter={(index) =>
            applyOps([{ type: 'insert', index: index + 1, paragraph: createParagraph('新段落：在此输入内容。') }])
          }
          onDeleteParagraph={(id) => applyOps([{ type: 'delete', paragraphId: id }])}
          onActivateAnnotation={setActiveId}
        />
        <SidebarPane
          annotations={wb.store.ordered()}
          activeAnnotationId={activeId}
          draft={draft}
          onCreateAnnotation={handleCreate}
          onCancelDraft={() => setDraft(null)}
          onUpdateContent={(id, content) => { wb.store.updateContent(id, content); rerender(); }}
          onDelete={(id) => { wb.store.remove(id); rerender(); }}
          onLocate={handleLocate}
        />
      </main>
    </div>
  );
}
