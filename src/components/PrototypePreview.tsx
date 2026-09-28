import React, { useCallback } from 'react';
import { useAppStore, getCurrentPage } from '../store';
import type { UIComponent } from '../types';

interface ComponentRendererProps {
  component: UIComponent;
  onClick?: () => void;
  isClickable?: boolean;
}

const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  onClick,
  isClickable,
}) => {
  const { position, size, type, text, backgroundColor, icon } = component;

  const style: React.CSSProperties = {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
    background: backgroundColor,
  };

  const clickableClass = isClickable ? 'preview-clickable' : '';

  switch (type) {
    case 'button':
      return (
        <div
          className={`canvas-preview-component comp-type-button ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text}
        </div>
      );
    case 'input':
      return (
        <div
          className={`canvas-preview-component comp-type-input ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text}
        </div>
      );
    case 'navbar':
      return (
        <div
          className={`canvas-preview-component comp-type-navbar ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text.split(/\s{2,}/).map((item, i) => (
            <span key={i} style={{ opacity: i === 0 ? 1 : 0.8 }}>
              {item}
            </span>
          ))}
        </div>
      );
    case 'list':
      return (
        <div
          className={`canvas-preview-component comp-type-list ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text.split('\n').map((line, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                padding: '4px 0',
                borderBottom: i < text.split('\n').length - 1 ? '1px solid var(--grid)' : 'none',
                width: '100%',
              }}
            >
              • {line}
            </div>
          ))}
        </div>
      );
    case 'image':
      return (
        <div
          className={`canvas-preview-component comp-type-image ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {icon || '🖼️'}
        </div>
      );
    case 'text':
      return (
        <div
          className={`canvas-preview-component comp-type-text ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text}
        </div>
      );
    case 'card': {
      const lines = text.split('\n');
      return (
        <div
          className={`canvas-preview-component comp-type-card ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          <div className="card-title">{lines[0] || ''}</div>
          <div className="card-desc">{lines.slice(1).join(' ')}</div>
        </div>
      );
    }
    case 'checkbox':
      return (
        <div
          className={`canvas-preview-component comp-type-checkbox ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          <div className="checkbox-box" />
          {text}
        </div>
      );
    case 'dropdown':
      return (
        <div
          className={`canvas-preview-component comp-type-dropdown ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          <span>{text.replace('▼', '').trim()}</span>
          <span style={{ fontSize: 16 }}>▼</span>
        </div>
      );
    default:
      return (
        <div
          className={`canvas-preview-component ${clickableClass}`}
          style={style}
          onClick={onClick}
        >
          {text}
        </div>
      );
  }
};

const PrototypePreview: React.FC = () => {
  const { pages, currentPageId, setCurrentPage, setViewMode } = useAppStore();
  const currentPage = pages.find((p) => p.id === currentPageId) || pages[0];

  const clickableMap = new Map<string, string>();
  currentPage.connections.forEach((conn) => {
    clickableMap.set(conn.fromComponentId, conn.toComponentId);
  });

  // Check for cross-page connections
  const crossPageConnections = new Map<string, string>();
  pages.forEach((p) => {
    p.connections.forEach((conn) => {
      if (conn.fromPageId !== conn.toPageId) {
        if (conn.fromPageId === currentPageId) {
          crossPageConnections.set(conn.fromComponentId, conn.toPageId);
        }
      }
    });
  });

  const handleComponentClick = useCallback(
    (comp: UIComponent) => {
      // Check cross-page first
      const targetPageId = crossPageConnections.get(comp.id);
      if (targetPageId) {
        setCurrentPage(targetPageId);
        return;
      }
      // Same-page: try to scroll to target (visual cue)
      const targetCompId = clickableMap.get(comp.id);
      if (targetCompId) {
        const target = document.querySelector(`[data-comp-id="${targetCompId}"]`);
        if (target) {
          (target as HTMLElement).style.animation = 'none';
          // eslint-disable-next-line no-unused-expressions
          (target as HTMLElement).offsetHeight;
          (target as HTMLElement).style.animation =
            'placeBounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
          (target as HTMLElement).scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }
      }
    },
    [clickableMap, crossPageConnections, setCurrentPage]
  );

  return (
    <div className="canvas-wrapper">
      <div className="canvas preview-mode" style={{ minHeight: '100vh' }}>
        <div className="preview-page-indicator">
          📄 {currentPage.name}
          <button className="exit-preview-btn" onClick={() => setViewMode('edit')}>
            退出预览
          </button>
        </div>
        {currentPage.components.map((comp) => {
          const isClickable =
            clickableMap.has(comp.id) || crossPageConnections.has(comp.id);
          return (
            <div
              key={comp.id}
              data-comp-id={comp.id}
              style={{ display: 'contents' }}
            >
              <ComponentRenderer
                component={comp}
                onClick={() => handleComponentClick(comp)}
                isClickable={isClickable}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PrototypePreview;
