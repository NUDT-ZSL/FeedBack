import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Evaluation, StatsResponse } from './types';
import EvaluationForm from './components/EvaluationForm';
import ApprovalPanel from './components/ApprovalPanel';
import StatsDashboard from './components/StatsDashboard';

const API_BASE = '/api/evaluations';

const App: React.FC = () => {
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 2000);
  }, []);

  const fetchEvaluations = useCallback(async () => {
    try {
      const res = await fetch(API_BASE);
      if (res.ok) {
        const data: Evaluation[] = await res.json();
        setEvaluations(data);
      }
    } catch (err) {
      console.error('Failed to fetch evaluations:', err);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      if (res.ok) {
        const data: StatsResponse = await res.json();
        setStats((prev) => {
          if (!prev) return data;
          return { ...prev, ...data };
        });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchEvaluations();
    fetchStats();
  }, [fetchEvaluations, fetchStats]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchStats();
      fetchEvaluations();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchEvaluations]);

  const handleSubmit = useCallback(
    async (data: {
      courseName: string;
      teacher: string;
      rating: number;
      comment: string;
    }) => {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        showToast('评价已提交，等待审核');
        fetchEvaluations();
      }
    },
    [fetchEvaluations, showToast]
  );

  const handleApprove = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_BASE}/${id}/approve`, { method: 'PATCH' });
      if (res.ok) {
        fetchEvaluations();
        fetchStats();
      }
    },
    [fetchEvaluations, fetchStats]
  );

  const handleReject = useCallback(
    async (id: string) => {
      const res = await fetch(`${API_BASE}/${id}/reject`, { method: 'PATCH' });
      if (res.ok) {
        fetchEvaluations();
        fetchStats();
      }
    },
    [fetchEvaluations, fetchStats]
  );

  const pendingEvaluations = evaluations.filter((e) => e.status === 'pending');

  return (
    <div className="app-container" style={styles.container}>
      <style>{globalCSS}</style>
      {toast && <div className="app-toast" style={styles.toast}>{toast}</div>}
      <header style={styles.header}>
        <h1 style={styles.title}>📚 课程评价与反馈系统</h1>
      </header>
      <div className="app-main-layout" style={styles.mainLayout}>
        <div className="app-left-column" style={styles.leftColumn}>
          <EvaluationForm onSubmit={handleSubmit} />
          <StatsDashboard stats={stats} />
        </div>
        <div className="app-right-column" style={styles.rightColumn}>
          <ApprovalPanel
            evaluations={pendingEvaluations}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </div>
      </div>
    </div>
  );
};

const globalCSS = `
  @keyframes toastIn {
    0% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    100% { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  @media (max-width: 767px) {
    .app-main-layout {
      flex-direction: column !important;
    }
    .app-left-column, .app-right-column {
      width: 100% !important;
      max-width: 100% !important;
      flex: none !important;
      min-width: 0 !important;
    }
    .app-container {
      padding: 12px !important;
    }
    .app-container h1 {
      font-size: 20px !important;
    }
    .app-container h2 {
      font-size: 18px !important;
    }
    .app-container input,
    .app-container textarea,
    .app-container select,
    .app-container button {
      font-size: 16px !important;
    }
    .app-container .stats-grid {
      grid-template-columns: 1fr !important;
    }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1e1e2e',
    color: '#e0e0e0',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    padding: '24px',
    boxSizing: 'border-box',
  },
  toast: {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#4caf50',
    color: '#fff',
    padding: '12px 28px',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: 600,
    zIndex: 9999,
    boxShadow: '0 4px 20px rgba(76,175,80,0.4)',
    animation: 'toastIn 0.3s ease-out',
    pointerEvents: 'none',
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    color: '#ffb347',
    margin: 0,
  },
  mainLayout: {
    display: 'flex',
    gap: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  leftColumn: {
    flex: '0 0 60%',
    maxWidth: '60%',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  rightColumn: {
    flex: '1 1 0',
    minWidth: 0,
  },
};

export default App;
