import React, { useState, useEffect, useCallback, useRef } from 'react';
import CreateActivity from './components/CreateActivity';
import VotePage from './components/VotePage';
import AdminPage from './components/AdminPage';
import { Activity, VoteMessage } from '../shared/types';

type Page = 'home' | 'create' | 'vote' | 'admin';

const getUserId = () => {
  let userId = localStorage.getItem('party_voter_id');
  if (!userId) {
    userId = 'user_' + crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 12);
    localStorage.setItem('party_voter_id', userId);
  }
  return userId;
};

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('home');
  const [activityId, setActivityId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [userId] = useState(getUserId);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connectWebSocket = useCallback(() => {
    if (!mountedRef.current) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const websocket = new WebSocket(wsUrl);
      wsRef.current = websocket;
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
      };
      
      websocket.onmessage = (event) => {
        try {
          if (typeof event.data !== 'string') return;
          
          const message: VoteMessage = JSON.parse(event.data);
          
          if (!message || typeof message.type !== 'string' || typeof message.activityId !== 'string') {
            console.warn('Received malformed WebSocket message');
            return;
          }
          
          if (message.serverTime && typeof message.serverTime === 'number') {
            const offset = message.serverTime - Date.now();
            setServerTimeOffset(prev => prev === 0 ? offset : prev * 0.8 + offset * 0.2);
          }
          
          if (message.activityId === activityId && message.data) {
            setActivity(message.data);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      websocket.onclose = () => {
        console.log('WebSocket disconnected, will retry in 3s...');
        wsRef.current = null;
        
        if (mountedRef.current) {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connectWebSocket();
            }
          }, 3000);
        }
      };
      
      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connectWebSocket();
          }
        }, 3000);
      }
    }
  }, [activityId]);

  useEffect(() => {
    mountedRef.current = true;
    
    fetch('/api/server-time')
      .then(res => res.json())
      .then(data => {
        if (data.serverTime && typeof data.serverTime === 'number') {
          setServerTimeOffset(data.serverTime - Date.now());
        }
      })
      .catch(() => {});

    connectWebSocket();
    
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const fetchActivity = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/activities/${id}`);
      if (response.ok) {
        const data = await response.json();
        setActivity(data);
      }
    } catch (error) {
      console.error('Failed to fetch activity:', error);
    }
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      
      if (hash.startsWith('#/vote/')) {
        const id = hash.replace('#/vote/', '');
        setActivityId(id);
        setPage('vote');
        fetchActivity(id);
      } else if (hash.startsWith('#/admin/')) {
        const id = hash.replace('#/admin/', '');
        setActivityId(id);
        setPage('admin');
        fetchActivity(id);
      } else if (hash === '#/create') {
        setPage('create');
        setActivityId(null);
        setActivity(null);
      } else {
        setPage('home');
        setActivityId(null);
        setActivity(null);
      }
    };
    
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [fetchActivity]);

  const handleActivityCreated = (id: string) => {
    window.location.hash = `#/admin/${id}`;
  };

  const getServerTime = useCallback(() => {
    return Date.now() + serverTimeOffset;
  }, [serverTimeOffset]);

  if (page === 'home') {
    return (
      <div style={styles.container}>
        <div style={styles.hero}>
          <h1 style={styles.title}>🎉 聚会决策助手</h1>
          <p style={styles.subtitle}>快速创建、分享和投票选择聚会活动</p>
          <button
            style={styles.primaryButton}
            onClick={() => (window.location.hash = '#/create')}
          >
            创建新活动
          </button>
        </div>
        <div style={styles.features}>
          <div style={styles.featureCard}>
            <span style={styles.featureIcon}>📝</span>
            <h3>轻松创建</h3>
            <p>添加活动信息和多个候选选项</p>
          </div>
          <div style={styles.featureCard}>
            <span style={styles.featureIcon}>🔗</span>
            <h3>一键分享</h3>
            <p>生成唯一链接，分享给参与者</p>
          </div>
          <div style={styles.featureCard}>
            <span style={styles.featureIcon}>🗳️</span>
            <h3>实时投票</h3>
            <p>实时同步投票结果，无需刷新</p>
          </div>
        </div>
      </div>
    );
  }

  if (page === 'create') {
    return <CreateActivity onActivityCreated={handleActivityCreated} />;
  }

  if (page === 'vote' && activityId && activity) {
    return <VotePage activity={activity} activityId={activityId} userId={userId} />;
  }

  if (page === 'admin' && activityId && activity) {
    return <AdminPage activity={activity} activityId={activityId} getServerTime={getServerTime} />;
  }

  return (
    <div style={styles.container}>
      <div style={styles.loading}>加载中...</div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  hero: {
    textAlign: 'center',
    marginBottom: '60px'
  },
  title: {
    fontSize: '48px',
    color: '#4A90D9',
    marginBottom: '16px',
    fontWeight: '700'
  },
  subtitle: {
    fontSize: '20px',
    color: '#666',
    marginBottom: '32px'
  },
  primaryButton: {
    backgroundColor: '#4A90D9',
    color: 'white',
    border: 'none',
    padding: '16px 48px',
    fontSize: '18px',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontWeight: '600',
    boxShadow: '0 4px 15px rgba(74, 144, 217, 0.3)'
  },
  features: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  featureCard: {
    backgroundColor: 'white',
    padding: '32px',
    borderRadius: '16px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
    width: '280px',
    textAlign: 'center',
    transition: 'transform 0.3s ease'
  },
  featureIcon: {
    fontSize: '48px',
    display: 'block',
    marginBottom: '16px'
  },
  loading: {
    fontSize: '18px',
    color: '#666'
  }
};

export default App;
