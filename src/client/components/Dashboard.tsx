import { useState, useEffect } from 'react';
import { User } from '../hooks/useAuth';

// 预约类型定义
interface Booking {
  id: string;
  courseId: string;
  courseName: string;
  coachName: string;
  startTime: string;
  status: 'booked' | 'checked-in' | 'cancelled';
}

// 仪表盘组件
// 数据流向：从props获取token和user -> fetch获取预约列表 -> 点击生成二维码 -> fetch获取Base64图片
// 调用关系：Dashboard -> fetch(/api/bookings, /api/qrcode) -> 后端routes/courses.ts, qrcode.ts
interface DashboardProps {
  user: User;
  token: string;
  updateUser: (data: Partial<User>) => void;
}

export default function Dashboard({ user, token, updateUser }: DashboardProps) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrCodeModalOpen, setQrCodeModalOpen] = useState(false);
  const [qrCodeImage, setQrCodeImage] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // 加载用户预约列表
  useEffect(() => {
    loadBookings();
  }, [token]);

  const loadBookings = async () => {
    try {
      const res = await fetch('/api/bookings', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      }
    } catch (err) {
      console.error('加载预约失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 生成签到二维码
  // 数据流向：点击按钮 -> fetch POST /api/qrcode -> 后端生成JWT签名的二维码（含bookingId和userId）
  // -> 返回Base64图片 -> 在模态框中展示
  const generateQRCode = async (booking: Booking) => {
    if (booking.status !== 'booked') {
      alert('该预约无法签到');
      return;
    }

    // 检查是否在课程开始前30分钟内
    const courseTime = new Date(booking.startTime).getTime();
    const now = Date.now();
    const diffMinutes = (courseTime - now) / (1000 * 60);

    if (diffMinutes > 30) {
      alert('只能在课程开始前30分钟内生成签到二维码');
      return;
    }

    if (diffMinutes < -30) {
      alert('课程已结束，无法签到');
      return;
    }

    setSelectedBooking(booking);
    setQrLoading(true);
    setQrCodeModalOpen(true);

    try {
      // fetch调用示例：请求后端生成签到二维码
      // 请求体包含bookingId和用户信息，后端使用jsonwebtoken签名防止篡改
      const res = await fetch('/api/qrcode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bookingId: booking.id,
          courseName: booking.courseName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '二维码生成失败');
      }

      // 后端返回Base64格式的二维码图片
      setQrCodeImage(data.qrCode);
    } catch (err: any) {
      alert(err.message || '二维码生成失败');
      setQrCodeModalOpen(false);
    } finally {
      setQrLoading(false);
    }
  };

  // 计算距离VIP升级还需要多少次预约
  const nextLevelCount = user.level === 'normal' ? Math.max(0, 5 - user.bookingCount) : 0;

  // 筛选即将开始的课程（未来24小时内）
  const upcomingBookings = bookings.filter((b) => {
    const courseTime = new Date(b.startTime).getTime();
    const now = Date.now();
    return courseTime > now && courseTime - now < 24 * 60 * 60 * 1000;
  });

  // 筛选已签到的课程
  const checkedInBookings = bookings.filter((b) => b.status === 'checked-in');

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1>个人中心</h1>
        <p>欢迎回来，{user.name}！</p>
      </div>

      {/* 用户信息卡片 */}
      <div className="info-cards">
        <div className="info-card glass-card">
          <div className="info-icon">👤</div>
          <div className="info-content">
            <p className="info-label">会员等级</p>
            <p className={`info-value ${user.level}`}>
              {user.level === 'vip' ? '⭐ VIP会员' : '🎯 普通会员'}
            </p>
            {user.level === 'normal' && nextLevelCount > 0 && (
              <p className="info-sub">
                再预约 <strong>{nextLevelCount}</strong> 次即可升级为VIP
              </p>
            )}
          </div>
        </div>

        <div className="info-card glass-card">
          <div className="info-icon">📊</div>
          <div className="info-content">
            <p className="info-label">累计预约</p>
            <p className="info-value">{user.bookingCount} 次</p>
            <p className="info-sub">已完成签到 {checkedInBookings.length} 次</p>
          </div>
        </div>

        <div className="info-card glass-card">
          <div className="info-icon">📧</div>
          <div className="info-content">
            <p className="info-label">账户邮箱</p>
            <p className="info-value small">{user.email}</p>
            <p className="info-sub">ID: {user.id.slice(0, 8)}...</p>
          </div>
        </div>
      </div>

      {/* 即将开始的课程 */}
      <div className="section">
        <h2 className="section-title">🔥 即将开始的课程</h2>
        {loading ? (
          <div className="loading">加载中...</div>
        ) : upcomingBookings.length === 0 ? (
          <div className="empty-state">
            <p>暂无即将开始的课程</p>
            <button className="btn-primary" onClick={() => window.location.hash = '#courses'}>
              去预约课程
            </button>
          </div>
        ) : (
          <div className="upcoming-list">
            {upcomingBookings.map((booking) => {
              const courseTime = new Date(booking.startTime);
              const canCheckIn = (courseTime.getTime() - Date.now()) / (1000 * 60) <= 30;

              return (
                <div key={booking.id} className="booking-item glass-card">
                  <div className="booking-info">
                    <h3 className="course-name">{booking.courseName}</h3>
                    <p className="booking-meta">
                      教练: {booking.coachName} | 时间: {courseTime.toLocaleString('zh-CN')}
                    </p>
                    <span className={`status-badge ${booking.status}`}>
                      {booking.status === 'booked' ? '✅ 已预约' :
                       booking.status === 'checked-in' ? '✓ 已签到' : '✕ 已取消'}
                    </span>
                  </div>
                  <div className="booking-actions">
                    {booking.status === 'booked' && (
                      <button
                        className={`btn-primary ${!canCheckIn ? 'disabled' : ''}`}
                        onClick={() => generateQRCode(booking)}
                        disabled={!canCheckIn}
                      >
                        {canCheckIn ? '📱 生成签到码' : '⏰ 提前30分钟开放'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 全部预约记录 */}
      <div className="section">
        <h2 className="section-title">📋 全部预约记录</h2>
        {loading ? (
          <div className="loading">加载中...</div>
        ) : bookings.length === 0 ? (
          <div className="empty-state">
            <p>暂无预约记录</p>
          </div>
        ) : (
          <div className="booking-list">
            {bookings.map((booking) => {
              const courseTime = new Date(booking.startTime);
              return (
                <div key={booking.id} className="booking-item glass-card">
                  <div className="booking-info">
                    <h3 className="course-name">{booking.courseName}</h3>
                    <p className="booking-meta">
                      教练: {booking.coachName} | 时间: {courseTime.toLocaleString('zh-CN')}
                    </p>
                    <span className={`status-badge ${booking.status}`}>
                      {booking.status === 'booked' ? '✅ 已预约' :
                       booking.status === 'checked-in' ? '✓ 已签到' : '✕ 已取消'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 二维码模态框 - 居中展示，带淡蓝色光晕动画 */}
      {qrCodeModalOpen && (
        <div className="modal-overlay" onClick={() => setQrCodeModalOpen(false)}>
          <div className="modal-content qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="qr-glow">
              <button className="modal-close" onClick={() => setQrCodeModalOpen(false)}>
                ✕
              </button>

              <h3>📱 签到二维码</h3>
              {selectedBooking && (
                <p className="qr-course-name">{selectedBooking.courseName}</p>
              )}

              {qrLoading ? (
                <div className="qr-loading">
                  <div className="spinner"></div>
                  <p>正在生成二维码...</p>
                </div>
              ) : (
                <div className="qr-code-container">
                  {qrCodeImage && (
                    <img src={qrCodeImage} alt="签到二维码" className="qr-code-image" />
                  )}
                </div>
              )}

              <p className="qr-tip">请向教练出示此二维码完成签到</p>
              <p className="qr-expire">二维码有效期：5分钟</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
