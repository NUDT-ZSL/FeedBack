import React, { useState, useMemo, useCallback } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { theme } from '../styles/theme';
import {
  BookstoreEvent,
  Registration,
  CheckInRecord,
} from '../data/mockData';

interface CheckInDashboardProps {
  event: BookstoreEvent;
  registrations: Registration[];
  checkInRecords: CheckInRecord[];
  onCheckIn: (registrationId: string) => void;
  onBack: () => void;
  initialMode?: 'checkin' | 'report';
}

const getRateColor = (rate: number): string => {
  if (rate >= 0.8) return '#4CAF50';
  if (rate >= 0.6) return '#8BC34A';
  if (rate >= 0.4) return '#FFC107';
  if (rate >= 0.2) return '#FF9800';
  return '#F44336';
};

const CheckInDashboard: React.FC<CheckInDashboardProps> = ({
  event,
  registrations,
  checkInRecords,
  onCheckIn,
  onBack,
  initialMode = 'checkin',
}) => {
  const [mode, setMode] = useState<'checkin' | 'report'>(initialMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [pulseActive, setPulseActive] = useState(false);

  const totalReg = registrations.length;
  const checkedInRecords = checkInRecords.filter(r => r.checkedIn);
  const totalCheckedIn = checkedInRecords.length;
  const checkInRate = totalReg > 0 ? totalCheckedIn / totalReg : 0;

  const uncheckedList = useMemo(() => {
    return registrations.filter(reg => {
      const record = checkInRecords.find(r => r.registrationId === reg.id);
      return !record || !record.checkedIn;
    });
  }, [registrations, checkInRecords]);

  const filteredRegistrations = useMemo(() => {
    if (!searchQuery.trim()) return registrations;
    const q = searchQuery.trim().toLowerCase();
    return registrations.filter(
      r => r.name.toLowerCase().includes(q) || r.phone.includes(q)
    );
  }, [registrations, searchQuery]);

  const timeDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const record of checkedInRecords) {
      if (!record.checkedInAt) continue;
      const date = new Date(record.checkedInAt);
      const h = date.getHours();
      const m = date.getMinutes();
      const slotStart = m < 30 ? h * 60 + 0 : h * 60 + 30;
      const slotH = Math.floor(slotStart / 60);
      const slotM = slotStart % 60;
      const label = `${String(slotH).padStart(2, '0')}:${String(slotM).padStart(2, '0')}`;
      dist[label] = (dist[label] || 0) + 1;
    }

    const sorted = Object.entries(dist)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));

    return sorted;
  }, [checkedInRecords]);

  const pieData = useMemo(() => {
    return [
      { name: '已签到', value: totalCheckedIn },
      { name: '未签到', value: totalReg - totalCheckedIn },
    ];
  }, [totalCheckedIn, totalReg]);

  const handleExportCSV = useCallback(() => {
    setPulseActive(true);
    setTimeout(() => setPulseActive(false), 1000);

    const headers = ['活动名称', '日期', '报名者姓名', '手机号', '签到状态', '签到时间'];
    const rows = registrations.map(reg => {
      const record = checkInRecords.find(r => r.registrationId === reg.id);
      const status = record?.checkedIn ? '已签到' : '未签到';
      const time = record?.checkedInAt
        ? new Date(record.checkedInAt).toLocaleString('zh-CN')
        : '';
      return [event.name, event.date, reg.name, reg.phone, status, time];
    });

    const bom = '\uFEFF';
    const csvContent =
      bom +
      [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.name}_签到报告_${event.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [registrations, checkInRecords, event]);

  const rateColor = getRateColor(checkInRate);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: theme.spacing.lg }}>
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
        ← 返回活动详情
      </button>

      <div style={{
        display: 'flex',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.xl,
      }}>
        <button
          className="btn-ripple"
          onClick={() => setMode('checkin')}
          style={{
            ...tabStyle,
            background: mode === 'checkin' ? theme.colors.primary : '#E0E0E0',
            color: mode === 'checkin' ? '#FFF' : theme.colors.textPrimary,
            transition: `transform ${theme.transition.fast}`,
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          ✅ 签到模式
        </button>
        <button
          className="btn-ripple"
          onClick={() => setMode('report')}
          style={{
            ...tabStyle,
            background: mode === 'report' ? theme.colors.primary : '#E0E0E0',
            color: mode === 'report' ? '#FFF' : theme.colors.textPrimary,
            transition: `transform ${theme.transition.fast}`,
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          📊 签到报告
        </button>
      </div>

      {mode === 'checkin' && (
        <div>
          <div style={{
            background: theme.colors.cardBg,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.lg,
            boxShadow: theme.shadow.card,
            marginBottom: theme.spacing.lg,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: theme.spacing.md,
            }}>
              <div>
                <h2 style={{ fontSize: theme.fonts.size.xl, color: theme.colors.textPrimary, marginBottom: 4 }}>
                  {event.name}
                </h2>
                <span style={{ fontSize: theme.fonts.size.sm, color: theme.colors.textSecondary }}>
                  📅 {event.date} &nbsp; 🕐 {event.startTime} - {event.endTime}
                </span>
              </div>
              <div style={{
                background: '#F5F5F5',
                padding: '10px 20px',
                borderRadius: 8,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: theme.fonts.size.xxl, fontWeight: 700, color: theme.colors.primary }}>
                  {totalCheckedIn} / {totalReg}
                </div>
                <div style={{ fontSize: theme.fonts.size.xs, color: theme.colors.textLight }}>
                  签到人数 / 报名人数
                </div>
              </div>
            </div>
          </div>

          <div style={{
            background: theme.colors.cardBg,
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.md,
            boxShadow: theme.shadow.card,
            marginBottom: theme.spacing.md,
          }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 搜索姓名或手机号..."
              style={{
                width: '100%',
                padding: '10px 16px',
                border: `2px solid ${theme.colors.border}`,
                borderRadius: 8,
                fontSize: theme.fonts.size.base,
                outline: 'none',
                transition: `border-color ${theme.transition.normal}`,
                background: '#FFF',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = theme.colors.primary)}
              onBlur={e => (e.currentTarget.style.borderColor = theme.colors.border)}
            />
          </div>

          <div style={{
            background: theme.colors.cardBg,
            borderRadius: theme.borderRadius.md,
            boxShadow: theme.shadow.card,
            overflow: 'hidden',
          }}>
            <div className="checkin-row" style={{
              background: '#F5F0E8',
              fontWeight: 600,
              fontSize: theme.fonts.size.sm,
              color: theme.colors.textSecondary,
              borderTop: 'none',
            }}>
              <span>姓名</span>
              <span>手机号</span>
              <span className="email-col">邮箱</span>
              <span style={{ textAlign: 'center' }}>签到状态</span>
            </div>

            {filteredRegistrations.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: theme.spacing.xl,
                color: theme.colors.textLight,
              }}>
                暂无匹配的报名者
              </div>
            )}

            {filteredRegistrations.map(reg => {
              const record = checkInRecords.find(r => r.registrationId === reg.id);
              const isCheckedIn = record?.checkedIn ?? false;

              return (
                <div
                  key={reg.id}
                  className="checkin-row"
                  style={{
                    background: isCheckedIn ? '#E8F5E9' : 'transparent',
                  }}
                >
                  <span style={{ fontWeight: 500, color: theme.colors.textPrimary }}>
                    {reg.name}
                  </span>
                  <span style={{ color: theme.colors.textSecondary }}>{reg.phone}</span>
                  <span className="email-col" style={{
                    color: theme.colors.textLight,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {reg.email}
                  </span>
                  <div style={{ textAlign: 'center' }}>
                    {isCheckedIn ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: '#C8E6C9',
                        color: '#2E7D32',
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: theme.fonts.size.xs,
                        fontWeight: 500,
                      }}>
                        ✓ 已签到
                      </span>
                    ) : (
                      <button
                        className="btn-ripple"
                        onClick={() => onCheckIn(reg.id)}
                        style={{
                          background: theme.colors.primary,
                          color: '#FFF',
                          border: 'none',
                          padding: '6px 16px',
                          borderRadius: 20,
                          fontSize: theme.fonts.size.xs,
                          cursor: 'pointer',
                          fontWeight: 500,
                          transition: `transform ${theme.transition.fast}, background ${theme.transition.fast}`,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                      >
                        签到
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'report' && (
        <div>
          <div style={{
            background: '#1E1E2E',
            borderRadius: theme.borderRadius.md,
            padding: theme.spacing.xl,
            color: '#FFFFFF',
            marginBottom: theme.spacing.xl,
          }}>
            <h2 style={{
              fontSize: theme.fonts.size.xxl,
              marginBottom: theme.spacing.lg,
              color: '#FFFFFF',
            }}>
              📊 签到分析报告
            </h2>
            <p style={{ color: '#AAA', fontSize: theme.fonts.size.sm, marginBottom: theme.spacing.lg }}>
              {event.name} · {event.date}
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.xl,
            }}>
              <div style={{
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: theme.spacing.lg,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: theme.fonts.size.xxl, fontWeight: 700, color: '#FFFFFF' }}>
                  {totalReg}
                </div>
                <div style={{ fontSize: theme.fonts.size.sm, color: '#AAA', marginTop: 4 }}>
                  总报名人数
                </div>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: theme.spacing.lg,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: theme.fonts.size.xxl, fontWeight: 700, color: rateColor }}>
                  {totalCheckedIn}
                </div>
                <div style={{ fontSize: theme.fonts.size.sm, color: '#AAA', marginTop: 4 }}>
                  实际签到人数
                </div>
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: theme.spacing.lg,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: theme.fonts.size.xxl, fontWeight: 700, color: rateColor }}>
                  {(checkInRate * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: theme.fonts.size.sm, color: '#AAA', marginTop: 4 }}>
                  签到率
                </div>
              </div>
            </div>

            <div className="report-grid" style={{
              marginBottom: theme.spacing.xl,
            }}>
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 8,
                padding: theme.spacing.lg,
              }}>
                <h3 style={{
                  fontSize: theme.fonts.size.base,
                  color: '#CCC',
                  marginBottom: theme.spacing.md,
                  textAlign: 'center',
                }}>
                  签到率
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      stroke="none"
                    >
                      <Cell fill={rateColor} />
                      <Cell fill="rgba(255,255,255,0.12)" />
                    </Pie>
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#FFFFFF"
                      fontSize={22}
                      fontWeight={700}
                    >
                      {(checkInRate * 100).toFixed(0)}%
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 8,
                padding: theme.spacing.lg,
              }}>
                <h3 style={{
                  fontSize: theme.fonts.size.base,
                  color: '#CCC',
                  marginBottom: theme.spacing.md,
                  textAlign: 'center',
                }}>
                  签到时段分布
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={timeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#AAA', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                    />
                    <YAxis
                      tick={{ fill: '#AAA', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#2D2D3E',
                        border: 'none',
                        borderRadius: 6,
                        color: '#FFF',
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="#64B5F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {uncheckedList.length > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 8,
                padding: theme.spacing.lg,
                marginBottom: theme.spacing.lg,
              }}>
                <h3 style={{
                  fontSize: theme.fonts.size.base,
                  color: '#FF6B6B',
                  marginBottom: theme.spacing.md,
                }}>
                  ❌ 未签到人员（{uncheckedList.length}人）
                </h3>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}>
                  {uncheckedList.map(reg => (
                    <span
                      key={reg.id}
                      style={{
                        background: 'rgba(255,107,107,0.15)',
                        color: '#FF6B6B',
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: theme.fonts.size.sm,
                      }}
                    >
                      {reg.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ textAlign: 'center' }}>
              <button
                className={`btn-ripple ${pulseActive ? 'pulse-animation' : ''}`}
                onClick={handleExportCSV}
                style={{
                  background: theme.colors.secondary,
                  color: '#FFF',
                  border: 'none',
                  padding: '12px 28px',
                  borderRadius: 8,
                  fontSize: theme.fonts.size.base,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: `transform ${theme.transition.fast}`,
                  boxShadow: theme.shadow.button,
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                📥 导出CSV报告
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const tabStyle: React.CSSProperties = {
  border: 'none',
  padding: '10px 24px',
  borderRadius: 8,
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
  boxShadow: theme.shadow.button,
};

export default CheckInDashboard;
