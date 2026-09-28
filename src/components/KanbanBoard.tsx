import React, { useState, useRef, useCallback } from 'react';
import { Idea, KanbanColumn, Tag, STATUS_LABELS, STATUS_COLORS } from '../utils/types';
import IdeaCard from './IdeaCard';

interface KanbanBoardProps {
  ideas: Idea[];
  columns: KanbanColumn[];
  tags: Tag[];
  onIdeaClick: (idea: Idea) => void;
  onAddColumn: (name: string) => void;
  onDeleteColumn: (id: string) => void;
  onMoveIdea: (ideaId: string, columnId: string) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  ideas,
  columns,
  tags,
  onIdeaClick,
  onAddColumn,
  onDeleteColumn,
  onMoveIdea,
}) => {
  const [newColName, setNewColName] = useState('');
  const [showNewCol, setShowNewCol] = useState(false);
  const [draggedIdeaId, setDraggedIdeaId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const sorted = [...columns].sort((a, b) => a.order - b.order);

  const handleDragStart = useCallback((ideaId: string) => {
    setDraggedIdeaId(ideaId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverColId(colId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColId(null);
  }, []);

  const handleDrop = useCallback(
    (colId: string) => {
      if (draggedIdeaId) {
        onMoveIdea(draggedIdeaId, colId);
      }
      setDraggedIdeaId(null);
      setDragOverColId(null);
    },
    [draggedIdeaId, onMoveIdea],
  );

  const handleAddColumn = () => {
    if (newColName.trim()) {
      onAddColumn(newColName.trim());
      setNewColName('');
      setShowNewCol(false);
    }
  };

  return (
    <div className="kanban-board">
      {sorted.map((col) => {
        const colIdeas = ideas.filter((i) => i.columnId === col.id);
        return (
          <div
            key={col.id}
            className={`kanban-column ${dragOverColId === col.id ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(col.id)}
          >
            <div className="kanban-col-header">
              <h3>{col.name}</h3>
              <span className="kanban-col-count">{colIdeas.length}</span>
              {col.id !== 'col-todo' && col.id !== 'col-doing' && col.id !== 'col-hold' && (
                <button className="kanban-col-delete" onClick={() => onDeleteColumn(col.id)} title="删除列">
                  ×
                </button>
              )}
            </div>
            <div className="kanban-col-body">
              {colIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className={`kanban-card-wrapper ${draggedIdeaId === idea.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(idea.id)}
                >
                  <IdeaCard idea={idea} tags={tags} onClick={onIdeaClick} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="kanban-column kanban-add-col">
        {showNewCol ? (
          <div className="kanban-add-form">
            <input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="列名称"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
            />
            <div className="kanban-add-actions">
              <button onClick={handleAddColumn}>添加</button>
              <button onClick={() => setShowNewCol(false)}>取消</button>
            </div>
          </div>
        ) : (
          <button className="kanban-add-btn" onClick={() => setShowNewCol(true)}>
            + 添加列
          </button>
        )}
      </div>
    </div>
  );
};

export default KanbanBoard;
