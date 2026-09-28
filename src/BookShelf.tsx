import { useState, useMemo, useCallback } from 'react';
import type { FC, ChangeEvent } from 'react';
import type { Book, BookStatus, UserBook } from './types';
import BookCard from './BookCard';
import RatingEditor from './RatingEditor';
import { useBookStore } from './store/useBookStore';

interface BookShelfProps {
  searchKeyword: string;
  onSearchChange: (keyword: string) => void;
}

const BookShelf: FC<BookShelfProps> = ({ searchKeyword, onSearchChange }) => {
  const {
    userBooks,
    allBooks,
    updateBookStatus,
    updateBookProgress,
    addToShelf,
    addReview,
    searchBooks,
    getBookById,
    getReviewsByBookId,
    likeReview,
  } = useBookStore();

  const [showResults, setShowResults] = useState(false);
  const [reviewModal, setReviewModal] = useState<{ bookId: string } | null>(null);
  const [reviewContent, setReviewContent] = useState('');
  const [reviewRating, setReviewRating] = useState(0);
  const [likedReviews, setLikedReviews] = useState<Set<string>>(new Set());
  const [scalingLike, setScalingLike] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    return searchBooks(searchKeyword);
  }, [searchKeyword, searchBooks]);

  const handleSearchChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onSearchChange(e.target.value);
      setShowResults(true);
    },
    [onSearchChange]
  );

  const handleAddToShelf = useCallback(
    (bookId: string) => {
      addToShelf(bookId);
    },
    [addToShelf]
  );

  const handleWriteReview = useCallback((bookId: string) => {
    setReviewModal({ bookId });
    setReviewContent('');
    setReviewRating(0);
  }, []);

  const handleSubmitReview = useCallback(() => {
    if (reviewModal && reviewContent.length >= 50 && reviewContent.length <= 200 && reviewRating > 0) {
      addReview(reviewModal.bookId, reviewContent, reviewRating);
      setReviewModal(null);
      setReviewContent('');
      setReviewRating(0);
    }
  }, [reviewModal, reviewContent, reviewRating, addReview]);

  const handleLikeReview = useCallback(
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

  const filteredUserBooks = useMemo(() => {
    if (!searchKeyword.trim()) return userBooks;
    
    const lowerKeyword = searchKeyword.toLowerCase();
    return userBooks.filter((ub) => {
      const book = getBookById(ub.bookId);
      if (!book) return false;
      return (
        book.title.toLowerCase().includes(lowerKeyword) ||
        book.author.toLowerCase().includes(lowerKeyword)
      );
    });
  }, [userBooks, searchKeyword, getBookById]);

  const booksByStatus = useMemo(() => {
    const grouped: Record<BookStatus, (UserBook & { book: Book })[]> = {
      unread: [],
      reading: [],
      finished: [],
    };

    filteredUserBooks.forEach((ub) => {
      const book = getBookById(ub.bookId);
      if (book) {
        grouped[ub.status].push({ ...ub, book });
      }
    });

    return grouped;
  }, [filteredUserBooks, getBookById]);

  const statusConfig: { key: BookStatus; title: string }[] = [
    { key: 'unread', title: '未读' },
    { key: 'reading', title: '在读' },
    { key: 'finished', title: '已读' },
  ];

  const finishedBooksWithReviews = useMemo(() => {
    return booksByStatus.finished.filter((ub) => {
      const reviews = getReviewsByBookId(ub.bookId);
      return reviews.length > 0;
    });
  }, [booksByStatus.finished, getReviewsByBookId]);

  return (
    <div className="shelf-page">
      <div className="search-section">
        <svg
          className="search-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          type="text"
          className="search-input"
          placeholder="搜索书名或作者..."
          value={searchKeyword}
          onChange={handleSearchChange}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
        {showResults && searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.slice(0, 10).map((book) => {
              const isInShelf = userBooks.some((ub) => ub.bookId === book.id);
              return (
                <div
                  key={book.id}
                  className="search-result-item"
                  onClick={() => !isInShelf && handleAddToShelf(book.id)}
                >
                  <div className="search-result-info">
                    <h4>{book.title}</h4>
                    <p>{book.author} · {book.category}</p>
                  </div>
                  {isInShelf ? (
                    <span style={{ color: '#4CAF50', fontSize: '0.875rem' }}>已在书架</span>
                  ) : (
                    <button className="add-btn">加入书架</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="shelf-container">
        {statusConfig.map(({ key, title }) => (
          <div key={key} className="shelf-column">
            <div className={`shelf-column-header ${key}`}>
              <h2 className="shelf-column-title">{title}</h2>
              <span className="shelf-column-count">{booksByStatus[key].length}</span>
            </div>
            <div className="books-grid">
              {booksByStatus[key].length > 0 ? (
                booksByStatus[key].map((ub) => (
                  <BookCard
                    key={ub.id}
                    book={ub.book}
                    userBook={ub}
                    onStatusChange={updateBookStatus}
                    onProgressChange={updateBookProgress}
                    onWriteReview={handleWriteReview}
                  />
                ))
              ) : (
                <div className="empty-shelf">
                  <div className="empty-shelf-icon">📚</div>
                  <p>暂无{title}书籍</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {finishedBooksWithReviews.length > 0 && (
        <div className="reviews-section">
          <h3>最近的短评</h3>
          {finishedBooksWithReviews.slice(0, 5).map((ub, index) => {
            const reviews = getReviewsByBookId(ub.bookId);
            if (reviews.length === 0) return null;
            const latestReview = reviews[0];
            return (
              <div key={ub.id} className={`review-item ${index === 0 ? 'latest' : ''}`}>
                <div className="review-header">
                  <div className="review-book-info">
                    <h4>{ub.book.title}</h4>
                    <p>{ub.book.author}</p>
                  </div>
                  <div className="review-rating">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`star ${i < latestReview.rating ? 'filled' : ''}`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                </div>
                <p className="review-content">{latestReview.content}</p>
                <div className="review-footer">
                  <span>{new Date(latestReview.createdAt).toLocaleDateString('zh-CN')}</span>
                  <button
                    className={`like-btn ${likedReviews.has(latestReview.id) ? 'liked' : ''} ${
                      scalingLike === latestReview.id ? 'scaling' : ''
                    }`}
                    onClick={() => handleLikeReview(latestReview.id)}
                  >
                    <span>👍</span>
                    <span>{latestReview.likes}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reviewModal && (
        <div className="review-modal-overlay" onClick={() => setReviewModal(null)}>
          <div className="review-modal" onClick={(e) => e.stopPropagation()}>
            <div className="review-modal-header">
              <h3>写短评</h3>
              <button className="close-btn" onClick={() => setReviewModal(null)}>
                ×
              </button>
            </div>
            <div className="review-form-group">
              <label>评分</label>
              <RatingEditor
                initialRating={reviewRating}
                onRatingChange={setReviewRating}
              />
            </div>
            <div className="review-form-group">
              <label>短评内容</label>
              <textarea
                className="review-textarea"
                placeholder="写下你的阅读感受（50-200字）..."
                value={reviewContent}
                onChange={(e) => setReviewContent(e.target.value)}
              />
              <p className={`char-count ${reviewContent.length < 50 || reviewContent.length > 200 ? 'error' : ''}`}>
                {reviewContent.length}/200
              </p>
            </div>
            <button
              className="submit-btn"
              disabled={reviewContent.length < 50 || reviewContent.length > 200 || reviewRating === 0}
              onClick={handleSubmitReview}
            >
              发布短评
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookShelf;
