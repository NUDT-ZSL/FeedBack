import React, { useState, useEffect, useCallback } from 'react';
import TimerPanel from './TimerPanel';
import TaskTimeline from './TaskTimeline';
import { useTimer } from './hooks/useTimer';
import type { Task } from './types';

const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRestoreToast, setShowRestoreToast] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);

  const { state, control, saveConfig, loadConfig } = useTimer(25);

  useEffect(() => {
    const savedConfig = loadConfig();
    if (savedConfig) {
      control.setTime(savedConfig.time);
      setTasks(savedConfig.tasks);
      setShowRestoreToast(true);
      setTimeout(() => setShowRestoreToast(false), 2000);
    }
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (isInitialized) {
      saveConfig(tasks);
    }
  }, [state.initialTime, tasks, isInitialized, saveConfig]);

  const handleDurationChange = useCallback((minutes: number) => {
    control.setTime(minutes);
  }, [control]);

  const handleAddTask = useCallback((task: Task) => {
    setTasks(prev => [...prev, task]);
  }, []);

  const handleRemoveTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      if (isInput) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (state.isRunning) {
            control.pause();
          } else {
            control.start();
          }
          break;
        case 'KeyR':
          e.preventDefault();
          control.reset();
          break;
        case 'KeyT':
          e.preventDefault();
          if (!state.isRunning && !state.isPaused && tasks.length < 5) {
            setShowAddTaskForm(true);
            setShowShortcuts(false);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isRunning, control, tasks.length]);

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
      position: 'relative',
    }}>
      {showRestoreToast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(76, 175, 80, 0.9)',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          zIndex: 1000,
          animation: 'slideIn 0.3s ease-out',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        }}>
          ✓ 已恢复上次配置
        </div>
      )}

      <div
        onClick={() => setShowShortcuts(!showShortcuts)}
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 100,
          transition: 'all 0.3s ease',
          border: '1px solid rgba(255, 255, 255, 0.2)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6m4.22-13.22l4.24 4.24M1.54 1.54l4.24 4.24M20.46 20.46l-4.24-4.24M1.54 20.46l4.24-4.24" />
        </svg>
      </div>

      {showShortcuts && (
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '20px',
          backgroundColor: 'rgba(30, 58, 95, 0.95)',
          backdropFilter: 'blur(20px)',
          borderRadius: '12px',
          padding: '20px',
          minWidth: '240px',
          zIndex: 101,
          animation: 'slideDown 0.2s ease-out',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}>
          <h3 style={{ fontSize: '16px', marginBottom: '16px', fontWeight: '600' }}>
            键盘快捷键
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)' }}>开始/暂停</span>
              <kbd style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}>空格</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)' }}>重置</span>
              <kbd style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}>R</kbd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)' }}>添加任务</span>
              <kbd style={{
                padding: '4px 10px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
              }}>T</kbd>
            </div>
          </div>
        </div>
      )}

      <h1 style={{
        fontSize: '32px',
        fontWeight: 'bold',
        marginBottom: '8px',
        textAlign: 'center',
      }}>
        课堂计时器
      </h1>
      <p style={{
        fontSize: '14px',
        color: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '30px',
        textAlign: 'center',
      }}>
        高效管理课堂时间，设置任务节点
      </p>

      <TimerPanel
        state={state}
        control={control}
        onDurationChange={handleDurationChange}
      />

      <TaskTimeline
        tasks={tasks}
        timeLeft={state.timeLeft}
        initialTime={state.initialTime}
        onAddTask={handleAddTask}
        onRemoveTask={handleRemoveTask}
        isRunning={state.isRunning || state.isPaused}
        showAddForm={showAddTaskForm}
        onShowAddFormChange={setShowAddTaskForm}
      />

      <div style={{
        marginTop: '40px',
        padding: '16px 24px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '8px',
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.5)',
        textAlign: 'center',
        maxWidth: '600px',
      }}>
        提示：按 <kbd style={{
          padding: '2px 6px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          fontFamily: 'monospace',
        }}>空格</kbd> 开始/暂停，
        <kbd style={{
          padding: '2px 6px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          fontFamily: 'monospace',
          margin: '0 4px',
        }}>R</kbd> 重置，
        <kbd style={{
          padding: '2px 6px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          fontFamily: 'monospace',
          margin: '0 4px',
        }}>T</kbd> 添加任务
      </div>
    </div>
  );
};

export default App;
