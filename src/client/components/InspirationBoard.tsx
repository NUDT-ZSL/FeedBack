import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { InspirationCard, Note, Book } from '../../types';
import { tagToColor } from '../utils/color';
import { BoardGroups, loadLayout, saveLayout } from '../utils/boardLayout';

interface InspirationBoardProps {
  notes: Note[];
  books: Book[];
  onRemoveCard: (id: string) => void;
  onMoveCard?: (cardId: string, targetBookId: string) => Promise<boolean> | boolean;
}

const InspirationBoard: React.FC<InspirationBoardProps> = ({
  notes,
  books,
  onRemoveCard,
  onMoveCard,
}) => {
  const [groups, setGroups] = useState<BoardGroups>(loadLayout);

  useEffect(() => {
    saveLayout(groups);
  }, [groups]);

  // 笔记被删除后，同步移除指向它的卡片，避免留下空卡
  useEffect(() => {
    setGroups((prev) => {
      const noteIds = new Set(notes.map((n) => n.id));
      let changed = false;
      const next: BoardGroups = {};
      Object.entries(prev).forEach(([bookId, cards]) => {
        const kept = cards.filter((c) => noteIds.has(c.noteId));
        if (kept.length !== cards.length) changed = true;
        if (kept.length > 0) next[bookId] = kept;
      });
      return changed ? next : prev;
    });
  }, [notes]);

  const getBookTitle = useCallback(
    (bookId: string) => {
      const book = books.find((b) => b.id === bookId);
      return book ? book.title : '未知书籍';
    },
    [books]
  );

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    // 拖到组外空白处：取消
    if (!destination) return;
    const sourceBookId = source.droppableId;
    const targetBookId = destination.droppableId;
    const sourceCards = groups[sourceBookId];
    const targetCards = groups[targetBookId];
    // 目标组为空（不存在或没有卡片）：取消，不做任何归属变更
    if (!sourceCards || !targetCards || targetCards.length === 0) return;

    // 同一本书内拖拽：只调整顺序，不触发归属变更
    if (sourceBookId === targetBookId) {
      if (source.index === destination.index) return;
      const reordered = Array.from(sourceCards);
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      setGroups((prev) => ({ ...prev, [sourceBookId]: reordered }));
      return;
    }

    // 跨组拖拽：先乐观落位，归属更新失败则整体回滚到原组原顺序
    const prevGroups = groups;
    const nextSource = Array.from(sourceCards);
    const [moved] = nextSource.splice(source.index, 1);
    const nextTarget = Array.from(targetCards);
    nextTarget.splice(destination.index, 0, { ...moved, bookId: targetBookId });
    setGroups({
      ...groups,
      [sourceBookId]: nextSource,
      [targetBookId]: nextTarget,
    });

    if (onMoveCard) {
      let ok = false;
      try {
        ok = await onMoveCard(draggableId, targetBookId);
      } catch {
        ok = false;
      }
      if (!ok) {
        setGroups(prevGroups);
      }
    }
  };

  const handleAddCard = (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const exists = Object.values(groups).some((cards) =>
      cards.some((c) => c.noteId === noteId)
    );
    if (exists) return;

    const newCard: InspirationCard = {
      id: `insp-${Date.now()}`,
      noteId: note.id,
      bookId: note.bookId,
      summary: note.highlightText || note.thought || `第${note.pageNumber}页笔记`,
      tags: note.tags,
      x: 0,
      y: 0,
    };
    setGroups((prev) => ({
      ...prev,
      [note.bookId]: [...(prev[note.bookId] || []), newCard],
    }));
  };

  const handleRemoveCard = (cardId: string) => {
    setGroups((prev) => {
      const next: BoardGroups = {};
      Object.entries(prev).forEach(([bookId, cards]) => {
        const kept = cards.filter((c) => c.id !== cardId);
        if (kept.length > 0) next[bookId] = kept;
      });
      return next;
    });
    onRemoveCard(cardId);
  };

  const handleClearBoard = () => {
    if (window.confirm('确定要清空灵感板吗？')) {
      setGroups({});
    }
  };

  const allCards = useMemo(() => Object.values(groups).flat(), [groups]);

  const notesNotOnBoard = useMemo(
    () => notes.filter((n) => !allCards.some((c) => c.noteId === n.id)),
    [notes, allCards]
  );

  // 按书架顺序排列有卡片的分组，未知书籍的分组排在最后
  const orderedBookIds = useMemo(() => {
    const ids = books.filter((b) => (groups[b.id] || []).length > 0).map((b) => b.id);
    Object.keys(groups).forEach((id) => {
      if (groups[id].length > 0 && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }, [books, groups]);

  return (
    <div>
      <div className="inspiration-toolbar">
        <select
          className="add-to-board-select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) {
              handleAddCard(e.target.value);
              e.target.value = '';
            }
          }}
        >
          <option value="" disabled>
            + 从笔记添加到灵感板...
          </option>
          {notesNotOnBoard.map((note) => (
            <option key={note.id} value={note.id}>
              {(note.highlightText || note.thought || '笔记').substring(0, 30)}... (第
              {note.pageNumber}页)
            </option>
          ))}
        </select>
        {allCards.length > 0 && (
          <button className="btn btn-sm btn-secondary" onClick={handleClearBoard}>
            清空灵感板
          </button>
        )}
      </div>

      {allCards.length === 0 ? (
        <div className="inspiration-board">
          <div className="inspiration-board-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>💡</div>
            <div>灵感板是空的，从上方下拉菜单添加笔记卡片</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              同组内拖动调整顺序，拖到其他书的分组可以改变笔记归属
            </div>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="inspiration-board inspiration-board-grouped">
            {orderedBookIds.map((bookId) => (
              <section key={bookId} className="inspiration-group">
                <header className="inspiration-group-header">
                  <span className="inspiration-group-title">
                    📖 {getBookTitle(bookId)}
                  </span>
                  <span className="inspiration-group-count">
                    {groups[bookId].length} 张卡片
                  </span>
                </header>
                <Droppable droppableId={bookId} direction="horizontal">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`inspiration-group-cards${
                        snapshot.isDraggingOver ? ' dragging-over' : ''
                      }`}
                    >
                      {groups[bookId].map((card, index) => (
                        <Draggable key={card.id} draggableId={card.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="inspiration-card-wrapper"
                              style={{
                                ...provided.draggableProps.style,
                                transition: snapshot.isDragging
                                  ? 'none'
                                  : 'transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                              }}
                            >
                              <div
                                className={`inspiration-card-dnd ${snapshot.isDragging ? 'dragging-dnd' : ''}`}
                                style={{
                                  position: 'relative',
                                  width: '100%',
                                  background: 'var(--bg-card)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--radius-sm)',
                                  padding: 14,
                                  cursor: snapshot.isDragging ? 'grabbing' : 'grab',
                                  boxShadow: snapshot.isDragging
                                    ? 'var(--shadow-lg)'
                                    : 'var(--shadow-sm)',
                                  opacity: snapshot.isDragging ? 0.7 : 1,
                                  borderLeft: `3px solid ${
                                    card.tags.length > 0
                                      ? tagToColor(card.tags[0])
                                      : 'var(--accent)'
                                  }`,
                                  userSelect: 'none',
                                  transform: snapshot.isDragging
                                    ? 'scale(1.02)'
                                    : 'scale(1)',
                                }}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveCard(card.id);
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: 6,
                                    right: 6,
                                    width: 20,
                                    height: 20,
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    fontSize: 14,
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: 0,
                                    transition: 'opacity 0.2s',
                                    zIndex: 1,
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                                    (e.currentTarget as HTMLButtonElement).style.color =
                                      'var(--danger)';
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.opacity = '0';
                                    (e.currentTarget as HTMLButtonElement).style.color =
                                      'var(--text-muted)';
                                  }}
                                >
                                  ✕
                                </button>
                                <div
                                  style={{
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                    color: 'var(--text-primary)',
                                    marginBottom: 8,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 4,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {card.summary}
                                </div>
                                {card.tags.length > 0 && (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {card.tags.map((tag) => (
                                      <span
                                        key={tag}
                                        style={{
                                          fontSize: 10,
                                          padding: '1px 6px',
                                          borderRadius: 8,
                                          background: `${tagToColor(tag)}20`,
                                          color: tagToColor(tag),
                                        }}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            ))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
};

export default InspirationBoard;
