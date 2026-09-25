import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Book, Note, BookSearchResult } from '../types';
import BookCard from './components/BookCard';
import NoteList from './components/NoteList';
import InspirationBoard from './components/InspirationBoard';
import { SkeletonGrid, SearchResultSkeleton } from './components/Skeleton';

const NavBar: React.FC<{ onExport: () => void }> = ({ onExport }) => (
  <nav className="navbar">
    <Link to="/" className="navbar-brand">BookNotes</Link>
    <div className="navbar-links">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
        我的书架
      </NavLink>
      <NavLink to="/inspiration" className={({ isActive }) => (isActive ? 'active' : '')}>
        灵感板
      </NavLink>
      <button
        onClick={onExport}
        style={{
          marginLeft: 8,
          padding: '8px 14px',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent)',
          color: 'white',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
        }}
      >
        📥 导出笔记
      </button>
    </div>
  </nav>
);

const BookShelfPage: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [addingOlid, setAddingOlid] = useState<string | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const navigate = useNavigate();

  const fetchBooks = useCallback(async () => {
    setLoadingBooks(true);
    const res = await axios.get<Book[]>('/api/books');
    setBooks(res.data);
    setLoadingBooks(false);
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setShowResults(true);
    try {
      const res = await axios.get<BookSearchResult[]>('/api/books/search', {
        params: { q: searchQuery },
      });
      setSearchResults(res.data);
    } catch {
      setSearchResults([]);
    }
    setIsSearching(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleAddBook = async (result: BookSearchResult) => {
    setAddingOlid(result.olid);
    try {
      await axios.post('/api/books', result);
      await fetchBooks();
    } catch {
      alert('添加失败，请重试');
    }
    setAddingOlid(null);
  };

  const handleDeleteBook = async (id: string) => {
    try {
      await axios.delete(`/api/books/${id}`);
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch {
      alert('删除失败');
    }
  };

  const isAlreadyAdded = (olid: string) => books.some((b) => b.olid === olid);

  return (
    <div className="main-content">
      <div className="search-section">
        <h1 className="search-title">发现与收藏</h1>
        <div className="search-bar">
          <input
            className="search-input"
            type="text"
            placeholder="搜索书名、作者...（来自 Open Library）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching}>
            {isSearching ? '搜索中...' : '搜索'}
          </button>
        </div>

        {showResults && (
          <div>
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 12,
                color: 'var(--text-secondary)',
              }}
            >
              搜索结果
            </h3>
            {isSearching ? (
              <SearchResultSkeleton count={6} />
            ) : searchResults.length === 0 ? (
              <div className="empty-state" style={{ padding: 30 }}>
                <div className="empty-state-text">未找到相关书籍</div>
              </div>
            ) : (
              <div className="search-results">
                {searchResults.map((result) => {
                  const added = isAlreadyAdded(result.olid);
                  return (
                    <div key={result.olid} className="search-result-card">
                      {result.coverUrl ? (
                        <img
                          className="search-result-cover"
                          src={result.coverUrl}
                          alt={result.title}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="search-result-cover-placeholder">📖</div>
                      )}
                      <div className="search-result-info">
                        <div className="search-result-title">{result.title}</div>
                        <div className="search-result-author">{result.author}</div>
                        {result.publishYear && (
                          <div className="search-result-year">{result.publishYear}</div>
                        )}
                        <button
                          className="btn btn-sm"
                          disabled={added || addingOlid === result.olid}
                          onClick={() => handleAddBook(result)}
                          style={{
                            background: added ? 'var(--border)' : 'var(--accent)',
                            color: added ? 'var(--text-muted)' : 'white',
                            cursor: added ? 'default' : 'pointer',
                          }}
                        >
                          {addingOlid === result.olid
                            ? '添加中...'
                            : added
                            ? '已添加'
                            : '加入书架'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="section-title">我的书架</h2>
        {loadingBooks ? (
          <SkeletonGrid count={8} />
        ) : books.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <div className="empty-state-text">书架空空如也，搜索并添加你喜欢的书吧</div>
          </div>
        ) : (
          <div className="bookshelf-grid">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onClick={(id) => navigate(`/book/${id}`)}
                onDelete={handleDeleteBook}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const BookDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [formData, setFormData] = useState({
    highlightText: '',
    thought: '',
    tagsInput: '',
    pageNumber: '',
  });
  const [formTags, setFormTags] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [bookRes, notesRes] = await Promise.all([
        axios.get<Book[]>('/api/books'),
        axios.get<Note[]>('/api/notes', { params: { bookId: id } }),
      ]);
      const foundBook = bookRes.data.find((b) => b.id === id);
      setBook(foundBook || null);
      setNotes(notesRes.data);
    } catch {
      setBook(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setFormData({ highlightText: '', thought: '', tagsInput: '', pageNumber: '' });
    setFormTags([]);
    setEditingNote(null);
    setShowForm(false);
  };

  const openEditForm = (note: Note) => {
    setEditingNote(note);
    setFormData({
      highlightText: note.highlightText,
      thought: note.thought,
      tagsInput: '',
      pageNumber: String(note.pageNumber),
    });
    setFormTags([...note.tags]);
    setShowForm(true);
  };

  const handleAddTag = () => {
    const tag = formData.tagsInput.trim();
    if (tag && !formTags.includes(tag)) {
      setFormTags([...formTags, tag]);
      setFormData({ ...formData, tagsInput: '' });
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormTags(formTags.filter((t) => t !== tag));
  };

  const handleSubmitNote = async () => {
    if (!id) return;
    const payload = {
      bookId: id,
      highlightText: formData.highlightText,
      thought: formData.thought,
      tags: formTags,
      pageNumber: parseInt(formData.pageNumber) || 0,
    };

    try {
      if (editingNote) {
        await axios.put(`/api/notes/${editingNote.id}`, payload);
      } else {
        await axios.post('/api/notes', payload);
      }
      resetForm();
      await fetchData();
    } catch {
      alert('保存失败');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await axios.delete(`/api/notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      alert('删除失败');
    }
  };

  const handleProgressUpdate = async (progress: number) => {
    if (!id) return;
    const clamped = Math.max(0, Math.min(100, progress));
    try {
      await axios.patch(`/api/books/${id}`, { progress: clamped });
      setBook((prev) => (prev ? { ...prev, progress: clamped } : prev));
    } catch {
      // silent
    }
  };

  const handleAddToBoard = (note: Note) => {
    const STORAGE_KEY = 'inspiration_board_layout';
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const alreadyAdded = existing.some((c: any) => c.noteId === note.id);
      if (alreadyAdded) {
        alert('该笔记已在灵感板中');
        return;
      }
      const newCard = {
        id: `insp-${Date.now()}`,
        noteId: note.id,
        bookId: note.bookId,
        summary: note.highlightText || note.thought || `第${note.pageNumber}页笔记`,
        tags: note.tags,
        x: 20 + Math.random() * 300,
        y: 20 + Math.random() * 200,
      };
      existing.push(newCard);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      alert('已添加到灵感板！');
    } catch {
      alert('添加失败');
    }
  };

  if (loading) {
    return (
      <div className="main-content">
        <SkeletonGrid />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="main-content">
        <div className="empty-state">
          <div className="empty-state-icon">😕</div>
          <div className="empty-state-text">书籍未找到</div>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 16 }}>
            返回书架
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      <Link to="/" className="back-link">
        ← 返回书架
      </Link>

      <div className="detail-header">
        {book.coverUrl ? (
          <img className="detail-cover" src={book.coverUrl} alt={book.title} />
        ) : (
          <div className="detail-cover-placeholder">📖</div>
        )}
        <div className="detail-info">
          <h1 className="detail-title">{book.title}</h1>
          <p className="detail-author">{book.author}</p>
          <p className="detail-year">
            {book.publishYear ? `${book.publishYear} 年出版` : ''}
          </p>

          <div className="progress-section">
            <div className="progress-label">阅读进度：{book.progress}%</div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${book.progress}%` }} />
            </div>
            <div className="progress-input">
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={book.progress}
                onBlur={(e) => handleProgressUpdate(parseInt(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleProgressUpdate(
                      parseInt((e.target as HTMLInputElement).value) || 0
                    );
                  }
                }}
              />
              <span>%</span>
            </div>
          </div>

          <div className="detail-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              + 添加笔记
            </button>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="note-form">
          <h3 className="note-form-title">
            {editingNote ? '编辑笔记' : '添加新笔记'}
          </h3>

          <div className="note-form-row">
            <label className="note-form-label">页码</label>
            <input
              className="note-form-input"
              type="number"
              placeholder="页码"
              value={formData.pageNumber}
              onChange={(e) => setFormData({ ...formData, pageNumber: e.target.value })}
            />
          </div>

          <div className="note-form-row">
            <label className="note-form-label">高亮文本</label>
            <textarea
              className="note-form-textarea"
              placeholder="摘录书中的精彩内容..."
              value={formData.highlightText}
              onChange={(e) => setFormData({ ...formData, highlightText: e.target.value })}
            />
          </div>

          <div className="note-form-row">
            <label className="note-form-label">个人感想</label>
            <textarea
              className="note-form-textarea"
              placeholder="写下你的思考和感悟..."
              value={formData.thought}
              onChange={(e) => setFormData({ ...formData, thought: e.target.value })}
            />
          </div>

          <div className="note-form-row">
            <label className="note-form-label">标签</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="note-form-input"
                style={{ flex: 1 }}
                type="text"
                placeholder="输入标签后回车添加"
                value={formData.tagsInput}
                onChange={(e) => setFormData({ ...formData, tagsInput: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <button className="btn btn-sm btn-secondary" onClick={handleAddTag}>
                添加
              </button>
            </div>
            {formTags.length > 0 && (
              <div className="note-form-tags" style={{ marginTop: 8 }}>
                {formTags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <span
                      className="tag-chip-remove"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      ×
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="note-form-actions">
            <button className="btn btn-primary" onClick={handleSubmitNote}>
              {editingNote ? '保存修改' : '添加笔记'}
            </button>
            <button className="btn btn-secondary" onClick={resetForm}>
              取消
            </button>
          </div>
        </div>
      )}

      <div>
        <h2 className="section-title">笔记 ({notes.length})</h2>
        <NoteList
          notes={notes}
          onEdit={openEditForm}
          onDelete={handleDeleteNote}
          onAddToBoard={handleAddToBoard}
        />
      </div>
    </div>
  );
};

const InspirationPage: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [books, setBooks] = useState<Book[]>([]);

  useEffect(() => {
    Promise.all([axios.get<Note[]>('/api/notes'), axios.get<Book[]>('/api/books')]).then(
      ([notesRes, booksRes]) => {
        setNotes(notesRes.data);
        setBooks(booksRes.data);
      }
    );
  }, []);

  return (
    <div className="main-content">
      <h1 className="section-title">💡 灵感板</h1>
      <InspirationBoard notes={notes} books={books} onRemoveCard={() => {}} />
      <p
        style={{
          marginTop: 16,
          fontSize: 13,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        拖拽卡片来重新排列你的灵感 · 布局自动保存
      </p>
    </div>
  );
};

const ExportModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [files, setFiles] = useState<{ filename: string; content: string }[]>([]);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get('/api/export')
      .then((res) => {
        setFiles(res.data.files);
        setPreview(res.data.markdown);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleDownload = () => {
    files.forEach((file) => {
      const blob = new Blob([file.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">导出笔记为 Markdown</h2>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            生成预览中...
          </div>
        ) : files.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            暂无笔记可导出
          </div>
        ) : (
          <>
            <div
              style={{
                marginBottom: 12,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              预览（共 {files.length} 本书籍）：
            </div>
            <div className="modal-preview">{preview}</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: 8,
                marginBottom: 16,
              }}
            >
              下载后将按书籍分组生成文件，文件名格式：书名_作者.md
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleDownload}>
                确认导出
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [showExport, setShowExport] = useState(false);

  return (
    <BrowserRouter>
      <NavBar onExport={() => setShowExport(true)} />
      <Routes>
        <Route path="/" element={<BookShelfPage />} />
        <Route path="/book/:id" element={<BookDetailPage />} />
        <Route path="/inspiration" element={<InspirationPage />} />
      </Routes>
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </BrowserRouter>
  );
};

export default App;
