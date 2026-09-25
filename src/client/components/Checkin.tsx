import { useState } from 'react';

// 签到核销组件
// 数据流向：教练输入二维码内容 -> fetch POST /api/checkin -> 后端校验JWT签名 -> 返回签到结果
// 调用关系：Checkin -> fetch(/api/checkin) -> 后端routes/qrcode.ts -> 验证签名 -> 更新预约状态
interface CheckinProps {
  token: string;
}

export default function Checkin({ token }: CheckinProps) {
  const [qrContent, setQrContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    booking?: any;
  } | null>(null);

  // 提交签到核销
  const handleCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      // 二维码内容是后端JWT签名的token，包含bookingId和userId
      // 后端会校验签名有效性和有效期
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ qrToken: qrContent }),
      });

      const data = await res.json();

      setResult({
        success: res.ok,
        message: data.message || (res.ok ? '签到成功！' : '签到失败'),
        booking: data.booking,
      });
    } catch (err: any) {
      setResult({
        success: false,
        message: err.message || '签到失败，请重试',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="checkin-page">
      <div className="page-header">
        <h1>签到核销</h1>
        <p>教练使用此页面扫描或输入会员的签到二维码内容</p>
      </div>

      <div className="checkin-container">
        <div className="checkin-card glass-card">
          <div className="checkin-icon">📱</div>
          <h3>会员签到验证</h3>
          <p className="checkin-desc">
            请输入会员出示的签到二维码内容，或扫描二维码获取的token
          </p>

          <form onSubmit={handleCheckin} className="checkin-form">
            <div className="form-group">
              <label>二维码内容</label>
              <textarea
                value={qrContent}
                onChange={(e) => setQrContent(e.target.value)}
                placeholder="粘贴或输入二维码token..."
                rows={4}
                required
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '验证中...' : '✅ 确认签到'}
            </button>
          </form>

          {result && (
            <div className={`checkin-result ${result.success ? 'success' : 'error'}`}>
              <div className="result-icon">
                {result.success ? '✓' : '✕'}
              </div>
              <p className="result-message">{result.message}</p>
              {result.success && result.booking && (
                <div className="result-details">
                  <p><strong>课程：</strong>{result.booking.courseName}</p>
                  <p><strong>会员：</strong>{result.booking.userName}</p>
                  <p><strong>教练：</strong>{result.booking.coachName}</p>
                  <p><strong>状态：</strong>
                    <span className="status-success">已签到</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="checkin-info glass-card">
          <h3>💡 使用说明</h3>
          <ul className="info-list">
            <li>会员在课程开始前30分钟内生成签到二维码</li>
            <li>二维码包含JWT签名，包含预约ID和用户ID，防止伪造</li>
            <li>二维码有效期为5分钟，过期需重新生成</li>
            <li>签到后预约状态自动更新为"已签到"</li>
            <li>系统会自动校验二维码的合法性和时效性</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
