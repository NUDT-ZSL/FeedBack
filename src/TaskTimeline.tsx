import React, { useState } from 'react';
import type { Task, TaskWithProgress } from './types';

interface TaskTimelineProps {
  tasks: Task[];
  timeLeft: number;
  initialTime: number;
  onAddTask: (task: Task) => void;
  onRemoveTask: (id: string) => void;
  isRunning: boolean;
  showAddForm?: boolean;
  onShowAddFormChange?: (show: boolean) => void;
}

const TaskTimeline: React.FC<TaskTimelineProps> = ({
  tasks,
  timeLeft,
  initialTime,
  onAddTask,
  onRemoveTask,
  isRunning,
  showAddForm: controlledShowAddForm,
  onShowAddFormChange,
}) => {
  const [internalShowAddForm, setInternalShowAddForm] = useState(false);
  const showAddForm = controlledShowAddForm !== undefined ? controlledShowAddForm : internalShowAddForm;
  
  const setShowAddForm = (value: boolean | ((prev: boolean) => boolean)) => {
    const newValue = typeof value === 'function' ? value(showAddForm) : value;
    if (onShowAddFormChange) {
      onShowAddFormChange(newValue);
    } else {
      setInternalShowAddForm(newValue);
    }
  };
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDuration, setNewTaskDuration] = useState(5);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const calculateTaskProgress = (task: Task, index: number): TaskWithProgress => {
    let cumulativeTime = 0;
    for (let i = 0; i < index; i++) {
      cumulativeTime += tasks[i].duration * 60;
    }

    const taskTotalSeconds = task.duration * 60;
    const taskEndTime = initialTime - cumulativeTime;
    const taskStartTime = taskEndTime - taskTotalSeconds;
    const elapsedInTask = Math.max(0, Math.min(taskTotalSeconds, taskEndTime - timeLeft));
    const progress = (elapsedInTask / taskTotalSeconds) * 100;
    const remainingInTask = Math.max(0, taskTotalSeconds - elapsedInTask);

    let status: 'pending' | 'active' | 'completed';
    if (timeLeft > taskEndTime) {
      status = 'pending';
    } else if (timeLeft > taskStartTime) {
      status = 'active';
    } else {
      status = 'completed';
    }

    return {
      ...task,
      status,
      remainingTime: remainingInTask,
      progress: Math.min(100, Math.max(0, progress)),
    };
  };

  const tasksWithProgress = tasks.map((task, index) =>
    calculateTaskProgress(task, index)
  );

  const handleAddTask = () => {
    if (newTaskName.trim() && tasks.length < 5) {
      onAddTask({
        id: Date.now().toString(),
        name: newTaskName.trim(),
        duration: newTaskDuration,
      });
      setNewTaskName('');
      setNewTaskDuration(5);
      setShowAddForm(false);
    }
  };

  const handleCancelAdd = () => {
    setNewTaskName('');
    setNewTaskDuration(5);
    setShowAddForm(false);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getDotColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#4CAF50';
      case 'active':
        return '#2196F3';
      default:
        return '#9e9e9e';
    }
  };

  const getProgressBarColor = (task: TaskWithProgress) => {
    if (task.status === 'completed') return '#4CAF50';
    if (task.status === 'active') {
      const taskTotalSeconds = task.duration * 60;
      if (task.remainingTime <= 10) return '#f44336';
      if (task.remainingTime < taskTotalSeconds * 0.5) return '#ff9800';
      return '#2196F3';
    }
    return '#9e9e9e';
  };

  const isBlinking = (task: TaskWithProgress) => {
    return task.status === 'active' && task.remainingTime <= 10 && task.remainingTime > 0;
  };

  return (
    <div style={{
      width: '100%',
      maxWidth: '800px',
      marginTop: '30px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600' }}>任务时间线</h2>
        {tasks.length < 5 && !isRunning && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            + 添加任务
          </button>
        )}
      </div>

      {showAddForm && (
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          padding: '20px',
          borderRadius: '12px',
          marginBottom: '20px',
          animation: 'slideDown 0.3s ease-out',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="任务名称"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              style={{
                flex: '1',
                minWidth: '150px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                outline: 'none',
              }}
            />
            <input
              type="number"
              min="1"
              max="999"
              placeholder="时长(分钟)"
              value={newTaskDuration}
              onChange={(e) => setNewTaskDuration(Math.max(1, parseInt(e.target.value) || 1))}
              style={{
                width: '120px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                outline: 'none',
              }}
            />
            <button
              onClick={handleAddTask}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4CAF50',
                color: '#ffffff',
                cursor: 'pointer',
                fontWeight: 'bold',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow = '0 4px 15px rgba(76, 175, 80, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              确认
            </button>
            <button
              onClick={handleCancelAdd}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                backgroundColor: 'transparent',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {tasksWithProgress.map((task, _index) => (
          <div
            key={task.id}
            onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: '12px',
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              border: task.status === 'active' ? '1px solid rgba(33, 150, 243, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
              animation: task.status === 'active' && expandedId !== task.id ? 'fadeIn 0.3s ease' : 'none',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: getDotColor(task.status),
                flexShrink: 0,
                boxShadow: task.status === 'active' ? `0 0 10px ${getDotColor(task.status)}` : 'none',
              }} />
              <span style={{
                flex: '1',
                fontSize: '16px',
                fontWeight: task.status === 'active' ? '600' : '400',
                opacity: task.status === 'completed' ? 0.6 : 1,
              }}>
                {task.name}
              </span>
              <span style={{
                fontSize: '14px',
                color: 'rgba(255, 255, 255, 0.7)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {task.duration}分钟
              </span>
              {!isRunning && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTask(task.id);
                  }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: 'rgba(244, 67, 54, 0.2)',
                    color: '#f44336',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(244, 67, 54, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
                  }}
                >
                  删除
                </button>
              )}
            </div>

            <div style={{
              overflow: 'hidden',
              maxHeight: expandedId === task.id ? '200px' : '0',
              transition: 'max-height 0.3s ease-in-out',
            }}>
              <div style={{ marginTop: '16px' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.8)',
                }}>
                  <span>
                    {task.status === 'pending' ? '未开始' : task.status === 'active' ? '进行中' : '已完成'}
                  </span>
                  <span
                    style={{
                      animation: isBlinking(task) ? 'blink 0.5s ease-in-out infinite' : 'none',
                      color: task.remainingTime <= 10 && task.status === 'active' ? '#f44336' : 'inherit',
                      fontWeight: task.status === 'active' ? '600' : '400',
                    }}
                  >
                    剩余 {formatTime(task.remainingTime)}
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${task.progress}%`,
                      backgroundColor: getProgressBarColor(task),
                      transition: 'width 0.5s linear, background-color 0.3s',
                      animation: isBlinking(task) ? 'blink 0.5s ease-in-out infinite' : 'none',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '14px',
          }}>
            暂无任务，点击上方按钮添加任务节点
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 768px) {
          div[style*="flex-direction: column"] {
            flex-direction: column !important;
          }
        }
      `}</style>
    </div>
  );
};

export default TaskTimeline;
