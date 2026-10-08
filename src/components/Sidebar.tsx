/**
 * 侧栏：批注卡片列表。卡片顺序直接来自 store 的正文顺序索引，
 * 与正文高亮出现顺序始终一致；失效批注单独分区，不参与导出。
 */
import { useState } from 'react';
import type { Annotation } from '../anchor/types';

interface SidebarProps {
  ordered: Annotation[];
  orphans: Annotation[];
  selectedId: string | null;
  onSelect(id: string): void;
  onLocate(id: string): void;
  onUpdateBody(id: string, body: string): void;
  onRemove(id: string): void;
}

function Quote({ text }: { text: string }) {
  return (
    <div className="card-quote" title={text}>
      “{text.length > 50 ? `${text.slice(0, 50)}…` : text}”
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { ordered, orphans, selectedId, onSelect, onLocate, onUpdateBody, onRemove } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEdit = (ann: Annotation) => {
    setEditingId(ann.id);
    setDraft(ann.body);
  };

  const commitEdit = () => {
    if (editingId) onUpdateBody(editingId, draft.trim() || '');
    setEditingId(null);
  };

  const renderCard = (ann: Annotation, orphaned: boolean) => (
    <div
      key={ann.id}
      className={[
        'ann-card',
        ann.id === selectedId ? 'ann-card-selected' : '',
        orphaned ? 'ann-card-orphan' : '',
      ].join(' ')}
      onClick={() => onSelect(ann.id)}
    >
      <Quote text={ann.anchor.exact} />
      {editingId === ann.id ? (
        <div className="card-editor">
          <textarea
            autoFocus
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="card-actions">
            <button type="button" className="primary" onClick={commitEdit}>
              保存
            </button>
            <button type="button" onClick={() => setEditingId(null)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="card-body">{ann.body}</div>
      )}
      <div className="card-actions">
        {!orphaned && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLocate(ann.id);
            }}
          >
            定位
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            startEdit(ann);
          }}
        >
          编辑
        </button>
        <button
          type="button"
          className="danger"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(ann.id);
          }}
        >
          删除
        </button>
      </div>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-title">批注（{ordered.length}）</div>
      {ordered.length === 0 && (
        <div className="sidebar-empty">在正文中选中一段文字即可创建批注</div>
      )}
      {ordered.map((ann) => renderCard(ann, false))}
      {orphans.length > 0 && (
        <>
          <div className="sidebar-title sidebar-title-orphan">
            已失效（目标文本已删除，{orphans.length}）
          </div>
          {orphans.map((ann) => renderCard(ann, true))}
        </>
      )}
    </aside>
  );
}
