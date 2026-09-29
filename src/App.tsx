import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { CodeEditor } from './components/CodeEditor';
import { CodePreview } from './components/CodePreview';
import { SnippetCard } from './components/SnippetCard';
import { FavoritesPanel } from './components/FavoritesPanel';
import type { LanguageType, Snippet, ThemeType } from './utils/snippetsData';
import { generateId, loadFavoriteIds, loadSnippets, saveFavoriteIds, saveSnippets } from './utils/snippetsData';

const DEFAULT_CODE = `// 欢迎使用代码片段编辑器
// 在左侧输入代码，右侧实时预览语法高亮效果

function greet(name) {
  console.log(\`Hello, \${name}!\`);
  return { message: \`Welcome, \${name}\`, timestamp: Date.now() };
}

greet('Developer');`;

function App() {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [language, setLanguage] = useState<LanguageType>('javascript');
  const [theme, setTheme] = useState<ThemeType>('dracula');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isCurrentFavorite, setIsCurrentFavorite] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const [favoriteAnimating, setFavoriteAnimating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const currentLoadedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const loaded = loadSnippets();
    setSnippets(loaded);
  }, []);

  useEffect(() => {
    if (snippets.length > 0) {
      saveSnippets(snippets);
    }
  }, [snippets]);

  const sortedSnippets = useMemo(() => {
    return [...snippets].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      return b.timestamp - a.timestamp;
    });
  }, [snippets]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let percent = ((e.clientX - rect.left) / rect.width) * 100;
      percent = Math.max(30, Math.min(70, percent));
      setLeftWidth(percent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const checkCurrentFavorite = useCallback(() => {
    if (!currentLoadedIdRef.current) {
      setIsCurrentFavorite(false);
      return;
    }
    const found = snippets.find((s) => s.id === currentLoadedIdRef.current);
    setIsCurrentFavorite(found?.isFavorite ?? false);
  }, [snippets]);

  useEffect(() => {
    checkCurrentFavorite();
  }, [checkCurrentFavorite]);

  const handleSaveSnippet = useCallback(() => {
    if (!code.trim()) {
      toast.error('代码内容不能为空');
      return;
    }

    const firstLine = code.split('\n').find((l) => l.trim()) || '未命名片段';
    const title = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;

    const newSnippet: Snippet = {
      id: generateId(),
      title,
      code,
      language,
      theme,
      timestamp: Date.now(),
      isFavorite: false,
    };

    setSnippets((prev) => [newSnippet, ...prev]);
    currentLoadedIdRef.current = newSnippet.id;
    setIsCurrentFavorite(false);
    toast.success('代码片段已保存');
  }, [code, language, theme]);

  const handleToggleFavorite = useCallback(
    (id?: string) => {
      const targetId = id ?? currentLoadedIdRef.current;

      if (!targetId) {
        const firstLine = code.split('\n').find((l) => l.trim()) || '未命名片段';
        const title = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;

        const newSnippet: Snippet = {
          id: generateId(),
          title,
          code,
          language,
          theme,
          timestamp: Date.now(),
          isFavorite: true,
        };
        setSnippets((prev) => [newSnippet, ...prev]);
        currentLoadedIdRef.current = newSnippet.id;
        setIsCurrentFavorite(true);
        setFavoriteAnimating(true);
        setTimeout(() => setFavoriteAnimating(false), 300);
        toast.success('已添加到收藏');

        const currentFavIds = loadFavoriteIds();
        saveFavoriteIds([...currentFavIds, newSnippet.id]);
        return;
      }

      setSnippets((prev) => {
        const updated = prev.map((s) => (s.id === targetId ? { ...s, isFavorite: !s.isFavorite } : s));
        const updatedItem = updated.find((s) => s.id === targetId);
        const currentFavIds = loadFavoriteIds();
        if (updatedItem?.isFavorite) {
          saveFavoriteIds([...currentFavIds, targetId]);
          toast.success('已添加到收藏');
        } else {
          saveFavoriteIds(currentFavIds.filter((fid) => fid !== targetId));
          toast('已取消收藏', { icon: '💔', style: { background: '#a6e3a1', color: '#1e1e2e' } });
        }
        if (targetId === currentLoadedIdRef.current) {
          setIsCurrentFavorite(updatedItem?.isFavorite ?? false);
        }
        return updated;
      });

      if (!id) {
        setFavoriteAnimating(true);
        setTimeout(() => setFavoriteAnimating(false), 300);
      }
    },
    [code, language, theme]
  );

  const handleRemoveFavorite = useCallback((id: string) => {
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, isFavorite: false } : s)));
    const currentFavIds = loadFavoriteIds();
    saveFavoriteIds(currentFavIds.filter((fid) => fid !== id));
    if (id === currentLoadedIdRef.current) {
      setIsCurrentFavorite(false);
    }
    toast('已取消收藏', { icon: '💔', style: { background: '#a6e3a1', color: '#1e1e2e' } });
  }, []);

  const handleLoadSnippet = useCallback((snippet: Snippet) => {
    setCode(snippet.code);
    setLanguage(snippet.language);
    setTheme(snippet.theme);
    currentLoadedIdRef.current = snippet.id;
    setIsCurrentFavorite(snippet.isFavorite);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e2e',
        minWidth: 1024,
      }}
    >
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 2000,
          style: {
            background: '#282840',
            color: '#cdd6f4',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace",
          },
          success: {
            style: { background: '#a6e3a1', color: '#1e1e2e' },
          },
          error: {
            style: { background: '#f38ba8', color: '#1e1e2e' },
          },
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid #313244',
          background: '#181825',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#cdd6f4', letterSpacing: 0.5 }}>CodeSnippet</span>
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setFavoritesOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 8,
            background: '#313244',
            color: '#cdd6f4',
            fontSize: 13,
            fontWeight: 500,
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#f38ba8" stroke="#f38ba8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          收藏夹
          <span
            style={{
              padding: '1px 7px',
              borderRadius: 999,
              background: 'rgba(243, 139, 168, 0.2)',
              color: '#f38ba8',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {snippets.filter((s) => s.isFavorite).length}
          </span>
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${leftWidth}%`, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden', borderBottom: '1px solid #313244' }}>
            <CodeEditor
              code={code}
              language={language}
              theme={theme}
              onCodeChange={setCode}
              onLanguageChange={(lang) => {
                setLanguage(lang);
                currentLoadedIdRef.current = null;
                setIsCurrentFavorite(false);
              }}
              onThemeChange={(t) => {
                setTheme(t);
                currentLoadedIdRef.current = null;
                setIsCurrentFavorite(false);
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              background: '#181825',
              borderBottom: '1px solid #313244',
            }}
          >
            <button
              onClick={handleSaveSnippet}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 20px',
                borderRadius: 8,
                background: '#89b4fa',
                color: '#1e1e2e',
                fontSize: 13,
                fontWeight: 600,
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#74c7ec')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#89b4fa')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              保存片段
            </button>

            <button
              onClick={() => handleToggleFavorite()}
              className={favoriteAnimating ? 'heart-animate' : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 20px',
                borderRadius: 8,
                background: isCurrentFavorite ? 'rgba(243, 139, 168, 0.15)' : '#313244',
                color: isCurrentFavorite ? '#f38ba8' : '#cdd6f4',
                fontSize: 13,
                fontWeight: 500,
                border: isCurrentFavorite ? '1px solid rgba(243, 139, 168, 0.3)' : '1px solid transparent',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = isCurrentFavorite
                  ? 'rgba(243, 139, 168, 0.25)'
                  : '#45475a';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = isCurrentFavorite
                  ? 'rgba(243, 139, 168, 0.15)'
                  : '#313244';
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill={isCurrentFavorite ? '#f38ba8' : 'none'}
                stroke={isCurrentFavorite ? '#f38ba8' : 'currentColor'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {isCurrentFavorite ? '已收藏' : '收藏'}
            </button>

            <div style={{ marginLeft: 'auto', fontSize: 12, color: '#585b70' }}>
              {code.split('\n').length} 行 · {code.length} 字符
            </div>
          </div>

          <div style={{ padding: '16px 24px 20px 24px', background: '#1e1e2e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#cdd6f4' }}>我的代码片段</span>
              <span style={{ fontSize: 12, color: '#585b70' }}>{snippets.length} 个片段</span>
            </div>
            <div
              className="horizontal-scroll"
              style={{
                display: 'flex',
                gap: 16,
                overflowX: 'auto',
                overflowY: 'hidden',
                paddingBottom: 8,
              }}
            >
              {sortedSnippets.length === 0 ? (
                <div
                  style={{
                    padding: 32,
                    color: '#585b70',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#45475a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="9" y1="9" x2="15" y2="9" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                  还没有保存的片段，点击上方「保存片段」按钮创建一个吧
                </div>
              ) : (
                sortedSnippets.map((snippet) => (
                  <SnippetCard
                    key={snippet.id}
                    snippet={snippet}
                    onLoad={handleLoadSnippet}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <div
          onMouseDown={handleMouseDown}
          style={{
            width: isDragging ? 4 : 5,
            cursor: 'col-resize',
            background: isDragging ? 'transparent' : '#313244',
            borderLeft: isDragging ? '2px dashed #89b4fa' : 'none',
            borderRight: isDragging ? '2px dashed #89b4fa' : 'none',
            flexShrink: 0,
            transition: isDragging ? 'none' : 'background 0.2s ease',
            position: 'relative',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            if (!isDragging) {
              (e.currentTarget as HTMLDivElement).style.background = '#89b4fa';
            }
          }}
          onMouseLeave={(e) => {
            if (!isDragging) {
              (e.currentTarget as HTMLDivElement).style.background = '#313244';
            }
          }}
        />

        <div style={{ width: `${100 - leftWidth}%`, height: '100%', overflow: 'hidden' }}>
          <CodePreview code={code} language={language} theme={theme} />
        </div>
      </div>

      <FavoritesPanel
        isOpen={favoritesOpen}
        snippets={snippets}
        onClose={() => setFavoritesOpen(false)}
        onLoad={(s) => {
          handleLoadSnippet(s);
          setFavoritesOpen(false);
        }}
        onRemoveFavorite={handleRemoveFavorite}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}

export default App;
