import { useState, useMemo, useCallback } from 'react';
import type { FC } from 'react';
import { useBookStore } from './store/useBookStore';

const CommunityFeed: FC = () => {
  const { getTopReviews, getBookById, likeReview } = useBookStore();
  const [expandedReviews, setExpandedReviews] = useState<Set<string>>(new Set());
  const [likedReviews, setLikedReviews] = useState<Set<string>>(new Set());
  const [scalingLike, setScalingLike] = useState<string | null>(null);

  const topReviews = useMemo(() => {
    return getTopReviews().map((review) => ({
      ...review,
      book: getBookById(review.bookId),
    }));
  }, [getTopReviews, getBookById]);

  const toggleExpand = useCallback((reviewId: string) => {
    setExpandedReviews((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) {
        next.delete(reviewId);
      } else {
        next.add(reviewId);
      }
      return next;
    });
  }, []);

  const handleLike = useCallback(
    (reviewId: string) => {
      if (!likedReviews.has(reviewId)) {
        likeReview(reviewId);
        setLikedReviews((prev) => new Set(prev).add(reviewId));
        setScalingLike(reviewId);
        setTimeout(() => setScalingLike(null), 300);
      }
    },
    [likedReviews, likeReview]
  );

  const truncateContent = (content: string, maxLength: number = 40) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="community-page">
      <h1>🔥 社区热度排行</h1>
      <p className="subtitle">最近7天获得点赞最多的10条短评</p>

      <div className="community-list">
        {topReviews.map((item, index) => {
          if (!item.book) return null;
          const isExpanded = expandedReviews.has(item.id);
          const isLiked = likedReviews.has(item.id);
          const isScaling = scalingLike === item.id;

          return (
            <div
              key={item.id}
              className="community-review-card"
              onClick={() => toggleExpand(item.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
                <span className="community-review-rank">{index + 1}</span>
                <div>
                  <h3 style={{ color: 'var(--primary-brown)', fontSize: '1.125rem' }}>
                    {item.book.title}
                  </h3>
                  <p style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>
                    {item.book.author}
                  </p>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.125rem' }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`star ${i < item.rating ? 'filled' : ''}`}
                      style={{ fontSize: '1rem', cursor: 'default' }}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>

              {isExpanded ? (
                <p className="review-full-content">{item.content}</p>
              ) : (
                <p className="review-summary">{truncateContent(item.content)}</p>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-light)', fontSize: '0.875rem' }}>
                  {formatDate(item.createdAt)}
                </span>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button
                    className={`like-btn ${isLiked ? 'liked' : ''} ${isScaling ? 'scaling' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLike(item.id);
                    }}
                  >
                    <span>👍</span>
                    <span>{item.likes}</span>
                  </button>
                  <button
                    className="expand-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(item.id);
                    }}
                  >
                    {isExpanded ? '收起' : '展开全文'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {topReviews.length === 0 && (
          <div className="empty-shelf">
            <div className="empty-shelf-icon">💬</div>
            <p>暂无热门短评</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CommunityFeed;
