import React from 'react';
import { Comment } from '../types';
import { StarRating } from './StarRating';

interface CommentCardProps {
  comment: Comment;
  index: number;
}

export const CommentCard: React.FC<CommentCardProps> = ({ comment, index }) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <div
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        padding: 'var(--padding-card)',
        marginBottom: '16px',
        animation: `slideInFromRight 0.3s var(--easing-standard) both`,
        animationDelay: `${index * 0.1}s`,
      }}
    >
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: comment.avatarColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: '18px',
            flexShrink: 0,
          }}
        >
          {getInitial(comment.author)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h4 style={{ fontSize: '16px', margin: 0 }}>{comment.author}</h4>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {formatDate(comment.createdAt)}
            </span>
          </div>

          <StarRating value={comment.rating} readonly size={16} />

          <p style={{ marginTop: '12px', color: 'var(--text-body)', lineHeight: 1.6 }}>
            {comment.content}
          </p>
        </div>
      </div>
    </div>
  );
};
