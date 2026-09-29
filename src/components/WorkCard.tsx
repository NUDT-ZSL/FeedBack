import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Work, categoryConfig } from '../types';
import { CategoryBadge } from './CategoryBadge';
import { StarRating } from './StarRating';
import { useRipple } from '../hooks/useRipple';

interface WorkCardProps {
  work: Work;
}

export const WorkCard: React.FC<WorkCardProps> = ({ work }) => {
  const navigate = useNavigate();
  const categoryColor = categoryConfig[work.category].color;
  const createRipple = useRipple(`${categoryColor}80`);

  const averageRating = work.comments.length > 0
    ? work.comments.reduce((sum, c) => sum + c.rating, 0) / work.comments.length
    : 0;

  const handleClick = () => {
    navigate(`/work/${work.id}`);
  };

  return (
    <div
      className="ripple-container"
      onClick={(e) => {
        createRipple(e);
        setTimeout(handleClick, 100);
      }}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'box-shadow 0.3s var(--easing-standard), transform 0.3s var(--easing-standard)',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,0.08), 0 0 12px ${categoryColor}66`;
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ position: 'relative', paddingTop: '60%', overflow: 'hidden' }}>
        <img
          src={work.coverImage}
          alt={work.name}
          loading="lazy"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.3s var(--easing-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        />
      </div>

      <div style={{ padding: 'var(--padding-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '18px', margin: 0, flex: 1, marginRight: '12px' }}>{work.name}</h3>
          <CategoryBadge category={work.category} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <StarRating value={averageRating} readonly size={16} />
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {work.steps.length} 个步骤
          </span>
        </div>
      </div>
    </div>
  );
};
