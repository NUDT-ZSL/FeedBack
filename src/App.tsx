import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Idea, IdeaStatus, Tag, KanbanColumn, TagLogic, TAG_COLORS } from './utils/types';
import { db } from './utils/db';
import IdeaCard from './components/IdeaCard';
import KanbanBoard from './components/KanbanBoard';

type ViewMode = 'grid' | 'kanban';

const App: React.FC = () => {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [view, setView] = useState<ViewMode>('grid');
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterPriority, setFilterPriority] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<IdeaStatus | ''>('');
  const [tagLogic, setTagLogic] = useState<TagLogic>('or');
  const [editingIdea, setEditingIdea] = useState<Idea | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 30 });

  useEffect(() => {
    (async () => {
      await db.initDefaults();
      const [loadedIdeas, loadedTags, loadedCols] = await Promise.all([
        db.getAllIdeas(),
        db.getAllTags(),
        db.getAllColumns(),
      ]);
      setIdeas(loadedIdeas);
      setTags(loadedTags);
      setColumns(loadedCols);
    })();
  }, []);

  const filteredIdeas = useMemo(() => {
    let result = ideas;

    if (search.trim()) {
      const kw = search.toLowerCase();
      result = result.filter(
        (i) => i.title.toLowerCase().includes(kw) || i.description.toLowerCase().includes(kw),
      );
    }

    if (filterTags.length > 0) {
      if (tagLogic === 'and') {
        result = result.filter((i) => filterTags.every((ft) => i.tags.includes(ft)));
      } else {
        result = result.filter((i) => filterTags.some((ft) => i.tags.includes(ft)));
      }
    }

    if (filterPriority > 0) {
      result = result.filter((i) => i.priority >= filterPriority);
    }

    if (filterStatus) {
      result = result.filter((i) => i.status === filterStatus);
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [ideas, search, filterTags, tagLogic, filterPriority, filterStatus]);

  const handleScroll = useCallback(() => {
    if (!gridRef.current) return;
    const scrollTop = gridRef.current.scrollTop;
    const rowHeight = 280;
    const start = Math.floor(scrollTop / rowHeight) * 2;
    const end = start + 30;
    setVisibleRange({ start: Math.max(0, start), end: Math.min(filteredIdeas.length, end) });
  }, [filteredIdeas.length]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const saveIdea = useCallback(async (idea: Idea) => {
    await db.saveIdea(idea);
    setIdeas((prev) => {
      const idx = prev.findIndex((i) => i.id === idea.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = idea;
        return next;
      }
      return [...prev, idea];
    });
  }, []);

  const deleteIdea = useCallback(async (id: string) => {
    await db.deleteIdea(id);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const handleNewIdea = () => {
    const idea: Idea = {
      id: uuidv4(),
      title: '',
      description: '',
      imageUrl: '',
      tags: [],
      priority: 3,
      status: 'draft',
      columnId: columns.length > 0 ? columns[0].id : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setEditingIdea(idea);
    setIsModalOpen(true);
  };

  const handleCardClick = (idea: Idea) => {
    setEditingIdea({ ...idea });
    setIsModalOpen(true);
  };

  const handleModalSave = () => {
    if (!editingIdea) return;
    const updated = { ...editingIdea, updatedAt: Date.now() };
    saveIdea(updated);
    setIsModalOpen(false);
    setEditingIdea(null);
  };

  const handleModalDelete = () => {
    if (!editingIdea) return;
    deleteIdea(editingIdea.id);
    setIsModalOpen(false);
    setEditingIdea(null);
  };

  const handleAddTag = async (name: string) => {
    const tag: Tag = {
      id: uuidv4(),
      name,
      color: TAG_COLORS[tags.length % TAG_COLORS.length],
    };
    await db.saveTag(tag);
    setTags((prev) => [...prev, tag]);
    return tag;
  };

  const handleDeleteTag = async (id: string) => {
    await db.deleteTag(id);
    setTags((prev) => prev.filter((t) => t.id !== id));
    setFilterTags((prev) => prev.filter((t) => t !== id));
  };

  const handleAddColumn = async (name: string) => {
    const col: KanbanColumn = {
      id: uuidv4(),
      name,
      order: columns.length,
    };
    await db.saveColumn(col);
    setColumns((prev) => [...prev, col]);
  };

  const handleDeleteColumn = async (id: string) => {
    await db.deleteColumn(id);
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const handleMoveIdea = async (ideaId: string, columnId: string) => {
    const idea = ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    const updated = { ...idea, columnId, updatedAt: Date.now() };
    await saveIdea(updated);
  };

  const toggleFilterTag = (tagId: string) => {
    setFilterTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  };

  const [newTagName, setNewTagName] = useState('');

  const handleCreateAndSelectTag = async () => {
    if (!newTagName.trim()) return;
    const tag = await handleAddTag(newTagName.trim());
    setNewTagName('');
    if (editingIdea) {
      setEditingIdea({ ...editingIdea, tags: [...editingIdea.tags, tag.id] });
    }
  };

  const visibleIdeas = filteredIdeas.slice(visibleRange.start, visibleRange.end);

  return (
    <div className="app-layout">
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-logo">
          <span className="logo-icon">💡</span>
          {sidebarOpen && <span className="logo-text">IdeaVault</span>}
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-btn ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} title="灵感库">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            {sidebarOpen && <span>灵感库</span>}
          </button>
          <button className={`nav-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')} title="看板">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="18"/><rect x="13" y="3" width="6" height="12"/></svg>
            {sidebarOpen && <span>看板</span>}
          </button>
          <button className="nav-btn add-btn" onClick={handleNewIdea} title="新建灵感">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {sidebarOpen && <span>新建灵感</span>}
          </button>
        </nav>
        <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '◀' : '▶'}
        </button>
      </aside>

      <main className="main-content">
        <div className="toolbar">
          <div className="search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              placeholder="搜索灵感..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filters">
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as IdeaStatus | '')}>
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="in-progress">进行中</option>
              <option value="completed">已完成</option>
            </select>
            <select value={filterPriority} onChange={(e) => setFilterPriority(Number(e.target.value))}>
              <option value={0}>全部优先级</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{'★'.repeat(n)} 及以上</option>
              ))}
            </select>
            <div className="tag-filter-group">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  className={`tag-filter-btn ${filterTags.includes(tag.id) ? 'active' : ''}`}
                  style={{
                    borderColor: tag.color,
                    backgroundColor: filterTags.includes(tag.id) ? tag.color + '30' : 'transparent',
                    color: tag.color,
                  }}
                  onClick={() => toggleFilterTag(tag.id)}
                >
                  {tag.name}
                </button>
              ))}
              {tags.length > 0 && (
                <button
                  className={`tag-logic-btn ${tagLogic === 'and' ? 'and' : ''}`}
                  onClick={() => setTagLogic(tagLogic === 'and' ? 'or' : 'and')}
                >
                  {tagLogic === 'and' ? '与' : '或'}
                </button>
              )}
            </div>
          </div>
        </div>

        {view === 'grid' ? (
          <div className="idea-grid" ref={gridRef} onScroll={handleScroll}>
            {filteredIdeas.length === 0 && (
              <div className="empty-state">
                <p>还没有灵感，点击"新建灵感"开始创建吧！</p>
              </div>
            )}
            {filteredIdeas.length > 200 ? (
              <div className="idea-grid-inner" style={{ height: Math.ceil(filteredIdeas.length / 2) * 280 }}>
                {visibleIdeas.map((idea, idx) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    tags={tags}
                    onClick={handleCardClick}
                    style={{
                      position: 'absolute',
                      top: Math.floor((visibleRange.start + idx) / 2) * 280,
                      left: (visibleRange.start + idx) % 2 === 0 ? 0 : '50%',
                      width: 'calc(50% - 12px)',
                      animation: 'fadeInUp 300ms ease-out',
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="idea-grid-inner">
                {filteredIdeas.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} tags={tags} onClick={handleCardClick} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <KanbanBoard
            ideas={filteredIdeas}
            columns={columns}
            tags={tags}
            onIdeaClick={handleCardClick}
            onAddColumn={handleAddColumn}
            onDeleteColumn={handleDeleteColumn}
            onMoveIdea={handleMoveIdea}
          />
        )}
      </main>

      {isModalOpen && editingIdea && (
        <div className="modal-overlay" onClick={() => { setIsModalOpen(false); setEditingIdea(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>编辑灵感</h2>
              <button className="modal-close" onClick={() => { setIsModalOpen(false); setEditingIdea(null); }}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>标题</label>
                <input
                  type="text"
                  value={editingIdea.title}
                  onChange={(e) => setEditingIdea({ ...editingIdea, title: e.target.value })}
                  placeholder="灵感标题"
                />
              </div>
              <div className="form-group">
                <label>详细描述（支持Markdown）</label>
                <textarea
                  value={editingIdea.description}
                  onChange={(e) => setEditingIdea({ ...editingIdea, description: e.target.value })}
                  placeholder="详细描述你的灵感..."
                  rows={8}
                />
              </div>
              <div className="form-group">
                <label>图片URL</label>
                <input
                  type="text"
                  value={editingIdea.imageUrl}
                  onChange={(e) => setEditingIdea({ ...editingIdea, imageUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div className="form-group">
                <label>标签</label>
                <div className="tag-editor">
                  {tags.map((tag) => (
                    <div key={tag.id} className="tag-editor-item">
                      <label className="tag-editor-checkbox">
                        <input
                          type="checkbox"
                          checked={editingIdea.tags.includes(tag.id)}
                          onChange={() => {
                            const newTags = editingIdea.tags.includes(tag.id)
                              ? editingIdea.tags.filter((t) => t !== tag.id)
                              : [...editingIdea.tags, tag.id];
                            setEditingIdea({ ...editingIdea, tags: newTags });
                          }}
                        />
                        <span style={{ color: tag.color }}>{tag.name}</span>
                      </label>
                      <button className="tag-delete-btn" onClick={() => handleDeleteTag(tag.id)} title="删除标签">×</button>
                    </div>
                  ))}
                  <div className="tag-add-row">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="新标签名"
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateAndSelectTag()}
                    />
                    <button onClick={handleCreateAndSelectTag}>添加标签</button>
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>优先级</label>
                  <div className="star-rating">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={n <= editingIdea.priority ? 'star filled' : 'star'}
                        onClick={() => setEditingIdea({ ...editingIdea, priority: n })}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>状态</label>
                  <select
                    value={editingIdea.status}
                    onChange={(e) =>
                      setEditingIdea({ ...editingIdea, status: e.target.value as IdeaStatus })
                    }
                  >
                    <option value="draft">草稿</option>
                    <option value="in-progress">进行中</option>
                    <option value="completed">已完成</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-delete" onClick={handleModalDelete}>
                删除
              </button>
              <button className="btn-save" onClick={handleModalSave}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
