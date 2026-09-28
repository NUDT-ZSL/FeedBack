import React, { useState, useEffect, useCallback } from 'react';
import Reader from './components/Reader';
import { api } from './api';
import type { Book, Annotation, ShareLink } from './types';

interface Notification {
  id: number;
  message: string;
  link?: string;
}

const App: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [shareData, setShareData] = useState<ShareLink | null>(null);

  const loadShareData = useCallback(async (shareId: string) => {
    try {
      const share = await api.getShare(shareId);
      if (share) {
        setShareData(share);
        const book = await api.getBook(share.bookId);
        setSelectedBook(book);
        setIsReadOnly(true);
      }
    } catch (error) {
      console.error('Failed to load share:', error);
    }
  }, []);

  const checkHashRoute = useCallback(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#/shared/')) {
      const shareId = hash.replace('#/shared/', '');
      loadShareData(shareId);
    } else {
      setIsReadOnly(false);
      setShareData(null);
      setSelectedBook(null);
    }
  }, [loadShareData]);

  useEffect(() => {
    checkHashRoute();
    loadBooks();

    const handleHashChange = () => {
      checkHashRoute();
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [checkHashRoute]);

  const loadBooks = async () => {
    try {
      const data = await api.getBooks();
      setBooks(data);
    } catch (error) {
      console.error('Failed to load books:', error);
    }
  };

  const loadAnnotations = useCallback(async (bookId: string) => {
    try {
      const data = await api.getAnnotations(bookId);
      setAnnotations(data);
    } catch (error) {
      console.error('Failed to load annotations:', error);
    }
  }, []);

  const handleBookSelect = async (book: Book) => {
    if (isReadOnly) return;
    
    setLoading(true);
    setSelectedBook(book);
    setAnnotations([]);
    
    try {
      await loadAnnotations(book.id);
    } finally {
      setLoading(false);
    }
  };

  const handleAnnotationAdded = (annotation: Annotation) => {
    setAnnotations((prev) => [...prev, annotation]);
  };

  const showNotification = (message: string, link?: string) => {
    const id = Date.now();
    setNotification({ id, message, link });
    setTimeout(() => {
      setNotification((current) => (current?.id === id ? null : current));
    }, 3000);
  };

  const handleShare = async () => {
    if (!selectedBook || !shareEmail.trim()) return;

    try {
      const share = await api.createShare(selectedBook.id, shareEmail.trim());
      const shareUrl = `${window.location.origin}${window.location.pathname}#/shared/${share.id}`;
      setShowShareModal(false);
      setShareEmail('');
      showNotification('分享链接已生成：', shareUrl);
    } catch (error) {
      console.error('Failed to create share:', error);
    }
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTBkZGQzIi8+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+5Zu+5LqM6aG15Zu+5b2V5Zu+5Zu+55qE5Zu+5Zu+5aSH5Zu+5Zu+8J+OqDwvdGV4dD48L3N2Zz4=';
  };

  return (
    <div className="app-container">
      {notification && (
        <div className="notification-banner show">
          <span>
            {notification.message}
            {notification.link && (
              <a
                className="link"
                href={notification.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                {notification.link}
              </a>
            )}
          </span>
          <button className="close-btn" onClick={() => setNotification(null)}>
            ×
          </button>
        </div>
      )}

      <header className="header">
        <h1>
          📚 在线电子书批注平台
          {isReadOnly && <span className="read-only-badge">只读视图</span>}
        </h1>
        {!isReadOnly && (
          <div className="books-scroll">
            {books.map((book) => (
              <div
                key={book.id}
                className={`book-card ${selectedBook?.id === book.id ? 'selected' : ''}`}
                onClick={() => handleBookSelect(book)}
              >
                <img
                  src={book.coverUrl}
                  alt={book.title}
                  className="book-cover"
                  onError={handleImageError}
                />
                <div className="book-title">{book.title}</div>
                <div className="book-author">{book.author}</div>
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="main-content">
        {selectedBook ? (
          loading ? (
            <div className="empty-state">
              <div className="icon">⏳</div>
              <p>加载中...</p>
            </div>
          ) : (
            <>
              <Reader
                book={selectedBook}
                annotations={annotations}
                onAnnotationAdded={handleAnnotationAdded}
                isReadOnly={isReadOnly}
                shareAnnotations={shareData?.annotations}
              />
            </>
          )
        ) : (
          <div className="reader-wrapper">
            <div className="reader-container">
              <div className="empty-state">
                <div className="icon">📖</div>
                <p>请从上方选择一本书开始阅读</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedBook && !isReadOnly && (
        <button
          className="share-button"
          onClick={() => setShowShareModal(true)}
        >
          🔗 分享批注
        </button>
      )}

      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">分享批注</div>
            <div className="modal-body">
              <label>目标用户邮箱</label>
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="请输入邮箱地址..."
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowShareModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleShare}
                disabled={!shareEmail.trim() || !selectedBook}
              >
                生成分享链接
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
