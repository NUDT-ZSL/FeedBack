import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Book } from '../types';
import { getBooks, createExchange } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['全部', '文学', '科技', '生活', '历史', '艺术', '教育'];

const CONDITION_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: '全新', color: '#22c55e' },
  good: { label: '9成新', color: '#3b82f6' },
  fair: { label: '8成新', color: '#f97316' },
  poor: { label: '7成新及以下', color: '#ef4444' },
};

const Home: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestedBooks, setRequestedBooks] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ show: boolean; book: Book | null }>({
    show: false,
    book: null,
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allBooksRef = useRef<Book[]>([]);

  const fetchBooks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getBooks();
      allBooksRef.current = data;
      applyFilters(data, searchTerm, selectedCategory);
    } catch (error) {
      console.error('Failed to fetch books:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyFilters = useCallback(
    (allBooks: Book[], search: string, category: string) => {
      let filtered = [...allBooks];

      if (search.trim()) {
        const lowerSearch = search.toLowerCase();
        filtered = filtered.filter(
          (book) =>
            book.title.toLowerCase().includes(lowerSearch) ||
            book.author.toLowerCase().includes(lowerSearch)
        );
      }

      if (category !== '全部') {
        filtered = filtered.filter((book) => book.category === category);
      }

      setBooks(filtered);
    },
    []
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      applyFilters(allBooksRef.current, value, selectedCategory);
    }, 300);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setIsFilterOpen(false);
    applyFilters(allBooksRef.current, searchTerm, category);
  };

  const handleRequestExchange = (book: Book) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/' } } });
      return;
    }
    setConfirmDialog({ show: true, book });
  };

  const confirmExchange = async () => {
    if (!confirmDialog.book) return;

    try {
      await createExchange({ bookId: confirmDialog.book.id });
      setRequestedBooks((prev) => new Set([...prev, confirmDialog.book!.id]));
      setConfirmDialog({ show: false, book: null });
    } catch (error) {
      console.error('Failed to create exchange:', error);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen py-8 px-4 md:px-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold mb-8 text-center" style={{ color: '#2D2D2D' }}>
          发现好书，交换知识
        </h1>

        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="搜索书名或作者..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full px-5 py-3 rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-400 transition-all"
              style={{ backgroundColor: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}
            />
            <svg
              className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="relative">
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="px-6 py-3 rounded-full font-medium transition-all flex items-center gap-2 hover:opacity-90"
              style={{ backgroundColor: '#FF6B35', color: 'white', boxShadow: '0 2px 8px rgba(255,107,53,0.3)' }}
            >
              <span>{selectedCategory}</span>
              <svg
                className={`w-4 h-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div
              className={`absolute top-full mt-2 right-0 bg-white rounded-lg shadow-lg overflow-hidden z-10 transition-all duration-300 origin-top ${
                isFilterOpen ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-0 pointer-events-none'
              }`}
              style={{ minWidth: '150px' }}
            >
              {CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`w-full px-4 py-2 text-left hover:bg-gray-50 transition-colors ${
                    selectedCategory === category ? 'bg-orange-50 text-orange-600' : 'text-gray-700'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : books.length === 0 ? (
          <div className="text-center py-16 text-gray-500">暂无符合条件的书籍</div>
        ) : (
          <div
            className="grid gap-6"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {books.map((book) => {
              const isRequested = requestedBooks.has(book.id);
              const conditionInfo = CONDITION_LABELS[book.condition] || { label: book.condition, color: '#6b7280' };

              return (
                <div
                  key={book.id}
                  className="bg-white rounded-xl overflow-hidden group cursor-pointer"
                  style={{
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                  }}
                >
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={book.coverImage || 'https://picsum.photos/seed/book/400/300'}
                      alt={book.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <span
                      className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: conditionInfo.color }}
                    >
                      {conditionInfo.label}
                    </span>
                  </div>

                  <div className="p-5">
                    <h3 className="font-bold text-lg mb-1 truncate" style={{ color: '#2D2D2D' }}>
                      {book.title}
                    </h3>
                    <p className="text-gray-500 text-sm mb-2">{book.author}</p>
                    <p className="text-gray-600 text-sm mb-4 line-clamp-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {book.description}
                    </p>
                    <button
                      onClick={() => handleRequestExchange(book)}
                      disabled={isRequested}
                      className={`w-full py-2.5 rounded-lg font-medium transition-all ${
                        isRequested
                          ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          : 'text-white hover:opacity-90'
                      }`}
                      style={!isRequested ? { backgroundColor: '#FF6B35' } : {}}
                    >
                      {isRequested ? '已请求' : '请求交换'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {confirmDialog.show && confirmDialog.book && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full" style={{ boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <h3 className="text-xl font-bold mb-4" style={{ color: '#2D2D2D' }}>
                确认交换请求
              </h3>
              <div className="flex items-center gap-4 mb-6">
                <img
                  src={confirmDialog.book.coverImage || 'https://picsum.photos/seed/book/80/120'}
                  alt={confirmDialog.book.title}
                  className="w-16 h-24 object-cover rounded-lg"
                />
                <div>
                  <p className="font-medium">{confirmDialog.book.title}</p>
                  <p className="text-gray-500 text-sm">{confirmDialog.book.author}</p>
                </div>
              </div>
              <p className="text-gray-600 mb-6 text-sm">
                确认向书籍所有者发送交换请求？对方会收到通知并决定是否接受。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDialog({ show: false, book: null })}
                  className="flex-1 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmExchange}
                  className="flex-1 py-2.5 rounded-lg font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: '#FF6B35' }}
                >
                  确认请求
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
