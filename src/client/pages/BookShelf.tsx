import React, { useState, useEffect, useCallback } from 'react';
import { Book } from '../types';
import { getUserBooks, createBook, updateBook, deleteBook } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['文学', '科技', '生活', '历史', '艺术', '教育'];
const CONDITIONS = [
  { value: 'new', label: '全新' },
  { value: 'good', label: '9成新' },
  { value: 'fair', label: '8成新' },
  { value: 'poor', label: '7成新及以下' },
];

interface BookFormData {
  title: string;
  author: string;
  category: string;
  coverImage: string;
  condition: Book['condition'];
  description: string;
}

const initialFormData: BookFormData = {
  title: '',
  author: '',
  category: '文学',
  coverImage: '',
  condition: 'good',
  description: '',
};

const BookShelf: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [formData, setFormData] = useState<BookFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'available' | 'exchanged'>('all');

  const { user } = useAuth();

  const fetchBooks = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await getUserBooks(user.id);
      setBooks(data);
    } catch (error) {
      console.error('Failed to fetch books:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (editingBook) {
        const updated = await updateBook(editingBook.id, formData);
        setBooks((prev) => prev.map((b) => (b.id === editingBook.id ? updated : b)));
      } else {
        const newBook = await createBook({ ...formData, isAvailable: true });
        setBooks((prev) => [newBook, ...prev]);
      }
      resetForm();
    } catch (error) {
      console.error('Failed to save book:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (book: Book) => {
    setEditingBook(book);
    setFormData({
      title: book.title,
      author: book.author,
      category: book.category,
      coverImage: book.coverImage || '',
      condition: book.condition,
      description: book.description || '',
    });
    setShowAddForm(true);
  };

  const handleDelete = async (bookId: string) => {
    if (!confirm('确定要删除这本书吗？')) return;
    try {
      await deleteBook(bookId);
      setBooks((prev) => prev.filter((b) => b.id !== bookId));
    } catch (error) {
      console.error('Failed to delete book:', error);
    }
  };

  const resetForm = () => {
    setFormData(initialFormData);
    setEditingBook(null);
    setShowAddForm(false);
  };

  const filteredBooks = books.filter((book) => {
    if (activeTab === 'available') return book.isAvailable;
    if (activeTab === 'exchanged') return !book.isAvailable;
    return true;
  });

  const sortedBooks = [...filteredBooks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  return (
    <div className="min-h-screen py-8 px-4 md:px-8" style={{ backgroundColor: '#F9F5F0' }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#2D2D2D' }}>
              我的书架
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              共 {books.length} 本书 · 可交换 {books.filter((b) => b.isAvailable).length} 本
            </p>
          </div>

          <button
            onClick={() => setShowAddForm(true)}
            className="px-6 py-2.5 rounded-full font-medium text-white hover:opacity-90 transition-all flex items-center gap-2"
            style={{ backgroundColor: '#FF6B35', boxShadow: '0 4px 12px rgba(255,107,53,0.3)' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            添加新书
          </button>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {[
            { key: 'all', label: '全部' },
            { key: 'available', label: '可交换' },
            { key: 'exchanged', label: '已交换' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={`px-5 py-2 rounded-full font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
              style={activeTab === tab.key ? { backgroundColor: '#FF6B35' } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : sortedBooks.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div className="text-6xl mb-4">📚</div>
            <p className="text-gray-500 text-lg">书架还是空的</p>
            <p className="text-gray-400 text-sm mt-2 mb-6">点击"添加新书"开始分享您的书籍</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-6 py-2.5 rounded-full font-medium text-white hover:opacity-90 transition-all"
              style={{ backgroundColor: '#FF6B35' }}
            >
              添加第一本书
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6 justify-center md:justify-start">
            {sortedBooks.map((book) => (
              <div
                key={book.id}
                className="bg-white rounded-2xl overflow-hidden w-full sm:w-auto"
                style={{
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  width: '280px',
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                }}
              >
                <div className="relative h-48">
                  <img
                    src={book.coverImage || 'https://picsum.photos/seed/book/400/300'}
                    alt={book.title}
                    className="w-full h-full object-cover"
                  />
                  {!book.isAvailable && (
                    <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center">
                      <span className="px-4 py-2 bg-orange-500 text-white rounded-full font-medium">
                        已交换
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <h3 className="font-bold text-lg mb-1 truncate" style={{ color: '#2D2D2D' }}>
                    {book.title}
                  </h3>
                  <p className="text-gray-500 text-sm mb-2">{book.author}</p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                      {book.category}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-xs text-white"
                      style={{
                        backgroundColor:
                          book.condition === 'new'
                            ? '#22c55e'
                            : book.condition === 'good'
                            ? '#3b82f6'
                            : book.condition === 'fair'
                            ? '#f97316'
                            : '#ef4444',
                      }}
                    >
                      {CONDITIONS.find((c) => c.value === book.condition)?.label}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm mb-4 line-clamp-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {book.description}
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(book)}
                      className="flex-1 py-2 rounded-lg font-medium text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(book.id)}
                      className="flex-1 py-2 rounded-lg font-medium text-sm text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showAddForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" style={{ boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold" style={{ color: '#2D2D2D' }}>
                  {editingBook ? '编辑书籍' : '添加新书'}
                </h3>
                <button
                  onClick={resetForm}
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">书名 *</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="请输入书名"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">作者 *</label>
                  <input
                    type="text"
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="请输入作者"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">类别 *</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                      required
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">新旧程度 *</label>
                    <select
                      value={formData.condition}
                      onChange={(e) => setFormData({ ...formData, condition: e.target.value as Book['condition'] })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                      required
                    >
                      {CONDITIONS.map((cond) => (
                        <option key={cond.value} value={cond.value}>
                          {cond.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">封面图片 URL</label>
                  <input
                    type="url"
                    value={formData.coverImage}
                    onChange={(e) => setFormData({ ...formData, coverImage: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="https://example.com/book-cover.jpg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">简短描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                    rows={3}
                    placeholder="简要介绍这本书的内容..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 py-2.5 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-lg font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#FF6B35' }}
                  >
                    {submitting ? '保存中...' : editingBook ? '保存修改' : '添加书籍'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookShelf;
