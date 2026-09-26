import React from 'react';
import { useAppContext } from '../context/AppContext';

const HistoryPanel: React.FC = () => {
  const { state, restoreHistory } = useAppContext();

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const today = new Date();
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    if (isToday) return '今天';
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  };

  return (
    <div
      style={{
        width: 280,
        minWidth: 280,
        background: '#FFFFFF',
        borderLeft: '1px solid #E8E8E8',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid #F0F0F0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: '#212121',
            letterSpacing: 0.3,
          }}
        >
          历史记录
        </h2>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: '#9E9E9E',
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#81C784',
              animation: 'blink 2s ease-in-out infinite',
            }}
          />
          实时更新
        </div>
      </div>

      <div
        style={{
          padding: '8px 16px 12px',
          fontSize: 11,
          color: '#9E9E9E',
          borderBottom: '1px solid #FAFAFA',
        }}
      >
        最近 {state.history.length} / 20 条记录
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 8,
        }}
      >
        {state.history.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#BDBDBD',
              textAlign: 'center',
              padding: 20,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.5 }}>📋</div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>暂无历史记录</div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>调整颜色后会自动记录</div>
          </div>
        ) : (
          state.history.map((record, idx) => (
            <div
              key={record.id}
              onClick={() => restoreHistory(record.id)}
              style={{
                padding: '12px 14px',
                marginBottom: 8,
                background: '#FAFAFA',
                border: `1px solid ${'#F0F0F0'}`,
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                animation: `slideIn 0.4s ease ${idx * 0.03}s both`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#F5F9FF';
                e.currentTarget.style.borderColor = '#BBDEFB';
                e.currentTarget.style.transform = 'translateX(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(100, 181, 246, 0.12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#FAFAFA';
                e.currentTarget.style.borderColor = '#F0F0F0';
                e.currentTarget.style.transform = 'translateX(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#757575',
                      fontFamily: 'monospace',
                    }}
                  >
                    {formatDate(record.timestamp)} {formatTime(record.timestamp)}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 10,
                    background: record.status === 'pass' ? '#E8F5E9' : '#FFEBEE',
                    color: record.status === 'pass' ? '#43A047' : '#E53935',
                  }}
                >
                  {record.status === 'pass' ? '✓ 通过' : '✗ 未通过'}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 11, color: '#9E9E9E' }}>配色:</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {record.colors.slice(0, 5).map((c, cIdx) => (
                    <div
                      key={cIdx}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: c.hex,
                        border: cIdx < 2 ? '1.5px solid #64B5F6' : '1px solid #E0E0E0',
                      }}
                      title={c.hex}
                    />
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: 8,
                  borderTop: '1px solid #F0F0F0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: record.contrastScore >= 4.5 ? '#2E7D32' : '#C62828',
                      fontFamily: 'monospace',
                    }}
                  >
                    {record.contrastScore.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 11, color: '#9E9E9E' }}>平均对比度</span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#64B5F6',
                    fontWeight: 500,
                  }}
                >
                  点击恢复 →
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};

export default HistoryPanel;
