import { memo } from 'react';
import type { FC } from 'react';
import type { Book, UserBook, BookStatus } from './types';
import { categoryGradients } from './data/books';

interface BookCardProps {
  book: Book;
  userBook: UserBook;
  onStatusChange: (userBookId: string, status: BookStatus) => void;
  onProgressChange: (userBookId: string, progress: number) => void;
  onWriteReview: (bookId: string) => void;
}

const BookCard: FC<BookCardProps> = memo(({
  book,
  userBook,
  onStatusChange,
  onProgressChange,
  onWriteReview,
}) => {
  const gradient = categoryGradients[book.category] || { from: '#E07A2F', to: '#6B4226' };

  const statuses: { value: BookStatus; label: string }[] = [
    { value: 'unread', label: '未读' },
    { value: 'reading', label: '在读' },
    { value: 'finished', label: '已读' },
  ];

  return (
    <div className="book-card" style={{ contain: 'layout paint' }}>
      <div className="book-card-inner">
        <div className="book-card-front">
          <div
            className="book-cover-gradient"
            style={{
              background: `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
            }}
          />
          <div className="book-card-front-content">
            <h3 className="book-title">{book.title}</h3>
            <p className="book-author">{book.author}</p>
            <span className="book-category">{book.category}</span>
          </div>
        </div>

        <div className="book-card-back">
          <div className="book-back-header">
            <h4>{book.title}</h4>
            <p>{book.author}</p>
            {userBook.status === 'finished' && (
              <button
                className="write-review-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onWriteReview(book.id);
                }}
              >
                写短评
              </button>
            )}
          </div>

          <div className="progress-container">
            <div className="progress-label">
              <span>阅读进度</span>
              <span>{userBook.progress}%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${userBook.progress}%` }}
              />
            </div>
            {userBook.status !== 'finished' && (
              <input
                type="range"
                min="0"
                max="100"
                value={userBook.progress}
                className="progress-slider"
                onChange={(e) =>
                  onProgressChange(userBook.id, parseInt(e.target.value, 10))
                }
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>

          <div className="status-buttons">
            {statuses.map((status) => (
              <button
                key={status.value}
                className={`status-btn ${userBook.status === status.value ? `active ${status.value}` : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(userBook.id, status.value);
                }}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

BookCard.displayName = 'BookCard';

export default BookCard;
