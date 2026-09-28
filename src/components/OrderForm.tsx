import React, { useState } from 'react';
import { Book } from '../modules/book/BookManager';

interface OrderItemInput {
  bookId: string;
  quantity: number;
}

interface OrderFormProps {
  books: Book[];
  onSubmit: (data: {
    customerName: string;
    customerPhone: string;
    items: OrderItemInput[];
  }) => void;
  error?: string | null;
}

export const OrderForm: React.FC<OrderFormProps> = ({ books, onSubmit, error }) => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedBooks, setSelectedBooks] = useState<OrderItemInput[]>([
    { bookId: '', quantity: 1 },
  ]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);

  const filteredBooks = books.filter(
    (b) =>
      b.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.isbn.includes(searchTerm)
  );

  const handleBookSelect = (index: number, book: Book) => {
    const newSelected = [...selectedBooks];
    newSelected[index] = { bookId: book.id, quantity: 1 };
    setSelectedBooks(newSelected);
    setActiveDropdown(null);
    setSearchTerm('');
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const newSelected = [...selectedBooks];
    newSelected[index] = { ...newSelected[index], quantity: Math.max(1, quantity) };
    setSelectedBooks(newSelected);
  };

  const addBookRow = () => {
    setSelectedBooks([...selectedBooks, { bookId: '', quantity: 1 }]);
  };

  const removeBookRow = (index: number) => {
    if (selectedBooks.length > 1) {
      setSelectedBooks(selectedBooks.filter((_, i) => i !== index));
    }
  };

  const getBookById = (id: string): Book | undefined => {
    return books.find((b) => b.id === id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName || !customerPhone) {
      alert('请填写客户信息');
      return;
    }

    const validItems = selectedBooks.filter((item) => item.bookId && item.quantity > 0);
    if (validItems.length === 0) {
      alert('请至少选择一本书');
      return;
    }

    onSubmit({
      customerName,
      customerPhone,
      items: validItems,
    });

    setCustomerName('');
    setCustomerPhone('');
    setSelectedBooks([{ bookId: '', quantity: 1 }]);
  };

  return (
    <form className="order-form" onSubmit={handleSubmit}>
      <h3>创建订单</h3>

      {error && <div className="error-alert">{error}</div>}

      <div className="form-row">
        <div className="form-group">
          <label>客户姓名</label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="请输入客户姓名"
          />
        </div>
        <div className="form-group">
          <label>联系电话</label>
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="请输入联系电话"
          />
        </div>
      </div>

      <div className="form-group">
        <label>选购书籍</label>
        {selectedBooks.map((item, index) => {
          const selectedBook = item.bookId ? getBookById(item.bookId) : null;
          return (
            <div key={index} className="book-select-row">
              <div className="book-select-wrapper">
                <input
                  type="text"
                  className="book-search-input"
                  value={activeDropdown === index ? searchTerm : selectedBook?.title || ''}
                  placeholder="搜索书名或ISBN..."
                  onFocus={() => {
                    setActiveDropdown(index);
                    setSearchTerm('');
                  }}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setActiveDropdown(index);
                  }}
                />
                {activeDropdown === index && (
                  <div className="book-dropdown">
                    {filteredBooks.length > 0 ? (
                      filteredBooks.map((book) => (
                        <div
                          key={book.id}
                          className="book-dropdown-item"
                          onClick={() => handleBookSelect(index, book)}
                        >
                          <span className="dropdown-book-title">{book.title}</span>
                          <span className="dropdown-book-stock">
                            库存: {book.stock}
                          </span>
                          <span className="dropdown-book-price">¥{book.price}</span>
                        </div>
                      ))
                    ) : (
                      <div className="dropdown-empty">未找到匹配书籍</div>
                    )}
                  </div>
                )}
              </div>
              <input
                type="number"
                className="quantity-input"
                min="1"
                value={item.quantity}
                onChange={(e) =>
                  handleQuantityChange(index, parseInt(e.target.value, 10) || 1)
                }
              />
              <button
                type="button"
                className="btn btn-remove"
                onClick={() => removeBookRow(index)}
                disabled={selectedBooks.length <= 1}
              >
                移除
              </button>
            </div>
          );
        })}
        <button type="button" className="btn btn-add-book" onClick={addBookRow}>
          + 添加书籍
        </button>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          提交订单
        </button>
      </div>
    </form>
  );
};
