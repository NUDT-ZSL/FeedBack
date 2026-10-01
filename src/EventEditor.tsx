import React from 'react';
import {
  TimelineEvent,
  TimelineBranch,
  EventCategory,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from './types';

interface EventEditorProps {
  event: TimelineEvent | null;
  branches: TimelineBranch[];
  onChange: (event: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onAddBranch: (parentEventId: string) => void;
  onRemoveBranch: (branchId: string) => void;
}

const EventEditor: React.FC<EventEditorProps> = ({
  event,
  branches,
  onChange,
  onDelete,
  onAddBranch,
  onRemoveBranch,
}) => {
  if (!event) {
    return (
      <div className="editor-section">
        <div className="editor-header">
          <h2>事件编辑</h2>
        </div>
        <div className="editor-empty">
          点击时间线上的事件节点
          <br />
          或添加新事件开始编辑
        </div>
      </div>
    );
  }

  const eventBranches = branches.filter((b) => b.parentEventId === event.id);
  const canAddBranch = eventBranches.length < 3 && !event.branchId;

  const handleFieldChange = <K extends keyof TimelineEvent>(
    field: K,
    value: TimelineEvent[K]
  ) => {
    onChange({ ...event, [field]: value });
  };

  return (
    <div className="editor-section">
      <div className="editor-header">
        <h2>事件编辑</h2>
      </div>
      <div className="editor-form">
        <div className="form-group">
          <label className="form-label">标题</label>
          <input
            type="text"
            className="form-input"
            value={event.title}
            onChange={(e) => handleFieldChange('title', e.target.value)}
            placeholder="输入事件标题"
          />
        </div>

        <div className="form-group">
          <label className="form-label">日期</label>
          <input
            type="date"
            className="form-input"
            value={event.date}
            onChange={(e) => handleFieldChange('date', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">描述</label>
          <textarea
            className="form-input"
            value={event.description}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            placeholder="输入事件描述..."
          />
        </div>

        <div className="form-group">
          <label className="form-label">类别</label>
          <select
            className="form-input"
            value={event.category}
            onChange={(e) =>
              handleFieldChange('category', e.target.value as EventCategory)
            }
          >
            {(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="category-color-dot"
              style={{ background: CATEGORY_COLORS[event.category] }}
            />
            <span style={{ fontSize: 12, color: '#888' }}>
              {CATEGORY_LABELS[event.category]}
            </span>
          </div>
        </div>

        {!event.branchId && (
          <div className="branch-section">
            <div className="branch-section-title">
              分支时间线 ({eventBranches.length}/3)
            </div>
            <div className="branches-list">
              {eventBranches.map((branch) => (
                <div key={branch.id} className="branch-item">
                  <span>{branch.name}</span>
                  <button
                    className="branch-remove-btn"
                    onClick={() => onRemoveBranch(branch.id)}
                    title="删除分支"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="add-branch-btn"
              onClick={() => onAddBranch(event.id)}
              disabled={!canAddBranch}
            >
              {canAddBranch ? '+ 添加分支时间线' : '已达最大分支数'}
            </button>
          </div>
        )}

        <button className="delete-btn" onClick={() => onDelete(event.id)}>
          删除事件
        </button>
      </div>
    </div>
  );
};

export default EventEditor;
