import { useState, useMemo } from 'react';
import { EscapeRecord, FilterState, ThemeType } from './types';
import { initialRecords, getFilteredRecords, getStats } from './data';
import RoomCard from './components/RoomCard';
import FilterBar from './components/FilterBar';

const themeColors: Record<ThemeType, string> = {
  恐怖: '#DC143C',
  悬疑: '#8A2BE2',
  科幻: '#4169E1',
  古风: '#556B2F',
  搞笑: '#FFD700',
};

function App() {
  const [records, setRecords] = useState<EscapeRecord[]>(initialRecords);
  const [filter, setFilter] = useState<FilterState>({
    themes: [],
    escapeStatus: 'all',
    searchText: '',
  });

  const filteredRecords = useMemo(() => {
    return getFilteredRecords(records, filter);
  }, [records, filter]);

  const stats = useMemo(() => {
    return getStats(records);
  }, [records]);

  const handleDelete = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1A1A2E',
        color: '#E0E0E0',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <style>{`
        * {
          box-sizing: border-box;
        }
        body {
          margin: 0;
          padding: 0;
        }
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(233,69,96,0.3);
          border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(233,69,96,0.5);
        }
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23E0E0E0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 36px !important;
        }
      `}</style>

      <header
        style={{
          padding: '24px 0',
          textAlign: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: '28px',
            fontWeight: 700,
            background: 'linear-gradient(90deg, #E94560, #FF6B8A)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          🔐 密室逃脱记录
        </h1>
        <p style={{ color: 'rgba(224,224,224,0.5)', fontSize: '14px', marginTop: '6px' }}>
          记录每一次惊心动魄的冒险
        </p>
      </header>

      <div
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '24px',
          display: 'flex',
          gap: '24px',
        }}
      >
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          <FilterBar filter={filter} onFilterChange={setFilter} />

          {filteredRecords.length > 0 ? (
            <div>
              {filteredRecords.map((record) => (
                <RoomCard key={record.id} record={record} onDelete={handleDelete} />
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                color: 'rgba(224,224,224,0.4)',
              }}
            >
              <div
                style={{
                  fontSize: '48px',
                  marginBottom: '16px',
                  animation: 'bounce 0.5s ease-in-out infinite alternate',
                }}
              >
                👻
              </div>
              <p style={{ fontSize: '16px', margin: 0 }}>还没有玩法记录哦</p>
            </div>
          )}
        </div>

        <div
          style={{
            flex: '0 0 calc(40% - 24px)',
            position: 'sticky',
            top: '24px',
            alignSelf: 'flex-start',
          }}
        >
          <StatsPanel stats={stats} />
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );
}

interface StatsPanelProps {
  stats: ReturnType<typeof getStats>;
}

function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <div
      style={{
        backgroundColor: '#16213E',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 4px 15px rgba(233,69,96,0.15)',
      }}
    >
      <h2
        style={{
          margin: '0 0 20px 0',
          fontSize: '18px',
          fontWeight: 600,
          color: '#E0E0E0',
        }}
      >
        📊 数据统计
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <StatCard
          label="总记录数"
          value={stats.totalRecords.toString()}
          icon="📝"
          color="#E94560"
        />
        <StatCard
          label="平均用时"
          value={stats.averageEscapeTime > 0 ? `${Math.round(stats.averageEscapeTime)}分钟` : '-'}
          icon="⏱️"
          color="#4FC3F7"
        />
      </div>

      <div style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '14px', color: 'rgba(224,224,224,0.7)' }}>成功逃脱率</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#66BB6A' }}>
            {Math.round(stats.successRate)}%
          </span>
        </div>
        <RingProgress percentage={stats.successRate} color="#66BB6A" size={120} />
      </div>

      <div style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontSize: '14px', color: 'rgba(224,224,224,0.7)' }}>最常玩主题</span>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: stats.mostPlayedTheme ? themeColors[stats.mostPlayedTheme] : 'rgba(224,224,224,0.5)',
            }}
          >
            {stats.mostPlayedTheme || '-'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(Object.keys(stats.themeCounts) as ThemeType[]).map((theme) => {
            const count = stats.themeCounts[theme];
            const maxCount = Math.max(...Object.values(stats.themeCounts), 1);
            const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
            return (
              <div key={theme}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'rgba(224,224,224,0.6)' }}>{theme}</span>
                  <span style={{ fontSize: '12px', color: 'rgba(224,224,224,0.6)' }}>{count}次</span>
                </div>
                <div
                  style={{
                    height: '6px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${percentage}%`,
                      backgroundColor: themeColors[theme],
                      borderRadius: '3px',
                      transition: 'width 0.5s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: string;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderRadius: '10px',
        padding: '16px',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div style={{ fontSize: '24px', marginBottom: '8px' }}>{icon}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color, marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'rgba(224,224,224,0.5)' }}>{label}</div>
    </div>
  );
}

interface RingProgressProps {
  percentage: number;
  color: string;
  size: number;
}

function RingProgress({ percentage, color, size }: RingProgressProps) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          fontWeight: 700,
          color,
        }}
      >
        {Math.round(percentage)}%
      </div>
    </div>
  );
}

export default App;
