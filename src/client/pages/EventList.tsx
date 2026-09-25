import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { formatDateTime } from '@/utils/format';
import type { EventWithStats } from '../../shared/types';

export default function EventList() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    api
      .getEvents()
      .then((data) => {
        setEvents(data);
        const elapsed = performance.now() - t0;
        console.debug(`[perf] 活动列表加载: ${elapsed.toFixed(1)}ms`);
      })
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">✨ 探索精彩活动</h1>
        <p className="page-subtitle">发现并报名参加心仪的线下与线上活动</p>
      </div>

      {loading && (
        <div className="loading-wrap">
          <div className="spinner" />
          <div>正在加载活动...</div>
        </div>
      )}

      {error && !loading && (
        <div className="loading-wrap" style={{ color: '#fecaca' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <div>{error}</div>
          <button
            className="btn-secondary"
            style={{ marginTop: 20 }}
            onClick={() => window.location.reload()}
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && events.length === 0 && (
        <div className="empty-state" style={{ color: 'rgba(255,255,255,0.7)' }}>
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-text">暂无活动，点击右下角按钮发布第一个活动吧！</div>
          <Link to="/create" className="btn-primary">立即发布活动</Link>
        </div>
      )}

      {!loading && !error && events.length > 0 && (
        <div className="events-grid">
          {events.map((e) => {
            const pct = Math.min(100, (e.registeredCount / e.maxCapacity) * 100);
            const handleCheckInClick = (ev: React.MouseEvent) => {
              ev.preventDefault();
              ev.stopPropagation();
              navigate('/checkin', { state: { autoEventId: e.id, autoEventName: e.name } });
            };
            return (
              <Link key={e.id} to={`/event/${e.id}`} className="glass-card event-card">
                {e.isFull && <span className="full-tag">已满员</span>}
                <h3 className="event-card-title">{e.name}</h3>
                <div className="event-card-meta">
                  <div className="event-meta-row">
                    <span className="event-meta-icon">🗓️</span>
                    <span>{formatDateTime(e.dateTime)}</span>
                  </div>
                  <div className="event-meta-row">
                    <span className="event-meta-icon">📍</span>
                    <span>{e.location}</span>
                  </div>
                </div>
                <p className="event-card-desc">{e.description}</p>
                <div className="event-card-footer">
                  <div>
                    <div className="event-capacity">
                      {e.registeredCount} / {e.maxCapacity} 人报名
                    </div>
                    <div className="event-capacity-bar">
                      <div
                        className={`event-capacity-fill${e.isFull ? ' full' : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-checkin-card"
                    onClick={handleCheckInClick}
                    title="进入签到管理"
                  >
                    ✅ 签到
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Link to="/create" className="fab" aria-label="发布活动" title="发布新活动">
        ➕
      </Link>
    </div>
  );
}
