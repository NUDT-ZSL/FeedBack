import React, { useState, useEffect } from 'react';
import { Book } from '../modules/book/BookManager';

interface LowStockNotificationProps {
  books: Book[];
  onBookClick: (book: Book) => void;
}

export const LowStockNotification: React.FC<LowStockNotificationProps> = ({
  books,
  onBookClick,
}) => {
  const [visible, setVisible] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const lowStockBooks = books.filter((b) => b.stock < 5 && !dismissedIds.has(b.id));

  useEffect(() => {
    if (lowStockBooks.length > 0) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [lowStockBooks.length]);

  const handleClick = (book: Book) => {
    onBookClick(book);
    setDismissedIds((prev) => new Set([...prev, book.id]));
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVisible(false);
  };

  if (lowStockBooks.length === 0) return null;

  return (
    <div className={`low-stock-notification ${visible ? 'show' : ''}`}>
      <div className="notification-header">
        <span className="notification-title">⚠️ 库存预警</span>
        <button className="notification-close" onClick={handleClose}>
          ×
        </button>
      </div>
      <div className="notification-content">
        {lowStockBooks.slice(0, 3).map((book) => (
          <div
            key={book.id}
            className="notification-item"
            onClick={() => handleClick(book)}
          >
            <span className="notification-book-title">{book.title}</span>
            <span className="notification-book-stock">仅剩 {book.stock} 本</span>
          </div>
        ))}
        {lowStockBooks.length > 3 && (
          <div className="notification-more">
            还有 {lowStockBooks.length - 3} 本书库存不足...
          </div>
        )}
      </div>
    </div>
  );
};
