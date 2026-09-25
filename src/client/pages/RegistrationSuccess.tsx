import { useEffect, useState } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import { shortId } from '@/utils/format';
import type { Registration } from '../../shared/types';

export default function RegistrationSuccess() {
  const { regId } = useParams<{ regId: string }>();
  const location = useLocation() as any;
  const navigate = useNavigate();
  const [qrCode, setQrCode] = useState<string>(location.state?.qrCodeDataUrl || '');
  const [eventName, setEventName] = useState<string>(location.state?.eventName || '');
  const [reg, setReg] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(!location.state?.qrCodeDataUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!regId) return;
    if (qrCode) return;
    const t0 = performance.now();
    api
      .getRegistration(regId)
      .then((data) => {
        setReg(data);
        const elapsed = performance.now() - t0;
        console.debug(`[perf] 报名信息加载: ${elapsed.toFixed(1)}ms`);
      })
      .catch((e) => setError(e.message || '加载失败'))
      .finally(() => setLoading(false));

    if (!qrCode) {
      api
        .register({
          eventId: '',
          name: '',
          email: '',
        })
        .catch(() => {});
    }
  }, [regId, qrCode]);

  return (
    <div className="success-wrapper">
      <div className="success-card">
        <div className="success-icon">🎉</div>
        <h1 className="success-title">报名成功！</h1>
        <p className="success-subtitle">
          {eventName ? `您已成功报名「${eventName}」` : '恭喜您，报名请求已成功提交'}
          <br />
          请保存以下签到二维码，活动当天凭此入场
        </p>

        {loading && (
          <div className="loading-wrap" style={{ padding: '40px 0' }}>
            <div className="spinner" />
            <div>正在生成二维码...</div>
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', padding: '20px 0' }}>
            {error}
          </div>
        )}

        {!loading && qrCode && (
          <div className="qr-wrapper">
            <div className="qr-container">
              <img src={qrCode} alt="签到二维码" />
            </div>
          </div>
        )}

        {regId && (
          <div className="reg-id-box">
            <span className="reg-id-label">报名编号</span>
            <span className="reg-id-value">{shortId(regId)}...</span>
          </div>
        )}

        <div className="success-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (qrCode) {
                const w = window.open('');
                if (w) {
                  w.document.write(`<title>签到二维码</title><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${qrCode}" style="width:400px;height:400px;" /></body>`);
                  w.document.close();
                }
              }
            }}
          >
            🖨️ 打印/保存
          </button>
          <Link to="/" className="btn-secondary">
            返回首页
          </Link>
        </div>

        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #f3f4f6', fontSize: 13, color: '#9ca3af', lineHeight: 1.7 }}>
          📌 温馨提示：活动当天请提前 30 分钟到达会场，出示二维码或报名编号完成签到。
          {reg?.name && <div style={{ marginTop: 8 }}>报名人：<strong style={{ color: '#4b5563' }}>{reg.name}</strong> · {reg.email}</div>}
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 12, padding: '8px 16px', minHeight: 36 }} onClick={() => navigate('/checkin')}>
            前往签到管理 →
          </button>
        </div>
      </div>
    </div>
  );
}
