import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, LogOut, User, FileText, Menu, X, Loader2, AlertCircle, Folder } from 'lucide-react';
import DirectoryTree, { TreeNode } from '../components/DirectoryTree';
import { withErrorBoundary } from '../components/withErrorBoundary';

interface Document {
  id: string;
  title: string;
  content: string;
  directoryId: string | null;
  updatedAt: string;
  version: number;
}

interface UserInfo {
  id: string;
  username: string;
}

const API_BASE = 'http://localhost:3001';

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
};

const truncate = (text: string, len: number): string => {
  const plain = text.replace(/[#*`>\[\]()_~\-!]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > len ? plain.slice(0, len) + '...' : plain;
};

const highlightText = (text: string, keyword: string): React.ReactNode => {
  if (!keyword.trim()) return text;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} style={{ background: '#fff3cd', padding: '0 2px', borderRadius: 2 }}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
};

const collectFileIds = (nodes: TreeNode[]): string[] => {
  const ids: string[] = [];
  const walk = (arr: TreeNode[]) => {
    for (const n of arr) {
      if (n.type === 'file') ids.push(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
};

const Workspace: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [selectedDirName, setSelectedDirName] = useState<string>('全部文档');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Document[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDocModalOpen, setNewDocModalOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        setUser(null);
      }
    }
  }, []);

  const fetchTree = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/directories/tree`, { headers: getAuthHeaders() });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) throw new Error('获取目录树失败');
      const data = await res.json();
      setTreeData(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const fetchDocuments = async (directoryId: string | null) => {
    setDocsLoading(true);
    setError(null);
    try {
      const url = directoryId
        ? `${API_BASE}/documents?directoryId=${encodeURIComponent(directoryId)}`
        : `${API_BASE}/documents`;
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) throw new Error('获取文档列表失败');
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
    fetchDocuments(null);
  }, []);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timer = setTimeout(() => {
        performSearch(searchQuery.trim());
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setSearchResults(null);
    }
  }, [searchQuery]);

  const performSearch = async (q: string) => {
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) throw new Error('搜索失败');
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (e) {
      setSearchResults([]);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  };

  const handleSelectNode = (node: TreeNode) => {
    setSidebarOpen(false);
    if (node.type === 'folder') {
      setSelectedDir(node.id);
      setSelectedDirName(node.name);
      fetchDocuments(node.id);
    } else {
      navigate(`/editor/${node.id}`);
    }
  };

  const handleShowAll = () => {
    setSelectedDir(null);
    setSelectedDirName('全部文档');
    fetchDocuments(null);
    setSidebarOpen(false);
  };

  const handleCreateDocument = async () => {
    if (!newDocTitle.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          title: newDocTitle.trim(),
          directoryId: selectedDir,
          content: '',
          version: 1,
        }),
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) throw new Error('创建文档失败');
      const doc = await res.json();
      setNewDocModalOpen(false);
      setNewDocTitle('');
      fetchTree();
      fetchDocuments(selectedDir);
      navigate(`/editor/${doc.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNode = (parentId: string | null, type: 'folder' | 'file') => {
    if (type === 'file') {
      if (parentId) {
        setSelectedDir(parentId);
      }
      setNewDocModalOpen(true);
    }
  };

  const displayedDocs = useMemo(() => {
    if (searchResults !== null) {
      return searchResults;
    }
    if (!selectedDir) {
      const fileIds = new Set(collectFileIds(treeData));
      return documents.filter((d) => fileIds.has(d.id));
    }
    return documents.filter((d) => d.directoryId === selectedDir);
  }, [searchResults, documents, selectedDir, treeData]);

  return (
    <div className="workspace-layout">
      <div
        className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSidebarOpen(false);
        }}
      >
        <aside className="sidebar-panel">
          <div className="sidebar-close-btn" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </div>
          <DirectoryTree
            data={treeData}
            onSelect={handleSelectNode}
            onAdd={handleAddNode}
            selectedId={selectedDir}
          />
        </aside>
      </div>

      <main className="main-content">
        <header className="workspace-header">
          <div className="header-left">
            <button className="menu-toggle" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="welcome-info">
              <div className="welcome-avatar">
                <User size={18} />
              </div>
              <div>
                <div className="welcome-greeting">
                  {new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}，
                </div>
                <div className="welcome-username">{user?.username ?? '用户'}</div>
              </div>
            </div>
          </div>

          <div className="header-center">
            <div className="header-search-wrapper">
              <Search size={18} className="header-search-icon" />
              <input
                type="text"
                className="header-search-input"
                placeholder="搜索文档标题或内容..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="header-search-clear" onClick={() => setSearchQuery('')}>
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="header-right">
            <button className="btn-new-doc" onClick={() => setNewDocModalOpen(true)}>
              <Plus size={18} />
              <span>新建文档</span>
            </button>
            <button className="btn-logout" onClick={handleLogout} title="退出登录">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="content-subheader">
          <button
            className={`crumb-btn ${!selectedDir && !searchQuery.trim() ? 'active' : ''}`}
            onClick={handleShowAll}
          >
            <Folder size={14} />
            <span>全部文档</span>
          </button>
          {searchResults === null && selectedDirName !== '全部文档' && (
            <>
              <span className="crumb-sep">/</span>
              <span className="crumb-current">
                <Folder size={14} />
                {selectedDirName}
              </span>
            </>
          )}
          <span className="doc-count">{displayedDocs.length} 个文档</span>
        </div>

        <section className="content-body">
          {error && (
            <div className="error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button onClick={() => setError(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          {loading || docsLoading ? (
            <div className="center-loading">
              <Loader2 size={32} className="spinner" />
              <p>加载中...</p>
            </div>
          ) : displayedDocs.length === 0 ? (
            <div className="empty-placeholder">
              <div className="empty-icon">
                <FileText size={48} />
              </div>
              <h3>{searchQuery.trim() ? '没有找到匹配的文档' : '这里还没有文档'}</h3>
              <p>
                {searchQuery.trim()
                  ? '尝试使用其他关键词搜索'
                  : '点击右上角"新建文档"开始创作吧'}
              </p>
              {!searchQuery.trim() && (
                <button className="btn-new-doc-empty" onClick={() => setNewDocModalOpen(true)}>
                  <Plus size={16} />
                  新建文档
                </button>
              )}
            </div>
          ) : (
            <div className="card-grid">
              {displayedDocs.map((doc) => (
                <article
                  key={doc.id}
                  className="doc-card"
                  onClick={() => navigate(`/editor/${doc.id}`)}
                >
                  <div className="doc-card-icon">
                    <FileText size={20} />
                  </div>
                  <h3 className="doc-card-title">
                    {highlightText(doc.title, searchQuery.trim())}
                  </h3>
                  <p className="doc-card-desc">
                    {highlightText(truncate(doc.content, 100) || '暂无内容', searchQuery.trim())}
                  </p>
                  <footer className="doc-card-meta">
                    <span className="meta-time">
                      {formatDate(doc.updatedAt)}
                    </span>
                    <span className="meta-version">v{doc.version}</span>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {newDocModalOpen && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget && !submitting) {
            setNewDocModalOpen(false);
            setNewDocTitle('');
          }
        }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">新建文档</h2>
            <p className="modal-subtitle">
              将创建于：<strong>{selectedDirName}</strong>
            </p>
            <input
              type="text"
              className="modal-input"
              placeholder="请输入文档标题..."
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateDocument();
                if (e.key === 'Escape' && !submitting) {
                  setNewDocModalOpen(false);
                  setNewDocTitle('');
                }
              }}
              autoFocus
              disabled={submitting}
            />
            <div className="modal-actions">
              <button
                className="modal-btn cancel"
                onClick={() => {
                  setNewDocModalOpen(false);
                  setNewDocTitle('');
                }}
                disabled={submitting}
              >
                取消
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleCreateDocument}
                disabled={submitting || !newDocTitle.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    创建中...
                  </>
                ) : (
                  '创建'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .sidebar-wrapper {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 90;
          pointer-events: none;
          background: transparent;
          transition: background 0.3s ease;
        }
        .sidebar-wrapper.open {
          pointer-events: auto;
          background: rgba(0, 0, 0, 0.4);
        }
        .sidebar-panel {
          width: 280px;
          height: 100%;
          transform: translateX(-100%);
          transition: transform 0.3s ease;
          position: relative;
        }
        .sidebar-wrapper.open .sidebar-panel {
          transform: translateX(0);
        }
        .sidebar-close-btn {
          position: absolute;
          top: 12px;
          right: 12px;
          z-index: 10;
          width: 28px;
          height: 28px;
          display: none;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.7);
          border-radius: 6px;
          transition: all 0.2s;
        }
        .sidebar-close-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .workspace-header {
          height: 64px;
          padding: 0 24px;
          display: flex;
          align-items: center;
          gap: 24px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-shrink: 0;
        }
        .menu-toggle {
          display: none;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          color: var(--text-secondary);
          transition: all 0.2s;
        }
        .menu-toggle:hover {
          background: #f0f3f6;
          color: var(--text-primary);
        }
        .welcome-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .welcome-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--primary-gradient);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
        }
        .welcome-greeting {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.2;
        }
        .welcome-username {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          line-height: 1.3;
        }

        .header-center {
          flex: 1;
          max-width: 520px;
          margin: 0 auto;
        }
        .header-search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        .header-search-icon {
          position: absolute;
          left: 14px;
          color: var(--text-secondary);
          pointer-events: none;
        }
        .header-search-input {
          width: 100%;
          height: 42px;
          padding: 0 42px 0 44px;
          background: #f5f7fa;
          border: 1.5px solid transparent;
          border-radius: 10px;
          font-size: 14px;
          color: var(--text-primary);
          transition: all 0.2s;
        }
        .header-search-input::placeholder {
          color: var(--text-secondary);
        }
        .header-search-input:focus {
          background: #fff;
          border-color: var(--primary-start);
          box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.12);
        }
        .header-search-clear {
          position: absolute;
          right: 8px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          border-radius: 6px;
          transition: all 0.2s;
        }
        .header-search-clear:hover {
          background: #e8ecf1;
          color: var(--text-primary);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .btn-new-doc {
          height: 42px;
          padding: 0 18px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--primary-gradient);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
          transition: all 0.25s;
        }
        .btn-new-doc:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(52, 152, 219, 0.4);
        }
        .btn-new-doc:active {
          transform: translateY(0);
        }
        .btn-logout {
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          color: var(--text-secondary);
          transition: all 0.2s;
        }
        .btn-logout:hover {
          background: #fef0f0;
          color: #e74c3c;
        }

        .content-subheader {
          padding: 12px 24px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-color);
          flex-shrink: 0;
        }
        .crumb-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 13px;
          color: var(--text-secondary);
          transition: all 0.2s;
        }
        .crumb-btn:hover {
          background: #f0f3f6;
          color: var(--text-primary);
        }
        .crumb-btn.active {
          background: rgba(52, 152, 219, 0.08);
          color: var(--primary-start);
          font-weight: 600;
        }
        .crumb-sep {
          color: var(--border-color);
          font-weight: 700;
        }
        .crumb-current {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 600;
        }
        .doc-count {
          margin-left: auto;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .error-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          margin-bottom: 20px;
          background: #fef0f0;
          border: 1px solid #fecaca;
          border-radius: 10px;
          color: #c0392b;
          font-size: 13px;
        }
        .error-banner button {
          margin-left: auto;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          color: inherit;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .error-banner button:hover {
          opacity: 1;
        }

        .center-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 80px 20px;
          color: var(--text-secondary);
        }
        .spinner {
          animation: spin 1s linear infinite;
          color: var(--primary-start);
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .empty-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 20px;
          text-align: center;
        }
        .empty-icon {
          width: 88px;
          height: 88px;
          margin-bottom: 24px;
          border-radius: 50%;
          background: #f0f3f6;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .empty-placeholder h3 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 8px;
        }
        .empty-placeholder p {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 24px;
        }
        .btn-new-doc-empty {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 40px;
          padding: 0 18px;
          background: var(--primary-gradient);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          border-radius: 10px;
          box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
          transition: all 0.25s;
        }
        .btn-new-doc-empty:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(52, 152, 219, 0.4);
        }

        .doc-card {
          background: var(--bg-card);
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
          border: 1px solid transparent;
          display: flex;
          flex-direction: column;
          min-height: 180px;
        }
        .doc-card:hover {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
          border-color: rgba(52, 152, 219, 0.2);
        }
        .doc-card-icon {
          width: 40px;
          height: 40px;
          margin-bottom: 14px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(52, 152, 219, 0.1) 0%, rgba(26, 188, 156, 0.1) 100%);
          color: var(--primary-start);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .doc-card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 10px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-all;
        }
        .doc-card-desc {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
          margin-bottom: auto;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          word-break: break-all;
        }
        .doc-card-meta {
          margin-top: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 12px;
          border-top: 1px solid #f0f3f6;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .meta-time {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .meta-version {
          padding: 2px 8px;
          background: #f5f7fa;
          border-radius: 4px;
          font-weight: 500;
          font-size: 11px;
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .modal-card {
          width: 100%;
          max-width: 420px;
          background: var(--bg-card);
          border-radius: 16px;
          padding: 28px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
          animation: scaleIn 0.2s ease;
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .modal-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 6px;
        }
        .modal-subtitle {
          font-size: 13px;
          color: var(--text-secondary);
          margin-bottom: 20px;
        }
        .modal-subtitle strong {
          color: var(--primary-start);
        }
        .modal-input {
          width: 100%;
          height: 46px;
          padding: 0 16px;
          background: #f5f7fa;
          border: 1.5px solid var(--border-color);
          border-radius: 10px;
          font-size: 14px;
          color: var(--text-primary);
          margin-bottom: 24px;
          transition: all 0.2s;
        }
        .modal-input::placeholder {
          color: var(--text-secondary);
        }
        .modal-input:focus {
          background: #fff;
          border-color: var(--primary-start);
          box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.12);
        }
        .modal-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        .modal-btn {
          height: 42px;
          padding: 0 22px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .modal-btn.cancel {
          background: #f5f7fa;
          color: var(--text-primary);
        }
        .modal-btn.cancel:hover:not(:disabled) {
          background: #e8ecf1;
        }
        .modal-btn.confirm {
          background: var(--primary-gradient);
          color: #fff;
          box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
        }
        .modal-btn.confirm:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(52, 152, 219, 0.4);
        }
        .modal-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none !important;
        }

        @media (max-width: 768px) {
          .sidebar-wrapper {
            display: block;
          }
          .sidebar-close-btn {
            display: flex;
          }
          .menu-toggle {
            display: flex;
          }
          .workspace-header {
            height: auto;
            padding: 12px 16px;
            flex-wrap: wrap;
            gap: 12px;
          }
          .header-left {
            order: 1;
          }
          .header-right {
            order: 2;
            margin-left: auto;
          }
          .header-center {
            order: 3;
            max-width: none;
            width: 100%;
          }
          .welcome-info .welcome-greeting {
            display: none;
          }
          .welcome-avatar {
            width: 36px;
            height: 36px;
          }
          .btn-new-doc span {
            display: none;
          }
          .btn-new-doc {
            padding: 0 10px;
          }
          .content-subheader {
            padding: 10px 16px;
          }
          .content-body {
            padding: 16px;
          }
          .card-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .modal-card {
            padding: 20px;
          }
        }
      `}</style>
    </div>
  );
};

export default withErrorBoundary(Workspace);
