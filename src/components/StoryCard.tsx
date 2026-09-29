import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Story } from '../types';

interface StoryCardProps {
  story: Story;
  index: number;
}

export const StoryCard = memo(function StoryCard({ story, index }: StoryCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/story/${story.id}`);
  };

  return (
    <article
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`阅读故事：${story.title}`}
      style={{
        position: 'relative',
        padding: '24px',
        borderRadius: '12px',
        backgroundColor: 'rgba(255, 255, 255, 0.7)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
        cursor: 'pointer',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: 0,
        animation: 'fadeInUp 0.6s ease forwards',
        animationDelay: `${index * 0.1}s`,
        willChange: 'transform',
        contentVisibility: 'auto'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-8px)';
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.06)';
      }}
    >
      <div
        style={{
          width: '80px',
          height: '80px',
          margin: '0 auto 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px',
          borderRadius: '16px',
          backgroundColor: 'rgba(74, 144, 217, 0.1)'
        }}
      >
        {story.coverEmoji}
      </div>

      <h3
        style={{
          fontSize: '18px',
          fontWeight: 600,
          color: '#333',
          textAlign: 'center',
          marginBottom: '8px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {story.title}
      </h3>

      <p
        style={{
          fontSize: '14px',
          color: '#666',
          textAlign: 'center',
          marginBottom: '12px'
        }}
      >
        {story.author}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          fontSize: '13px',
          color: '#999'
        }}
      >
        <span>
          <span
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: 'rgba(74, 144, 217, 0.1)',
              color: '#4A90D9',
              fontWeight: 500
            }}
          >
            {story.chapters.length} 章
          </span>
        </span>
        <span>★ {story.averageRating.toFixed(1)}</span>
      </div>

      <p
        style={{
          marginTop: '12px',
          fontSize: '13px',
          color: '#666',
          lineHeight: 1.6,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {story.description}
      </p>
    </article>
  );
});
