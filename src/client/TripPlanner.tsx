import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Trip, Activity, DayPlan, ExpenseCategory } from '../types';

interface TripPlannerProps {
  trip: Trip;
  onUpdate: (trip: Trip) => void;
}

const categoryOptions: { value: ExpenseCategory; label: string }[] = [
  { value: 'transport', label: '交通' },
  { value: 'accommodation', label: '住宿' },
  { value: 'food', label: '餐饮' },
  { value: 'ticket', label: '门票' },
  { value: 'other', label: '其他' }
];

const locationIcons: Record<string, string> = {
  default: '📍'
};

const categoryIcons: Record<ExpenseCategory, string> = {
  transport: '🚗',
  accommodation: '🏨',
  food: '🍜',
  ticket: '🎫',
  other: '📦'
};

function getDayOfWeek(dateStr: string): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const date = new Date(dateStr);
  return days[date.getDay()];
}

function sortActivitiesByTime(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => a.time.localeCompare(b.time));
}

export default function TripPlanner({ trip, onUpdate }: TripPlannerProps) {
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [draggedActivity, setDraggedActivity] = useState<{ activityId: string; fromDate: string; fromIndex: number } | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ date: string; index: number } | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<{ date: string; index: number; position: 'top' | 'bottom' } | null>(null);

  const [formData, setFormData] = useState({
    time: '09:00',
    location: '',
    description: '',
    transport: '',
    cost: 0,
    category: 'other' as ExpenseCategory
  });

  function openAddModal(date: string) {
    setSelectedDate(date);
    setEditingActivity(null);
    setFormData({
      time: '09:00',
      location: '',
      description: '',
      transport: '',
      cost: 0,
      category: 'other'
    });
    setShowModal(true);
  }

  function openEditModal(date: string, activity: Activity) {
    setSelectedDate(date);
    setEditingActivity(activity);
    setFormData({
      time: activity.time,
      location: activity.location,
      description: activity.description,
      transport: activity.transport,
      cost: activity.cost,
      category: activity.category
    });
    setShowModal(true);
  }

  function handleSubmit() {
    if (!selectedDate) return;
    if (!formData.location.trim()) {
      alert('请输入地点');
      return;
    }

    const updatedDays = trip.days.map(day => {
      if (day.date !== selectedDate) return day;

      let activities: Activity[];
      if (editingActivity) {
        activities = day.activities.map(act =>
          act.id === editingActivity.id
            ? { ...act, ...formData }
            : act
        );
      } else {
        const newActivity: Activity = {
          id: uuidv4(),
          ...formData
        };
        activities = [...day.activities, newActivity];
      }

      return {
        ...day,
        activities: sortActivitiesByTime(activities)
      };
    });

    onUpdate({ ...trip, days: updatedDays });
    setShowModal(false);
  }

  function handleDelete(date: string, activityId: string) {
    if (!confirm('确定要删除这个行程吗？')) return;

    const updatedDays = trip.days.map(day => {
      if (day.date !== date) return day;
      return {
        ...day,
        activities: day.activities.filter(act => act.id !== activityId)
      };
    });

    onUpdate({ ...trip, days: updatedDays });
  }

  function handleDragStart(e: React.DragEvent, activityId: string, fromDate: string, fromIndex: number) {
    setDraggedActivity({ activityId, fromDate, fromIndex });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', activityId);
  }

  function handleDragOver(e: React.DragEvent, date: string, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
    setDragOverItem({ date, index });

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: 'top' | 'bottom' = e.clientY < midY ? 'top' : 'bottom';
    setDragOverPosition({ date, index, position });
  }

  function handleDragLeave() {
    setDragOverDate(null);
    setDragOverItem(null);
    setDragOverPosition(null);
  }

  function handleDrop(e: React.DragEvent, toDate: string, toIndex: number) {
    e.preventDefault();
    setDragOverDate(null);
    setDragOverItem(null);

    let insertIndex = toIndex;
    if (dragOverPosition && dragOverPosition.date === toDate && dragOverPosition.index === toIndex) {
      if (dragOverPosition.position === 'bottom') {
        insertIndex = toIndex + 1;
      }
    }
    setDragOverPosition(null);

    if (!draggedActivity) return;

    const { activityId, fromDate, fromIndex } = draggedActivity;
    const fromDay = trip.days.find(d => d.date === fromDate);
    if (!fromDay) return;

    const activity = fromDay.activities.find(a => a.id === activityId);
    if (!activity) return;

    const updatedDays = trip.days.map(day => {
      if (day.date === fromDate && day.date === toDate) {
        const newActivities = [...day.activities];
        const [removed] = newActivities.splice(fromIndex, 1);
        let finalInsertIndex = insertIndex;
        if (fromIndex < insertIndex) {
          finalInsertIndex = insertIndex - 1;
        }
        newActivities.splice(finalInsertIndex, 0, removed);
        return { ...day, activities: newActivities };
      }
      if (day.date === fromDate) {
        return {
          ...day,
          activities: day.activities.filter(act => act.id !== activityId)
        };
      }
      if (day.date === toDate) {
        const newActivities = [...day.activities];
        newActivities.splice(insertIndex, 0, activity);
        return { ...day, activities: newActivities };
      }
      return day;
    });

    onUpdate({ ...trip, days: updatedDays });
    setDraggedActivity(null);
  }

  function handleDragEnd() {
    setDraggedActivity(null);
    setDragOverDate(null);
    setDragOverItem(null);
    setDragOverPosition(null);
  }

  return (
    <div className="trip-planner">
      <style>{`
        .activity-card {
          position: relative;
          transition: transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease;
        }
        .activity-card.dragging-source {
          opacity: 0.4;
          transform: scale(0.95);
        }
        .activity-card.drag-target {
          border: 2px solid #1E88E5 !important;
          background-color: #e3f2fd !important;
          box-shadow: 0 4px 12px rgba(30, 136, 229, 0.2);
        }
        .activity-card.drag-over-top::before {
          content: '';
          position: absolute;
          top: -3px;
          left: 0;
          right: 0;
          height: 4px;
          background-color: #1E88E5;
          border-radius: 2px;
          z-index: 10;
          box-shadow: 0 0 8px rgba(30, 136, 229, 0.5);
        }
        .activity-card.drag-over-bottom::after {
          content: '';
          position: absolute;
          bottom: -3px;
          left: 0;
          right: 0;
          height: 4px;
          background-color: #1E88E5;
          border-radius: 2px;
          z-index: 10;
          box-shadow: 0 0 8px rgba(30, 136, 229, 0.5);
        }
        .placeholder {
          border: 2px dashed #90caf9;
          background-color: #f5f9ff;
          border-radius: 8px;
          min-height: 120px;
          margin: 8px 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #64b5f6;
          font-size: 13px;
        }
      `}</style>
      <div className="days-grid">
        {trip.days.map((day, dayIndex) => (
          <div
            key={day.date}
            className={`day-column ${dragOverDate === day.date && !dragOverItem ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, day.date, day.activities.length)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, day.date, day.activities.length)}
            style={{
              border: dragOverDate === day.date && !dragOverItem ? '2px dashed #1E88E5' : 'none',
              backgroundColor: dragOverDate === day.date && !dragOverItem ? '#f0f7ff' : 'white'
            }}
          >
            <h3>
              第 {dayIndex + 1} 天
              <span className="day-date"> · {day.date} {getDayOfWeek(day.date)}</span>
            </h3>

            <div className="activities-list">
              {day.activities.length === 0 && !draggedActivity ? (
                <div style={{
                  textAlign: 'center',
                  padding: '30px 10px',
                  color: '#bbb',
                  fontSize: '13px'
                }}>
                  暂无行程，点击下方添加
                </div>
              ) : (
                day.activities.map((activity, actIndex) => {
                  const isSource = draggedActivity?.activityId === activity.id;
                  const isTarget = dragOverItem?.date === day.date && dragOverItem?.index === actIndex && !isSource;
                  const isTopPosition = dragOverPosition?.date === day.date && dragOverPosition.index === actIndex && dragOverPosition.position === 'top';
                  const isBottomPosition = dragOverPosition?.date === day.date && dragOverPosition.index === actIndex && dragOverPosition.position === 'bottom';
                  const showPlaceholderBefore = isTopPosition && !isSource;
                  const showPlaceholderAfter = isBottomPosition && !isSource;

                  return (
                    <div key={activity.id}>
                      {showPlaceholderBefore && <div className="placeholder">放置到此处</div>}
                      <div
                        className={`activity-card ${isSource ? 'dragging-source' : ''} ${isTarget ? 'drag-target' : ''} ${isTopPosition && !isSource ? 'drag-over-top' : ''} ${isBottomPosition && !isSource ? 'drag-over-bottom' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, activity.id, day.date, actIndex)}
                        onDragOver={(e) => handleDragOver(e, day.date, actIndex)}
                        onDragLeave={(e) => {
                          e.stopPropagation();
                        }}
                        onDrop={(e) => handleDrop(e, day.date, actIndex)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="activity-time">
                          <span className="activity-icon">🕐</span> {activity.time}
                        </div>
                        <div className="activity-location">
                          <span className="activity-icon">{locationIcons.default}</span>
                          {activity.location}
                        </div>
                        <div className="activity-desc">{activity.description}</div>
                        <div className="activity-footer">
                          <div>
                            <span className={`category-tag category-${activity.category}`}>
                              {categoryIcons[activity.category]} {categoryOptions.find(c => c.value === activity.category)?.label}
                            </span>
                            {activity.transport && (
                              <span style={{ marginLeft: '8px', color: '#888' }}>
                                🚗 {activity.transport}
                              </span>
                            )}
                          </div>
                          <div className="activity-cost">¥{activity.cost.toLocaleString()}</div>
                        </div>
                        <div style={{
                          display: 'flex',
                          gap: '6px',
                          marginTop: '8px',
                          justifyContent: 'flex-end'
                        }}>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => openEditModal(day.date, activity)}
                          >
                            编辑
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDelete(day.date, activity.id)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      {showPlaceholderAfter && <div className="placeholder">放置到此处</div>}
                    </div>
                  );
                })
              )}
              {day.activities.length === 0 && draggedActivity && dragOverDate === day.date && (
                <div className="placeholder">放置到此处</div>
              )}
            </div>

            <button
              className="add-activity-btn"
              onClick={() => openAddModal(day.date)}
            >
              + 添加行程
            </button>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingActivity ? '编辑行程' : '添加行程'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <div className="form-group">
              <label>时间</label>
              <input
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>地点</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="例如：故宫博物院"
              />
            </div>

            <div className="form-group">
              <label>活动描述</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="描述这个活动的内容..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>交通方式</label>
              <input
                type="text"
                value={formData.transport}
                onChange={(e) => setFormData({ ...formData, transport: e.target.value })}
                placeholder="例如：地铁、步行、出租车"
              />
            </div>

            <div className="form-group">
              <label>花费分类</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value as ExpenseCategory })}
              >
                {categoryOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>预计花费 (元)</label>
              <input
                type="number"
                min="0"
                value={formData.cost}
                onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSubmit}>
                {editingActivity ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
