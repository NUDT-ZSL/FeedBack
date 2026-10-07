import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import DispatchBoard, { HourglassSVG } from './components/DispatchBoard';
import './styles.css';

interface Letter {
  id: string;
  sender: string;
  receiver: string;
  destination: string;
  urgency: 'urgent' | 'normal' | 'regular';
  weight: number;
  status: 'pending' | 'assigned' | 'delivered';
  estimatedDeliveryTime: number;
  createdAt: number;
}

interface Horse {
  id: string;
  name: string;
  status: 'idle' | 'transit' | 'resting';
  currentLoad: number;
  maxLoad: number;
  restCooldownEnd: number | null;
  assignedTaskId: string | null;
}

interface Fleet {
  id: string;
  name: string;
  horseIds: string;
  currentLocation: string;
  totalLoad: number;
  maxLoad: number;
  status: 'idle' | 'transit';
}

interface Task {
  id: string;
  letterId: string;
  horseId: string;
  fleetId: string | null;
  departureTime: number;
  estimatedArrivalTime: number;
  actualArrivalTime: number | null;
  status: 'in_progress' | 'completed' | 'delayed';
  destination: string;
  urgency: string;
  weight: number;
  horseName: string;
}

interface Statistics {
  todayDeliveries: number;
  averageDeliveryTime: number;
  overtimeRate: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

const App: React.FC = () => {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [horses, setHorses] = useState<Horse[]>([]);
  const [fleets, setFleets] = useState<Fleet[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [historyTasks, setHistoryTasks] = useState<Task[]>([]);
  const [statistics, setStatistics] = useState<Statistics>({
    todayDeliveries: 0,
    averageDeliveryTime: 0,
    overtimeRate: 0,
  });

  const [formData, setFormData] = useState({
    sender: '',
    receiver: '',
    destination: '长安',
    urgency: 'normal' as 'urgent' | 'normal' | 'regular',
    weight: 5,
  });

  const [selectedLetterId, setSelectedLetterId] = useState<string | null>(null);
  const [flashHorseId, setFlashHorseId] = useState<string | null>(null);
  const [glowHorseId, setGlowHorseId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hourglassFrame, setHourglassFrame] = useState(0);

  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const HISTORY_LIMIT = 20;

  const destinations = ['长安', '洛阳', '扬州', '成都', '荆州', '幽州', '凉州', '广州'];

  useEffect(() => {
    const timer = setInterval(() => {
      setHourglassFrame((prev) => (prev + 1) % 12);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const fetchLetters = useCallback(async () => {
    try {
      const res = await axios.get('/api/letters');
      if (res.data.success) {
        setLetters(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch letters:', err);
    }
  }, []);

  const fetchHorses = useCallback(async () => {
    try {
      const res = await axios.get('/api/horses');
      if (res.data.success) {
        setHorses(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch horses:', err);
    }
  }, []);

  const fetchFleets = useCallback(async () => {
    try {
      const res = await axios.get('/api/fleets');
      if (res.data.success) {
        setFleets(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch fleets:', err);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await axios.get('/api/tasks');
      if (res.data.success) {
        setTasks(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  const fetchHistory = useCallback(async (page: number = 1) => {
    try {
      const res = await axios.get('/api/tasks/history', {
        params: { page, limit: HISTORY_LIMIT },
      });
      if (res.data.success) {
        if (page === 1) {
          setHistoryTasks(res.data.data.tasks);
        } else {
          setHistoryTasks((prev) => [...prev, ...res.data.data.tasks]);
        }
        setHistoryTotal(res.data.data.total);
        setHasMoreHistory(res.data.data.hasMore);
        setHistoryPage(page);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  }, []);

  const fetchStatistics = useCallback(async () => {
    try {
      const res = await axios.get('/api/statistics');
      if (res.data.success) {
        setStatistics(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch statistics:', err);
    }
  }, []);

  const fetchBusy = useCallback(() => {
    fetchTasks();
    fetchLetters();
    fetchHorses();
    fetchStatistics();
  }, [fetchTasks, fetchLetters, fetchHorses, fetchStatistics]);

  useEffect(() => {
    fetchBusy();
    fetchFleets();
    fetchHistory(1);

    const interval = setInterval(() => {
      fetchBusy();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchBusy, fetchFleets, fetchHistory]);

  const handleRefresh = useCallback(() => {
    fetchBusy();
    fetchHistory(1);
    showToast('数据已刷新', 'success');
  }, [fetchBusy, fetchHistory, showToast]);

  const handleSubmitLetter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/letters', formData);
      if (res.data.success) {
        setLetters((prev) => [res.data.data, ...prev]);
        setFormData({
          sender: '',
          receiver: '',
          destination: '长安',
          urgency: 'normal',
          weight: 5,
        });
        showToast('信件添加成功', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || '添加失败', 'error');
    }
  };

  const handleHorseRest = async (horseId: string) => {
    try {
      const res = await axios.post(`/api/horses/${horseId}/rest`);
      if (res.data.success) {
        setHorses((prev) =>
          prev.map((h) => (h.id === horseId ? res.data.data : h))
        );
        showToast('马匹已安排休息', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || '操作失败', 'error');
    }
  };

  const handleAssignMule = async (letterId: string, horseId: string) => {
    const letter = letters.find((l) => l.id === letterId);
    const horse = horses.find((h) => h.id === horseId);

    if (!letter || !horse) {
      showToast('数据错误', 'error');
      return;
    }

    if (horse.status !== 'idle') {
      setFlashHorseId(horseId);
      setTimeout(() => setFlashHorseId(null), 500);
      showToast('马匹不在空闲状态', 'error');
      return;
    }

    if (horse.currentLoad + letter.weight > horse.maxLoad) {
      setFlashHorseId(horseId);
      setTimeout(() => setFlashHorseId(null), 500);
      showToast('马匹载重超限', 'error');
      return;
    }

    try {
      const res = await axios.post('/api/tasks', { letterId, horseId });
      if (res.data.success) {
        setGlowHorseId(horseId);
        setTimeout(() => setGlowHorseId(null), 300);

        setTasks((prev) => [res.data.data, ...prev]);
        setLetters((prev) =>
          prev.map((l) => (l.id === letterId ? { ...l, status: 'assigned' as const } : l))
        );
        setHorses((prev) =>
          prev.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  status: 'transit' as const,
                  currentLoad: h.currentLoad + letter.weight,
                  assignedTaskId: res.data.data.id,
                }
              : h
          )
        );
        setSelectedLetterId(null);
        showToast('分配成功', 'success');
      }
    } catch (err: any) {
      setFlashHorseId(horseId);
      setTimeout(() => setFlashHorseId(null), 500);
      showToast(err.response?.data?.error || '分配失败', 'error');
    }
  };

  const handleLetterSelect = (letterId: string) => {
    setSelectedLetterId((prev) => (prev === letterId ? null : letterId));
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '准时';
      case 'delayed':
        return '延迟';
      default:
        return '进行中';
    }
  };

  const pendingLetters = letters.filter((l) => l.status === 'pending');

  return (
    <>
      <div className="header">
        <h1>🏯 古代驿站管理系统</h1>
        <HourglassSVG onClick={handleRefresh} frame={hourglassFrame} />
        <div className="statistics-panel">
          <div className="stat-card">
            <h3>今日派送</h3>
            <div className="stat-value">{statistics.todayDeliveries}</div>
          </div>
          <div className="stat-card">
            <h3>平均时长</h3>
            <div className="stat-value">{statistics.averageDeliveryTime}分</div>
          </div>
          <div className="stat-card">
            <h3>超时率</h3>
            <div className="stat-value">{statistics.overtimeRate}%</div>
          </div>
        </div>
      </div>

      <div className="app-container">
        <div className="sidebar">
          <h2 className="panel-title">📜 任务历史</h2>
          <div className="history-list">
            {historyTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <div>暂无历史记录</div>
              </div>
            ) : (
              historyTasks.map((task, index) => (
                <div
                  key={task.id}
                  className="history-item"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  <div className="letter-id">
                    信件 #{task.letterId.slice(0, 8)} → {task.destination}
                  </div>
                  <div className="times">
                    <div>马匹: {task.horseName}</div>
                    <div>出发: {formatTime(task.departureTime)}</div>
                    {task.actualArrivalTime && (
                      <div>到达: {formatTime(task.actualArrivalTime)}</div>
                    )}
                  </div>
                  <span
                    className={`status-final ${
                      task.status === 'delayed' ? 'status-delayed' : 'status-on-time'
                    }`}
                  >
                    {getStatusText(task.status)}
                  </span>
                </div>
              ))
            )}
          </div>
          {historyTotal > 50 && (
            <div className="pagination-controls">
              <button
                onClick={() => fetchHistory(historyPage - 1)}
                disabled={historyPage === 1}
              >
                上一页
              </button>
              <span className="page-info">
                {historyPage} / {Math.ceil(historyTotal / HISTORY_LIMIT)}
              </span>
              <button
                onClick={() => fetchHistory(historyPage + 1)}
                disabled={!hasMoreHistory}
              >
                下一页
              </button>
            </div>
          )}
        </div>

        <div className="main-content">
          <form className="letter-form" onSubmit={handleSubmitLetter}>
            <h2 className="panel-title">✉️ 新增信件</h2>
            <div className="form-row">
              <div className="form-group">
                <label>发件人</label>
                <input
                  type="text"
                  value={formData.sender}
                  onChange={(e) =>
                    setFormData({ ...formData, sender: e.target.value })
                  }
                  placeholder="请输入发件人姓名"
                  required
                />
              </div>
              <div className="form-group">
                <label>收件人</label>
                <input
                  type="text"
                  value={formData.receiver}
                  onChange={(e) =>
                    setFormData({ ...formData, receiver: e.target.value })
                  }
                  placeholder="请输入收件人姓名"
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>目的地</label>
                <select
                  value={formData.destination}
                  onChange={(e) =>
                    setFormData({ ...formData, destination: e.target.value })
                  }
                >
                  {destinations.map((dest) => (
                    <option key={dest} value={dest}>
                      {dest}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>紧急程度</label>
                <select
                  value={formData.urgency}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      urgency: e.target.value as 'urgent' | 'normal' | 'regular',
                    })
                  }
                >
                  <option value="urgent">🔴 紧急（加急）</option>
                  <option value="normal">🟡 普通（正常）</option>
                  <option value="regular">🟢 平邮（延迟）</option>
                </select>
              </div>
              <div className="form-group">
                <label>重量 (kg)</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formData.weight}
                  onChange={(e) =>
                    setFormData({ ...formData, weight: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">
              添加信件
            </button>
          </form>

          <DispatchBoard
            tasks={tasks}
            horses={horses}
            onAssignMule={handleAssignMule}
            pendingLetters={pendingLetters}
            onHorseRest={handleHorseRest}
            onLetterSelect={handleLetterSelect}
            selectedLetterId={selectedLetterId}
            flashHorseId={flashHorseId}
            glowHorseId={glowHorseId}
          />
        </div>

        <div className="right-panel">
          <div className="fleets-section">
            <h2 className="panel-title">🚚 车队状态</h2>
            {fleets.map((fleet) => (
              <div key={fleet.id} className="fleet-card">
                <div className="fleet-name">{fleet.name}</div>
                <div className="fleet-info">
                  <div>位置: {fleet.currentLocation}</div>
                  <div>
                    载重: {fleet.totalLoad}/{fleet.maxLoad}kg
                  </div>
                  <div>
                    状态:{' '}
                    <span
                      className={`horse-status status-${
                        fleet.status === 'idle' ? 'idle' : 'transit'
                      }`}
                    >
                      {fleet.status === 'idle' ? '空闲' : '途中'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(139, 90, 43, 0.1)', borderRadius: '10px' }}>
            <h3 style={{ color: '#5c3d1e', marginBottom: '10px' }}>📖 使用说明</h3>
            <div style={{ fontSize: '13px', lineHeight: '1.8', color: '#6b3a0f' }}>
              <p>• 填写表单新增信件</p>
              <p>• <strong>桌面端</strong>：拖拽信件到马匹上完成分配</p>
              <p>• <strong>移动端</strong>：先点击信件选中，再点击马匹分配</p>
              <p>• 马匹载重上限50kg，超限无法分配</p>
              <p>• 点击"休息"按钮可让马匹恢复体力（30秒冷却）</p>
              <p>• 点击右上角沙漏刷新数据</p>
            </div>
          </div>
        </div>
      </div>

      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </>
  );
};

export default App;
