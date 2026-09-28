import React from 'react';
import { Book, BookCategory } from '../modules/book/BookManager';

interface BookCardProps {
  book: Book;
  lowStock?: boolean;
  onClick?: (book: Book) => void;
}

const categoryColors: Record<BookCategory, { bg: string; tagBg: string; text: string }> = {
  小说: { bg: '#e6f0ff', tagBg: '#4a90d9', text: '#1a4e8a' },
  非小说: { bg: '#e6f5e9', tagBg: '#5cb85c', text: '#2d6a2d' },
  儿童: { bg: '#fff8e1', tagBg: '#f0ad4e', text: '#8a6d1a' },
  科技: { bg: '#f0e6ff', tagBg: '#9561e2', text: '#5a32a8' },
};

export const BookCard: React.FC<BookCardProps> = ({ book, lowStock, onClick }) => {
  const colors = categoryColors[book.category];

  return (
    <div
      className={`book-card ${lowStock ? 'low-stock' : ''}`}
      style={{ backgroundColor: colors.bg }}
      onClick={() => onClick?.(book)}
    >
      <span className="book-category-tag" style={{ backgroundColor: colors.tagBg }}>
        {book.category}
      </span>
      <h3 className="book-title" style={{ color: colors.text }}>
        {book.title}
      </h3>
      <p className="book-author">{book.author}</p>
      <p className="book-isbn">ISBN: {book.isbn}</p>
      <div className="book-footer">
        <span className="book-price">¥{book.price.toFixed(2)}</span>
        <span className={`book-stock ${lowStock ? 'stock-warning' : ''}`}>
          库存: {book.stock}
        </span>
      </div>
    </div>
  );
};
