import React from 'react';
import { Category, categoryConfig } from '../types';

interface CategoryBadgeProps {
  category: Category;
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category }) => {
  const config = categoryConfig[category];

  return (
    <span
      className="category-badge"
      style={{
        display: 'inline-block',
        padding: '6px 16px',
        borderRadius: '20px',
        backgroundColor: config.color,
        color: category === 'paper' ? '#5D4037' : '#FFFFFF',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'default',
        transition: 'transform 0.2s var(--easing-standard), box-shadow 0.2s var(--easing-standard)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      }}
    >
      {config.name}
    </span>
  );
};
