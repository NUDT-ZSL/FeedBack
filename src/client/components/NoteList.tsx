import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Note } from '../../types';
import { tagToColor } from '../utils/color';

const PAGE_SIZE = 20;

interface NoteListProps {
  notes: Note[];
  onEdit: (note: Note) => void;
  onDelete: (id: string) => void;
  onAddToBoard: (note: Note) => void;
}

const NoteList: React.FC<NoteListProps> = ({ notes, onEdit, onDelete, onAddToBoard }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sortedNotes = useMemo(() => {
    return [...notes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [notes]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    sortedNotes.forEach((n) => n.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [sortedNotes]);

  const filteredNotes = useMemo(() => {
    return sortedNotes.filter((note) => {
      if (activeTag && !note.tags.includes(activeTag)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          note.highlightText.toLowerCase().includes(q) ||
          note.thought.toLowerCase().includes(q) ||
          note.tags.some((t) => t.toLowerCase().includes(q)) ||
          String(note.pageNumber).includes(q)
        );
      }
      return true;
    });
  }, [sortedNotes, searchQuery, activeTag]);

  const visibleNotes = filteredNotes.slice(0, visibleCount);
  const hasMore = visibleCount < filteredNotes.length;

  const loadMore = useCallback(() => {
    if (hasMore) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredNotes.length));
    }
  }, [hasMore, filteredNotes.length]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, activeTag]);

  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observerRef.current = observer;
    const sentinel = sentinelRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      observer.disconnect();
    };
  }, [loadMore, filteredNotes.length]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (notes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📝</div>
        <div className="empty-state-text">还没有笔记，添加第一条吧</div>
      </div>
    );
  }

  return (
    <div>
      <div className="filter-bar">
        <input
          className="filter-input"
          type="text"
          placeholder="搜索笔记内容、标签或页码..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {allTags.length > 0 && (
        <div className="tag-filter-chips" style={{ marginBottom: 16 }}>
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`tag-filter-chip ${activeTag === tag ? 'active' : ''}`}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={activeTag === tag ? {} : { background: `${tagToColor(tag)}20`, color: tagToColor(tag) }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {filteredNotes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">没有匹配的笔记</div>
        </div>
      ) : (
        <>
          {visibleNotes.map((note) => {
            const borderColor = note.tags.length > 0 ? tagToColor(note.tags[0]) : 'var(--accent)';
            const isExpanded = expandedId === note.id;

            return (
              <div
                key={note.id}
                className="note-item"
                style={{ borderLeftColor: borderColor }}
                onClick={() => toggleExpand(note.id)}
              >
                <div className="note-item-header">
                  <span className="note-item-page">第 {note.pageNumber} 页</span>
                  <div className="note-item-tags">
                    {note.tags.map((tag) => (
                      <span
                        key={tag}
                        className="note-item-tag"
                        style={{ background: `${tagToColor(tag)}20`, color: tagToColor(tag) }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {note.highlightText && (
                  <div className="note-item-highlight">{note.highlightText}</div>
                )}

                <div
                  className="note-item-expanded"
                  style={{
                    maxHeight: isExpanded ? '1000px' : '0px',
                    transition: 'max-height 0.2s ease',
                    overflow: 'hidden',
                  }}
                >
                  {note.thought && (
                    <div className="note-item-thought">{note.thought}</div>
                  )}
                </div>

                <div className="note-item-actions">
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(note);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToBoard(note);
                    }}
                  >
                    加到灵感板
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('确定要删除这条笔记吗？')) onDelete(note.id);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}

          {hasMore && (
            <div ref={sentinelRef} className="load-more-sentinel" />
          )}
          {hasMore && (
            <div
              style={{
                textAlign: 'center',
                padding: 16,
                color: 'var(--text-muted)',
                fontSize: 13,
              }}
            >
              加载更多笔记...
            </div>
          )}
          {!hasMore && filteredNotes.length > 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: 16,
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              已加载全部 {filteredNotes.length} 条笔记
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NoteList;
