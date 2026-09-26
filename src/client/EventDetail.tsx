import { useState, useEffect } from 'react';
import Barrage from './Barrage';
import type { Event } from './types';

interface EventDetailProps {
  event: Event;
  onBack: () => void;
}

function EventDetail({ event, onBack }: EventDetailProps) {
  const [attendanceCount, setAttendanceCount] = useState(0);
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (event.qrCode) {
      setQrDataUrl(event.qrCode);
    }
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, [event.id]);

  const fetchStats = async () => {
    try {
      const response = await fetch(`/api/events/${event.id}/stats`);
      const stats = await response.json();
      setAttendanceCount(stats.totalAttendance);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const downloadQRCode = () => {
    const link = document.createElement('a');
    link.download = `qrcode-${event.name}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const formatTime = (timeStr: string) => {
    return new Date(timeStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div style={styles.container}>
      <Barrage eventId={event.id} />
      
      <div style={styles.content}>
        <button onClick={onBack} style={styles.backBtn}>
          ← 返回创建
        </button>

        <div style={styles.header}>
          <h1 style={styles.title}>{event.name}</h1>
          <p style={styles.subtitle}>活动ID: {event.id}</p>
        </div>

        <div style={styles.grid}>
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>活动信息</h3>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>地点:</span>
              <span style={styles.infoValue}>{event.location}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>时间:</span>
              <span style={styles.infoValue}>{formatTime(event.time)}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>预计人数:</span>
              <span style={styles.infoValue}>{event.expectedCount}人</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>已签到:</span>
              <span style={styles.infoValueHighlight}>{attendanceCount}人</span>
            </div>
            {event.description && (
              <div style={styles.infoRow}>
                <span style={styles.infoLabel}>描述:</span>
                <span style={styles.infoValue}>{event.description}</span>
              </div>
            )}
          </div>

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>签到二维码</h3>
            <div style={styles.qrContainer}>
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="签到二维码" style={styles.qrImage} />
              ) : (
                <div style={styles.qrPlaceholder}>加载中...</div>
              )}
            </div>
            <p style={styles.qrHint}>扫描二维码进行签到</p>
            <button onClick={downloadQRCode} style={styles.downloadBtn}>
              下载二维码
            </button>
          </div>
        </div>

        <div style={styles.links}>
          <a 
            href={`/dashboard/${event.id}`} 
            target="_blank" 
            style={styles.linkBtn}
          >
            📊 查看数据大屏
          </a>
          <a 
            href={`/attendance/${event.id}`} 
            target="_blank" 
            style={styles.linkBtn}
          >
            📱 签到页面
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0f7ff 0%, #ffffff 100%)',
    paddingBottom: '40px'
  },
  content: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '20px'
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#667eea',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '20px',
    padding: '8px 12px',
    borderRadius: '6px'
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px'
  },
  title: {
    fontSize: '32px',
    color: '#333',
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '14px',
    color: '#888'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    marginBottom: '30px'
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '20px'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #f0f0f0'
  },
  infoLabel: {
    color: '#888',
    fontSize: '14px'
  },
  infoValue: {
    color: '#333',
    fontSize: '14px',
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    marginLeft: '20px'
  },
  infoValueHighlight: {
    color: '#667eea',
    fontSize: '16px',
    fontWeight: 'bold'
  },
  qrContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    background: '#f8f9fa',
    borderRadius: '12px',
    marginBottom: '16px'
  },
  qrImage: {
    width: '200px',
    height: '200px'
  },
  qrPlaceholder: {
    width: '200px',
    height: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999'
  },
  qrHint: {
    textAlign: 'center',
    color: '#888',
    fontSize: '14px',
    marginBottom: '16px'
  },
  downloadBtn: {
    width: '100%',
    padding: '12px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer'
  },
  links: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center'
  },
  linkBtn: {
    padding: '12px 24px',
    background: 'white',
    color: '#667eea',
    textDecoration: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  }
};

export default EventDetail;
