import React, { useState, useEffect, useCallback } from 'react';

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

interface MyReservationsProps {
  ownerId: string;
  showNotification: (msg: string, type: 'success' | 'error') => void;
}

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

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '待审核', color: '#F57C00', bg: '#FFF3E0' },
  confirmed: { label: '已确认', color: COLORS.success, bg: '#E8F5E9' },
  cancelled: { label: '已取消', color: COLORS.error, bg: '#FFEBEE' },
};

function MyReservations({ ownerId, showNotification }: MyReservationsProps) {
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?ownerId=${ownerId}`);
      const data = await res.json();
      setReservations(data);
    } catch {
      showNotification('加载预约列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [ownerId, showNotification]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/reservations/${id}/approve`, { method: 'PUT' });
      if (!res.ok) {
        showNotification('操作失败', 'error');
        return;
      }
      showNotification('已确认预约', 'success');
      fetchReservations();
    } catch {
      showNotification('操作失败', 'error');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/reservations/${id}/reject`, { method: 'PUT' });
      if (!res.ok) {
        showNotification('操作失败', 'error');
        return;
      }
      showNotification('已拒绝预约', 'success');
      fetchReservations();
    } catch {
      showNotification('操作失败', 'error');
    }
  };

  const handleExport = () => {
    window.open(`/api/reservations/export?ownerId=${ownerId}`, '_blank');
  };

  const renderStatusBadge = (status: string) => {
    const info = STATUS_MAP[status] || STATUS_MAP.pending;
    return (
      <span style={{
        padding: '3px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        color: info.color,
        background: info.bg,
      }}>
        {info.label}
      </span>
    );
  };

  const pendingCount = reservations.filter((r) => r.status === 'pending').length;
  const confirmedCount = reservations.filter((r) => r.status === 'confirmed').length;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.primary, marginBottom: 4 }}>
            📋 我的预约管理
          </h2>
          <div style={{ fontSize: 13, color: COLORS.textLight, display: 'flex', gap: 16 }}>
            <span>待审核 <strong style={{ color: '#F57C00' }}>{pendingCount}</strong></span>
            <span>已确认 <strong style={{ color: COLORS.success }}>{confirmedCount}</strong></span>
            <span>总计 <strong>{reservations.length}</strong></span>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={confirmedCount === 0}
          style={{
            background: COLORS.primary,
            color: COLORS.white,
            border: 'none',
            padding: '8px 18px',
            borderRadius: 8,
            cursor: confirmedCount === 0 ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            opacity: confirmedCount === 0 ? 0.5 : 1,
            transition: 'opacity 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseEnter={(e) => { if (confirmedCount > 0) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { if (confirmedCount > 0) e.currentTarget.style.opacity = '1'; }}
        >
          📥 导出今日确认报表
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: COLORS.textLight, fontSize: 14 }}>
          加载中...
        </div>
      ) : reservations.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 60,
          background: COLORS.cardBg,
          borderRadius: 12,
          color: COLORS.textLight,
          fontSize: 14,
        }}>
          暂无预约记录
        </div>
      ) : (
        <div style={{
          background: COLORS.cardBg,
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(111,78,55,0.08)',
          overflowX: 'auto',
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
            minWidth: 600,
          }}>
            <thead>
              <tr style={{ background: COLORS.primary + '0D' }}>
                <th style={thStyle}>摊位</th>
                <th style={thStyle}>顾客姓名</th>
                <th style={thStyle}>手机号</th>
                <th style={thStyle}>预约时段</th>
                <th style={thStyle}>状态</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    background: r.status === 'confirmed'
                      ? '#E8F5E9'
                      : r.status === 'cancelled'
                        ? '#FFEBEE'
                        : COLORS.white,
                    transition: 'background 0.3s ease',
                  }}
                >
                  <td style={{
                    ...tdStyle,
                    fontWeight: 500,
                    color: COLORS.primary,
                  }}>
                    {r.stallName}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textDecoration: r.status === 'cancelled' ? 'line-through' : 'none',
                    color: r.status === 'cancelled' ? COLORS.error : COLORS.text,
                  }}>
                    {r.customerName}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textDecoration: r.status === 'cancelled' ? 'line-through' : 'none',
                    color: r.status === 'cancelled' ? COLORS.error : COLORS.text,
                  }}>
                    {r.customerPhone}
                  </td>
                  <td style={{
                    ...tdStyle,
                    textDecoration: r.status === 'cancelled' ? 'line-through' : 'none',
                    color: r.status === 'cancelled' ? COLORS.error : COLORS.text,
                  }}>
                    {r.timeSlot}
                  </td>
                  <td style={tdStyle}>
                    {renderStatusBadge(r.status)}
                  </td>
                  <td style={tdStyle}>
                    {r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleApprove(r.id)}
                          style={{
                            background: COLORS.success,
                            color: COLORS.white,
                            border: 'none',
                            padding: '5px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                            transition: 'opacity 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                          通过
                        </button>
                        <button
                          onClick={() => handleReject(r.id)}
                          style={{
                            background: COLORS.error,
                            color: COLORS.white,
                            border: 'none',
                            padding: '5px 12px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: 12,
                            fontWeight: 600,
                            transition: 'opacity 0.2s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                          拒绝
                        </button>
                      </div>
                    )}
                    {r.status !== 'pending' && (
                      <span style={{ fontSize: 12, color: COLORS.textLight }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#5D4037',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

export default MyReservations;
