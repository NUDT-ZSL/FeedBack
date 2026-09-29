import { memo, useCallback, useState } from 'react';
import type { Snippet } from '../utils/snippetsData';
import { getLanguageColor, getLanguageLabel } from '../utils/snippetsData';

interface SnippetCardProps {
  snippet: Snippet;
  onLoad: (snippet: Snippet) => void;
  onToggleFavorite: (id: string) => void;
  onRemove?: (id: string) => void;
  showRemove?: boolean;
}

function HeartIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? '#f38ba8' : 'none'}
      stroke={filled ? '#f38ba8' : '#a6adc8'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function SnippetCardImpl({ snippet, onLoad, onToggleFavorite, onRemove, showRemove }: SnippetCardProps) {
  const [animating, setAnimating] = useState(false);
  const [removing, setRemoving] = useState(false);

  const previewLines = snippet.code.split('\n').slice(0, 3).join('\n');

  const handleCardClick = useCallback(() => {
    onLoad(snippet);
  }, [onLoad, snippet]);

  const handleFavoriteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setAnimating(true);
    setTimeout(() => setAnimating(false), 300);
    onToggleFavorite(snippet.id);
  }, [onToggleFavorite, snippet.id]);

  const handleRemoveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove) {
      setRemoving(true);
      setTimeout(() => onRemove(snippet.id), 200);
    }
  }, [onRemove, snippet.id]);

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={removing ? 'fade-out' : ''}
      onClick={handleCardClick}
      style={{
        width: 280,
        minWidth: 280,
        background: '#282840',
        borderRadius: 10,
        padding: 16,
        cursor: 'pointer',
        transition: 'all 0.25s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        border: '1px solid #313244',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-6px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.4)';
        (e.currentTarget as HTMLDivElement).style.borderColor = '#45475a';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        (e.currentTarget as HTMLDivElement).style.borderColor = '#313244';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#cdd6f4',
            lineHeight: 1.4,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {snippet.title}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 999,
            color: snippet.language === 'javascript' || snippet.language === 'html' ? '#1e1e2e' : '#fff',
            background: getLanguageColor(snippet.language),
            whiteSpace: 'nowrap',
          }}
        >
          {getLanguageLabel(snippet.language)}
        </span>
      </div>

      <pre
        style={{
          fontSize: 11,
          lineHeight: '16px',
          color: '#a6adc8',
          background: '#1e1e2e',
          borderRadius: 6,
          padding: 10,
          overflow: 'hidden',
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace",
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 72,
          minHeight: 56,
          margin: 0,
        }}
      >
        {previewLines}
      </pre>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span style={{ fontSize: 11, color: '#585b70' }}>{formatDate(snippet.timestamp)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {showRemove && (
            <button
              onClick={handleRemoveClick}
              style={{
                padding: 6,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'rgba(243, 139, 168, 0.15)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
              title="移除收藏"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f38ba8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
          <button
            onClick={handleFavoriteClick}
            className={animating ? 'heart-animate' : ''}
            style={{
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = snippet.isFavorite ? 'rgba(243, 139, 168, 0.15)' : 'rgba(137, 180, 250, 0.1)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
            title={snippet.isFavorite ? '取消收藏' : '收藏'}
          >
            <HeartIcon filled={snippet.isFavorite} />
          </button>
        </div>
      </div>
    </div>
  );
}

export const SnippetCard = memo(SnippetCardImpl);
