import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { InspirationCard, Note, Book } from '../../types';
import { tagToColor } from '../utils/color';

interface InspirationBoardProps {
  notes: Note[];
  books: Book[];
  onRemoveCard: (id: string) => void;
}

const STORAGE_KEY = 'inspiration_board_layout';

function loadLayout(): InspirationCard[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLayout(cards: InspirationCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

const InspirationBoard: React.FC<InspirationBoardProps> = ({ notes, books, onRemoveCard }) => {
  const [cards, setCards] = useState<InspirationCard[]>(loadLayout);

  useEffect(() => {
    saveLayout(cards);
  }, [cards]);

  const getBookTitle = useCallback(
    (bookId: string) => {
      const book = books.find((b) => b.id === bookId);
      return book ? book.title : '未知书籍';
    },
    [books]
  );

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const items = Array.from(cards);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setCards(items);
  };

  const handleAddCard = (noteId: string) => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const existing = cards.find((c) => c.noteId === noteId);
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
    setCards((prev) => [...prev, newCard]);
  };

  const handleRemoveCard = (cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    onRemoveCard(cardId);
  };

  const handleClearBoard = () => {
    if (window.confirm('确定要清空灵感板吗？')) {
      setCards([]);
    }
  };

  const notesNotOnBoard = useMemo(
    () => notes.filter((n) => !cards.some((c) => c.noteId === n.id)),
    [notes, cards]
  );

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
        {cards.length > 0 && (
          <button className="btn btn-sm btn-secondary" onClick={handleClearBoard}>
            清空灵感板
          </button>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="inspiration-board">
          <div className="inspiration-board-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>💡</div>
            <div>灵感板是空的，从上方下拉菜单添加笔记卡片</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>拖拽卡片来自由排列你的灵感</div>
          </div>
        </div>
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="inspiration-board" direction="horizontal">
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
                }}
              >
                {cards.map((card, index) => (
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
        </DragDropContext>
      )}
    </div>
  );
};

export default InspirationBoard;
