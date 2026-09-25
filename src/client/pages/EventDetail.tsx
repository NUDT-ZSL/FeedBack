import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/api';
import { formatDate, formatTime } from '@/utils/format';
import type { EventWithStats } from '../../shared/types';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventWithStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '' });

  useEffect(() => {
    if (!id) return;
    api
      .getEvent(id)
      .then(setEvent)
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setRegError('请填写姓名和邮箱');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setRegError('邮箱格式不正确');
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.register({
        eventId: id!,
        name: form.name,
        email: form.email,
      });
      navigate(`/success/${res.registration.id}`, {
        state: { qrCodeDataUrl: res.qrCodeDataUrl, eventName: event?.name },
      });
    } catch (err: any) {
      setRegError(err.message || '报名失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-wrap">
          <div className="spinner" />
          <div>加载活动详情...</div>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="page-container">
        <div className="loading-wrap" style={{ color: '#fecaca' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>😕</div>
          <div>{error || '活动不存在'}</div>
          <Link to="/" className="btn-secondary" style={{ marginTop: 20 }}>
            返回活动列表
          </Link>
        </div>
      </div>
    );
  }

  const spotsLeft = event.maxCapacity - event.registeredCount;

  return (
    <div className="page-container">
      <div className="detail-layout">
        <div className="glass-card-static detail-info-card">
          <h1 className="detail-title">{event.name}</h1>

          <div className="event-detail-hint">
            <div className="event-detail-hint-title">活动 ID（用于签到管理）</div>
            <div className="event-detail-hint-value">{event.id}</div>
          </div>

          <div className="detail-meta-grid">
            <div className="detail-meta-item">
              <span className="detail-meta-label">📆 活动日期</span>
              <span className="detail-meta-value">{formatDate(event.dateTime)}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">⏰ 活动时间</span>
              <span className="detail-meta-value">{formatTime(event.dateTime)}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">📍 活动地点</span>
              <span className="detail-meta-value">{event.location}</span>
            </div>
            <div className="detail-meta-item">
              <span className="detail-meta-label">👥 规模</span>
              <span className="detail-meta-value">最多 {event.maxCapacity} 人</span>
            </div>
          </div>

          <div style={{ marginBottom: 14, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
            📝 活动详情
          </div>
          <p className="detail-description">{event.description}</p>
        </div>

        <div className="glass-card-static detail-register-card">
          <h2 className="detail-register-title">🎫 立即报名</h2>
          <p className="detail-register-subtitle">席位有限，先到先得</p>

          <div className="spots-info">
            <div>剩余名额</div>
            <div className={`spots-count${event.isFull ? ' full' : ''}`}>
              {event.isFull ? '已满员' : `${spotsLeft} 位`}
            </div>
          </div>

          {event.isFull && (
            <div className="full-notice">😔 本次活动已达人数上限，下次请早哦！</div>
          )}

          {regError && (
            <div className="verify-feedback error">{regError}</div>
          )}

          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label className="form-label">您的姓名 *</label>
              <input
                type="text"
                className="form-input"
                placeholder="请输入真实姓名"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={event.isFull || submitting}
              />
            </div>
            <div className="form-group">
              <label className="form-label">邮箱地址 *</label>
              <input
                type="email"
                className="form-input"
                placeholder="name@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={event.isFull || submitting}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={event.isFull || submitting}
              style={{ width: '100%' }}
            >
              {submitting ? '⏳ 处理中...' : event.isFull ? '🔒 活动已满员' : '✅ 确认报名'}
            </button>
          </form>

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            💡 报名成功后将自动生成签到二维码，请妥善保存以便入场核验。
          </div>
        </div>
      </div>
    </div>
  );
}
