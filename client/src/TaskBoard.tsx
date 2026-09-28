import { useState, useMemo, useCallback } from 'react';
import type { Task } from './App';

interface TaskBoardProps {
  tasks: Task[];
  onCreateTask: (data: { title: string; description: string; assignee: string; dueDate: string }) => void;
  onStatusChange: (id: string, status: Task['status']) => void;
  onTaskClick: (task: Task) => void;
  onOpenCreate: () => void;
}

const COLUMNS: { key: Task['status']; label: string; className: string }[] = [
  { key: 'todo', label: '待办', className: 'todo' },
  { key: 'in-progress', label: '进行中', className: 'in-progress' },
  { key: 'done', label: '已完成', className: 'done' },
];

function TaskBoard({ tasks, onStatusChange, onTaskClick, onOpenCreate }: TaskBoardProps) {
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [dragOverColumn, setDragOverColumn] = useState<Task['status'] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const assignees = useMemo(() => {
    const set = new Set(tasks.map((t) => t.assignee).filter(Boolean));
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterAssignee && t.assignee !== filterAssignee) return false;
      if (filterDateFrom && t.dueDate < filterDateFrom) return false;
      if (filterDateTo && t.dueDate > filterDateTo) return false;
      return true;
    });
  }, [tasks, filterAssignee, filterDateFrom, filterDateTo]);

  const columnTasks = useMemo(() => {
    const map: Record<Task['status'], Task[]> = {
      todo: [],
      'in-progress': [],
      done: [],
    };
    for (const t of filteredTasks) {
      map[t.status].push(t);
    }
    return map;
  }, [filteredTasks]);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(taskId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, status: Task['status']) => {
    e.preventDefault();
    setDragOverColumn(status);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverColumn(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, status: Task['status']) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain');
      if (taskId) {
        const task = tasks.find((t) => t.id === taskId);
        if (task && task.status !== status) {
          onStatusChange(taskId, status);
        }
      }
      setDragOverColumn(null);
      setDraggingId(null);
    },
    [tasks, onStatusChange],
  );

  const isOverdue = (task: Task) => {
    if (task.status === 'done' || !task.dueDate) return false;
    return new Date(task.dueDate) < new Date(new Date().toISOString().split('T')[0]);
  };

  return (
    <div className="board-container">
      <div className="filters">
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="filter-select"
        >
          <option value="">全部负责人</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <div className="date-filter">
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="filter-date"
            placeholder="起始日期"
          />
          <span className="date-separator">至</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="filter-date"
            placeholder="结束日期"
          />
        </div>
        {(filterAssignee || filterDateFrom || filterDateTo) && (
          <button
            className="clear-filter-btn"
            onClick={() => {
              setFilterAssignee('');
              setFilterDateFrom('');
              setFilterDateTo('');
            }}
          >
            清除筛选
          </button>
        )}
        <button className="create-task-btn" onClick={onOpenCreate}>
          + 新建任务
        </button>
      </div>

      <div className="board-columns">
        {COLUMNS.map(({ key, label, className }) => (
          <div
            key={key}
            className={`board-column ${dragOverColumn === key ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragEnter={(e) => handleDragEnter(e, key)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, key)}
          >
            <div className={`column-header ${className}`}>
              <span>{label}</span>
              <span className="count">{columnTasks[key].length}</span>
            </div>
            <div className="column-body">
              {columnTasks[key].map((task) => (
                <div
                  key={task.id}
                  className={`task-card ${draggingId === task.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => onTaskClick(task)}
                >
                  <div className="task-card-title">{task.title}</div>
                  {task.description && (
                    <div className="task-card-desc">{task.description}</div>
                  )}
                  <div className="task-card-meta">
                    {task.assignee && (
                      <span className="task-card-assignee">{task.assignee}</span>
                    )}
                    {task.dueDate && (
                      <span className={`task-card-due ${isOverdue(task) ? 'overdue' : ''}`}>
                        {task.dueDate}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {columnTasks[key].length === 0 && (
                <div className="column-empty">暂无任务</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskBoard;
