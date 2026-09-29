import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FiSearch, FiX, FiBookOpen } from 'react-icons/fi';
import { books as initialBooks } from '@/data/books';
import type { Book, BookCategory, BorrowRecord } from '@/types';
import BookCard from '@/components/BookCard';
import BookDetail from '@/components/BookDetail';
import BorrowForm from '@/components/BorrowForm';

const CATEGORIES: BookCategory[] = ['文学', '历史', '哲学', '科学', '艺术'];

type SortMode = 'title' | 'author' | 'stock';

function sortBooks(list: Book[], mode: SortMode): Book[] {
  const sorted = [...list];
  switch (mode) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
      break;
    case 'author':
      sorted.sort((a, b) => a.author.localeCompare(b.author, 'zh'));
      break;
    case 'stock':
      sorted.sort((a, b) => b.stock - a.stock);
      break;
  }
  return sorted;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function App() {
  const [books, setBooks] = useState<Book[]>(initialBooks);
  const [activeCategory, setActiveCategory] = useState<BookCategory | '全部'>('全部');
  const [searchRaw, setSearchRaw] = useState('');
  const searchKeyword = useDebounce(searchRaw, 200);
  const [sortMode, setSortMode] = useState<SortMode>('title');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  const gridRef = useRef<HTMLDivElement>(null);
  const prevPositions = useRef<Map<string, DOMRect>>(new Map());

  const filteredBooks = useMemo(() => {
    let result = books;
    if (activeCategory !== '全部') {
      result = result.filter((b) => b.category === activeCategory);
    }
    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(kw) ||
          b.author.toLowerCase().includes(kw)
      );
    }
    return sortBooks(result, sortMode);
  }, [books, activeCategory, searchKeyword, sortMode]);

  const handleCategoryChange = useCallback((cat: BookCategory | '全部') => {
    setActiveCategory(cat);
    setAnimKey((k) => k + 1);
  }, []);

  const handleSortChange = useCallback((mode: SortMode) => {
    if (gridRef.current) {
      const positions = new Map<string, DOMRect>();
      gridRef.current.querySelectorAll<HTMLElement>('[data-book-id]').forEach((el) => {
        const id = el.dataset.bookId!;
        positions.set(id, el.getBoundingClientRect());
      });
      prevPositions.current = positions;
    }
    setSortMode(mode);
  }, []);

  useEffect(() => {
    if (!gridRef.current || prevPositions.current.size === 0) return;
    const grid = gridRef.current;
    const newPositions = new Map<string, DOMRect>();
    grid.querySelectorAll<HTMLElement>('[data-book-id]').forEach((el) => {
      const id = el.dataset.bookId!;
      newPositions.set(id, el.getBoundingClientRect());
    });

    grid.querySelectorAll<HTMLElement>('[data-book-id]').forEach((el) => {
      const id = el.dataset.bookId!;
      const oldRect = prevPositions.current.get(id);
      const newRect = newPositions.get(id);
      if (oldRect && newRect) {
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        if (dx !== 0 || dy !== 0) {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          el.style.transition = 'none';
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.4s ease';
            el.style.transform = '';
          });
        }
      }
    });
    prevPositions.current = new Map();
  }, [sortMode, filteredBooks]);

  const handleSelectBook = useCallback((book: Book) => {
    setSelectedBook(book);
    setMobileDetailOpen(true);
  }, []);

  const handleOpenBorrow = useCallback(() => {
    setDrawerOpen(true);
    setDrawerClosing(false);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerClosing(true);
    setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, 300);
  }, []);

  const handleBorrowSubmit = useCallback(
    (data: { name: string; phone: string; returnDate: string }) => {
      if (!selectedBook) return;
      const target = books.find((b) => b.id === selectedBook.id);
      if (!target || target.stock <= 0) {
        toast.error('该书已全部借出', { duration: 2500 });
        handleCloseDrawer();
        return;
      }
      const newRecord: BorrowRecord = {
        name: data.name,
        phone: data.phone,
        returnDate: data.returnDate,
        borrowDate: new Date().toISOString().split('T')[0],
      };
      setBooks((prev) =>
        prev.map((b) =>
          b.id === selectedBook.id
            ? { ...b, stock: b.stock - 1, borrowRecords: [...b.borrowRecords, newRecord] }
            : b
        )
      );
      setSelectedBook((prev) =>
        prev && prev.id === selectedBook.id
          ? { ...prev, stock: prev.stock - 1, borrowRecords: [...prev.borrowRecords, newRecord] }
          : prev
      );
      toast.success('借阅成功', { duration: 2500 });
      handleCloseDrawer();
    },
    [selectedBook, books, handleCloseDrawer]
  );

  const handleBorrowFromCard = useCallback(
    (book: Book) => {
      setSelectedBook(book);
      handleOpenBorrow();
    },
    [handleOpenBorrow]
  );

  const syncedSelectedBook = useMemo(() => {
    if (!selectedBook) return null;
    return books.find((b) => b.id === selectedBook.id) || selectedBook;
  }, [books, selectedBook]);

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            fontFamily: "'Noto Serif SC', serif",
            borderRadius: '10px',
            fontSize: '0.9rem',
          },
          success: {
            style: { background: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' },
            iconTheme: { primary: '#50B86C', secondary: '#fff' },
          },
          error: {
            style: { background: '#FFEBEE', color: '#C62828', border: '1px solid #EF9A9A' },
            iconTheme: { primary: '#E74C3C', secondary: '#fff' },
          },
        }}
      />

      <nav className="navbar">
        <div className="navbar-brand">墨香书馆</div>
        <div className="navbar-actions">
          <div className="search-wrapper">
            <FiSearch className="search-icon" />
            <input
              className="search-input"
              type="text"
              placeholder="搜索书名或作者..."
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
          </div>
          <select
            className="sort-select"
            value={sortMode}
            onChange={(e) => handleSortChange(e.target.value as SortMode)}
          >
            <option value="title">按书名 A-Z</option>
            <option value="author">按作者</option>
            <option value="stock">按库存</option>
          </select>
        </div>
      </nav>

      <div className="main-layout">
        <div className="book-grid-area">
          <div className="category-tabs">
            <button
              className={`category-tab ${activeCategory === '全部' ? 'active' : ''}`}
              onClick={() => handleCategoryChange('全部')}
            >
              全部
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                className={`category-tab ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => handleCategoryChange(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="book-grid" ref={gridRef} key={animKey}>
            {filteredBooks.map((book, index) => (
              <div key={book.id} data-book-id={book.id}>
                <BookCard
                  book={book}
                  index={index}
                  searchKeyword={searchKeyword}
                  onClick={() => handleSelectBook(book)}
                  onBorrow={() => handleBorrowFromCard(book)}
                />
              </div>
            ))}
          </div>

          {filteredBooks.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-light)' }}>
              <FiBookOpen style={{ fontSize: '2.5rem', marginBottom: '12px', opacity: 0.4 }} />
              <div>未找到匹配的图书</div>
            </div>
          )}
        </div>

        <div className={`detail-area ${mobileDetailOpen ? 'mobile-open' : ''}`}>
          {syncedSelectedBook ? (
            <>
              <BookDetail book={syncedSelectedBook} onBorrow={handleOpenBorrow} />
              <button
                className="mobile-detail-toggle"
                style={{ display: mobileDetailOpen ? 'flex' : 'none' }}
                onClick={() => setMobileDetailOpen(false)}
              >
                <FiX />
              </button>
            </>
          ) : (
            <div className="empty-detail">
              <div className="empty-detail-icon"><FiBookOpen /></div>
              <div className="empty-detail-text">点击左侧图书卡片<br />查看详细信息</div>
            </div>
          )}
        </div>
      </div>

      {!syncedSelectedBook && (
        <button className="mobile-detail-toggle" style={{ display: 'none' }}>
          <FiBookOpen />
        </button>
      )}

      {drawerOpen && (
        <>
          <div
            className={`drawer-overlay ${drawerClosing ? 'closing' : ''}`}
            onClick={handleCloseDrawer}
          />
          <div className={`drawer ${drawerClosing ? 'closing' : ''}`}>
            <div className="drawer-header">
              <h3>申请借阅</h3>
              <button className="drawer-close" onClick={handleCloseDrawer}>
                <FiX />
              </button>
            </div>
            <div className="drawer-body">
              {syncedSelectedBook && (
                <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--bg)', borderRadius: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-dark)' }}>{syncedSelectedBook.title}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-light)', marginTop: '4px' }}>{syncedSelectedBook.author}</div>
                </div>
              )}
              <BorrowForm onSubmit={handleBorrowSubmit} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
