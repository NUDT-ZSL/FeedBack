import { useEffect, useState } from 'react';
import { Plus, Calendar, Clock, Music, AlertTriangle, Trash2 } from 'lucide-react';
import { Schedule, Band } from '../types';
import { scheduleApi, bandsApi } from '../services/api';
import { useStore } from '../store/useStore';
import { formatTime, formatDate, generateTimeSlots } from '../utils/time';
import './ScheduleManager.css';

const STAGES = ['主舞台', '副舞台', '电音舞台'];

export default function ScheduleManager() {
  const { schedules, bands, setSchedules, setBands, addSchedule, removeSchedule, addNotification } = useStore();
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [showConflict, setShowConflict] = useState(false);

  const [formData, setFormData] = useState({
    bandId: '',
    stage: STAGES[0],
    date: '',
    startTime: '18:00',
    endTime: '19:00'
  });

  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const approvedBands = bands.filter(b => b.status === 'approved');
  const timeSlots = generateTimeSlots(12, 24, 15);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [schedulesData, bandsData] = await Promise.all([
          scheduleApi.getSchedules(),
          bandsApi.getBands()
        ]);
        setSchedules(schedulesData);
        setBands(bandsData);
      } catch (error: any) {
        addNotification({ message: '加载数据失败', type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [setSchedules, setBands, addNotification]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.bandId || !formData.date || !formData.startTime || !formData.endTime) {
      addNotification({ message: '请填写完整信息', type: 'error' });
      return;
    }

    const startTime = new Date(`${formData.date}T${formData.startTime}:00`).toISOString();
    const endTime = new Date(`${formData.date}T${formData.endTime}:00`).toISOString();

    if (startTime >= endTime) {
      setConflictError('结束时间必须晚于开始时间');
      setShowConflict(true);
      return;
    }

    setSubmitting(true);
    setConflictError(null);

    try {
      const newSchedule = await scheduleApi.createSchedule({
        bandId: formData.bandId,
        stage: formData.stage,
        startTime,
        endTime
      });

      addSchedule(newSchedule);
      addNotification({ message: '排期创建成功', type: 'success' });
      setShowForm(false);
      setFormData({
        bandId: '',
        stage: STAGES[0],
        date: '',
        startTime: '18:00',
        endTime: '19:00'
      });
    } catch (error: any) {
      if (error.message) {
        setConflictError(error.message);
        setShowConflict(true);
      } else {
        addNotification({ message: '创建失败', type: 'error' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个排期吗？')) return;

    setDeletingId(id);
    try {
      await scheduleApi.deleteSchedule(id);
      removeSchedule(id);
      addNotification({ message: '排期已删除', type: 'success' });
    } catch (error: any) {
      addNotification({ message: error.message || '删除失败', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const groupedSchedules = schedules.reduce((acc, schedule) => {
    const date = new Date(schedule.startTime);
    date.setHours(0, 0, 0, 0);
    const dateKey = date.toISOString();
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(schedule);
    return acc;
  }, {} as Record<string, Schedule[]>);

  const sortedDates = Object.keys(groupedSchedules).sort();

  if (loading) {
    return (
      <div className="schedule-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">排期管理</h1>
          <p className="page-subtitle">管理音乐节舞台演出安排</p>
        </div>
        <button className="btn-primary add-btn" onClick={() => setShowForm(true)}>
          <Plus size={18} />
          新增排期
        </button>
      </div>

      {showConflict && conflictError && (
        <div className="conflict-alert shake slide-in-down">
          <AlertTriangle size={20} />
          <span>{conflictError}</span>
          <button className="close-btn" onClick={() => setShowConflict(false)}>×</button>
        </div>
      )}

      {showForm && (
        <div className="schedule-form-card fade-in">
          <h2 className="form-title">新增排期</h2>
          <form onSubmit={handleSubmit} className="schedule-form">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">
                  <Music size={16} />
                  选择乐队
                </label>
                <select
                  value={formData.bandId}
                  onChange={(e) => setFormData(prev => ({ ...prev, bandId: e.target.value }))}
                  className="form-input"
                >
                  <option value="">请选择乐队</option>
                  {approvedBands.map(band => (
                    <option key={band.id} value={band.id}>{band.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  <Music size={16} />
                  舞台
                </label>
                <select
                  value={formData.stage}
                  onChange={(e) => setFormData(prev => ({ ...prev, stage: e.target.value }))}
                  className="form-input"
                >
                  {STAGES.map(stage => (
                    <option key={stage} value={stage}>{stage}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">
                  <Calendar size={16} />
                  日期
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  className="form-input"
                  min="2026-07-01"
                  max="2026-07-31"
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  <Clock size={16} />
                  开始时间
                </label>
                <select
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  className="form-input"
                >
                  {timeSlots.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  <Clock size={16} />
                  结束时间
                </label>
                <select
                  value={formData.endTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                  className="form-input"
                >
                  {timeSlots.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowForm(false);
                  setConflictError(null);
                  setShowConflict(false);
                }}
              >
                取消
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? '创建中...' : '创建排期'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="schedule-list">
        {sortedDates.length === 0 ? (
          <div className="empty-state">
            <Calendar size={48} />
            <p>暂无排期安排，点击上方按钮添加</p>
          </div>
        ) : (
          sortedDates.map(date => (
            <div key={date} className="schedule-day-section">
              <h3 className="day-title">{formatDate(date)}</h3>
              <div className="stage-schedules">
                {STAGES.map(stage => {
                  const stageSchedules = groupedSchedules[date]
                    .filter(s => s.stage === stage)
                    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                  return (
                    <div key={stage} className="stage-column">
                      <div className="stage-header">{stage}</div>
                      <div className="stage-items">
                        {stageSchedules.length === 0 ? (
                          <div className="empty-stage">暂无安排</div>
                        ) : (
                          stageSchedules.map(schedule => (
                            <div key={schedule.id} className="schedule-item fade-in">
                              <div className="schedule-time">
                                {formatTime(schedule.startTime)} - {formatTime(schedule.endTime)}
                              </div>
                              <div className="schedule-band">{schedule.bandName}</div>
                              <div className="schedule-genres">
                                {schedule.genres.slice(0, 2).map(g => (
                                  <span key={g} className="mini-tag">{g}</span>
                                ))}
                              </div>
                              <button
                                className="delete-btn"
                                onClick={() => handleDelete(schedule.id)}
                                disabled={deletingId === schedule.id}
                                title="删除排期"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
