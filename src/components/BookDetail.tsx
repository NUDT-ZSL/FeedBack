import type { Book } from '@/types';
import { FiBook, FiUser, FiCalendar, FiCornerUpLeft } from 'react-icons/fi';

interface BookDetailProps {
  book: Book;
  onBorrow: () => void;
  onReturnRecord: (recordId: string) => void;
}

function getStockBarClass(stock: number, totalStock: number): string {
  const ratio = stock / totalStock;
  if (ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'low';
  return 'high';
}

export default function BookDetail({ book, onBorrow, onReturnRecord }: BookDetailProps) {
  const barClass = getStockBarClass(book.stock, book.totalStock);
  const fillPercent = (book.stock / book.totalStock) * 100;
  const recentRecords = book.borrowRecords.slice(-3).reverse();
  const activeRecords = book.borrowRecords.filter((r) => r.status === 'borrowing');

  return (
    <div className="detail-panel">
      <img
        className="detail-cover"
        src={book.coverUrl}
        alt={book.title}
      />
      <div className="detail-title">{book.title}</div>
      <div className="detail-author">{book.author}</div>
      <span className="detail-category">{book.category}</span>
      <div className="detail-description">{book.description}</div>

      <div className="stock-bar-container">
        <div className="stock-bar-label">
          <span>库存状态</span>
          <span>{book.stock} / {book.totalStock}</span>
        </div>
        <div className="stock-bar-track">
          <div
            className={`stock-bar-fill ${barClass}`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: '8px' }}
        onClick={onBorrow}
        disabled={book.stock <= 0}
      >
        {book.stock > 0 ? '申请借阅' : '暂无库存'}
      </button>

      {activeRecords.length > 0 && (
        <div className="borrow-records-section">
          <div className="borrow-records-title">待归还记录（{activeRecords.length}）</div>
          {activeRecords.map((record) => (
            <div className="borrow-record-item" key={record.id}>
              <span className="borrow-record-name">
                <FiUser style={{ marginRight: '4px', fontSize: '0.75rem' }} />
                {record.name}
              </span>
              <span className="borrow-record-date">
                <FiCalendar style={{ marginRight: '4px', fontSize: '0.75rem' }} />
                {record.borrowDate}
              </span>
              <button
                className="btn-return"
                onClick={() => onReturnRecord(record.id)}
              >
                <FiCornerUpLeft style={{ marginRight: '3px', fontSize: '0.7rem' }} />
                标记归还
              </button>
            </div>
          ))}
        </div>
      )}

      {recentRecords.length > 0 && (
        <div className="borrow-records-section">
          <div className="borrow-records-title">最近借阅记录</div>
          {recentRecords.map((record) => {
            const returned = record.status === 'returned';
            return (
              <div className="borrow-record-item" key={record.id}>
                <span className="borrow-record-name">
                  <FiUser style={{ marginRight: '4px', fontSize: '0.75rem' }} />
                  {record.name}
                </span>
                <span className="borrow-record-date">
                  <FiCalendar style={{ marginRight: '4px', fontSize: '0.75rem' }} />
                  {returned && record.returnedAt ? record.returnedAt : record.borrowDate}
                </span>
                <span className={`borrow-record-status ${returned ? 'returned' : 'borrowing'}`}>
                  <FiBook style={{ marginRight: '3px', fontSize: '0.65rem' }} />
                  {returned ? '已归还' : '借阅中'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
