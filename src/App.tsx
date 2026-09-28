import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore, getCurrentPage } from './store';
import Toolbar from './components/Toolbar';
import Canvas from './components/Canvas';
import PrototypePreview from './components/PrototypePreview';
import CommentPanel from './components/CommentPanel';
import type { ComponentType } from './types';

const App: React.FC = () => {
  const {
    pages,
    currentPageId,
    viewMode,
    isCommentPanelOpen,
    selectedComponentId,
    addPage,
    setCurrentPage,
    deletePage,
    setViewMode,
    toggleCommentPanel,
    undo,
    redo,
  } = useAppStore();

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [bottomTab, setBottomTab] = useState<'canvas' | 'comments'>('canvas');

  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z')
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setViewMode(viewMode === 'preview' ? 'edit' : 'preview');
        return;
      }
      if (e.key === 'Escape') {
        if (viewMode === 'preview') {
          setViewMode('edit');
        }
        if (isCommentPanelOpen) {
          toggleCommentPanel(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, isCommentPanelOpen, undo, redo, setViewMode, toggleCommentPanel]);

  const handleToolbarDragStart = useCallback((type: ComponentType) => {
    // Custom event to add component via click
    const event = new CustomEvent('tool:add-component', { detail: type });
    window.dispatchEvent(event);
  }, []);

  const isSmall = windowWidth < 1280;
  const isMobile = windowWidth < 1024;

  const currentPageName =
    pages.find((p) => p.id === currentPageId)?.name || 'Page 1';

  const showBottomComment = isSmall && selectedComponentId && bottomTab === 'comments';

  return (
    <div className="app-container">
      {/* Page Tabs */}
      <div className="page-tabs">
        {pages.map((page) => (
          <button
            key={page.id}
            className={`page-tab ${page.id === currentPageId ? 'active' : ''}`}
            onClick={() => setCurrentPage(page.id)}
          >
            <span>{page.name}</span>
            {pages.length > 1 && (
              <span
                className="page-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`删除 ${page.name}？`)) {
                    deletePage(page.id);
                  }
                }}
              >
                ✕
              </span>
            )}
          </button>
        ))}
        <button
          className="add-page-btn"
          onClick={addPage}
          disabled={pages.length >= 10}
          title={pages.length >= 10 ? '最多 10 个页面' : '新建页面'}
        >
          +
        </button>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingRight: 12,
            fontSize: 12,
            color: 'var(--text-light)',
          }}
        >
          {viewMode === 'edit' && (
            <span style={{ opacity: 0.7 }}>
              💡 拖拽组件到画布，或点击组件即可添加
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        {viewMode === 'edit' && !isMobile && (
          <Toolbar onDragStartComponent={handleToolbarDragStart} />
        )}

        {viewMode === 'edit' && isMobile && (
          <Toolbar onDragStartComponent={handleToolbarDragStart} />
        )}

        {viewMode === 'edit' ? <Canvas /> : <PrototypePreview />}

        {/* Side Comment Panel */}
        {!isSmall && viewMode === 'edit' && (
          <CommentPanel
            isOpen={isCommentPanelOpen && !!selectedComponentId}
            onClose={() => toggleCommentPanel(false)}
            variant="side"
          />
        )}

        {/* Bottom Comment Panel (for small screens) */}
        {isSmall && viewMode === 'edit' && (
          <CommentPanel
            isOpen={showBottomComment}
            onClose={() => setBottomTab('canvas')}
            variant="bottom"
          />
        )}
      </div>

      {/* Bottom Tab Bar for small screens */}
      {isSmall && viewMode === 'edit' && (
        <div className="bottom-tab-bar">
          <button
            className={`bottom-tab-btn ${bottomTab === 'canvas' ? 'active' : ''}`}
            onClick={() => setBottomTab('canvas')}
          >
            🎨 画布
          </button>
          <button
            className={`bottom-tab-btn ${bottomTab === 'comments' ? 'active' : ''}`}
            onClick={() => {
              if (!selectedComponentId) {
                alert('请先在画布上选择一个组件');
                return;
              }
              setBottomTab('comments');
            }}
          >
            💬 评论{selectedComponentId ? '' : ''}
          </button>
        </div>
      )}

      {/* Preview mode - override fullscreen indicator already in PrototypePreview */}
    </div>
  );
};

export default App;
