import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { InspirationCard, Note, Book } from '../../types';
import { tagToColor } from '../utils/color';

interface InspirationBoardProps {
  notes: Note[];
  books: Book[];
  onRemoveCard: (id: string) => void;
  onCardMove?: (cardId: string, targetBookId: string) => boolean | Promise<boolean>;
}

const STORAGE_KEY = 'inspiration_board_layout';

type CardGroups = Record<string, InspirationCard[]>;

export function normalizeLayout(parsed: unknown): CardGroups {
  // 兼容旧格式：扁平卡片数组，按 bookId 分组迁移
  if (Array.isArray(parsed)) {
    const groups: CardGroups = {};
    parsed.forEach((card) => {
      if (!card || typeof card.bookId !== 'string') return;
      if (!groups[card.bookId]) groups[card.bookId] = [];
      groups[card.bookId].push(card);
    });
    return groups;
  }
  if (parsed && typeof parsed === 'object') {
    return parsed as CardGroups;
  }
  return {};
}

function loadLayout(): CardGroups {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? normalizeLayout(JSON.parse(data)) : {};
  } catch {
    return {};
  }
}

function saveLayout(groups: CardGroups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
}

const InspirationBoard: React.FC<InspirationBoardProps> = ({
  notes,
  books,
  onRemoveCard,
  onCardMove,
}) => {
  const [groups, setGroups] = useState<CardGroups>(loadLayout);

  useEffect(() => {
    saveLayout(groups);
  }, [groups]);

  // 与笔记数据联动：笔记被删除时移除对应卡片；笔记归属在外部变化时同步卡片所在分组
  useEffect(() => {
    setGroups((prev) => {
      let changed = false;
      const next: CardGroups = {};
      Object.values(prev).forEach((list) => {
        list.forEach((card) => {
          const note = notes.find((n) => n.id === card.noteId);
          if (!note) {
            changed = true;
            return;
          }
          if (note.bookId !== card.bookId) changed = true;
          if (!next[note.bookId]) next[note.bookId] = [];
          next[note.bookId].push(
            note.bookId !== card.bookId ? { ...card, bookId: note.bookId } : card
          );
        });
      });
      if (!changed) {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (
          prevKeys.length !== nextKeys.length ||
          prevKeys.some((key, i) => key !== nextKeys[i])
        ) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [notes]);

  const allCards = useMemo(() => Object.values(groups).flat(), [groups]);

  const getBookTitle = useCallback(
    (bookId: string) => {
      const book = books.find((b) => b.id === bookId);
      return book ? book.title : '未知书籍';
    },
    [books]
  );

  const handleDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    // 拖到组外空白处：取消，不做任何变更
    if (!destination) return;

    const sourceBookId = source.droppableId;
    const targetBookId = destination.droppableId;

    // 同一本书内拖拽：只调整顺序，不触发归属变更
    if (sourceBookId === targetBookId) {
      if (source.index === destination.index) return;
      setGroups((prev) => {
        const list = [...(prev[sourceBookId] || [])];
        const [moved] = list.splice(source.index, 1);
        list.splice(destination.index, 0, moved);
        return { ...prev, [sourceBookId]: list };
      });
      return;
    }

    const sourceList = groups[sourceBookId] || [];
    const targetList = groups[targetBookId] || [];
    // 目标组为空或不存在：视为取消，不变更归属
    if (targetList.length === 0) return;
    const movedCard = sourceList[source.index];
    if (!movedCard) return;

    // 先乐观地把卡片移动到目标组
    const snapshot = groups;
    const nextSource = [...sourceList];
    nextSource.splice(source.index, 1);
    const nextTarget = [...targetList];
    nextTarget.splice(destination.index, 0, { ...movedCard, bookId: targetBookId });
    const next: CardGroups = { ...groups, [targetBookId]: nextTarget };
    if (nextSource.length > 0) {
      next[sourceBookId] = nextSource;
    } else {
      delete next[sourceBookId];
    }
    setGroups(next);

    // 通知上层更新笔记归属；失败则回滚到移动前的分组与顺序
    if (onCardMove) {
      const rollback = () => setGroups(snapshot);
      try {
        const ret = onCardMove(movedCard.id, targetBookId);
        if (ret && typeof (ret as Promise<boolean>).then === 'function') {
          (ret as Promise<boolean>)
            .then((ok) => {
              if (!ok) rollback();
            })
            .catch(rollback);
        } else if (ret === false) {
          rollback();
        }
      } catch {
        rollback();
      }
    }
  };

  const handleAddCard = (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const existing = allCards.find((c) => c.noteId === noteId);
    if (existing) return;

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
      const next: CardGroups = {};
      Object.entries(prev).forEach(([bookId, list]) => {
        const filtered = list.filter((c) => c.id !== cardId);
        if (filtered.length > 0) next[bookId] = filtered;
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

  const notesNotOnBoard = useMemo(
    () => notes.filter((n) => !allCards.some((c) => c.noteId === n.id)),
    [notes, allCards]
  );

  // 按书籍顺序排列分组；不在书籍列表中的分组（如书籍已删除）排在最后
  const orderedBookIds = useMemo(() => {
    const ids: string[] = [];
    books.forEach((b) => {
      if (groups[b.id] && groups[b.id].length > 0) ids.push(b.id);
    });
    Object.keys(groups).forEach((bookId) => {
      if (!ids.includes(bookId) && groups[bookId].length > 0) ids.push(bookId);
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
              {(note.highlightText || note.thought || '笔记').substring(0, 30)}...
              (第{note.pageNumber}页)
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
            <div style={{ fontSize: 13, marginTop: 6 }}>拖拽卡片来自由排列你的灵感</div>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          {orderedBookIds.map((bookId) => (
            <div key={bookId} className="inspiration-group" style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>📖 {getBookTitle(bookId)}</span>
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
                  {groups[bookId].length} 张卡片
                </span>
              </div>
              <Droppable droppableId={bookId} direction="horizontal">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="inspiration-board"
                    style={{
                      padding: 16,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, 240px)',
                      gap: 16,
                      alignContent: 'start',
                      minHeight: 140,
                    }}
                  >
                    {groups[bookId].map((card, index) => (
                  <Draggable key={card.id} draggableId={card.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
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
                            width: '100%',
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: 14,
                            cursor: snapshot.isDragging ? 'grabbing' : 'grab',
                            boxShadow: snapshot.isDragging ? 'var(--shadow-lg)' : 'var(--shadow-sm)',
                            opacity: snapshot.isDragging ? 0.7 : 1,
                            borderLeft: `3px solid ${card.tags.length > 0 ? tagToColor(card.tags[0]) : 'var(--accent)'}`,
                            userSelect: 'none',
                            transform: snapshot.isDragging ? 'scale(1.02)' : 'scale(1)',
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
                              (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)';
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.opacity = '0';
                              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)';
                            }}
                          >
                            ✕
                          </button>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                            📖 {getBookTitle(card.bookId)}
                          </div>
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
            </div>
          ))}
        </DragDropContext>
      )}
    </div>
  );
};

export default InspirationBoard;
