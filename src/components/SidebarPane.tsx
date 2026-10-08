import { useEffect, useState } from 'react';
import type { Annotation } from '@/annotation/types';
import type { ParagraphSelection } from './DocumentPane';

interface SidebarPaneProps {
  annotations: readonly Annotation[];
  activeAnnotationId: string | null;
  draft: { selection: ParagraphSelection; quote: string } | null;
  onCreateAnnotation: (content: string) => void;
  onCancelDraft: () => void;
  onUpdateContent: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onLocate: (id: string) => void;
}

function AnnotationCard(props: {
  ann: Annotation;
  order: number;
  active: boolean;
  onUpdateContent: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  onLocate: (id: string) => void;
}) {
  const { ann } = props;
  const orphaned = ann.resolved.status === 'orphaned';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(ann.content);

  useEffect(() => {
    if (!editing) setText(ann.content);
  }, [ann.content, editing]);

  return (
    <div
      className={`card${props.active ? ' active' : ''}${orphaned ? ' card-orphaned' : ''}`}
      data-annotation-id={ann.id}
    >
      <div className="card-head">
        <span className="card-order">#{props.order}</span>
        {orphaned ? (
          <span className="badge badge-orphan">已失效（目标文本已删除）</span>
        ) : (
          <span className="badge">第 {ann.resolved.paragraphIndex + 1} 段</span>
        )}
      </div>
      <p
        className={`card-quote${orphaned ? ' card-quote-orphan' : ''}`}
        title={orphaned ? '目标文本已删除' : '点击定位到正文'}
        onClick={() => !orphaned && props.onLocate(ann.id)}
      >
        “{ann.anchor.exact}”
      </p>
      {editing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} />
          <div className="card-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                props.onUpdateContent(ann.id, text);
                setEditing(false);
              }}
            >
              保存
            </button>
            <button className="btn" onClick={() => { setText(ann.content); setEditing(false); }}>
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{ann.content}</p>
          <div className="card-actions">
            <button className="btn" onClick={() => setEditing(true)}>编辑</button>
            <button className="btn btn-danger" onClick={() => props.onDelete(ann.id)}>删除</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function SidebarPane(props: SidebarPaneProps) {
  const [draftContent, setDraftContent] = useState('');

  useEffect(() => {
    setDraftContent('');
  }, [props.draft?.selection.paragraphId, props.draft?.selection.start, props.draft?.selection.end]);

  return (
    <div className="sidebar">
      <h3 className="sidebar-title">批注（按正文顺序）</h3>
      {props.draft && (
        <div className="draft-box">
          <h3>新建批注</h3>
          <p className="card-quote" style={{ cursor: 'default' }}>“{props.draft.quote}”</p>
          <textarea
            autoFocus
            placeholder="输入批注内容…"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
          />
          <div className="draft-actions">
            <button
              className="btn btn-primary"
              disabled={draftContent.trim().length === 0}
              onClick={() => props.onCreateAnnotation(draftContent.trim())}
            >
              创建批注
            </button>
            <button className="btn" onClick={props.onCancelDraft}>取消</button>
          </div>
        </div>
      )}
      <div className="sidebar-list">
        {props.annotations.length === 0 && !props.draft && (
          <div className="empty-hint">暂无批注。在左侧正文中选中一段文字即可创建。</div>
        )}
        {props.annotations.map((ann, i) => (
          <AnnotationCard
            key={ann.id}
            ann={ann}
            order={i + 1}
            active={props.activeAnnotationId === ann.id}
            onUpdateContent={props.onUpdateContent}
            onDelete={props.onDelete}
            onLocate={props.onLocate}
          />
        ))}
      </div>
    </div>
  );
}
