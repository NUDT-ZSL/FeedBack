import { useState, useEffect, useCallback } from 'react';
import TaskBoard from './TaskBoard';
import TaskModal from './TaskModal';
import StatsChart from './StatsChart';
import useSocket from './hooks/useSocket';

export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  status: 'todo' | 'in-progress' | 'done';
  createdAt: string;
  completedAt?: string;
}

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'board' | 'stats'>('board');
  const [modalTask, setModalTask] = useState<Task | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { socket, connected } = useSocket();

  const showToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = String(Date.now()) + String(Math.random()).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('tasks:init', (initialTasks: Task[]) => {
      setTasks(initialTasks);
    });

    socket.on('task:created', (task: Task) => {
      setTasks((prev) => {
        if (prev.some((t) => t.id === task.id)) return prev;
        return [...prev, task];
      });
    });

    socket.on('task:updated', (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    });

    socket.on('task:deleted', ({ id }: { id: string }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });

    return () => {
      socket.off('tasks:init');
      socket.off('task:created');
      socket.off('task:updated');
      socket.off('task:deleted');
    };
  }, [socket]);

  const createTask = useCallback(
    async (data: { title: string; description: string; assignee: string; dueDate: string }) => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        showToast('任务创建成功');
        setIsCreating(false);
      } else {
        const err = await res.json();
        showToast(err.error || '创建失败', 'error');
      }
    },
    [showToast],
  );

  const updateTask = useCallback(
    async (id: string, data: Partial<Task>) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        showToast('任务更新成功');
        setModalTask(null);
      } else {
        showToast('更新失败', 'error');
      }
    },
    [showToast],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('任务已删除');
        setModalTask(null);
      } else {
        showToast('删除失败', 'error');
      }
    },
    [showToast],
  );

  const handleStatusChange = useCallback(
    async (id: string, status: Task['status']) => {
      await updateTask(id, { status });
    },
    [updateTask],
  );

  const handleOpenCreate = useCallback(() => {
    setIsCreating(true);
    setModalTask(null);
  }, []);

  const handleOpenEdit = useCallback((task: Task) => {
    setIsCreating(false);
    setModalTask(task);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalTask(null);
    setIsCreating(false);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>敏捷团队任务看板</h1>
        <div className="header-actions">
          <div className="connection-status">
            <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
            {connected ? '已连接' : '未连接'}
          </div>
          <button
            className={`view-btn ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            看板
          </button>
          <button
            className={`view-btn ${view === 'stats' ? 'active' : ''}`}
            onClick={() => setView('stats')}
          >
            统计
          </button>
        </div>
      </header>

      {view === 'board' ? (
        <TaskBoard
          tasks={tasks}
          onCreateTask={createTask}
          onStatusChange={handleStatusChange}
          onTaskClick={handleOpenEdit}
          onOpenCreate={handleOpenCreate}
        />
      ) : (
        <StatsChart tasks={tasks} />
      )}

      {(modalTask || isCreating) && (
        <TaskModal
          task={isCreating ? undefined : modalTask!}
          isCreating={isCreating}
          onSave={isCreating ? (data) => createTask(data as any) : (data) => updateTask(modalTask!.id, data)}
          onDelete={isCreating ? undefined : () => deleteTask(modalTask!.id)}
          onClose={handleCloseModal}
        />
      )}

      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
