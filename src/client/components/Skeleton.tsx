import React from 'react';

export const SkeletonCard: React.FC<{ variant?: 'book' | 'search' | 'note' }> = ({ variant = 'book' }) => {
  if (variant === 'search') {
    return (
      <div className="search-result-card" style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}>
        <div className="skeleton-cover" style={{ width: 60, height: 80, borderRadius: 4, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="skeleton-line" style={{ marginBottom: 6 }} />
          <div className="skeleton-line skeleton-line-short" style={{ marginBottom: 8 }} />
          <div className="skeleton-line" style={{ width: '40%', height: 24, borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  if (variant === 'note') {
    return (
      <div className="note-item" style={{ borderLeftColor: 'var(--border)', animation: 'shimmer 1.5s ease-in-out infinite' }}>
        <div className="skeleton-line" style={{ width: '30%', marginBottom: 10 }} />
        <div className="skeleton-line" style={{ marginBottom: 6 }} />
        <div className="skeleton-line" style={{ width: '70%' }} />
      </div>
    );
  }

  return (
    <div className="skeleton-card" style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}>
      <div className="skeleton-cover" />
      <div className="skeleton-line" />
      <div className="skeleton-line skeleton-line-short" />
    </div>
  );
};

export const SkeletonGrid: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="skeleton-grid">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} variant="book" />
    ))}
  </div>
);

export const SearchResultSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="search-results">
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} variant="search" />
    ))}
  </div>
);

export const NoteListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div>
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} variant="note" />
    ))}
  </div>
);
