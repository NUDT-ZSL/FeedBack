import { useState, useMemo, useCallback, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FaLeaf, FaHeart, FaBook, FaListUl, FaHandHoldingHeart } from 'react-icons/fa';
import type { Task, FilterCategory, TaskCategory } from './types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './types';
import { getInitialTasks, claimTask, submitFeedback } from './data/tasks';
import TaskCard from './components/TaskCard';
import FeedbackForm from './components/FeedbackForm';

const CATEGORY_ICONS: Record<FilterCategory, React.ReactNode> = {
  all: <FaListUl size={14} />,
  environmental: <FaLeaf size={14} />,
  elderly: <FaHeart size={14} />,
  education: <FaBook size={14} />
};

const CATEGORY_COLOR_MAP: Record<FilterCategory, string> = {
  all: '#2196F3',
  environmental: '#4CAF50',
  elderly: '#2196F3',
  education: '#FF9800'
};

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => getInitialTasks());
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [openFeedbackTaskId, setOpenFeedbackTaskId] = useState<string | null>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      html, body, #root {
        margin: 0;
        padding: 0;
        min-height: 100vh;
      }
      body {
        background: #FAFAFA;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
          'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica,
          Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        color: #333;
      }
      * {
        box-sizing: border-box;
      }
      ::-webkit-scrollbar {
        width: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(0,0,0,0.15);
        border-radius: 3px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(0,0,0,0.25);
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const filteredTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt);
    if (filter === 'all') return sorted;
    return sorted.filter(t => t.category === filter);
  }, [tasks, filter]);

  const handleClaim = useCallback((taskId: string) => {
    setTasks(prev => {
      const updated = claimTask(prev, taskId);
      const task = updated.find(t => t.id === taskId);
      if (task) {
        toast.success(`🎉 成功认领「${task.title}」`, {
          position: 'top-right',
          duration: 3000,
          style: {
            padding: '12px 18px',
            background: '#fff',
            color: '#2E7D32',
            border: '1px solid #C8E6C9',
            borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(46,125,50,0.15)',
            fontSize: '14px',
            fontWeight: 500
          },
          iconTheme: {
            primary: '#4CAF50',
            secondary: '#fff'
          }
        });
      }
      return updated;
    });
  }, []);

  const handleOpenFeedback = useCallback((taskId: string) => {
    setOpenFeedbackTaskId(prev => prev === taskId ? null : taskId);
  }, []);

  const handleSubmitFeedback = useCallback((taskId: string, data: { description: string; imageUrl?: string }) => {
    setTasks(prev => submitFeedback(prev, taskId, data));
    setOpenFeedbackTaskId(null);
  }, []);

  const closeFeedback = useCallback(() => {
    setOpenFeedbackTaskId(null);
  }, []);

  const stats = useMemo(() => {
    const total = tasks.length;
    const claimed = tasks.filter(t => t.isClaimed).length;
    const withFeedback = tasks.filter(t => t.feedback).length;
    const byCategory = tasks.reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + 1;
      return acc;
    }, {} as Record<TaskCategory, number>);
    return { total, claimed, withFeedback, byCategory };
  }, [tasks]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #E3F2FD 0%, #FAFAFA 280px, #FAFAFA 100%)'
    }}>
      <Toaster />

      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '20px 16px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <header style={{
          textAlign: 'center',
          padding: '10px 0 30px'
        }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '10px'
          }}>
            <div style={{
              width: '54px',
              height: '54px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #2196F3, #64B5F6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 6px 20px rgba(33,150,243,0.3)',
              color: '#fff'
            }}>
              <FaHandHoldingHeart size={28} />
            </div>
          </div>
          <h1 style={{
            margin: '0 0 8px',
            fontSize: 'clamp(24px, 5vw, 30px)',
            fontWeight: 700,
            color: '#1A237E',
            letterSpacing: '0.5px'
          }}>
            社区志愿服务平台
          </h1>
          <p style={{
            margin: 0,
            fontSize: '14px',
            color: '#607D8B',
            lineHeight: 1.6
          }}>
            用爱心点亮社区 · 让温暖触手可及
          </p>
        </header>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginBottom: '26px',
          padding: '16px',
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          borderRadius: '14px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.05)'
        }}>
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#2196F3' }}>{stats.total}</div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>总任务</div>
          </div>
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#4CAF50' }}>{stats.claimed}</div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>已认领</div>
          </div>
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#FF9800' }}>{stats.withFeedback}</div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>已反馈</div>
          </div>
          <div style={{ textAlign: 'center', padding: '4px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#E91E63' }}>
              {stats.total > 0 ? Math.round((stats.claimed / stats.total) * 100) : 0}%
            </div>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>参与率</div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '24px'
        }}>
          {(Object.keys(CATEGORY_LABELS) as FilterCategory[]).map(cat => {
            const isActive = filter === cat;
            const color = CATEGORY_COLOR_MAP[cat];
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 20px',
                  borderRadius: '999px',
                  border: 'none',
                  background: isActive ? color : 'rgba(255,255,255,0.9)',
                  color: isActive ? '#fff' : '#777',
                  fontSize: '14px',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  boxShadow: isActive
                    ? `0 4px 14px ${color}55`
                    : '0 2px 8px rgba(0,0,0,0.06)',
                  transition: 'all 0.25s ease-out',
                  transform: 'translateZ(0)',
                  willChange: 'transform, background, color'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = 'translateY(-1.5px)';
                    e.currentTarget.style.color = color;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  if (!isActive) {
                    e.currentTarget.style.color = '#777';
                  }
                }}
              >
                {CATEGORY_ICONS[cat]}
                {CATEGORY_LABELS[cat]}
                {cat !== 'all' && (
                  <span style={{
                    fontSize: '11px',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    background: isActive ? 'rgba(255,255,255,0.25)' : '#F0F0F0',
                    fontWeight: 500
                  }}>
                    {stats.byCategory[cat as TaskCategory] || 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          padding: '0 0 20px'
        }}>
          {filteredTasks.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '60px 20px',
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(8px)',
              borderRadius: '14px',
              color: '#888',
              animation: 'fadeIn 0.4s ease-out'
            }}>
              <div style={{
                fontSize: '52px',
                marginBottom: '14px',
                opacity: 0.6
              }}>
                🌱
              </div>
              <p style={{
                margin: 0,
                fontSize: '15px',
                lineHeight: 1.6
              }}>
                暂无{CATEGORY_LABELS[filter]}类任务<br />
                <span style={{ fontSize: '13px', color: '#AAA' }}>切换分类看看其他任务吧~</span>
              </p>
            </div>
          ) : (
            filteredTasks.map(task => (
              <div
                key={task.id}
                style={{
                  animation: 'fadeIn 0.35s ease-out',
                  willChange: 'opacity'
                }}
              >
                <TaskCard
                  task={task}
                  onClaim={handleClaim}
                  onOpenFeedback={handleOpenFeedback}
                />
                {openFeedbackTaskId === task.id && (
                  <FeedbackForm
                    taskId={task.id}
                    taskTitle={task.title}
                    onSubmit={handleSubmitFeedback}
                    onClose={closeFeedback}
                  />
                )}
              </div>
            ))
          )}
        </div>

        <footer style={{
          textAlign: 'center',
          padding: '24px 12px 10px',
          fontSize: '12px',
          color: '#AAA',
          borderTop: '1px solid rgba(0,0,0,0.05)'
        }}>
          <p style={{ margin: 0, lineHeight: 1.8 }}>
            💙 每一份善意，都让社区更温暖<br />
            © 2024 社区志愿服务平台
          </p>
        </footer>
      </div>
    </div>
  );
}
