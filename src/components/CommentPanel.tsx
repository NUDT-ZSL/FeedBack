import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { Comment } from '../types';
import { MOCK_USERS, PRESET_ICONS } from '../types';
import { useAppStore } from '../store';
import { formatTime } from '../utils';

const CURRENT_USER = MOCK_USERS[0];

interface CommentPanelProps {
  isOpen: boolean;
  onClose: () => void;
  variant?: 'side' | 'bottom';
}

const CommentPanel: React.FC<CommentPanelProps> = ({ isOpen, onClose, variant = 'side' }) => {
  const { selectedComponentId } = useAppStore();
  const [comments, setComments] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [selectedMentionIdx, setSelectedMentionIdx] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCallback(async () => {
    if (!selectedComponentId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/comments?componentId=${selectedComponentId}`);
      const data = await res.json();
      setComments(data);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [selectedComponentId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const filteredMentions = MOCK_USERS.filter((u) =>
    u.name.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^@\s]*)$/);

    if (atMatch) {
      setShowMentions(true);
      setMentionSearch(atMatch[1]);
      setMentionStartPos(cursorPos - atMatch[1].length - 1);
      setSelectedMentionIdx(0);
    } else {
      setShowMentions(false);
      setMentionStartPos(null);
    }

    setContent(value);
  };

  const insertMention = (user: { id: string; name: string }) => {
    if (mentionStartPos === null || !textareaRef.current) return;
    const before = content.slice(0, mentionStartPos);
    const cursorPos = textareaRef.current.selectionStart;
    const after = content.slice(cursorPos);
    const newContent = `${before}@${user.name} ${after}`;
    setContent(newContent);
    setShowMentions(false);
    setMentionStartPos(null);
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = mentionStartPos + user.name.length + 2;
        textareaRef.current.selectionStart = textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIdx((i) => (i + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIdx(
          (i) => (i - 1 + filteredMentions.length) % filteredMentions.length
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[selectedMentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!selectedComponentId || !content.trim() || submitting) return;
    setSubmitting(true);
    try {
      const mentions = MOCK_USERS
        .filter((u) => content.includes(`@${u.name}`))
        .map((u) => u.id);
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          componentId: selectedComponentId,
          userId: CURRENT_USER.id,
          userName: CURRENT_USER.name,
          userAvatar: CURRENT_USER.avatar,
          content: content.trim(),
          mentions,
        }),
      });
      const newComment = await res.json();
      setComments((prev) => [newComment, ...prev]);
      setContent('');
    } catch {
      // silent error
    } finally {
      setSubmitting(false);
    }
  };

  const renderContent = (text: string) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="mention-tag">
            {part}
          </span>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
  };

  if (variant === 'bottom') {
    return (
      <div className={`bottom-comment-panel ${isOpen ? 'open' : ''}`}>
        <div className="comment-panel-header">
          <div className="comment-panel-title">
            💬 评论
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
              {comments.length > 0 && `(${comments.length})`}
            </span>
          </div>
          <button className="comment-panel-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {renderBody()}
      </div>
    );
  }

  function renderBody() {
    return (
      <>
        <div className="comment-list">
          {loading ? (
            <div className="empty-state">
              <div className="loading-spinner" />
              <div style={{ fontSize: 13 }}>加载评论中...</div>
            </div>
          ) : comments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💭</div>
              <div style={{ fontSize: 14 }}>暂无评论</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                成为第一个添加评论的人吧
              </div>
            </div>
          ) : (
            comments.map((c) => {
              const user = MOCK_USERS.find((u) => u.id === c.userId);
              return (
                <div key={c.id} className="comment-item">
                  <div
                    className="comment-avatar"
                    style={{ background: user?.color || 'var(--primary)' }}
                  >
                    {c.userAvatar}
                  </div>
                  <div className="comment-body">
                    <div className="comment-meta">
                      <span className="comment-username">{c.userName}</span>
                      <span className="comment-time">{formatTime(c.timestamp)}</span>
                    </div>
                    <div className="comment-content">{renderContent(c.content)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="comment-input-area">
          {showMentions && filteredMentions.length > 0 && (
            <div className="mention-dropdown">
              {filteredMentions.map((user, i) => (
                <div
                  key={user.id}
                  className={`mention-item ${i === selectedMentionIdx ? 'selected' : ''}`}
                  onClick={() => insertMention(user)}
                  onMouseEnter={() => setSelectedMentionIdx(i)}
                >
                  <div
                    className="mention-item-avatar"
                    style={{ background: user.color }}
                  >
                    {user.avatar}
                  </div>
                  <div style={{ fontSize: 13 }}>{user.name}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div
              className="comment-avatar"
              style={{
                width: 28,
                height: 28,
                fontSize: 12,
                background: CURRENT_USER.color,
              }}
            >
              {CURRENT_USER.avatar}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
              以 <strong style={{ color: 'var(--text)' }}>{CURRENT_USER.name}</strong> 身份回复
            </span>
          </div>
          <textarea
            ref={textareaRef}
            className="comment-textarea"
            placeholder="输入评论，使用 @ 提及他人..."
            value={content}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setShowMentions(false), 150)}
          />
          <div className="comment-submit-row">
            <button
              className="btn-primary"
              onClick={handleSubmit}
              disabled={!content.trim() || submitting}
            >
              {submitting ? '提交中...' : '发送'}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={`comment-panel ${isOpen ? 'open' : ''}`}>
      <div className="comment-panel-header">
        <div className="comment-panel-title">
          💬 评论
          <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
            {comments.length > 0 && `(${comments.length})`}
          </span>
        </div>
        <button className="comment-panel-close" onClick={onClose}>
          ✕
        </button>
      </div>
      {renderBody()}
    </div>
  );
};

export default CommentPanel;
