import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@/api';
import { formatDateTime, shortId } from '@/utils/format';
import type { Registration } from '../../shared/types';

export default function CheckInManager() {
  const location = useLocation() as any;
  const [eventId, setEventId] = useState('');
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadedEventId, setLoadedEventId] = useState('');
  const [scanId, setScanId] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [justCheckedId, setJustCheckedId] = useState<string | null>(null);
  const [poppingId, setPoppingId] = useState<string | null>(null);
  const [eventInfo, setEventInfo] = useState<{ name: string } | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const state = location.state as { autoEventId?: string; autoEventName?: string } | null;
    if (state?.autoEventId) {
      setEventId(state.autoEventId);
      if (state.autoEventName) {
        setEventInfo({ name: state.autoEventName });
      }
      setTimeout(() => loadList(state.autoEventId), 50);
    } else {
      const firstEventKey = Object.keys(sessionStorage).find((k) => k.startsWith('demo_event_'));
      if (firstEventKey) {
        setEventId(sessionStorage.getItem(firstEventKey) || '');
      }
    }
    scanInputRef.current?.focus();
  }, [location.state]);

  const debouncedVerify = useCallback((id: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      if (id.trim()) {
        doVerify(id.trim());
      }
    }, 500);
  }, [loadedEventId]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(null), 3000);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  useEffect(() => {
    if (justCheckedId) {
      const t = setTimeout(() => setJustCheckedId(null), 1500);
      return () => clearTimeout(t);
    }
  }, [justCheckedId]);

  const loadList = async (evId?: string) => {
    const targetId = (evId ?? eventId).trim();
    if (!targetId) {
      setFeedback({ type: 'error', msg: '请先输入活动 ID' });
      return;
    }
    try {
      setLoadingList(true);
      const t0 = performance.now();
      const [list, ev] = await Promise.all([
        api.getRegistrationsByEvent(targetId),
        api.getEvent(targetId).catch(() => null),
      ]);
      setRegistrations(list);
      setLoadedEventId(targetId);
      setEventInfo(ev ? { name: ev.name } : null);
      const elapsed = performance.now() - t0;
      console.debug(`[perf] 名单加载: ${elapsed.toFixed(1)}ms, 共 ${list.length} 条`);
    } catch (err: any) {
      setRegistrations([]);
      setLoadedEventId('');
      setEventInfo(null);
      setFeedback({ type: 'error', msg: err.message || '加载名单失败，请检查活动 ID' });
    } finally {
      setLoadingList(false);
    }
  };

  const doVerify = async (rawId?: string) => {
    const id = (rawId ?? scanId).trim();
    if (!id) {
      setFeedback({ type: 'error', msg: '请输入或扫描报名 ID' });
      return;
    }
    if (!loadedEventId) {
      setFeedback({ type: 'error', msg: '请先加载活动名单' });
      return;
    }
    try {
      const t0 = performance.now();
      const res = await api.verify({ registrationId: id, eventId: loadedEventId });
      const elapsed = performance.now() - t0;
      console.debug(`[perf] 签到响应: ${elapsed.toFixed(1)}ms`);

      if (res.success && res.registration) {
        setFeedback({ type: 'success', msg: `✅ ${res.message} - ${res.registration.name}` });
        setJustCheckedId(res.registration.id);
        setPoppingId(res.registration.id);
        setTimeout(() => setPoppingId(null), 600);
        setRegistrations((prev) =>
          prev.map((r) => (r.id === res.registration!.id ? res.registration! : r))
        );
        setScanId('');
        scanInputRef.current?.focus();
      } else {
        setFeedback({ type: 'error', msg: `❌ ${res.message}` });
        if (res.registration) {
          setJustCheckedId(res.registration.id);
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || '签到失败' });
    }
  };

  const manualCheckRow = async (reg: Registration) => {
    if (reg.checkedIn) return;
    const t0 = performance.now();
    try {
      const res = await api.verify({ registrationId: reg.id, eventId: loadedEventId });
      const elapsed = performance.now() - t0;
      console.debug(`[perf] 行内签到: ${elapsed.toFixed(1)}ms`);

      if (res.success && res.registration) {
        setFeedback({ type: 'success', msg: `✅ ${res.registration.name} 签到成功` });
        setJustCheckedId(res.registration.id);
        setPoppingId(res.registration.id);
        setTimeout(() => setPoppingId(null), 600);
        setRegistrations((prev) =>
          prev.map((r) => (r.id === res.registration!.id ? res.registration! : r))
        );
      } else {
        setFeedback({ type: 'error', msg: res.message });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', msg: err.message || '签到失败' });
    }
  };

  const total = registrations.length;
  const checked = registrations.filter((r) => r.checkedIn).length;
  const pending = total - checked;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">✅ 签到管理台</h1>
        <p className="page-subtitle">主办方扫码或手动验证参与者入场签到</p>
      </div>

      <div className="checkin-layout">
        <div className="glass-card-static checkin-panel">
          <h2 className="panel-title">🎯 签到操作</h2>
          <p className="panel-subtitle">步骤 1：加载活动名单 → 步骤 2：扫码签到</p>

          <div className="form-group">
            <label className="form-label">活动 ID</label>
            <input
              type="text"
              className="form-input"
              placeholder="请输入活动 ID"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  loadList();
                  setTimeout(() => scanInputRef.current?.focus(), 100);
                }
              }}
            />
          </div>

          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', marginBottom: 24 }}
            onClick={() => loadList()}
            disabled={loadingList}
          >
            {loadingList ? '⏳ 加载中...' : '📋 加载报名名单'}
          </button>

          <div className="scan-tip">
            💡 提示：可直接使用扫码枪扫描参与者二维码（自动输入报名 ID 并回车触发签到），或手动输入编号
          </div>

          <div className="form-group">
            <label className="form-label">报名 ID / 扫码输入</label>
            <input
              ref={scanInputRef}
              type="text"
              className="form-input"
              placeholder="扫描二维码或粘贴报名 ID（停止输入后自动验证）"
              value={scanId}
              onChange={(e) => {
                const val = e.target.value;
                setScanId(val);
                if (val.trim()) {
                  debouncedVerify(val);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                  }
                  doVerify();
                }
              }}
              disabled={!loadedEventId}
            />
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={() => doVerify()}
            disabled={!loadedEventId}
          >
            🔍 验证签到
          </button>

          {feedback && (
            <div className={`verify-feedback ${feedback.type}`} style={{ marginTop: 20 }}>
              {feedback.msg}
            </div>
          )}
        </div>

        <div className="registrations-card">
          <div className="registrations-header">
            <div>
              <h2 className="registrations-title">
                {eventInfo ? eventInfo.name : loadedEventId ? '报名名单' : '等待加载活动'}
              </h2>
              {loadedEventId && (
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                  活动 ID: {shortId(loadedEventId, 12)}...
                </div>
              )}
            </div>
            {loadedEventId && (
              <div className="registrations-stats">
                <span className="stat-chip total">👥 总 {total}</span>
                <span className="stat-chip checked">✅ 已签 {checked}</span>
                <span className="stat-chip pending">⏳ 待签 {pending}</span>
              </div>
            )}
          </div>

          {!loadedEventId && !loadingList && (
            <div className="empty-state">
              <div className="empty-state-icon">🔐</div>
              <div className="empty-state-text">请输入活动 ID 并加载报名名单</div>
            </div>
          )}

          {loadingList && (
            <div className="loading-wrap">
              <div className="spinner" />
              <div>加载名单中...</div>
            </div>
          )}

          {loadedEventId && !loadingList && registrations.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📭</div>
              <div className="empty-state-text">该活动暂无报名记录</div>
            </div>
          )}

          {loadedEventId && !loadingList && registrations.length > 0 && (
            <table className="registrations-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>姓名</th>
                  <th>邮箱</th>
                  <th style={{ width: 130 }}>报名编号</th>
                  <th style={{ width: 120 }}>报名时间</th>
                  <th style={{ width: 130 }}>签到状态</th>
                  <th style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((r, idx) => {
                  const rowClass = idx % 2 === 0 ? 'reg-row reg-row-odd' : 'reg-row reg-row-even';
                  const checkedClass = justCheckedId === r.id ? ' just-checked' : '';
                  return (
                    <tr key={r.id} className={rowClass + checkedClass} data-row-idx={idx}>
                      <td style={{ color: '#9ca3af', fontWeight: 600 }}>{String(idx + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td style={{ color: '#6b7280' }}>{r.email}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#4b5563' }}>{shortId(r.id)}</td>
                      <td style={{ fontSize: 12, color: '#9ca3af' }}>{formatDateTime(r.createdAt).split(' ')[0]}</td>
                      <td>
                        {r.checkedIn ? (
                          <span className="status-badge checked">
                            <span className={poppingId === r.id ? 'checkmark-pop' : ''}>✓</span>
                            已签到
                          </span>
                        ) : (
                          <span className="status-badge pending">⏳ 未签到</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-success"
                          disabled={r.checkedIn}
                          onClick={() => manualCheckRow(r)}
                        >
                          {r.checkedIn ? '已完成' : '手动签到'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
