import { useState, useEffect, useRef } from 'react';
import type { Task } from './App';

interface TaskModalProps {
  task?: Task;
  isCreating?: boolean;
  onSave: (data: Partial<Task>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function TaskModal({ task, isCreating = false, onSave, onDelete, onClose }: TaskModalProps) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    titleRef.current?.focus();
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      handleClose();
    }
  };

  const handleSave = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      description: description.trim(),
      assignee: assignee.trim(),
      dueDate,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClose();
    if (e.key === 'Enter' && e.ctrlKey) handleSave();
  };

  return (
    <div
      ref={overlayRef}
      className={`modal-overlay ${visible ? 'visible' : ''}`}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className={`modal-content ${visible ? 'visible' : ''}`}>
        <div className="modal-title">
          {isCreating ? '新建任务' : '任务详情'}
        </div>

        <div className="form-group">
          <label>标题 *</label>
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入任务标题"
          />
        </div>

        <div className="form-group">
          <label>描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="请输入任务描述"
          />
        </div>

        <div className="form-group">
          <label>负责人</label>
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="请输入负责人姓名"
          />
        </div>

        <div className="form-group">
          <label>截止日期</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              删除
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={handleClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!title.trim()}
          >
            {isCreating ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TaskModal;
