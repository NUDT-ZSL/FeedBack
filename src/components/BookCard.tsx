import type { Book } from '@/types';
import { FiBook } from 'react-icons/fi';

interface BookCardProps {
  book: Book;
  index: number;
  searchKeyword: string;
  onClick: () => void;
  onBorrow: () => void;
}

function highlightText(text: string, keyword: string): React.ReactNode {
  if (!keyword.trim()) return text;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="highlight-match">{part}</span>
    ) : (
      part
    )
  );
}

export default function BookCard({ book, index, searchKeyword, onClick, onBorrow }: BookCardProps) {
  const inStock = book.stock > 0;

  return (
    <div
      className="book-card"
      style={{ animationDelay: `${index * 0.1}s` }}
      onClick={onClick}
    >
      <img
        className="book-card-cover"
        src={book.coverUrl}
        alt={book.title}
        loading="lazy"
      />
      <div className="book-card-info">
        <div className="book-card-title">
          {highlightText(book.title, searchKeyword)}
        </div>
        <div className="book-card-author">
          {highlightText(book.author, searchKeyword)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
          <span className={`stock-badge ${inStock ? 'in-stock' : 'out-of-stock'}`}>
            <FiBook style={{ fontSize: '0.7rem' }} />
            {inStock ? `库存 ${book.stock}` : '已借出'}
          </span>
          {inStock && (
            <button
              className="btn btn-primary"
              style={{ padding: '5px 14px', fontSize: '0.78rem' }}
              onClick={(e) => {
                e.stopPropagation();
                onBorrow();
              }}
            >
              借阅
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
