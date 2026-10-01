import React from 'react';

export const SkeletonCard: React.FC = () => {
  return (
    <div className="skeleton-card">
      <div className="skeleton-poster" />
      <div className="skeleton-content">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line skeleton-sub" />
      </div>
    </div>
  );
};
