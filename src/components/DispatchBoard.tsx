import React, { useState } from 'react';

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

interface DispatchBoardProps {
  tasks: Task[];
  horses: Horse[];
  onAssignMule: (letterId: string, horseId: string) => void;
  pendingLetters: Letter[];
  onHorseRest: (horseId: string) => void;
  onLetterSelect: (letterId: string) => void;
  selectedLetterId: string | null;
  flashHorseId: string | null;
  glowHorseId: string | null;
}

const HorseSVG: React.FC<{ status: string }> = ({ status }) => {
  const bodyColor = status === 'idle' ? '#2d6a4f' : status === 'transit' ? '#6b3a0f' : '#9c9c9c';
  return (
    <svg className="horse-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="60" rx="30" ry="20" fill={bodyColor} stroke="#3d2914" strokeWidth="2" />
      <circle cx="75" cy="45" r="15" fill={bodyColor} stroke="#3d2914" strokeWidth="2" />
      <circle cx="80" cy="42" r="3" fill="#fff8e1" />
      <circle cx="81" cy="42" r="1.5" fill="#3d2914" />
      <ellipse cx="85" cy="52" rx="4" ry="2" fill="#3d2914" />
      <path d="M68 35 Q72 25 78 28" stroke="#3d2914" strokeWidth="3" fill="none" />
      <line x1="30" y1="75" x2="25" y2="95" stroke="#3d2914" strokeWidth="4" strokeLinecap="round" />
      <line x1="45" y1="78" x2="42" y2="95" stroke="#3d2914" strokeWidth="4" strokeLinecap="round" />
      <line x1="55" y1="78" x2="58" y2="95" stroke="#3d2914" strokeWidth="4" strokeLinecap="round" />
      <line x1="70" y1="75" x2="75" y2="95" stroke="#3d2914" strokeWidth="4" strokeLinecap="round" />
      <path d="M20 55 Q10 50 15 45" stroke="#3d2914" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
};

const HourglassSVG: React.FC<{ onClick: () => void; frame: number }> = ({ onClick, frame }) => {
  const frames = Array.from({ length: 12 }, (_, i) => i);
  const sandHeight = 10 - (frame % 12) * 0.8;
  const bottomSandHeight = (frame % 12) * 0.8;

  return (
    <div className="hourglass-container" onClick={onClick} title="点击刷新">
      <svg className="hourglass-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="5" width="80" height="8" fill="#8b5a2b" rx="2" />
        <rect x="10" y="87" width="80" height="8" fill="#8b5a2b" rx="2" />
        <path d="M20 13 L80 13 L60 50 L80 87 L20 87 L40 50 Z" fill="none" stroke="#8b5a2b" strokeWidth="3" />
        <path d={`M25 15 L75 15 L55 ${25 + sandHeight} L45 ${25 + sandHeight} Z`} fill="#ffd700" />
        <path d={`M45 75 L55 75 L75 85 L25 85 Z`} fill="#ffd700" style={{ clipPath: `inset(${85 - bottomSandHeight * 7}px 0 0 0)` }} />
        {frame % 12 > 0 && (
          <circle cx="50" cy={30 + (frame % 12) * 2} r="2" fill="#ffd700" opacity={0.8} />
        )}
      </svg>
    </div>
  );
};

const CooldownProgress: React.FC<{ endTime: number; onComplete: () => void }> = ({ endTime, onComplete }) => {
  const [now, setNow] = useState(Date.now());
  const totalTime = 30000;
  const remaining = Math.max(0, endTime - now);
  const progress = 1 - remaining / totalTime;
  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference * (1 - progress);

  React.useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [remaining, onComplete]);

  return (
    <div className="cooldown-container">
      <svg className="cooldown-svg" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="none" stroke="#d4b886" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r="18"
          fill="none"
          stroke="#2d6a4f"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="cooldown-text">{Math.ceil(remaining / 1000)}s</div>
    </div>
  );
};

const DispatchBoard: React.FC<DispatchBoardProps> = ({
  tasks,
  horses,
  onAssignMule,
  pendingLetters,
  onHorseRest,
  onLetterSelect,
  selectedLetterId,
  flashHorseId,
  glowHorseId,
}) => {
  const [draggedLetterId, setDraggedLetterId] = useState<string | null>(null);
  const [dragOverHorseId, setDragOverHorseId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const getUrgencyText = (urgency: string) => {
    switch (urgency) {
      case 'urgent': return '紧急';
      case 'normal': return '普通';
      case 'regular': return '平邮';
      default: return urgency;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'idle': return '空闲';
      case 'transit': return '途中';
      case 'resting': return '休息';
      case 'in_progress': return '进行中';
      case 'completed': return '已完成';
      case 'delayed': return '已延迟';
      default: return status;
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTaskProgress = (task: Task) => {
    if (task.status !== 'in_progress') return 100;
    const now = Date.now();
    const total = task.estimatedArrivalTime - task.departureTime;
    const elapsed = now - task.departureTime;
    return Math.min(100, Math.max(0, (elapsed / total) * 100));
  };

  const handleDragStart = (e: React.DragEvent, letterId: string) => {
    setDraggedLetterId(letterId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedLetterId(null);
    setDragOverHorseId(null);
  };

  const handleDragOver = (e: React.DragEvent, horseId: string) => {
    e.preventDefault();
    setDragOverHorseId(horseId);
  };

  const handleDragLeave = () => {
    setDragOverHorseId(null);
  };

  const handleDrop = (e: React.DragEvent, horseId: string) => {
    e.preventDefault();
    if (draggedLetterId) {
      onAssignMule(draggedLetterId, horseId);
    }
    setDraggedLetterId(null);
    setDragOverHorseId(null);
  };

  const handleHorseClick = (horseId: string) => {
    if (isMobile && selectedLetterId) {
      onAssignMule(selectedLetterId, horseId);
    }
  };

  return (
    <>
      <div className="letters-section">
        <h2 className="panel-title">待办信件</h2>
        <div className="pending-letters">
          {pendingLetters.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📬</div>
              <div>暂无待办信件，请新增信件</div>
            </div>
          ) : (
            pendingLetters.map((letter, index) => (
              <div
                key={letter.id}
                className={`letter-card urgency-${letter.urgency} ${
                  draggedLetterId === letter.id ? 'dragging' : ''
                } ${selectedLetterId === letter.id ? 'selected' : ''}`}
                draggable={!isMobile}
                onDragStart={(e) => handleDragStart(e, letter.id)}
                onDragEnd={handleDragEnd}
                onClick={() => isMobile && onLetterSelect(letter.id)}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <span className={`urgency-tag urgency-${letter.urgency}`}>
                  {getUrgencyText(letter.urgency)}
                </span>
                <div className="letter-info">
                  <div><span className="label">发件人:</span> {letter.sender}</div>
                  <div><span className="label">收件人:</span> {letter.receiver}</div>
                  <div><span className="label">目的地:</span> {letter.destination}</div>
                  <div><span className="label">重量:</span> {letter.weight}kg</div>
                  <div><span className="label">预计:</span> {letter.estimatedDeliveryTime}分钟</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="dispatch-board">
        <h2 className="panel-title">运输任务看板</h2>
        <div className="tasks-grid">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🐴</div>
              <div>暂无运输任务</div>
            </div>
          ) : (
            tasks.map((task, index) => (
              <div
                key={task.id}
                className={`task-card ${task.status}`}
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div className="task-header">
                  <span className="task-id">任务 #{task.id.slice(0, 8)}</span>
                  <span className={`task-status-badge status-${task.status === 'in_progress' ? 'transit' : task.status}`}>
                    {getStatusText(task.status)}
                  </span>
                </div>
                <div className="task-info">
                  <div><span className="label">目的地:</span> {task.destination}</div>
                  <div><span className="label">紧急度:</span> {getUrgencyText(task.urgency)}</div>
                  <div><span className="label">马匹:</span> {task.horseName}</div>
                  <div><span className="label">载重:</span> {task.weight}kg</div>
                  <div><span className="label">出发:</span> {formatTime(task.departureTime)}</div>
                  <div><span className="label">预计到达:</span> {formatTime(task.estimatedArrivalTime)}</div>
                  {task.actualArrivalTime && (
                    <div><span className="label">实际到达:</span> {formatTime(task.actualArrivalTime)}</div>
                  )}
                </div>
                {task.status === 'in_progress' && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${getTaskProgress(task)}%` }} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="panel-title">马匹状态</h2>
        <div className="horses-grid">
          {horses.map((horse) => (
            <div
              key={horse.id}
              className={`horse-card ${
                dragOverHorseId === horse.id ? 'drag-over' : ''
              } ${flashHorseId === horse.id ? 'flash-red' : ''} ${
                glowHorseId === horse.id ? 'glow-gold' : ''
              }`}
              onDragOver={(e) => horse.status === 'idle' && handleDragOver(e, horse.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, horse.id)}
              onClick={() => handleHorseClick(horse.id)}
            >
              <HorseSVG status={horse.status} />
              <div className="horse-name">{horse.name}</div>
              <span className={`horse-status status-${horse.status}`}>
                {getStatusText(horse.status)}
              </span>
              <div className="horse-load">
                载重: {horse.currentLoad}/{horse.maxLoad}kg
              </div>
              {horse.status === 'resting' && horse.restCooldownEnd ? (
                <CooldownProgress
                  endTime={horse.restCooldownEnd}
                  onComplete={() => {}}
                />
              ) : (
                <button
                  className="btn btn-rest"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHorseRest(horse.id);
                  }}
                  disabled={horse.status !== 'idle'}
                >
                  休息
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export { HourglassSVG };
export default DispatchBoard;
