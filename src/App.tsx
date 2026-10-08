/**
 * 离线文档标注工作台。
 *
 * 架构：所有批注状态集中在 AnnotationStore；
 * 文档增删通过 store.applyEdit 进入锚点引擎做增量重排；
 * 侧栏顺序、正文高亮顺序、导出顺序同源（正文顺序索引）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnnotationStore } from './anchor/store';
import DocumentPane from './components/DocumentPane';
import Sidebar from './components/Sidebar';
import { clearSaved, loadStore, saveStore } from './persistence';
import { createSampleDocument } from './sampleDocument';

export default function App() {
  const [store, setStore] = useState<AnnotationStore>(() => loadStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingParagraphId, setEditingParagraphId] = useState<string | null>(null);
  const markElements = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    saveStore(store);
  }, [snapshot, store]);

  const registerMark = (id: string, el: HTMLElement | null) => {
    if (el) markElements.current.set(id, el);
    else markElements.current.delete(id);
  };

  const locate = (id: string) => {
    setSelectedId(id);
    markElements.current
      .get(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const exportAnnotations = () => {
    const data = JSON.stringify(store.export(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'annotations-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    if (!window.confirm('重置为示例文档并清空全部批注？')) return;
    clearSaved();
    setSelectedId(null);
    setEditingParagraphId(null);
    setStore(new AnnotationStore(createSampleDocument()));
  };

  const { doc, annotations, orderedIds, orphanIds, lastResolvedIds } = snapshot;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">离线文档标注工作台</div>
        <div className="app-stats">
          段落 {doc.paragraphs.length} · 批注 {orderedIds.length} · 失效{' '}
          {orphanIds.length} · 上次编辑重解析锚点 {lastResolvedIds.length} 个
        </div>
        <div className="app-actions">
          <button type="button" onClick={() => store.reanchorAll()} title="全量重算所有锚点（结果与增量重排一致）">
            全量校验
          </button>
          <button type="button" className="primary" onClick={exportAnnotations}>
            导出批注
          </button>
          <button type="button" className="danger" onClick={resetAll}>
            重置示例
          </button>
        </div>
      </header>
      <main className="app-main">
        <DocumentPane
          doc={doc}
          annotations={annotations}
          selectedId={selectedId}
          editingParagraphId={editingParagraphId}
          onSelect={setSelectedId}
          onCreateAnnotation={(paragraphId, start, end, body) => {
            const ann = store.addAnnotation(paragraphId, start, end, body);
            setSelectedId(ann.id);
          }}
          onInsertParagraph={(index) => {
            const id = `p-${crypto.randomUUID()}`;
            store.applyEdit({ type: 'insertParagraph', index, paragraph: { id, text: '' } });
            setEditingParagraphId(id);
          }}
          onDeleteParagraph={(paragraphId) => {
            if (window.confirm('删除该段落？其上的批注将标记为失效。')) {
              store.applyEdit({ type: 'deleteParagraph', paragraphId });
            }
          }}
          onUpdateParagraphText={(paragraphId, newText) =>
            store.applyEdit({ type: 'updateParagraphText', paragraphId, newText })
          }
          onEditingParagraphChange={setEditingParagraphId}
          registerMark={registerMark}
        />
        <Sidebar
          ordered={snapshot.orderedIds
            .map((id) => annotations.find((a) => a.id === id)!)
            .filter(Boolean)}
          orphans={snapshot.orphanIds
            .map((id) => annotations.find((a) => a.id === id)!)
            .filter(Boolean)}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onLocate={locate}
          onUpdateBody={(id, body) => store.updateBody(id, body)}
          onRemove={(id) => {
            store.removeAnnotation(id);
            if (selectedId === id) setSelectedId(null);
          }}
        />
      </main>
    </div>
  );
}
