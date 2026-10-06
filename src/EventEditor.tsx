import React, { useState } from 'react';
import {
  TimelineEvent,
  TimelineBranch,
  EventDependency,
  EventCategory,
  CATEGORY_COLORS,
  CATEGORY_LABELS,
} from './types';

interface EventEditorProps {
  event: TimelineEvent | null;
  events: TimelineEvent[];
  branches: TimelineBranch[];
  dependencies: EventDependency[];
  invalidDependencyIds: Set<string>;
  branchEventCounts: Map<string, number>;
  onChange: (event: TimelineEvent) => void;
  onDelete: (id: string) => void;
  onAddBranch: (parentEventId: string) => void;
  onRemoveBranch: (branchId: string) => void;
  onAddDependency: (fromId: string, toId: string) => void;
  onRemoveDependency: (dependencyId: string) => void;
  onReattach: (eventId: string) => void;
}

const EventEditor: React.FC<EventEditorProps> = ({
  event,
  events,
  branches,
  dependencies,
  invalidDependencyIds,
  branchEventCounts,
  onChange,
  onDelete,
  onAddBranch,
  onRemoveBranch,
  onAddDependency,
  onRemoveDependency,
  onReattach,
}) => {
  const [depTargetId, setDepTargetId] = useState('');
  const [depDirection, setDepDirection] = useState<'after' | 'before'>('after');

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

  const ownBranch = event.branchId
    ? branches.find((b) => b.id === event.branchId)
    : undefined;
  const parentEvent = ownBranch
    ? events.find((e) => e.id === ownBranch.parentEventId)
    : undefined;
  const isOffsetMode = !!event.branchId && event.offsetDays != null;

  const relatedDeps = dependencies.filter(
    (d) => d.fromId === event.id || d.toId === event.id
  );
  const depCandidates = events.filter((e) => e.id !== event.id);

  const handleFieldChange = <K extends keyof TimelineEvent>(
    field: K,
    value: TimelineEvent[K]
  ) => {
    onChange({ ...event, [field]: value });
  };

  const handleAddDependency = () => {
    if (!depTargetId) return;
    if (depDirection === 'after') {
      onAddDependency(depTargetId, event.id);
    } else {
      onAddDependency(event.id, depTargetId);
    }
    setDepTargetId('');
  };

  const titleOf = (id: string) =>
    events.find((e) => e.id === id)?.title || '（已删除事件）';

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
            disabled={isOffsetMode}
            onChange={(e) => handleFieldChange('date', e.target.value)}
          />
          {isOffsetMode && (
            <span className="form-hint">偏移模式下日期由主事件推导，不可直接编辑</span>
          )}
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

        {event.branchId && (
          <div className="branch-section">
            <div className="branch-section-title">时间模式</div>
            {isOffsetMode ? (
              <div className="offset-mode-box">
                <div className="offset-mode-row">
                  <span>相对主事件偏移</span>
                  <input
                    type="number"
                    className="form-input offset-input"
                    value={event.offsetDays ?? 0}
                    onChange={(e) =>
                      handleFieldChange('offsetDays', Number(e.target.value) || 0)
                    }
                  />
                  <span>天</span>
                </div>
                <div className="form-hint">
                  跟随主事件「{parentEvent?.title || '未知'}」改期整体重排
                </div>
                <button
                  className="mode-switch-btn"
                  onClick={() => handleFieldChange('offsetDays', null)}
                >
                  切换为手动定位
                </button>
              </div>
            ) : (
              <div className="offset-mode-box">
                <div className="form-hint">
                  手动定位中：不随主事件「{parentEvent?.title || '未知'}」重排
                </div>
                <button
                  className="mode-switch-btn"
                  onClick={() => onReattach(event.id)}
                >
                  重新挂回偏移模式
                </button>
              </div>
            )}
          </div>
        )}

        <div className="branch-section">
          <div className="branch-section-title">
            先后依赖 ({relatedDeps.length})
          </div>
          <div className="branches-list">
            {relatedDeps.map((dep) => {
              const isInvalid = invalidDependencyIds.has(dep.id);
              const isFrom = dep.fromId === event.id;
              return (
                <div
                  key={dep.id}
                  className={`branch-item dep-item ${isInvalid ? 'is-invalid' : ''}`}
                >
                  <span>
                    {isFrom
                      ? `「${titleOf(dep.toId)}」须晚于本事件`
                      : `本事件须晚于「${titleOf(dep.fromId)}」`}
                    {isInvalid && <em className="dep-invalid-tag">失效</em>}
                  </span>
                  <button
                    className="branch-remove-btn"
                    onClick={() => onRemoveDependency(dep.id)}
                    title="删除依赖"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {relatedDeps.length === 0 && (
              <div className="form-hint">暂无依赖约束</div>
            )}
          </div>
          <div className="dep-add-row">
            <select
              className="form-input"
              value={depDirection}
              onChange={(e) => setDepDirection(e.target.value as 'after' | 'before')}
            >
              <option value="after">本事件晚于</option>
              <option value="before">本事件早于</option>
            </select>
            <select
              className="form-input"
              value={depTargetId}
              onChange={(e) => setDepTargetId(e.target.value)}
            >
              <option value="">选择事件...</option>
              {depCandidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            <button
              className="add-branch-btn dep-add-btn"
              onClick={handleAddDependency}
              disabled={!depTargetId}
            >
              + 添加
            </button>
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
                  <span>
                    {branch.name}
                    <em className="branch-count-tag">
                      {branchEventCounts.get(branch.id) ?? 0} 个事件
                    </em>
                  </span>
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
