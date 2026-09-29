import React, { useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../styles/theme';
import {
  BookstoreEvent,
  EventType,
  Registration,
  getRegistrationCount,
} from '../data/mockData';

interface EventManagerProps {
  events: BookstoreEvent[];
  registrations: Registration[];
  onCreateEvent: (data: Omit<BookstoreEvent, 'id'>) => BookstoreEvent;
  onEditEvent: (id: string, data: Partial<BookstoreEvent>) => void;
  onDeleteEvent: (id: string) => void;
  onSelectEvent: (id: string) => void;
  onCheckInMode: (id: string) => void;
  onViewReport: (id: string) => void;
}

const PAGE_SIZE = 20;

const EVENT_TYPE_OPTIONS: EventType[] = ['读书会', '新书签售', '作者对谈', '手工工作坊'];

const typeColorMap: Record<EventType, string> = {
  '读书会': '#E8D5B7',
  '新书签售': '#C9E4C5',
  '作者对谈': '#B5D3E7',
  '手工工作坊': '#F4C2C2',
};

const typeTextColor: Record<EventType, string> = {
  '读书会': '#6B4C2E',
  '新书签售': '#2E6B3E',
  '作者对谈': '#2E4E6B',
  '手工工作坊': '#6B2E2E',
};

const EventManager: React.FC<EventManagerProps> = ({
  events,
  registrations,
  onCreateEvent,
  onEditEvent,
  onDeleteEvent,
  onSelectEvent,
  onCheckInMode,
  onViewReport,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    type: '读书会' as EventType,
    date: '',
    startTime: '14:00',
    endTime: '16:00',
    maxParticipants: 30,
    description: '',
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const loaderRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().split('T')[0];

  const regCountMap: Record<string, number> = {};
  registrations.forEach(r => {
    regCountMap[r.eventId] = (regCountMap[r.eventId] || 0) + 1;
  });

  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [events.length]);

  const handleScroll = useCallback(() => {
    if (displayCount >= events.length) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    if (scrollTop + clientHeight >= scrollHeight - 200) {
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, events.length));
    }
  }, [displayCount, events.length]);

  useEffect(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = '请输入活动名称';
    if (!formData.date) errors.date = '请选择活动日期';
    else if (formData.date < today) errors.date = '活动日期不能是过去日期';
    if (!formData.startTime) errors.startTime = '请选择开始时间';
    if (!formData.endTime) errors.endTime = '请选择结束时间';
    else if (formData.endTime <= formData.startTime) errors.endTime = '结束时间必须晚于开始时间';
    if (formData.maxParticipants < 10 || formData.maxParticipants > 200) errors.maxParticipants = '参与人数须在10-200之间';
    if (formData.description.length > 300) errors.description = '活动简介不能超过300字';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    if (editingId) {
      onEditEvent(editingId, formData);
      setEditingId(null);
    } else {
      onCreateEvent(formData);
    }
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: '读书会',
      date: '',
      startTime: '14:00',
      endTime: '16:00',
      maxParticipants: 30,
      description: '',
    });
    setFormErrors({});
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (event: BookstoreEvent) => {
    setFormData({
      name: event.name,
      type: event.type,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      maxParticipants: event.maxParticipants,
      description: event.description,
    });
    setEditingId(event.id);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    onDeleteEvent(id);
    setDeleteConfirmId(null);
  };

  const isPast = (date: string) => date < today;
  const isToday = (date: string) => date === today;

  const displayedEvents = events.slice(0, displayCount);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: theme.spacing.lg }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.xl,
        flexWrap: 'wrap',
        gap: theme.spacing.md,
      }}>
        <div>
          <h1 style={{
            fontSize: theme.fonts.size.title,
            color: theme.colors.primary,
            fontWeight: 700,
            marginBottom: 4,
          }}>
            📚 独立书店 · 活动管理
          </h1>
          <p style={{ color: theme.colors.textSecondary, fontSize: theme.fonts.size.sm }}>
            共 {events.length} 场活动 · 滚动加载更多
          </p>
        </div>
        <button
          className="btn-ripple"
          onClick={() => { setShowForm(true); setEditingId(null); resetForm(); }}
          style={{
            background: theme.colors.primary,
            color: '#FFF',
            border: 'none',
            padding: '12px 28px',
            borderRadius: theme.borderRadius.md,
            fontSize: theme.fonts.size.base,
            fontWeight: 500,
            cursor: 'pointer',
            transition: `transform ${theme.transition.fast}, background ${theme.transition.fast}`,
            boxShadow: theme.shadow.button,
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          + 创建活动
        </button>
      </div>

      {showForm && (
        <div style={{
          background: theme.colors.cardBg,
          borderRadius: theme.borderRadius.md,
          padding: theme.spacing.xl,
          marginBottom: theme.spacing.xl,
          boxShadow: theme.shadow.card,
          animation: 'slideDown 0.3s ease-out',
        }}>
          <h2 style={{ marginBottom: theme.spacing.lg, color: theme.colors.primary, fontSize: theme.fonts.size.xl }}>
            {editingId ? '编辑活动' : '创建新活动'}
          </h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.lg }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>活动名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="请输入活动名称"
                  style={inputStyle(formErrors.name)}
                  onFocus={e => !formErrors.name && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
                {formErrors.name && <span style={errorStyle}>{formErrors.name}</span>}
              </div>

              <div>
                <label style={labelStyle}>活动类型 *</label>
                <select
                  value={formData.type}
                  onChange={e => setFormData(p => ({ ...p, type: e.target.value as EventType }))}
                  style={{ ...inputStyle(), cursor: 'pointer' }}
                >
                  {EVENT_TYPE_OPTIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>活动日期 *</label>
                <input
                  type="date"
                  value={formData.date}
                  min={today}
                  onChange={e => setFormData(p => ({ ...p, date: e.target.value }))}
                  style={inputStyle(formErrors.date)}
                  onFocus={e => !formErrors.date && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
                {formErrors.date && <span style={errorStyle}>{formErrors.date}</span>}
              </div>

              <div>
                <label style={labelStyle}>开始时间 *</label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={e => setFormData(p => ({ ...p, startTime: e.target.value }))}
                  style={inputStyle(formErrors.startTime)}
                  onFocus={e => !formErrors.startTime && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
              </div>

              <div>
                <label style={labelStyle}>结束时间 *</label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={e => setFormData(p => ({ ...p, endTime: e.target.value }))}
                  style={inputStyle(formErrors.endTime)}
                  onFocus={e => !formErrors.endTime && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
                {formErrors.endTime && <span style={errorStyle}>{formErrors.endTime}</span>}
              </div>

              <div>
                <label style={labelStyle}>最大参与人数 (10-200) *</label>
                <input
                  type="number"
                  value={formData.maxParticipants}
                  min={10}
                  max={200}
                  onChange={e => setFormData(p => ({ ...p, maxParticipants: parseInt(e.target.value) || 0 }))}
                  style={inputStyle(formErrors.maxParticipants)}
                  onFocus={e => !formErrors.maxParticipants && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
                {formErrors.maxParticipants && <span style={errorStyle}>{formErrors.maxParticipants}</span>}
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>活动简介（最多300字）</label>
                <textarea
                  value={formData.description}
                  onChange={e => {
                    if (e.target.value.length <= 300) {
                      setFormData(p => ({ ...p, description: e.target.value }));
                    }
                  }}
                  placeholder="请输入活动简介..."
                  rows={3}
                  style={{
                    ...inputStyle(formErrors.description),
                    resize: 'vertical',
                    minHeight: 80,
                  }}
                  onFocus={e => !formErrors.description && (e.currentTarget.style.borderColor = theme.colors.primary)}
                  onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                />
                <div style={{ textAlign: 'right', fontSize: theme.fonts.size.xs, color: theme.colors.textLight, marginTop: 4 }}>
                  {formData.description.length}/300
                </div>
                {formErrors.description && <span style={errorStyle}>{formErrors.description}</span>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
              <button
                type="submit"
                className="btn-ripple"
                style={{
                  ...buttonPrimaryStyle,
                  transition: `transform ${theme.transition.fast}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                {editingId ? '保存修改' : '创建活动'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-ripple"
                style={{
                  ...buttonSecondaryStyle,
                  transition: `transform ${theme.transition.fast}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="event-card-grid">
        {displayedEvents.map(event => {
          const regCount = regCountMap[event.id] || 0;
          const remaining = event.maxParticipants - regCount;
          const past = isPast(event.date);
          const todayEvent = isToday(event.date);

          return (
            <div
              key={event.id}
              className="card-float event-card"
              style={{
                background: theme.colors.cardBg,
                borderRadius: theme.borderRadius.md,
                boxShadow: theme.shadow.card,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
              }}
              onClick={() => onSelectEvent(event.id)}
            >
              <div style={{
                position: 'relative',
                padding: `${theme.spacing.lg} ${theme.spacing.lg} ${theme.spacing.sm}`,
              }}>
                <span style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  background: typeColorMap[event.type],
                  color: typeTextColor[event.type],
                  padding: '4px 12px',
                  borderRadius: 20,
                  fontSize: theme.fonts.size.xs,
                  fontWeight: 500,
                }}>
                  {event.type}
                </span>
                {past && (
                  <span style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: '#E0E0E0',
                    color: '#757575',
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: theme.fonts.size.xs,
                  }}>
                    已结束
                  </span>
                )}
                {todayEvent && (
                  <span style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    background: '#FFF3E0',
                    color: '#E65100',
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: theme.fonts.size.xs,
                    fontWeight: 500,
                  }}>
                    今日
                  </span>
                )}
                <h3 style={{
                  fontSize: theme.fonts.size.lg,
                  fontWeight: 600,
                  color: theme.colors.textPrimary,
                  marginTop: 28,
                  marginBottom: theme.spacing.sm,
                  lineHeight: 1.4,
                }}>
                  {event.name}
                </h3>
                <div style={{ fontSize: theme.fonts.size.sm, color: theme.colors.textSecondary, marginBottom: 4 }}>
                  📅 {event.date} {event.startTime} - {event.endTime}
                </div>
                <div style={{
                  fontSize: theme.fonts.size.sm,
                  color: remaining <= 5 ? theme.colors.error : theme.colors.textSecondary,
                  fontWeight: remaining <= 5 ? 600 : 400,
                }}>
                  👥 剩余名额: {remaining}/{event.maxParticipants}
                  {remaining <= 0 && <span style={{ color: theme.colors.error, marginLeft: 6 }}>已满</span>}
                </div>
              </div>

              <div style={{
                padding: `0 ${theme.spacing.lg} ${theme.spacing.md}`,
                flex: 1,
              }}>
                <p style={{
                  fontSize: theme.fonts.size.sm,
                  color: theme.colors.textLight,
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {event.description}
                </p>
              </div>

              <div style={{
                padding: theme.spacing.sm,
                display: 'flex',
                gap: theme.spacing.sm,
                borderTop: `1px solid ${theme.colors.border}`,
                flexWrap: 'wrap',
              }}>
                {past && (
                  <button
                    className="btn-ripple"
                    onClick={e => { e.stopPropagation(); onViewReport(event.id); }}
                    style={cardButtonStyle('#1565C0')}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    📊 查看报告
                  </button>
                )}
                {todayEvent && (
                  <button
                    className="btn-ripple"
                    onClick={e => { e.stopPropagation(); onCheckInMode(event.id); }}
                    style={cardButtonStyle('#2E7D32')}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    ✅ 签到模式
                  </button>
                )}
                <button
                  className="btn-ripple"
                  onClick={e => { e.stopPropagation(); handleEdit(event); }}
                  style={cardButtonStyle(theme.colors.secondary)}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  ✏️ 编辑
                </button>
                {deleteConfirmId === event.id ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button
                      className="btn-ripple"
                      onClick={e => { e.stopPropagation(); handleDelete(event.id); }}
                      style={cardButtonStyle(theme.colors.error)}
                    >
                      确认
                    </button>
                    <button
                      className="btn-ripple"
                      onClick={e => { e.stopPropagation(); setDeleteConfirmId(null); }}
                      style={cardButtonStyle('#999')}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-ripple"
                    onClick={e => { e.stopPropagation(); setDeleteConfirmId(event.id); }}
                    style={cardButtonStyle('#999')}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    🗑️ 删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {displayCount < events.length && (
        <div
          ref={loaderRef}
          style={{
            textAlign: 'center',
            padding: theme.spacing.xl,
            color: theme.colors.textLight,
            fontSize: theme.fonts.size.sm,
          }}
        >
          ↓ 滚动加载更多 ({displayCount}/{events.length})
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: '0.875rem',
  fontWeight: 500,
  color: theme.colors.textSecondary,
};

const inputStyle = (error?: string): React.CSSProperties => ({
  width: '100%',
  padding: '10px 14px',
  border: `2px solid ${error ? theme.colors.error : theme.colors.border}`,
  borderRadius: 8,
  fontSize: theme.fonts.size.base,
  outline: 'none',
  transition: `border-color ${theme.transition.normal}`,
  background: '#FFF',
  fontFamily: 'inherit',
  ...(error ? { animation: 'shake 0.3s ease-in-out' } : {}),
});

const errorStyle: React.CSSProperties = {
  color: theme.colors.error,
  fontSize: theme.fonts.size.xs,
  marginTop: 4,
  display: 'block',
};

const buttonPrimaryStyle: React.CSSProperties = {
  background: theme.colors.primary,
  color: '#FFF',
  border: 'none',
  padding: '10px 24px',
  borderRadius: 8,
  fontSize: theme.fonts.size.base,
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: theme.shadow.button,
};

const buttonSecondaryStyle: React.CSSProperties = {
  background: '#E0E0E0',
  color: theme.colors.textPrimary,
  border: 'none',
  padding: '10px 24px',
  borderRadius: 8,
  fontSize: theme.fonts.size.base,
  cursor: 'pointer',
};

const cardButtonStyle = (color: string): React.CSSProperties => ({
  background: 'transparent',
  color,
  border: `1px solid ${color}`,
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: theme.fonts.size.xs,
  cursor: 'pointer',
  transition: `transform ${theme.transition.fast}, background ${theme.transition.fast}`,
  whiteSpace: 'nowrap',
});

export default EventManager;
