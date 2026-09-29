import { memo, useCallback, useMemo, useState } from 'react';
import type { LanguageType, Snippet } from '../utils/snippetsData';
import { getLanguageLabel } from '../utils/snippetsData';
import { SnippetCard } from './SnippetCard';

interface FavoritesPanelProps {
  isOpen: boolean;
  snippets: Snippet[];
  onClose: () => void;
  onLoad: (snippet: Snippet) => void;
  onRemoveFavorite: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

type SortType = 'time-desc' | 'time-asc';

function FavoritesPanelImpl({
  isOpen,
  snippets,
  onClose,
  onLoad,
  onRemoveFavorite,
  onToggleFavorite,
}: FavoritesPanelProps) {
  const [filterLanguage, setFilterLanguage] = useState<LanguageType | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortType>('time-desc');

  const favoriteSnippets = useMemo(() => {
    let result = snippets.filter((s) => s.isFavorite);
    if (filterLanguage !== 'all') {
      result = result.filter((s) => s.language === filterLanguage);
    }
    result = [...result].sort((a, b) => {
      if (sortBy === 'time-desc') {
        return b.timestamp - a.timestamp;
      }
      return a.timestamp - b.timestamp;
    });
    return result;
  }, [snippets, filterLanguage, sortBy]);

  const availableLanguages = useMemo(() => {
    const langs = new Set<LanguageType>();
    snippets.filter((s) => s.isFavorite).forEach((s) => langs.add(s.language));
    return Array.from(langs);
  }, [snippets]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilterLanguage(e.target.value as LanguageType | 'all');
  }, []);

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortBy(e.target.value as SortType);
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
        }}
      />
      <div
        className="favorites-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          background: '#1e1e2e',
          borderLeft: '1px solid #313244',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '16px',
            borderBottom: '1px solid #313244',
            gap: 12,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#f38ba8" stroke="#f38ba8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 600, color: '#cdd6f4', flex: 1 }}>我的收藏</span>
          <button
            onClick={onClose}
            style={{
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a6adc8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid #313244',
          }}
        >
          <select value={filterLanguage} onChange={handleFilterChange} style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}>
            <option value="all">全部语言</option>
            {availableLanguages.map((lang) => (
              <option key={lang} value={lang}>
                {getLanguageLabel(lang)}
              </option>
            ))}
          </select>
          <select value={sortBy} onChange={handleSortChange} style={{ fontSize: 12, padding: '6px 10px' }}>
            <option value="time-desc">最新优先</option>
            <option value="time-asc">最早优先</option>
          </select>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {favoriteSnippets.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                color: '#585b70',
                gap: 8,
                padding: 32,
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#45475a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              <span style={{ fontSize: 14 }}>暂无收藏的片段</span>
            </div>
          ) : (
            favoriteSnippets.map((snippet) => (
              <SnippetCard
                key={snippet.id}
                snippet={snippet}
                onLoad={onLoad}
                onToggleFavorite={onToggleFavorite}
                onRemove={onRemoveFavorite}
                showRemove
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

export const FavoritesPanel = memo(FavoritesPanelImpl);
