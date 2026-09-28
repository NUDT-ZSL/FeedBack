import { useState, useEffect } from 'react';
import type { Task, User, Plant } from '../types';
import { initialTasks, initialNeighbors, initialPlants } from '../data';
import { v4 as uuidv4 } from 'uuid';
import './Trust.scss';

export default function Trust() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const [tasks, setTasks] = useState<Task[]>([]);
  const [neighbors, setNeighbors] = useState<User[]>([]);
  const [plants] = useState<Plant[]>(initialPlants);
  const [form, setForm] = useState({
    plantId: initialPlants[0]?.id || '',
    startDate: formatDate(tomorrow),
    endDate: formatDate(nextWeek),
  });
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showMatches, setShowMatches] = useState(false);
  const [countdowns, setCountdowns] = useState<Record<string, { days: number; hours: number; mins: number; urgent: boolean }>>({});

  useEffect(() => {
    setTasks(initialTasks);
    setNeighbors(initialNeighbors);

    const timer = setInterval(() => {
      const now = Date.now();
      const updates: Record<string, { days: number; hours: number; mins: number; urgent: boolean }> = {};
      tasks.forEach(task => {
        if (task.status === 'accepted') {
          const end = new Date(task.endDate + 'T23:59:59').getTime();
          const diff = end - now;
          const urgent = diff > 0 && diff <= 60 * 60 * 1000;
          const totalMins = Math.max(0, Math.floor(diff / 60000));
          updates[task.id] = {
            days: Math.floor(totalMins / 1440),
            hours: Math.floor((totalMins % 1440) / 60),
            mins: totalMins % 60,
            urgent,
          };
        }
      });
      setCountdowns(updates);
    }, 1000);

    return () => clearInterval(timer);
  }, [tasks]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowMatches(true);
  };

  const handleSelectNeighbor = (neighbor: User) => {
    const plant = plants.find(p => p.id === form.plantId);
    const newTask: Task = {
      id: uuidv4(),
      plantId: form.plantId,
      requesterId: 'me',
      requesterName: '我',
      accepterId: neighbor.id,
      accepterName: neighbor.name,
      startDate: form.startDate,
      endDate: form.endDate,
      status: 'accepted',
      createdAt: new Date().toISOString(),
    };
    setTasks([newTask, ...tasks]);
    setShowMatches(false);
  };

  const getPlantName = (id: string) => plants.find(p => p.id === id)?.name || '未知植物';
  const getPlantIcon = (id: string) => plants.find(p => p.id === id)?.icon || '🌱';

  return (
    <div className="trust-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">托管中心</h1>
          <p className="page-subtitle">委托靠谱的邻居帮忙照顾植物 🤝</p>
        </div>
      </div>

      <div className="trust-grid">
        <div className="trust-form-wrap card">
          <h2 className="section-title">📝 发起托管请求</h2>
          <form className="trust-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label>选择植物</label>
              <select
                className="mui-input"
                value={form.plantId}
                onChange={e => setForm({ ...form, plantId: e.target.value })}
                onFocus={() => setFocusedField('plantId')}
                onBlur={() => setFocusedField(null)}
              >
                {plants.map(p => (
                  <option key={p.id} value={p.id}>{p.icon} {p.name}（{p.species}）</option>
                ))}
              </select>
              <span className={`mui-underline ${focusedField === 'plantId' ? 'active' : ''}`} />
            </div>

            <div className="date-row">
              <div className="form-group">
                <label>开始日期</label>
                <input
                  type="date"
                  className="mui-input"
                  value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })}
                  onFocus={() => setFocusedField('startDate')}
                  onBlur={() => setFocusedField(null)}
                />
                <span className={`mui-underline ${focusedField === 'startDate' ? 'active' : ''}`} />
              </div>
              <div className="form-group">
                <label>结束日期</label>
                <input
                  type="date"
                  className="mui-input"
                  value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })}
                  onFocus={() => setFocusedField('endDate')}
                  onBlur={() => setFocusedField(null)}
                />
                <span className={`mui-underline ${focusedField === 'endDate' ? 'active' : ''}`} />
              </div>
            </div>

            <button type="submit" className="btn btn-submit">
              🔍 智能匹配邻居
            </button>
          </form>

          {showMatches && (
            <div className="matches-section">
              <h3 className="matches-title">💚 为您匹配的邻居（按距离和信用排序）</h3>
              <div className="neighbors-list">
                {neighbors.map(n => (
                  <div key={n.id} className="neighbor-card">
                    <div className="neighbor-avatar">{n.avatar}</div>
                    <div className="neighbor-info">
                      <div className="neighbor-name">{n.name}</div>
                      <div className="neighbor-meta">
                        <span className="meta-item">⭐ 信用 {n.creditScore}</span>
                        <span className="meta-item">📍 {n.distance}km</span>
                      </div>
                    </div>
                    <button className="btn btn-small" onClick={() => handleSelectNeighbor(n)}>
                      选择 Ta
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="tasks-section">
          <h2 className="section-title">📋 我的托管任务</h2>
          {tasks.length === 0 ? (
            <div className="empty-tasks card">
              <span style={{ fontSize: 48 }}>🌿</span>
              <p>暂无托管任务</p>
              <p className="empty-sub">发起第一个托管请求吧！</p>
            </div>
          ) : (
            <div className="tasks-list">
              {tasks.map(task => (
                <div key={task.id} className="task-card card">
                  <div className="task-header">
                    <div className="task-plant">
                      <span className="task-plant-icon">{getPlantIcon(task.plantId)}</span>
                      <div>
                        <div className="task-plant-name">{getPlantName(task.plantId)}</div>
                        <div className="task-date">
                          {task.startDate} ~ {task.endDate}
                        </div>
                      </div>
                    </div>
                    <span className={`task-status status-${task.status}`}>
                      {task.status === 'pending' && '⏳ 待接单'}
                      {task.status === 'accepted' && '✅ 已接单'}
                      {task.status === 'completed' && '🎉 已完成'}
                      {task.status === 'cancelled' && '❌ 已取消'}
                    </span>
                  </div>

                  {task.status === 'accepted' && task.accepterName && (
                    <div className="task-accepter">
                      <span>托管人：{task.accepterName}</span>
                    </div>
                  )}

                  {task.status === 'accepted' && countdowns[task.id] && (
                    <div className={`countdown-box ${countdowns[task.id].urgent ? 'urgent' : ''}`}>
                      {countdowns[task.id].urgent && (
                        <span className="urgent-dot" title="即将到期！">
                          <span className="dot" />
                          即将到期提醒
                        </span>
                      )}
                      <div className="countdown-title">⏰ 托管结束倒计时</div>
                      <div className="countdown-numbers">
                        <div className="countdown-item">
                          <span className="num">{countdowns[task.id].days}</span>
                          <span className="unit">天</span>
                        </div>
                        <div className="countdown-sep">:</div>
                        <div className="countdown-item">
                          <span className="num">{String(countdowns[task.id].hours).padStart(2, '0')}</span>
                          <span className="unit">时</span>
                        </div>
                        <div className="countdown-sep">:</div>
                        <div className="countdown-item">
                          <span className="num">{String(countdowns[task.id].mins).padStart(2, '0')}</span>
                          <span className="unit">分</span>
                        </div>
                      </div>
                      <div className="countdown-bar">
                        <div className="countdown-progress" style={{
                          width: `${Math.max(5, 100 - ((countdowns[task.id].days * 24 + countdowns[task.id].hours) / (7 * 24)) * 100)}%`
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
