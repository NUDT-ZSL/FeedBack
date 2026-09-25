import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { toLocalInputValue } from '@/utils/format';

export default function CreateEvent() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    dateTime: toLocalInputValue(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()),
    location: '',
    maxCapacity: 50,
    description: '',
  });

  const update = (k: keyof typeof form, v: any) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.dateTime || !form.location.trim() || !form.description.trim()) {
      setError('请完整填写所有字段');
      return;
    }
    if (form.maxCapacity < 1) {
      setError('最大人数至少为 1');
      return;
    }
    try {
      setSubmitting(true);
      const created = await api.createEvent({
        name: form.name,
        dateTime: new Date(form.dateTime).toISOString(),
        location: form.location,
        maxCapacity: Number(form.maxCapacity),
        description: form.description,
      });
      navigate(`/event/${created.id}`);
    } catch (err: any) {
      setError(err.message || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="glass-card-static form-card">
        <h1 className="form-card-title">🎪 发布新活动</h1>
        <p className="form-card-subtitle">填写以下信息，让参与者了解你的精彩活动</p>

        {error && (
          <div className="verify-feedback error">{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">活动名称 *</label>
            <input
              type="text"
              className="form-input"
              placeholder="例如：2026 前端开发者大会"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label">活动时间 *</label>
              <input
                type="datetime-local"
                className="form-input"
                value={form.dateTime}
                onChange={(e) => update('dateTime', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">最大人数 *</label>
              <input
                type="number"
                min={1}
                className="form-input"
                value={form.maxCapacity}
                onChange={(e) => update('maxCapacity', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">活动地点 *</label>
            <input
              type="text"
              className="form-input"
              placeholder="例如：北京国际会议中心 · 3楼多功能厅"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="form-group">
            <label className="form-label">活动描述 *</label>
            <textarea
              className="form-textarea"
              placeholder="介绍活动亮点、议程、嘉宾阵容、适合人群等..."
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              maxLength={1000}
            />
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
              style={{ flex: 1 }}
            >
              {submitting ? '📝 发布中...' : '🚀 发布活动'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(-1)}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
