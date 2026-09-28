import React, { useState, useEffect, useCallback } from 'react';
import StallCard from './StallCard';
import MyReservations from './MyReservations';

interface StallOwner {
  id: string;
  username: string;
  displayName: string;
}

interface StallListItem {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  photoUrl: string;
  category: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  maxReservations: number;
  totalSlots: number;
  availableSlots: number;
}

interface TimeSlotDetail {
  label: string;
  hour: number;
  remaining: number;
  isFull: boolean;
}

interface StallDetail extends StallListItem {
  timeSlots: TimeSlotDetail[];
}

interface ReservationItem {
  id: string;
  stallId: string;
  stallName: string;
  customerName: string;
  customerPhone: string;
  timeSlot: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

type Page = 'home' | 'stallDetail' | 'login' | 'myReservations' | 'createStall';

const COLORS = {
  bg: '#F5F0E8',
  cardBg: '#FFFAF3',
  primary: '#6F4E37',
  secondary: '#C4724A',
  accent: '#D4A574',
  text: '#3E2723',
  textLight: '#8D6E63',
  success: '#4CAF50',
  error: '#E53935',
  border: '#E8DDD3',
  white: '#FFFFFF',
};

const CATEGORIES = ['首饰', '陶艺', '插画', '手工', '布艺', '木作'];

const globalStyles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
    background: ${COLORS.bg};
    color: ${COLORS.text};
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${COLORS.accent}; border-radius: 3px; }
`;

function App() {
  const [page, setPage] = useState<Page>('home');
  const [stalls, setStalls] = useState<StallListItem[]>([]);
  const [selectedStall, setSelectedStall] = useState<StallDetail | null>(null);
  const [currentUser, setCurrentUser] = useState<StallOwner | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [notificationVisible, setNotificationVisible] = useState(false);

  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerMode, setRegisterMode] = useState(false);
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', displayName: '' });

  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const [stallForm, setStallForm] = useState({
    name: '',
    description: '',
    photoUrl: '',
    category: '首饰',
    businessHoursStart: 9,
    businessHoursEnd: 18,
    maxReservations: 5,
  });

  const showNotification = useCallback((message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setNotificationVisible(true);
    setTimeout(() => {
      setNotificationVisible(false);
      setTimeout(() => setNotification(null), 300);
    }, 3000);
  }, []);

  const fetchStalls = useCallback(async () => {
    try {
      const res = await fetch('/api/stalls');
      const data = await res.json();
      setStalls(data);
    } catch {
      showNotification('加载摊位失败', 'error');
    }
  }, [showNotification]);

  const fetchStallDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/stalls/${id}`);
      const data = await res.json();
      setSelectedStall(data);
    } catch {
      showNotification('加载详情失败', 'error');
    }
  }, [showNotification]);

  useEffect(() => {
    fetchStalls();
  }, [fetchStalls]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      if (!res.ok) {
        const err = await res.json();
        showNotification(err.error || '登录失败', 'error');
        return;
      }
      const user = await res.json();
      setCurrentUser(user);
      setLoginForm({ username: '', password: '' });
      showNotification(`欢迎回来，${user.displayName}！`, 'success');
      setPage('home');
    } catch {
      showNotification('登录失败，请重试', 'error');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      });
      if (!res.ok) {
        const err = await res.json();
        showNotification(err.error || '注册失败', 'error');
        return;
      }
      const user = await res.json();
      setCurrentUser(user);
      setRegisterForm({ username: '', password: '', displayName: '' });
      showNotification(`注册成功，欢迎 ${user.displayName}！`, 'success');
      setPage('home');
    } catch {
      showNotification('注册失败，请重试', 'error');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setPage('home');
    showNotification('已退出登录', 'success');
  };

  const handleStallClick = async (stallId: string) => {
    await fetchStallDetail(stallId);
    setSelectedTimeSlot(null);
    setCustomerName('');
    setCustomerPhone('');
    setPage('stallDetail');
  };

  const handleReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStall || !selectedTimeSlot) return;
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stallId: selectedStall.id,
          customerName,
          customerPhone,
          timeSlot: selectedTimeSlot,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        showNotification(err.error || '预约失败', 'error');
        return;
      }
      showNotification('预约成功！请等待摊主确认', 'success');
      await fetchStallDetail(selectedStall.id);
      await fetchStalls();
      setSelectedTimeSlot(null);
      setCustomerName('');
      setCustomerPhone('');
    } catch {
      showNotification('预约提交失败，请重试', 'error');
    }
  };

  const handleCreateStall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    try {
      const res = await fetch('/api/stalls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...stallForm, ownerId: currentUser.id }),
      });
      if (!res.ok) {
        showNotification('创建摊位失败', 'error');
        return;
      }
      showNotification('摊位创建成功！', 'success');
      setStallForm({
        name: '',
        description: '',
        photoUrl: '',
        category: '首饰',
        businessHoursStart: 9,
        businessHoursEnd: 18,
        maxReservations: 5,
      });
      await fetchStalls();
      setPage('home');
    } catch {
      showNotification('创建摊位失败', 'error');
    }
  };

  const handleDeleteStall = async (stallId: string) => {
    try {
      const res = await fetch(`/api/stalls/${stallId}`, { method: 'DELETE' });
      if (!res.ok) {
        showNotification('删除失败', 'error');
        return;
      }
      showNotification('摊位已删除', 'success');
      await fetchStalls();
      setPage('home');
    } catch {
      showNotification('删除失败', 'error');
    }
  };

  const renderHeader = () => (
    <header style={{
      background: COLORS.primary,
      color: COLORS.white,
      padding: '0 24px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 12px rgba(111,78,55,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setPage('home')}>
        <span style={{ fontSize: 24 }}>🎪</span>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>创意市集</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {currentUser ? (
          <>
            <button
              onClick={() => setPage('myReservations')}
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: COLORS.white,
                border: '1px solid rgba(255,255,255,0.3)',
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
            >
              📋 我的预约
            </button>
            <button
              onClick={() => setPage('createStall')}
              style={{
                background: COLORS.secondary,
                color: COLORS.white,
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              ➕ 创建摊位
            </button>
            <span style={{ fontSize: 13, opacity: 0.9 }}>👤 {currentUser.displayName}</span>
            <button
              onClick={handleLogout}
              style={{
                background: 'transparent',
                color: COLORS.white,
                border: '1px solid rgba(255,255,255,0.4)',
                padding: '4px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              退出
            </button>
          </>
        ) : (
          <button
            onClick={() => { setRegisterMode(false); setPage('login'); }}
            style={{
              background: COLORS.secondary,
              color: COLORS.white,
              border: 'none',
              padding: '6px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            摊主登录
          </button>
        )}
      </div>
    </header>
  );

  const renderNotification = () => {
    if (!notification) return null;
    return (
      <div style={{
        position: 'fixed',
        top: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        padding: '12px 28px',
        borderRadius: 8,
        background: notification.type === 'success' ? COLORS.success : COLORS.error,
        color: COLORS.white,
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        opacity: notificationVisible ? 1 : 0,
        transition: 'opacity 0.3s ease',
        pointerEvents: 'none',
      }}>
        {notification.type === 'success' ? '✅ ' : '⚠️ '}{notification.message}
      </div>
    );
  };

  const renderHome = () => (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.primary, marginBottom: 8 }}>
          🎪 发现手作之美
        </h1>
        <p style={{ fontSize: 15, color: COLORS.textLight }}>
          浏览创意摊位，预约你心仪的手作体验
        </p>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 20,
      }}
      className="stall-grid"
      >
        {stalls.map((stall) => (
          <StallCard key={stall.id} stall={stall} onClick={() => handleStallClick(stall.id)} />
        ))}
      </div>
      {stalls.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: COLORS.textLight, fontSize: 15 }}>
          暂无摊位，摊主可以登录后创建摊位 🎨
        </div>
      )}
    </div>
  );

  const renderStallDetail = () => {
    if (!selectedStall) return null;
    const isOwner = currentUser?.id === selectedStall.ownerId;
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
        <button
          onClick={() => setPage('home')}
          style={{
            background: 'transparent',
            border: 'none',
            color: COLORS.secondary,
            fontSize: 14,
            cursor: 'pointer',
            marginBottom: 16,
            padding: '4px 0',
            fontWeight: 500,
          }}
        >
          ← 返回列表
        </button>

        <div style={{
          background: COLORS.cardBg,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(111,78,55,0.08)',
        }}>
          <img
            src={selectedStall.photoUrl}
            alt={selectedStall.name}
            style={{
              width: '100%',
              height: 300,
              objectFit: 'cover',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" fill="%23E8DDD3"><rect width="400" height="300"/><text x="200" y="150" text-anchor="middle" fill="%238D6E63" font-size="20">🎪 暂无图片</text></svg>');
            }}
          />
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: COLORS.primary }}>
                {selectedStall.name}
              </h2>
              <span style={{
                background: COLORS.secondary,
                color: COLORS.white,
                padding: '4px 12px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 500,
              }}>
                {selectedStall.category}
              </span>
            </div>
            <p style={{ fontSize: 15, color: COLORS.textLight, lineHeight: 1.7, marginBottom: 16 }}>
              {selectedStall.description}
            </p>
            <div style={{ display: 'flex', gap: 24, fontSize: 13, color: COLORS.textLight, marginBottom: 8 }}>
              <span>🕐 营业时间：{selectedStall.businessHoursStart}:00 - {selectedStall.businessHoursEnd}:00</span>
              <span>👥 每时段最多 {selectedStall.maxReservations} 人</span>
            </div>

            {isOwner && (
              <button
                onClick={() => handleDeleteStall(selectedStall.id)}
                style={{
                  marginTop: 12,
                  background: COLORS.error,
                  color: COLORS.white,
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                🗑 删除此摊位
              </button>
            )}

            <div style={{ marginTop: 24, borderTop: `1px solid ${COLORS.border}`, paddingTop: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.primary, marginBottom: 16 }}>
                📅 选择预约时段
              </h3>
              <div style={{
                display: 'flex',
                gap: 10,
                overflowX: 'auto',
                paddingBottom: 12,
                scrollBehavior: 'smooth',
                WebkitOverflowScrolling: 'touch',
              }}>
                {selectedStall.timeSlots.map((slot) => (
                  <button
                    key={slot.label}
                    disabled={slot.isFull}
                    onClick={() => !slot.isFull && setSelectedTimeSlot(slot.label)}
                    style={{
                      minWidth: 100,
                      padding: '12px 16px',
                      borderRadius: 8,
                      border: selectedTimeSlot === slot.label
                        ? `2px solid ${COLORS.secondary}`
                        : `1px solid ${COLORS.border}`,
                      background: slot.isFull
                        ? '#E0E0E0'
                        : selectedTimeSlot === slot.label
                          ? COLORS.accent + '33'
                          : COLORS.white,
                      color: slot.isFull
                        ? '#999'
                        : selectedTimeSlot === slot.label
                          ? COLORS.secondary
                          : COLORS.text,
                      cursor: slot.isFull ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      fontWeight: selectedTimeSlot === slot.label ? 600 : 400,
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span>{slot.label}</span>
                    <span style={{ fontSize: 11 }}>
                      {slot.isFull ? '已约满' : `余 ${slot.remaining} 位`}
                    </span>
                  </button>
                ))}
              </div>

              {selectedTimeSlot && (
                <form
                  onSubmit={handleReservation}
                  style={{
                    marginTop: 20,
                    background: COLORS.bg,
                    padding: 20,
                    borderRadius: 10,
                    animation: 'fadeInUp 0.3s ease',
                  }}
                >
                  <h4 style={{ fontSize: 14, fontWeight: 600, color: COLORS.primary, marginBottom: 14 }}>
                    填写预约信息 · {selectedTimeSlot}
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                      type="text"
                      placeholder="联系人姓名"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: `1px solid ${COLORS.border}`,
                        fontSize: 14,
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        background: COLORS.white,
                      }}
                      onFocus={(e) => (e.target.style.borderColor = COLORS.secondary)}
                      onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
                    />
                    <input
                      type="tel"
                      placeholder="手机号码"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      required
                      pattern="[0-9]{11}"
                      title="请输入11位手机号码"
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: `1px solid ${COLORS.border}`,
                        fontSize: 14,
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        background: COLORS.white,
                      }}
                      onFocus={(e) => (e.target.style.borderColor = COLORS.secondary)}
                      onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
                    />
                    <button
                      type="submit"
                      style={{
                        background: COLORS.secondary,
                        color: COLORS.white,
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'opacity 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                    >
                      确认预约
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderLogin = () => (
    <div style={{
      maxWidth: 400,
      margin: '60px auto',
      padding: '32px 28px',
      background: COLORS.cardBg,
      borderRadius: 12,
      boxShadow: '0 2px 16px rgba(111,78,55,0.1)',
    }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.primary, marginBottom: 8, textAlign: 'center' }}>
        {registerMode ? '📝 摊主注册' : '🔐 摊主登录'}
      </h2>
      <p style={{ fontSize: 13, color: COLORS.textLight, textAlign: 'center', marginBottom: 24 }}>
        {registerMode ? '创建账号，开始发布你的摊位' : '登录后管理摊位和预约'}
      </p>

      <form onSubmit={registerMode ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          type="text"
          placeholder="用户名"
          value={registerMode ? registerForm.username : loginForm.username}
          onChange={(e) => registerMode
            ? setRegisterForm({ ...registerForm, username: e.target.value })
            : setLoginForm({ ...loginForm, username: e.target.value })
          }
          required
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
            fontSize: 14,
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => (e.target.style.borderColor = COLORS.secondary)}
          onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
        />
        <input
          type="password"
          placeholder="密码"
          value={registerMode ? registerForm.password : loginForm.password}
          onChange={(e) => registerMode
            ? setRegisterForm({ ...registerForm, password: e.target.value })
            : setLoginForm({ ...loginForm, password: e.target.value })
          }
          required
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
            fontSize: 14,
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => (e.target.style.borderColor = COLORS.secondary)}
          onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
        />
        {registerMode && (
          <input
            type="text"
            placeholder="显示名称（如：王匠人）"
            value={registerForm.displayName}
            onChange={(e) => setRegisterForm({ ...registerForm, displayName: e.target.value })}
            required
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              fontSize: 14,
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.target.style.borderColor = COLORS.secondary)}
            onBlur={(e) => (e.target.style.borderColor = COLORS.border)}
          />
        )}
        <button
          type="submit"
          style={{
            background: COLORS.secondary,
            color: COLORS.white,
            border: 'none',
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
            marginTop: 4,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          {registerMode ? '注册' : '登录'}
        </button>
      </form>

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
        <span style={{ color: COLORS.textLight }}>
          {registerMode ? '已有账号？' : '没有账号？'}
        </span>
        <button
          onClick={() => setRegisterMode(!registerMode)}
          style={{
            background: 'transparent',
            border: 'none',
            color: COLORS.secondary,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {registerMode ? '去登录' : '去注册'}
        </button>
      </div>

      <button
        onClick={() => setPage('home')}
        style={{
          background: 'transparent',
          border: 'none',
          color: COLORS.textLight,
          cursor: 'pointer',
          fontSize: 13,
          marginTop: 12,
          display: 'block',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        ← 返回首页
      </button>

      {!registerMode && (
        <div style={{
          marginTop: 20,
          padding: 12,
          background: COLORS.bg,
          borderRadius: 8,
          fontSize: 12,
          color: COLORS.textLight,
          textAlign: 'center',
        }}>
          测试账号：artwang / 123456
        </div>
      )}
    </div>
  );

  const renderCreateStall = () => (
    <div style={{
      maxWidth: 600,
      margin: '24px auto',
      padding: '28px',
      background: COLORS.cardBg,
      borderRadius: 12,
      boxShadow: '0 2px 16px rgba(111,78,55,0.1)',
    }}>
      <button
        onClick={() => setPage('home')}
        style={{
          background: 'transparent',
          border: 'none',
          color: COLORS.secondary,
          fontSize: 14,
          cursor: 'pointer',
          marginBottom: 16,
          fontWeight: 500,
        }}
      >
        ← 返回列表
      </button>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.primary, marginBottom: 20 }}>
        ➕ 创建新摊位
      </h2>
      <form onSubmit={handleCreateStall} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input
          type="text"
          placeholder="摊位名称"
          value={stallForm.name}
          onChange={(e) => setStallForm({ ...stallForm, name: e.target.value })}
          required
          style={inputStyle}
        />
        <textarea
          placeholder="摊位简介"
          value={stallForm.description}
          onChange={(e) => setStallForm({ ...stallForm, description: e.target.value })}
          required
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <input
          type="url"
          placeholder="摊位照片URL（可选，留空使用默认图）"
          value={stallForm.photoUrl}
          onChange={(e) => setStallForm({ ...stallForm, photoUrl: e.target.value })}
          style={inputStyle}
        />
        <div>
          <label style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 6, display: 'block' }}>经营品类</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setStallForm({ ...stallForm, category: cat })}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: stallForm.category === cat
                    ? `2px solid ${COLORS.secondary}`
                    : `1px solid ${COLORS.border}`,
                  background: stallForm.category === cat
                    ? COLORS.accent + '33'
                    : COLORS.white,
                  color: stallForm.category === cat ? COLORS.secondary : COLORS.textLight,
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'all 0.2s',
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 6, display: 'block' }}>开始营业（时）</label>
            <input
              type="number"
              min={6}
              max={22}
              value={stallForm.businessHoursStart}
              onChange={(e) => setStallForm({ ...stallForm, businessHoursStart: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 6, display: 'block' }}>结束营业（时）</label>
            <input
              type="number"
              min={7}
              max={23}
              value={stallForm.businessHoursEnd}
              onChange={(e) => setStallForm({ ...stallForm, businessHoursEnd: Number(e.target.value) })}
              style={inputStyle}
            />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 13, color: COLORS.textLight, marginBottom: 6, display: 'block' }}>每时段最大预约人数</label>
          <input
            type="number"
            min={1}
            max={50}
            value={stallForm.maxReservations}
            onChange={(e) => setStallForm({ ...stallForm, maxReservations: Number(e.target.value) })}
            style={inputStyle}
          />
        </div>
        <button
          type="submit"
          style={{
            background: COLORS.secondary,
            color: COLORS.white,
            border: 'none',
            padding: '12px 20px',
            borderRadius: 8,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
            marginTop: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          创建摊位
        </button>
      </form>
    </div>
  );

  const renderPage = () => {
    switch (page) {
      case 'home': return renderHome();
      case 'stallDetail': return renderStallDetail();
      case 'login': return renderLogin();
      case 'myReservations': return currentUser ? <MyReservations ownerId={currentUser.id} showNotification={showNotification} /> : renderHome();
      case 'createStall': return currentUser ? renderCreateStall() : renderHome();
      default: return renderHome();
    }
  };

  return (
    <>
      <style>{globalStyles + responsiveCSS + animationsCSS}</style>
      {renderHeader()}
      {renderNotification()}
      <main style={{ minHeight: 'calc(100vh - 60px)' }}>
        {renderPage()}
      </main>
      <footer style={{
        textAlign: 'center',
        padding: '20px',
        fontSize: 12,
        color: COLORS.textLight,
        borderTop: `1px solid ${COLORS.border}`,
      }}>
        🎪 创意市集 · 摊位预约管理系统
      </footer>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  fontSize: 14,
  outline: 'none',
  transition: 'border-color 0.2s',
  background: COLORS.white,
  width: '100%',
  fontFamily: 'inherit',
};

const responsiveCSS = `
  @media (max-width: 1024px) {
    .stall-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
  }
  @media (max-width: 640px) {
    .stall-grid {
      grid-template-columns: 1fr !important;
    }
    .stall-grid > * {
      width: 100% !important;
    }
  }
`;

const animationsCSS = `
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

export default App;
