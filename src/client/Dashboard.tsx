import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Pie } from 'react-chartjs-2';
import type { EventStats, Attendance, Event } from './types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface DashboardProps {
  eventId: string;
}

function Dashboard({ eventId }: DashboardProps) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [recentAttendance, setRecentAttendance] = useState<Attendance[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const fetchData = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const [statsRes, attendanceRes, eventRes] = await Promise.all([
        fetch(`/api/events/${eventId}/stats`, { signal: controller.signal }),
        fetch(`/api/events/${eventId}/attendance?limit=50`, { signal: controller.signal }),
        fetch(`/api/events/${eventId}`, { signal: controller.signal })
      ]);

      const statsData = await statsRes.json();
      const attendanceData = await attendanceRes.json();
      const eventData = await eventRes.json();

      if (!mountedRef.current) return;

      setStats(statsData);
      setRecentAttendance(attendanceData);
      setEvent(eventData);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (!mountedRef.current) return;
      console.error('Failed to fetch data:', error);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    fetchData();
    intervalRef.current = setInterval(fetchData, 5000);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?eventId=${eventId}`;
    const websocket = new WebSocket(wsUrl);

    websocket.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'onlineCount') {
          setOnlineCount(data.count);
        } else if (data.type === 'newAttendance') {
          setRecentAttendance(prev => {
            const updated = [data.attendance, ...prev].slice(0, 50);
            return updated;
          });
        }
      } catch (err) {
        console.error('Parse error:', err);
      }
    };

    wsRef.current = websocket;

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      websocket.onclose = null;
      websocket.close();
      wsRef.current = null;
    };
  }, [eventId]);

  const formatTime = (timeStr: string) => {
    return new Date(timeStr).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const lineChartData = stats ? {
    labels: stats.hourlyDistribution.map(d => `${d.hour}:00`),
    datasets: [{
      label: '签到人数',
      data: stats.hourlyDistribution.map(d => d.count),
      borderColor: '#00d4ff',
      backgroundColor: 'rgba(0, 212, 255, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#00d4ff',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 4
    }]
  } : null;

  const pieChartData = stats ? {
    labels: ['已签到', '未签到'],
    datasets: [{
      data: [stats.totalAttendance, Math.max(0, stats.expectedCount - stats.totalAttendance)],
      backgroundColor: ['#00d4ff', 'rgba(255, 255, 255, 0.1)'],
      borderColor: ['#00d4ff', 'rgba(255, 255, 255, 0.3)'],
      borderWidth: 2
    }]
  } : null;

  const genderPieData = stats ? {
    labels: ['男', '女'],
    datasets: [{
      data: [stats.maleCount, stats.femaleCount],
      backgroundColor: ['#4facfe', '#f093fb'],
      borderColor: ['#4facfe', '#f093fb'],
      borderWidth: 2
    }]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 500
    },
    plugins: {
      legend: {
        labels: {
          color: '#fff',
          font: { size: 12 }
        }
      }
    },
    scales: {
      x: {
        ticks: { color: 'rgba(255,255,255,0.7)' },
        grid: { color: 'rgba(255,255,255,0.1)' }
      },
      y: {
        ticks: { color: 'rgba(255,255,255,0.7)' },
        grid: { color: 'rgba(255,255,255,0.1)' }
      }
    }
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#fff',
          font: { size: 12 }
        }
      }
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>{event?.name || '数据大屏'}</h1>
        <p style={styles.subtitle}>实时签到数据监控</p>
      </div>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>签到人数</div>
          <div style={styles.statValue}>{stats?.totalAttendance || 0}</div>
          <div style={styles.statSub}>
            / {stats?.expectedCount || 0} 人
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>在线人数</div>
          <div style={{ ...styles.statValue, fontSize: '4rem' }}>{onlineCount}</div>
          <div style={styles.statSub}>实时连接</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>男女比例</div>
          <div style={styles.statValue}>
            {stats?.maleCount || 0} : {stats?.femaleCount || 0}
          </div>
          <div style={styles.statSub}>
            男性占比: {stats && (stats.maleCount + stats.femaleCount) > 0
              ? Math.round((stats.maleCount / (stats.maleCount + stats.femaleCount)) * 100)
              : 0}%
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>参与率</div>
          <div style={styles.statValue}>
            {stats?.attendanceRate ? stats.attendanceRate.toFixed(1) : 0}%
          </div>
          <div style={styles.statSub}>
            目标进度
          </div>
        </div>
      </div>

      <div style={styles.chartsGrid}>
        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>签到时间分布</h3>
          <div style={styles.chartContainer}>
            {lineChartData && <Line data={lineChartData} options={chartOptions} />}
          </div>
        </div>

        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>参与率统计</h3>
          <div style={styles.chartContainer}>
            {pieChartData && <Pie data={pieChartData} options={pieOptions} />}
          </div>
        </div>

        <div style={styles.chartCard}>
          <h3 style={styles.chartTitle}>性别分布</h3>
          <div style={styles.chartContainer}>
            {genderPieData && <Pie data={genderPieData} options={pieOptions} />}
          </div>
        </div>
      </div>

      <div style={styles.listCard}>
        <h3 style={styles.chartTitle}>最新签到记录</h3>
        <div ref={listRef} style={styles.listContainer}>
          {recentAttendance.length === 0 ? (
            <div style={styles.emptyState}>暂无签到记录</div>
          ) : (
            recentAttendance.map((record, index) => (
              <div
                key={record.id}
                style={{
                  ...styles.listItem,
                  animation: index === 0 ? 'fadeIn 0.3s ease-in' : 'none'
                }}
              >
                <span style={styles.serialBadge}>#{record.serialNumber}</span>
                <span style={styles.listName}>{record.name}</span>
                <span style={styles.listTime}>{formatTime(record.checkInTime)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
    padding: '20px',
    color: 'white',
    position: 'relative',
    overflowX: 'hidden'
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px',
    padding: '20px',
    background: 'rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '16px'
  },
  title: {
    fontSize: '36px',
    fontWeight: 'bold',
    color: '#00d4ff',
    marginBottom: '8px',
    textShadow: '0 0 20px rgba(0, 212, 255, 0.5)',
    letterSpacing: '2px'
  },
  subtitle: {
    fontSize: '14px',
    color: 'rgba(255, 255, 255, 0.7)'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '24px'
  },
  statCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '20px',
    padding: '28px 20px',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    transition: 'transform 0.3s ease, box-shadow 0.3s ease'
  },
  statLabel: {
    fontSize: '14px',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: '8px'
  },
  statValue: {
    fontSize: '3rem',
    fontWeight: 'bold',
    color: '#00d4ff',
    textShadow: '0 0 10px rgba(0, 212, 255, 0.5)',
    lineHeight: 1
  },
  statSub: {
    fontSize: '12px',
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: '8px'
  },
  chartsGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr',
    gap: '20px',
    marginBottom: '24px'
  },
  chartCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '20px',
    padding: '24px',
    minHeight: '300px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
  },
  chartTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#00d4ff',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid rgba(0, 212, 255, 0.2)',
    letterSpacing: '1px'
  },
  chartContainer: {
    height: '250px',
    position: 'relative'
  },
  listCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '20px',
    padding: '24px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
  },
  listContainer: {
    maxHeight: '300px',
    overflowY: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(0, 212, 255, 0.3) transparent'
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '14px 18px',
    marginBottom: '8px',
    background: 'rgba(255, 255, 255, 0.02)',
    borderRadius: '12px',
    borderBottom: 'none',
    transition: 'background 0.2s ease'
  },
  serialBadge: {
    background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
    color: 'white',
    padding: '6px 14px',
    borderRadius: '14px',
    fontSize: '13px',
    fontWeight: 'bold',
    boxShadow: '0 2px 8px rgba(0, 212, 255, 0.3)'
  },
  listName: {
    flex: 1,
    fontSize: '15px',
    color: 'white',
    fontWeight: '500'
  },
  listTime: {
    fontSize: '13px',
    color: 'rgba(255, 255, 255, 0.6)',
    fontVariantNumeric: 'tabular-nums'
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '15px'
  }
};

export default Dashboard;
