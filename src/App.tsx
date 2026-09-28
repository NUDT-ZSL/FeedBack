import React, { useState } from 'react';
import { OKRList } from '@/components/OKRList';
import { KRPanel } from '@/components/KRPanel';
import { TaskBoard } from '@/components/TaskBoard';
import { RadarChart } from '@/components/RadarChart';
import { useOKRData } from '@/hooks/useOKRData';
import { calculateWeightedProgress, formatDate } from '@/utils/helpers';

type Page = 'list' | 'detail' | 'dashboard';

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('list');
  const [selectedOKRId, setSelectedOKRId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const {
    okrs,
    loading,
    updateTaskStatus,
    reorderTasks,
    assignTask,
    updateKRProgress,
    getRadarData
  } = useOKRData();

  const selectedOKR = selectedOKRId
    ? okrs.find(o => o.id === selectedOKRId) || null
    : null;

  const handleSelectOKR = (okrId: string) => {
    setSelectedOKRId(okrId);
    setCurrentPage('detail');
  };

  const handleTaskComplete = (taskId: string, completed: boolean) => {
    if (selectedOKRId) {
      updateTaskStatus(selectedOKRId, taskId, completed);
    }
  };

  const handleReorder = (taskId: string, newOrder: number) => {
    if (selectedOKRId) {
      reorderTasks(selectedOKRId, taskId, newOrder);
    }
  };

  const handleAssign = (taskId: string, assignee: string) => {
    if (selectedOKRId) {
      assignTask(selectedOKRId, taskId, assignee);
    }
  };

  const handleKRProgressChange = (krId: string, progress: number) => {
    if (selectedOKRId) {
      updateKRProgress(selectedOKRId, krId, progress);
    }
  };

  const radarData = getRadarData();

  const sidebarWidth = sidebarCollapsed ? '60px' : '220px';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: '#fff',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
      }}
    >
      <nav
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '60px',
          backgroundColor: 'rgba(26, 26, 46, 0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontWeight: 700,
            fontSize: '18px'
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #00b4d8 0%, #e63946 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 700
            }}
          >
            O
          </div>
          {!sidebarCollapsed && <span>Objective Tracker</span>}
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              padding: '8px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.15s ease'
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
            }}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>
      </nav>

      <div style={{ display: 'flex', paddingTop: '60px', minHeight: '100vh' }}>
        <aside
          style={{
            width: sidebarWidth,
            flexShrink: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            transition: 'width 0.3s ease',
            overflow: 'hidden'
          }}
        >
          <div style={{ padding: '20px 16px' }}>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { key: 'list', label: '目标列表', icon: '📋' },
                { key: 'dashboard', label: '控制台', icon: '📊' }
              ].map(item => (
                <button
                  key={item.key}
                  onClick={() => {
                    setCurrentPage(item.key as Page);
                    if (item.key === 'list') {
                      setSelectedOKRId(null);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: sidebarCollapsed ? '12px' : '10px 16px',
                    backgroundColor: currentPage === item.key
                      ? 'rgba(0, 180, 216, 0.15)'
                      : 'transparent',
                    color: currentPage === item.key ? '#00b4d8' : 'rgba(255, 255, 255, 0.7)',
                    border: 'none',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 500,
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap'
                  }}
                  onMouseEnter={(e) => {
                    if (currentPage !== item.key) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentPage !== item.key) {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }
                  }}
                  onMouseDown={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                  }}
                  onMouseUp={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  {!sidebarCollapsed && <span>{item.label}</span>}
                </button>
              ))}
            </nav>

            {!sidebarCollapsed && (
              <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <p style={{ margin: '0 0 12px 0', fontSize: '11px', color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  快速访问
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {okrs.slice(0, 3).map(okr => (
                    <button
                      key={okr.id}
                      onClick={() => handleSelectOKR(okr.id)}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: 'transparent',
                        color: 'rgba(255, 255, 255, 0.6)',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        textAlign: 'left',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                        (e.currentTarget as HTMLElement).style.color = '#fff';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        (e.currentTarget as HTMLElement).style.color = 'rgba(255, 255, 255, 0.6)';
                      }}
                    >
                      {okr.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        <main
          style={{
            flex: 1,
            padding: '32px',
            overflow: 'auto',
            minWidth: 0
          }}
        >
          {currentPage === 'list' && (
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
              <div style={{ marginBottom: '32px' }}>
                <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700 }}>
                  季度目标
                </h1>
                <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.6)', fontSize: '14px' }}>
                  共 {okrs.length} 个目标，点击卡片查看详情
                </p>
              </div>
              <OKRList okrs={okrs} loading={loading} onSelectOKR={handleSelectOKR} />
            </div>
          )}

          {currentPage === 'detail' && selectedOKR && (
            <div>
              <div style={{ marginBottom: '24px' }}>
                <button
                  onClick={() => {
                    setCurrentPage('list');
                    setSelectedOKRId(null);
                  }}
                  style={{
                    marginBottom: '16px',
                    padding: '8px 16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseDown={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
                  }}
                  onMouseUp={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                >
                  ← 返回列表
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 700 }}>
                    {selectedOKR.title}
                  </h1>
                  <span
                    style={{
                      padding: '6px 14px',
                      backgroundColor: 'rgba(230, 57, 70, 0.2)',
                      color: '#e63946',
                      fontSize: '13px',
                      fontWeight: 600,
                      borderRadius: '8px'
                    }}
                  >
                    {selectedOKR.quarter}
                  </span>
                </div>
                <p style={{ marginTop: '8px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '13px' }}>
                  截止日期: {formatDate(selectedOKR.deadline)} · 总进度: {calculateWeightedProgress(selectedOKR.keyResults)}%
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(320px, 1fr) minmax(350px, 1.5fr)',
                  gap: '24px',
                  height: 'calc(100vh - 220px)',
                  minHeight: '500px'
                }}
              >
                <KRPanel
                  keyResults={selectedOKR.keyResults}
                  onProgressChange={handleKRProgressChange}
                  editable={true}
                />
                <TaskBoard
                  tasks={selectedOKR.tasks}
                  keyResults={selectedOKR.keyResults}
                  onTaskComplete={handleTaskComplete}
                  onReorder={handleReorder}
                  onAssign={handleAssign}
                />
              </div>
            </div>
          )}

          {currentPage === 'dashboard' && (
            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
              <div style={{ marginBottom: '32px' }}>
                <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 700 }}>
                  数据控制台
                </h1>
                <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.6)', fontSize: '14px' }}>
                  查看团队OKR的多维度数据分析
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '16px',
                  marginBottom: '32px'
                }}
              >
                {[
                  { label: '目标总数', value: okrs.length, color: '#00b4d8' },
                  { label: '总KR数', value: okrs.reduce((s, o) => s + o.keyResults.length, 0), color: '#e63946' },
                  { label: '总任务数', value: okrs.reduce((s, o) => s + o.tasks.length, 0), color: '#48cae4' },
                  { label: '已完成', value: okrs.reduce((s, o) => s + o.tasks.filter(t => t.completed).length, 0), color: '#06d6a0' }
                ].map((stat, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '20px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '14px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = `${stat.color}40`;
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255, 255, 255, 0.08)';
                      (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                    }}
                  >
                    <div
                      style={{
                        fontSize: '32px',
                        fontWeight: 700,
                        color: stat.color,
                        marginBottom: '4px'
                      }}
                    >
                      {stat.value}
                    </div>
                    <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)' }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  padding: '32px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}
              >
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: 600 }}>
                  五维能力雷达图
                </h2>
                <p style={{ margin: '0 0 24px 0', color: 'rgba(255, 255, 255, 0.5)', fontSize: '13px' }}>
                  鼠标滚轮可缩放，悬停数据点查看详情
                </p>
                {radarData.length > 0 && (
                  <RadarChart data={radarData} width={500} height={500} />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
