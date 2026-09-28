import React, { useState } from 'react';
import { BookCategory } from '../modules/book/BookManager';

interface BookFormProps {
  onSubmit: (data: {
    title: string;
    author: string;
    isbn: string;
    price: number;
    category: BookCategory;
    stock: number;
  }) => void;
  onCancel?: () => void;
}

const categories: BookCategory[] = ['小说', '非小说', '儿童', '科技'];

export const BookForm: React.FC<BookFormProps> = ({ onSubmit, onCancel }) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<BookCategory>('小说');
  const [stock, setStock] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(price);
    const stockNum = parseInt(stock, 10);

    if (!title || !author || !isbn || isNaN(priceNum) || isNaN(stockNum)) {
      alert('请填写完整信息');
      return;
    }

    onSubmit({
      title,
      author,
      isbn,
      price: priceNum,
      category,
      stock: stockNum,
    });

    setTitle('');
    setAuthor('');
    setIsbn('');
    setPrice('');
    setCategory('小说');
    setStock('');
  };

  return (
    <form className="book-form" onSubmit={handleSubmit}>
      <h3>录入新书</h3>
      <div className="form-row">
        <div className="form-group">
          <label>书名</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入书名"
          />
        </div>
        <div className="form-group">
          <label>作者</label>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="请输入作者"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>ISBN</label>
          <input
            type="text"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            placeholder="请输入ISBN"
          />
        </div>
        <div className="form-group">
          <label>分类</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as BookCategory)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>定价 (元)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="form-group">
          <label>库存数量</label>
          <input
            type="number"
            min="0"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          添加书籍
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </form>
  );
};
