import { useState, useCallback, useMemo, useRef } from 'react';
import { BookManager, Book, BookCategory } from './modules/book/BookManager';
import { OrderManager, OrderStatus } from './modules/order/OrderManager';
import { ReportGenerator } from './modules/report/ReportGenerator';
import { BookCard } from './components/BookCard';
import { BookForm } from './components/BookForm';
import { OrderList } from './components/OrderList';
import { OrderForm } from './components/OrderForm';
import { Dashboard } from './components/Dashboard';
import { LowStockNotification } from './components/LowStockNotification';
import './styles/index.css';

type PageType = 'inventory' | 'orders' | 'reports';

const bookManager = new BookManager();
const orderManager = new OrderManager(bookManager);
const reportGenerator = new ReportGenerator(orderManager);

const navItems: { key: PageType; label: string; icon: string }[] = [
  { key: 'inventory', label: '库存管理', icon: '📚' },
  { key: 'orders', label: '订单管理', icon: '📦' },
  { key: 'reports', label: '销售报表', icon: '📊' },
];

const categories: (BookCategory | '全部')[] = ['全部', '小说', '非小说', '儿童', '科技'];

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<BookCategory | '全部'>('全部');
  const [books, setBooks] = useState<Book[]>(() => bookManager.getAllBooks());
  const [showBookForm, setShowBookForm] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [selectedBookDetail, setSelectedBookDetail] = useState<Book | null>(null);
  const bookGridRef = useRef<HTMLDivElement>(null);

  const refreshBooks = useCallback(() => {
    setBooks(bookManager.getAllBooks());
  }, []);

  const filteredBooks = useMemo(() => {
    let result = books;
    if (selectedCategory !== '全部') {
      result = result.filter((b) => b.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(lowerQuery) ||
          b.isbn.toLowerCase().includes(lowerQuery) ||
          b.author.toLowerCase().includes(lowerQuery)
      );
    }
    return result;
  }, [books, searchQuery, selectedCategory]);

  const handleAddBook = useCallback(
    (data: {
      title: string;
      author: string;
      isbn: string;
      price: number;
      category: BookCategory;
      stock: number;
    }) => {
      bookManager.addBook(data);
      refreshBooks();
      setShowBookForm(false);
    },
    [refreshBooks]
  );

  const handleCreateOrder = useCallback(
    (data: {
      customerName: string;
      customerPhone: string;
      items: { bookId: string; quantity: number }[];
    }) => {
      const result = orderManager.createOrder(data);
      if (result.success) {
        setOrderError(null);
        refreshBooks();
        setOrdersRefreshKey((k) => k + 1);
        setReportRefreshKey((k) => k + 1);
      } else {
        setOrderError(result.error || '创建订单失败');
      }
    },
    [refreshBooks]
  );

  const handleOrderStatusChange = useCallback(
    (orderId: string, status: OrderStatus) => {
      orderManager.updateStatus(orderId, status);
      setOrdersRefreshKey((k) => k + 1);
      setReportRefreshKey((k) => k + 1);
    },
    []
  );

  const handleLowStockBookClick = useCallback(
    (book: Book) => {
      setCurrentPage('inventory');
      setSelectedBookDetail(book);
      setTimeout(() => {
        const card = document.querySelector(`[data-book-id="${book.id}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('highlight-pulse');
          setTimeout(() => card.classList.remove('highlight-pulse'), 2000);
        }
      }, 300);
    },
    []
  );

  const orders = useMemo(() => orderManager.getAllOrders(), [ordersRefreshKey]);

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === '待处理' || o.status === '已发货'),
    [orders]
  );
  const completedOrders = useMemo(
    () => orders.filter((o) => o.status === '已完成'),
    [orders]
  );

  return (
    <div className="app-container">
      <LowStockNotification books={books} onBookClick={handleLowStockBookClick} />

      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo">📖</span>
          <h2 className="app-title">书店管理</h2>
        </div>
        <nav className="nav-menu">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              <span className="nav-indicator" />
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <div className="content-header">
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder={
                currentPage === 'inventory'
                  ? '搜索书名、作者或ISBN...'
                  : currentPage === 'orders'
                  ? '搜索订单号、客户名...'
                  : '搜索...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {currentPage === 'inventory' && (
            <button
              className="btn btn-primary btn-add"
              onClick={() => setShowBookForm(true)}
            >
              + 录入新书
            </button>
          )}
        </div>

        <div className="content-body">
          {currentPage === 'inventory' && (
            <div className="inventory-page">
              <div className="category-filter">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`category-btn ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {showBookForm && (
                <div className="form-panel">
                  <BookForm
                    onSubmit={handleAddBook}
                    onCancel={() => setShowBookForm(false)}
                  />
                </div>
              )}

              <div className="book-grid" ref={bookGridRef}>
                {filteredBooks.map((book) => (
                  <div key={book.id} data-book-id={book.id}>
                    <BookCard
                      book={book}
                      lowStock={book.stock < 5}
                      onClick={(b) => setSelectedBookDetail(b)}
                    />
                  </div>
                ))}
              </div>

              {filteredBooks.length === 0 && (
                <div className="empty-state">暂无匹配的书籍</div>
              )}
            </div>
          )}

          {currentPage === 'orders' && (
            <div className="orders-page">
              <div className="form-panel">
                <OrderForm
                  books={books.filter((b) => b.stock > 0)}
                  onSubmit={handleCreateOrder}
                  error={orderError}
                />
              </div>

              <div className="orders-section">
                <h3 className="section-title">待处理订单</h3>
                <OrderList
                  orders={pendingOrders}
                  onStatusChange={handleOrderStatusChange}
                />
              </div>

              <div className="orders-section">
                <h3 className="section-title">已完成订单</h3>
                <OrderList orders={completedOrders} />
              </div>
            </div>
          )}

          {currentPage === 'reports' && (
            <Dashboard reportGenerator={reportGenerator} refreshKey={reportRefreshKey} />
          )}
        </div>
      </main>

      {selectedBookDetail && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedBookDetail(null)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setSelectedBookDetail(null)}
            >
              ×
            </button>
            <h2>{selectedBookDetail.title}</h2>
            <div className="book-detail-info">
              <p><strong>作者：</strong>{selectedBookDetail.author}</p>
              <p><strong>ISBN：</strong>{selectedBookDetail.isbn}</p>
              <p><strong>分类：</strong>{selectedBookDetail.category}</p>
              <p><strong>定价：</strong>¥{selectedBookDetail.price.toFixed(2)}</p>
              <p>
                <strong>库存：</strong>
                <span className={selectedBookDetail.stock < 5 ? 'stock-warning' : ''}>
                  {selectedBookDetail.stock} 本
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
