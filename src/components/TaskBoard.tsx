import React, { useState, useRef } from 'react';
import { Task, KeyResult, formatDate } from '@/utils/helpers';

interface TaskBoardProps {
  tasks: Task[];
  keyResults: KeyResult[];
  onTaskComplete?: (taskId: string, completed: boolean) => void;
  onReorder?: (taskId: string, newOrder: number) => void;
  onAssign?: (taskId: string, assignee: string) => void;
}

export const TaskBoard: React.FC<TaskBoardProps> = ({
  tasks,
  keyResults,
  onTaskComplete,
  onReorder,
  onAssign
}) => {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const dragOverIndex = useRef<number>(-1);

  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);

  const getKRTitle = (krId: string) => {
    const kr = keyResults.find(k => k.id === krId);
    return kr ? kr.title : '未关联KR';
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    dragOverIndex.current = -1;
  };

  const handleDragOver = (e: React.DragEvent, taskId: string, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverTaskId !== taskId) {
      setDragOverTaskId(taskId);
      dragOverIndex.current = index;
    }
  };

  const handleDrop = (e: React.DragEvent, targetTaskId: string) => {
    e.preventDefault();
    if (!draggedTaskId || draggedTaskId === targetTaskId) return;

    const targetIndex = sortedTasks.findIndex(t => t.id === targetTaskId);
    if (onReorder && targetIndex !== -1) {
      onReorder(draggedTaskId, targetIndex);
    }

    setDraggedTaskId(null);
    setDragOverTaskId(null);
    dragOverIndex.current = -1;
  };

  const EmptyState = () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        color: 'rgba(255, 255, 255, 0.5)'
      }}
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        style={{ animation: 'bounce 2s ease-in-out infinite' }}
      >
        <defs>
          <linearGradient id="emptyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00b4d8" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#e63946" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        <rect x="30" y="25" width="60" height="70" rx="8" fill="none" stroke="url(#emptyGradient)" strokeWidth="2" />
        <line x1="40" y1="42" x2="80" y2="42" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="55" x2="70" y2="55" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="40" y1="68" x2="75" y2="68" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="85" cy="75" r="15" fill="url(#emptyGradient)" opacity="0.5" />
        <path d="M80 75 L84 79 L90 71" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p style={{ marginTop: '20px', fontSize: '14px', fontFamily: "'Inter', sans-serif" }}>
        暂无任务，快来添加第一个任务吧！
      </p>
      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        height: '100%'
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 600,
          color: '#fff',
          fontFamily: "'Inter', sans-serif"
        }}
      >
        子任务 ({tasks.length})
      </h3>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0
        }}
      >
        {sortedTasks.length === 0 ? (
          <EmptyState />
        ) : (
          sortedTasks.map((task, index) => (
            <div
              key={task.id}
              draggable
              onDragStart={(e) => handleDragStart(e, task.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, task.id, index)}
              onDrop={(e) => handleDrop(e, task.id)}
              style={{
                padding: '16px',
                backgroundColor: task.completed
                  ? 'rgba(0, 180, 216, 0.1)'
                  : 'rgba(255, 255, 255, 0.04)',
                borderRadius: '12px',
                border: `1px solid ${
                  draggedTaskId === task.id
                    ? 'rgba(230, 57, 70, 0.5)'
                    : dragOverTaskId === task.id
                    ? 'rgba(0, 180, 216, 0.5)'
                    : 'rgba(255, 255, 255, 0.06)'
                }`,
                cursor: 'grab',
                transform: draggedTaskId === task.id ? 'scale(1.02)' : 'scale(1)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                opacity: draggedTaskId === task.id ? 0.8 : 1,
                boxShadow: draggedTaskId === task.id
                  ? '0 8px 25px rgba(0, 0, 0, 0.3)'
                  : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <button
                  onClick={() => onTaskComplete && onTaskComplete(task.id, !task.completed)}
                  style={{
                    width: '20px',
                    height: '20px',
                    flexShrink: 0,
                    marginTop: '2px',
                    borderRadius: '50%',
                    border: `2px solid ${task.completed ? '#00b4d8' : 'rgba(255,255,255,0.3)'}`,
                    backgroundColor: task.completed ? '#00b4d8' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    transform: 'scale(1)'
                  }}
                  onMouseDown={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(0.9)';
                  }}
                  onMouseUp={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                  }}
                >
                  {task.completed && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6 L5 9 L10 3"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: task.completed ? 'rgba(255, 255, 255, 0.5)' : '#fff',
                      textDecoration: task.completed ? 'line-through' : 'none',
                      fontFamily: "'Inter', sans-serif",
                      lineHeight: 1.4
                    }}
                  >
                    {task.title}
                  </h4>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        backgroundColor: 'rgba(0, 180, 216, 0.15)',
                        color: '#00b4d8',
                        fontSize: '11px',
                        borderRadius: '4px',
                        fontFamily: "'Inter', sans-serif"
                      }}
                    >
                      {task.estimatedHours}h
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: 'rgba(255, 255, 255, 0.6)',
                        fontSize: '11px',
                        borderRadius: '4px',
                        fontFamily: "'Inter', sans-serif"
                      }}
                    >
                      截止: {formatDate(task.deadline)}
                    </span>
                    {task.assignee ? (
                      <span
                        style={{
                          padding: '2px 8px',
                          backgroundColor: 'rgba(230, 57, 70, 0.15)',
                          color: '#e63946',
                          fontSize: '11px',
                          borderRadius: '4px',
                          fontFamily: "'Inter', sans-serif"
                        }}
                      >
                        负责人: {task.assignee}
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          const name = prompt('输入负责人姓名:');
                          if (name && onAssign) {
                            onAssign(task.id, name);
                          }
                        }}
                        style={{
                          padding: '2px 8px',
                          backgroundColor: 'transparent',
                          color: 'rgba(255, 255, 255, 0.5)',
                          fontSize: '11px',
                          borderRadius: '4px',
                          border: '1px dashed rgba(255, 255, 255, 0.3)',
                          cursor: 'pointer',
                          fontFamily: "'Inter', sans-serif",
                          transition: 'all 0.15s ease'
                        }}
                      >
                        + 领取任务
                      </button>
                    )}
                  </div>

                  <div style={{ marginTop: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'rgba(255, 255, 255, 0.4)',
                        fontFamily: "'Inter', sans-serif"
                      }}
                    >
                      关联KR: {getKRTitle(task.krId).substring(0, 30)}...
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
