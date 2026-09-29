import React, { useState, useEffect } from 'react';
import { theme } from '../styles/theme';
import {
  BookstoreEvent,
  EventType,
  Registration,
} from '../data/mockData';

interface RegistrationModuleProps {
  event: BookstoreEvent;
  registrations: Registration[];
  registrationCount: number;
  onRegister: (data: { name: string; phone: string; email: string }) => boolean;
  onBack: () => void;
  onViewReport: () => void;
  onCheckInMode: () => void;
}

const typeColorMap: Record<EventType, string> = {
  '读书会': '#E8D5B7',
  '新书签售': '#C9E4C5',
  '作者对谈': '#B5D3E7',
  '手工工作坊': '#F4C2C2',
};

const typeTextColor: Record<EventType, string> = {
  '读书会': '#6B4C2E',
  '新书签售': '#2E6B3E',
  '作者对谈': '#2E4E6B',
  '手工工作坊': '#6B2E2E',
};

const RegistrationModule: React.FC<RegistrationModuleProps> = ({
  event,
  registrations,
  registrationCount,
  onRegister,
  onBack,
  onViewReport,
  onCheckInMode,
}) => {
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [isFull, setIsFull] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const isPast = event.date < today;
  const isToday = event.date === today;

  useEffect(() => {
    setIsFull(registrationCount >= event.maxParticipants);
  }, [registrationCount, event.maxParticipants]);

  const validatePhone = (phone: string): boolean => {
    return /^\d{11}$/.test(phone);
  };

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!form.name.trim()) newErrors.name = '请输入姓名';
    if (!form.phone) {
      newErrors.phone = '请输入手机号';
    } else if (!validatePhone(form.phone)) {
      newErrors.phone = '手机号必须为11位数字';
    }
    if (!form.email) {
      newErrors.email = '请输入邮箱';
    } else if (!validateEmail(form.email)) {
      newErrors.email = '邮箱格式不正确';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const success = onRegister(form);
    if (success) {
      setShowSuccess(true);
      setForm({ name: '', phone: '', email: '' });
      setErrors({});
      setTimeout(() => setShowSuccess(false), 2000);
    }
  };

  const remaining = event.maxParticipants - registrationCount;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: theme.spacing.lg }}>
      <button
        className="btn-ripple"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: theme.colors.primary,
          fontSize: theme.fonts.size.base,
          cursor: 'pointer',
          padding: '8px 0',
          marginBottom: theme.spacing.md,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          transition: `transform ${theme.transition.fast}`,
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        ← 返回活动列表
      </button>

      <div style={{
        background: theme.colors.cardBg,
        borderRadius: theme.borderRadius.md,
        boxShadow: theme.shadow.card,
        overflow: 'hidden',
        marginBottom: theme.spacing.xl,
      }}>
        <div style={{
          background: `linear-gradient(135deg, ${typeColorMap[event.type]}, ${theme.colors.secondary})`,
          padding: theme.spacing.xl,
          position: 'relative',
        }}>
          <span style={{
            background: 'rgba(255,255,255,0.9)',
            color: typeTextColor[event.type],
            padding: '4px 14px',
            borderRadius: 20,
            fontSize: theme.fonts.size.xs,
            fontWeight: 500,
            marginBottom: theme.spacing.sm,
            display: 'inline-block',
          }}>
            {event.type}
          </span>
          <h1 style={{
            fontSize: theme.fonts.size.xxl,
            fontWeight: 700,
            color: theme.colors.textPrimary,
            marginTop: theme.spacing.sm,
          }}>
            {event.name}
          </h1>
          <div style={{ marginTop: theme.spacing.sm, color: theme.colors.textSecondary, fontSize: theme.fonts.size.base }}>
            📅 {event.date} &nbsp; 🕐 {event.startTime} - {event.endTime}
          </div>
        </div>

        <div style={{ padding: theme.spacing.xl }}>
          <p style={{
            color: theme.colors.textSecondary,
            lineHeight: 1.8,
            fontSize: theme.fonts.size.base,
            marginBottom: theme.spacing.lg,
          }}>
            {event.description}
          </p>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: `${theme.spacing.md} ${theme.spacing.lg}`,
            background: remaining <= 5 ? '#FFF3E0' : '#F5F5F5',
            borderRadius: 8,
            marginBottom: theme.spacing.lg,
          }}>
            <span style={{ fontSize: theme.fonts.size.base }}>
              👥 报名人数
            </span>
            <span style={{
              fontSize: theme.fonts.size.xl,
              fontWeight: 700,
              color: remaining <= 0 ? theme.colors.error : (remaining <= 5 ? '#E65100' : theme.colors.primary),
            }}>
              {registrationCount} / {event.maxParticipants}
              <span style={{ fontSize: theme.fonts.size.sm, fontWeight: 400, marginLeft: 8 }}>
                (剩余 {remaining} 个名额)
              </span>
            </span>
          </div>

          {isPast && (
            <div style={{ marginBottom: theme.spacing.lg }}>
              <button
                className="btn-ripple"
                onClick={onViewReport}
                style={{
                  background: '#1565C0',
                  color: '#FFF',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: 8,
                  fontSize: theme.fonts.size.base,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: `transform ${theme.transition.fast}`,
                  boxShadow: theme.shadow.button,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                📊 查看签到分析报告
              </button>
            </div>
          )}

          {isToday && (
            <div style={{ marginBottom: theme.spacing.lg }}>
              <button
                className="btn-ripple"
                onClick={onCheckInMode}
                style={{
                  background: '#2E7D32',
                  color: '#FFF',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: 8,
                  fontSize: theme.fonts.size.base,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: `transform ${theme.transition.fast}`,
                  boxShadow: theme.shadow.button,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                ✅ 进入签到模式
              </button>
            </div>
          )}

          {!isPast && (
            <>
              <h3 style={{
                fontSize: theme.fonts.size.lg,
                color: theme.colors.primary,
                marginBottom: theme.spacing.md,
                paddingBottom: theme.spacing.sm,
                borderBottom: `2px solid ${theme.colors.border}`,
              }}>
                在线报名
              </h3>

              {isFull ? (
                <div style={{
                  textAlign: 'center',
                  padding: theme.spacing.xl,
                  background: '#F5F5F5',
                  borderRadius: 8,
                  color: '#999',
                  fontSize: theme.fonts.size.lg,
                  fontWeight: 500,
                }}>
                  名额已满
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div style={{ marginBottom: theme.spacing.md }}>
                    <label style={labelStyle}>姓名 *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="请输入您的姓名"
                      style={inputStyle(errors.name)}
                      onFocus={e => !errors.name && (e.currentTarget.style.borderColor = theme.colors.primary)}
                      onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                    />
                    {errors.name && <span style={errorStyle}>{errors.name}</span>}
                  </div>

                  <div style={{ marginBottom: theme.spacing.md }}>
                    <label style={labelStyle}>手机号 *</label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 11);
                        setForm(p => ({ ...p, phone: val }));
                      }}
                      placeholder="请输入11位手机号"
                      maxLength={11}
                      style={inputStyle(errors.phone)}
                      onFocus={e => !errors.phone && (e.currentTarget.style.borderColor = theme.colors.primary)}
                      onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                    />
                    {errors.phone && <span style={errorStyle}>{errors.phone}</span>}
                  </div>

                  <div style={{ marginBottom: theme.spacing.md }}>
                    <label style={labelStyle}>邮箱 *</label>
                    <input
                      type="text"
                      value={form.email}
                      onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="请输入邮箱地址"
                      style={inputStyle(errors.email)}
                      onFocus={e => !errors.email && (e.currentTarget.style.borderColor = theme.colors.primary)}
                      onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
                    />
                    {errors.email && <span style={errorStyle}>{errors.email}</span>}
                  </div>

                  <button
                    type="submit"
                    className="btn-ripple"
                    style={{
                      background: theme.colors.primary,
                      color: '#FFF',
                      border: 'none',
                      padding: '12px 32px',
                      borderRadius: 8,
                      fontSize: theme.fonts.size.base,
                      fontWeight: 500,
                      cursor: 'pointer',
                      width: '100%',
                      transition: `transform ${theme.transition.fast}`,
                      boxShadow: theme.shadow.button,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                    onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                  >
                    立即报名
                  </button>
                </form>
              )}
            </>
          )}

          {isPast && !isToday && (
            <div style={{
              textAlign: 'center',
              padding: theme.spacing.lg,
              background: '#F5F5F5',
              borderRadius: 8,
              color: '#999',
              fontSize: theme.fonts.size.base,
            }}>
              该活动已结束，无法报名
            </div>
          )}
        </div>
      </div>

      {showSuccess && (
        <div
          className="notification-enter"
          style={{
            position: 'fixed',
            top: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: theme.colors.success,
            color: '#FFF',
            padding: '14px 32px',
            borderRadius: 8,
            fontSize: theme.fonts.size.base,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            zIndex: 1000,
          }}
        >
          ✅ 报名成功！
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: '0.875rem',
  fontWeight: 500,
  color: theme.colors.textSecondary,
};

const inputStyle = (error?: string): React.CSSProperties => ({
  width: '100%',
  padding: '10px 14px',
  border: `2px solid ${error ? theme.colors.error : theme.colors.border}`,
  borderRadius: 8,
  fontSize: '1rem',
  outline: 'none',
  transition: `border-color 0.3s`,
  background: '#FFF',
  fontFamily: 'inherit',
  ...(error ? { animation: 'shake 0.3s ease-in-out' } : {}),
});

const errorStyle: React.CSSProperties = {
  color: theme.colors.error,
  fontSize: '0.75rem',
  marginTop: 4,
  display: 'block',
};

export default RegistrationModule;
