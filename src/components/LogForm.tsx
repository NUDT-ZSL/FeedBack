import React, { useState } from 'react';
import { CareLog } from '../utils/chartHelper';

interface LogFormProps {
  onSubmit: (log: Omit<CareLog, 'id'>) => void;
  onCancel: () => void;
}

const LogForm: React.FC<LogFormProps> = ({ onSubmit, onCancel }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [activityType, setActivityType] = useState<'water' | 'fertilize' | 'prune'>('water');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      onSubmit({ date, activityType, notes });
      setLoading(false);
    }, 500);
  };

  return (
    <div className="log-form-overlay" onClick={onCancel}>
      <div className="log-form" onClick={(e) => e.stopPropagation()}>
        <h3 className="log-form-title">添加养护记录</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>日期</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="form-input"
              required
            />
          </div>
          <div className="form-group">
            <label>活动类型</label>
            <div className="activity-radio-group">
              <label className={`activity-radio ${activityType === 'water' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="activityType"
                  value="water"
                  checked={activityType === 'water'}
                  onChange={() => setActivityType('water')}
                />
                <span className="activity-icon">💧</span>
                <span>浇水</span>
              </label>
              <label className={`activity-radio ${activityType === 'fertilize' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="activityType"
                  value="fertilize"
                  checked={activityType === 'fertilize'}
                  onChange={() => setActivityType('fertilize')}
                />
                <span className="activity-icon">🧪</span>
                <span>施肥</span>
              </label>
              <label className={`activity-radio ${activityType === 'prune' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="activityType"
                  value="prune"
                  checked={activityType === 'prune'}
                  onChange={() => setActivityType('prune')}
                />
                <span className="activity-icon">✂️</span>
                <span>修剪</span>
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>备注</label>
            <textarea
              value={notes}
              onChange={(e) => {
                if (e.target.value.length <= 200) setNotes(e.target.value);
              }}
              className="form-textarea"
              placeholder="记录养护详情..."
              rows={3}
            />
            <span className="char-count">{notes.length}/200</span>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-cancel" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="btn btn-submit" disabled={loading}>
              {loading && <span className="spinner" />}
              {loading ? '提交中...' : '提交'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LogForm;
