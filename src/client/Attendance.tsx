import { useState, useEffect, useRef, useCallback } from 'react';
import type { Event } from './types';

interface AttendanceProps {
  eventId: string;
}

function Attendance({ eventId }: AttendanceProps) {
  const [event, setEvent] = useState<Event | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    serialNumber?: number;
  } | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [animPhase, setAnimPhase] = useState<'idle' | 'bounce' | 'pulse'>('idle');
  const confettiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    fetchEvent();
  }, [eventId]);

  const fetchEvent = async () => {
    try {
      const response = await fetch(`/api/events/${eventId}`);
      const eventData = await response.json();
      if (mountedRef.current) setEvent(eventData);
    } catch (error) {
      console.error('Failed to fetch event:', error);
    }
  };

  const createConfetti = useCallback(() => {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#fd79a8', '#a29bfe', '#fdcb6e'];
    const confettiPieces: JSX.Element[] = [];
    const PARTICLE_COUNT = 40;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.8;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = Math.random() * 8 + 5;
      const duration = 2 + Math.random() * 1.5;
      
      confettiPieces.push(
        <div
          key={i}
          style={{
            position: 'fixed',
            left: `${left}%`,
            top: '-20px',
            backgroundColor: color,
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
            animationTimingFunction: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            animationFillMode: 'forwards',
            animationName: 'confettiFall',
            pointerEvents: 'none',
            zIndex: 1000,
            willChange: 'transform, opacity'
          }}
        />
      );
    }
    
    return confettiPieces;
  }, []);

  const triggerSuccessAnimation = useCallback(() => {
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      setShowConfetti(true);
      setAnimPhase('bounce');

      setTimeout(() => {
        if (!mountedRef.current) return;
        setAnimPhase('pulse');
      }, 800);

      confettiTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setShowConfetti(false);
      }, 3000);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          name: name.trim(),
          phone: phone.trim() || undefined,
          gender
        })
      });

      const data = await response.json();

      if (response.ok) {
        setResult({
          success: true,
          message: '签到成功！',
          serialNumber: data.serialNumber
        });
        triggerSuccessAnimation();
      } else {
        setResult({
          success: false,
          message: data.message || '签到失败'
        });
      }
    } catch (error) {
      setResult({
        success: false,
        message: '网络错误，请稍后重试'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!event) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>加载中...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {showConfetti && createConfetti()}
      
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>{event.name}</h1>
          <p style={styles.subtitle}>{event.location}</p>
        </div>

        {result ? (
          <div style={{
            ...styles.result,
            backgroundColor: result.success ? '#d4edda' : '#f8d7da',
            animation: result.success
              ? animPhase === 'bounce'
                ? 'successBounce 0.8s ease-out'
                : animPhase === 'pulse'
                  ? 'successPulse 1.2s ease-in-out infinite'
                  : 'none'
              : 'none'
          }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '16px',
              animation: result.success ? 'emojiBounce 0.8s ease-out' : 'none'
            }}>
              {result.success ? '🎉' : '❌'}
            </div>
            <h2 style={{
              color: result.success ? '#155724' : '#721c24',
              marginBottom: '8px',
              fontSize: result.success ? '28px' : '20px'
            }}>
              {result.message}
            </h2>
            {result.success && result.serialNumber && (
              <p style={styles.serialNumber}>
                您是第 <span style={styles.serialNumberHighlight}>{result.serialNumber}</span> 位签到者
              </p>
            )}
            {!result.success && (
              <button
                onClick={() => { setResult(null); setAnimPhase('idle'); }}
                style={styles.retryBtn}
              >
                重新签到
              </button>
            )}
            <style>{`
              @keyframes confettiFall {
                0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
              }
              @keyframes successPulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(40, 167, 69, 0.4); }
                50% { box-shadow: 0 0 0 12px rgba(40, 167, 69, 0); }
              }
              @keyframes successBounce {
                0% { transform: scale(0.3); opacity: 0; }
                50% { transform: scale(1.05); }
                70% { transform: scale(0.95); }
                100% { transform: scale(1); opacity: 1; }
              }
              @keyframes emojiBounce {
                0% { transform: scale(0) rotate(0deg); }
                50% { transform: scale(1.2) rotate(-10deg); }
                70% { transform: scale(0.9) rotate(5deg); }
                100% { transform: scale(1) rotate(0deg); }
              }
            `}</style>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>姓名 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={styles.input}
                placeholder="请输入您的姓名"
                maxLength={20}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={styles.input}
                placeholder="请输入手机号（可选）"
                maxLength={11}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>性别</label>
              <div style={styles.genderGroup}>
                <label style={styles.genderOption}>
                  <input
                    type="radio"
                    name="gender"
                    value="male"
                    checked={gender === 'male'}
                    onChange={() => setGender('male')}
                    style={styles.radio}
                  />
                  <span>男</span>
                </label>
                <label style={styles.genderOption}>
                  <input
                    type="radio"
                    name="gender"
                    value="female"
                    checked={gender === 'female'}
                    onChange={() => setGender('female')}
                    style={styles.radio}
                  />
                  <span>女</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim()}
              style={{
                ...styles.button,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '签到中...' : '立即签到'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #e3f2fd 0%, #ffffff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px'
  },
  loading: {
    fontSize: '16px',
    color: '#666'
  },
  card: {
    background: 'white',
    borderRadius: '20px',
    padding: '32px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.1)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '30px'
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '14px',
    color: '#888'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#555'
  },
  input: {
    padding: '14px 16px',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    fontSize: '16px',
    outline: 'none'
  },
  genderGroup: {
    display: 'flex',
    gap: '20px'
  },
  genderOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '14px'
  },
  radio: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  button: {
    marginTop: '10px',
    padding: '16px',
    background: 'linear-gradient(135deg, #2196f3 0%, #1976d2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed'
  },
  result: {
    textAlign: 'center',
    padding: '40px 20px',
    borderRadius: '12px'
  },
  serialNumber: {
    fontSize: '16px',
    color: '#666',
    marginTop: '16px'
  },
  serialNumberHighlight: {
    color: '#2196f3',
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 4px'
  },
  retryBtn: {
    marginTop: '20px',
    padding: '12px 32px',
    background: '#2196f3',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer'
  }
};

export default Attendance;
