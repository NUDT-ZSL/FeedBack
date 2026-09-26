import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { StatsResponse } from '../types';

interface StatsDashboardProps {
  stats: StatsResponse | null;
}

const PIE_COLORS = ['#e53935', '#ff9800', '#fdd835', '#66bb6a', '#42a5f5'];

const StatsDashboard: React.FC<StatsDashboardProps> = ({ stats }) => {
  const [visible, setVisible] = useState(false);
  const [currentRecentIdx, setCurrentRecentIdx] = useState(0);
  const [fadeAnim, setFadeAnim] = useState(true);
  const prevStatsRef = useRef<StatsResponse | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stats && stats !== prevStatsRef.current) {
      prevStatsRef.current = stats;
    }
  }, [stats]);

  const displayStats = stats || prevStatsRef.current;

  useEffect(() => {
    if (!displayStats?.recentApproved?.length) return;

    const interval = setInterval(() => {
      setFadeAnim(false);
      setTimeout(() => {
        setCurrentRecentIdx(
          (prev) => (prev + 1) % displayStats.recentApproved.length
        );
        setFadeAnim(true);
      }, 300);
    }, 3000);

    return () => clearInterval(interval);
  }, [displayStats?.recentApproved?.length]);

  if (!displayStats) {
    return (
      <div style={styles.dashboard}>
        <h2 style={styles.heading}>📊 统计仪表盘</h2>
        <div style={styles.loading}>加载中...</div>
      </div>
    );
  }

  const barData = displayStats.courseAverages.map((c) => ({
    name: c.courseName.length > 6 ? c.courseName.slice(0, 6) + '…' : c.courseName,
    fullName: c.courseName,
    平均分: c.averageScore,
  }));

  const pieData = displayStats.ratingDistribution.map((r) => ({
    name: `${r.rating}星`,
    value: r.count,
    percentage: r.percentage,
  }));

  const currentRecent = displayStats.recentApproved[currentRecentIdx];

  return (
    <div style={styles.dashboard}>
      <style>{chartAnimCSS}</style>
      <h2 style={styles.heading}>📊 统计仪表盘</h2>
      <div className="stats-grid" style={styles.grid}>
        <div
          className={visible ? 'chart-fade-in' : ''}
          style={styles.chartCard}
        >
          <h3 style={styles.cardTitle}>课程平均分 TOP3</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#66bb6a" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#e53935" stopOpacity={0.9} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#3a3a5e" />
              <XAxis dataKey="name" tick={{ fill: '#b0b0c0', fontSize: 12 }} />
              <YAxis
                domain={[0, 5]}
                tick={{ fill: '#b0b0c0', fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#2a2a3e',
                  border: '1px solid #3a3a5e',
                  borderRadius: '8px',
                  color: '#e0e0e0',
                }}
                formatter={(value: number, _name: string, props: { payload: { fullName: string } }) => [
                  `${value} 分`,
                  props.payload.fullName,
                ]}
              />
              <Bar dataKey="平均分" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div
          className={visible ? 'chart-fade-in' : ''}
          style={styles.chartCard}
        >
          <h3 style={styles.cardTitle}>评分分布</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percentage }) =>
                  `${name} ${percentage}%`
                }
              >
                {pieData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#2a2a3e',
                  border: '1px solid #3a3a5e',
                  borderRadius: '8px',
                  color: '#e0e0e0',
                }}
                formatter={(value: number) => [`${value} 条`, '数量']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={styles.summaryCard}>
          <h3 style={styles.cardTitle}>汇总数据</h3>
          <div style={styles.summaryGrid}>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>
                {displayStats.totalEvaluations}
              </div>
              <div style={styles.summaryLabel}>总评价数</div>
            </div>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>
                {displayStats.averageScore}
              </div>
              <div style={styles.summaryLabel}>平均分</div>
            </div>
            <div style={styles.summaryItem}>
              <div style={styles.summaryValue}>
                {displayStats.topCourse?.name || '-'}
              </div>
              <div style={styles.summaryLabel}>
                最高评分课程
                {displayStats.topCourse
                  ? ` (${displayStats.topCourse.score}分)`
                  : ''}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.recentCard}>
          <h3 style={styles.cardTitle}>最新评价</h3>
          {displayStats.recentApproved.length === 0 ? (
            <div style={styles.emptyRecent}>暂无已通过评价</div>
          ) : (
            <div
              style={{
                ...styles.recentItem,
                opacity: fadeAnim ? 1 : 0,
                transition: 'opacity 0.3s ease',
              }}
            >
              <div style={styles.recentHeader}>
                <span style={styles.recentCourse}>
                  {currentRecent?.courseName}
                </span>
                <span style={styles.recentStars}>
                  {currentRecent &&
                    [1, 2, 3, 4, 5].map((s) => (
                      <span
                        key={s}
                        style={{
                          color: s <= (currentRecent?.rating ?? 0) ? '#FFD700' : '#555580',
                          fontSize: '14px',
                        }}
                      >
                        ★
                      </span>
                    ))}
                </span>
              </div>
              <div style={styles.recentComment}>
                {currentRecent?.comment?.slice(0, 60)}
                {(currentRecent?.comment?.length ?? 0) > 60 ? '...' : ''}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const chartAnimCSS = `
  @keyframes chartFadeIn {
    0% {
      opacity: 0;
      transform: translateY(30px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .chart-fade-in {
    animation: chartFadeIn 0.8s ease forwards;
  }
`;

const styles: Record<string, React.CSSProperties> = {
  dashboard: {
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  },
  heading: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffb347',
    marginBottom: '20px',
    marginTop: 0,
  },
  loading: {
    textAlign: 'center',
    color: '#666688',
    padding: '40px 0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  chartCard: {
    backgroundColor: '#33334d',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
    opacity: 0,
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#b0b0c0',
    marginBottom: '12px',
    marginTop: 0,
  },
  summaryCard: {
    backgroundColor: '#33334d',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
  },
  summaryGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  summaryItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
  },
  summaryValue: {
    fontSize: '22px',
    fontWeight: 700,
    color: '#ffb347',
    minWidth: '60px',
  },
  summaryLabel: {
    fontSize: '13px',
    color: '#8888aa',
  },
  recentCard: {
    backgroundColor: '#33334d',
    borderRadius: '12px',
    padding: '16px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
    minHeight: '120px',
  },
  emptyRecent: {
    color: '#666688',
    textAlign: 'center',
    padding: '20px 0',
    fontSize: '14px',
  },
  recentItem: {
    padding: '10px',
    backgroundColor: '#3a3a5e',
    borderRadius: '8px',
  },
  recentHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  recentCourse: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffb347',
  },
  recentStars: {
    display: 'flex',
    gap: '1px',
  },
  recentComment: {
    fontSize: '13px',
    color: '#b0b0c0',
    lineHeight: '1.5',
  },
};

export default StatsDashboard;
