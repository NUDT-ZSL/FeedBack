import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Copy, Check, Maximize, X, ChevronDown } from 'lucide-react';
import Editor from './Editor';
import Highlighter from './Highlighter';
import {
  getThemes,
  setTheme,
  initTheme,
  getCurrentTheme,
  type Theme,
} from './themeManager';
import {
  type Language,
  resolveLanguage,
  languageOptions,
  detectLanguage,
} from './utils/languageDetector';

const sampleCode = `function greet(name) {
  const message = \`Hello, \${name}!\`;
  console.log(message);
  return message;
}

// Call the function
greet('World');

class Calculator {
  constructor() {
    this.result = 0;
  }

  add(num) {
    this.result += num;
    return this;
  }

  getResult() {
    return this.result;
  }
}

const calc = new Calculator();
const sum = calc.add(5).add(10).getResult();
console.log('Sum:', sum);
`;

const App: React.FC = () => {
  const [code, setCode] = useState<string>(sampleCode);
  const [debouncedCode, setDebouncedCode] = useState<string>(sampleCode);
  const [language, setLanguage] = useState<Language>('auto');
  const [currentThemeName, setCurrentThemeName] = useState<string>('');
  const [themes] = useState<Theme[]>(getThemes());
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [leftWidth, setLeftWidth] = useState<number>(40);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showThemeDropdown, setShowThemeDropdown] = useState<boolean>(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [topHeight, setTopHeight] = useState<number>(40);

  const containerRef = useRef<HTMLDivElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const theme = initTheme();
    setCurrentThemeName(theme.name);
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setShowThemeDropdown(false);
      }
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(e.target as Node)) {
        setShowLanguageDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedCode(code);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [code]);

  const resolvedLanguage = useMemo(() => {
    return resolveLanguage(language, debouncedCode);
  }, [language, debouncedCode]);

  const currentTheme = useMemo(() => {
    return currentThemeName ? getCurrentTheme() : themes[0];
  }, [currentThemeName, themes]);

  const handleThemeChange = useCallback((themeName: string) => {
    setTheme(themeName);
    setCurrentThemeName(themeName);
    setShowThemeDropdown(false);
  }, []);

  const handleLanguageChange = useCallback((lang: Language) => {
    setLanguage(lang);
    setShowLanguageDropdown(false);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore copy errors
    }
  }, [code]);

  const handleFullscreen = useCallback(() => {
    setIsFullscreen(true);
  }, []);

  const handleExitFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        handleExitFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, handleExitFullscreen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        if (isMobile) {
          const totalHeight = rect.height;
          const relativeY = e.clientY - rect.top;
          const newHeight = (relativeY / totalHeight) * 100;
          const clamped = Math.max(30, Math.min(70, newHeight));
          setTopHeight(clamped);
        } else {
          const totalWidth = rect.width;
          const relativeX = e.clientX - rect.left;
          const newWidth = (relativeX / totalWidth) * 100;
          const clamped = Math.max(30, Math.min(70, newWidth));
          setLeftWidth(clamped);
        }
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [isDragging, isMobile]);

  const editorStyle = isMobile
    ? { height: `${topHeight}%`, width: '100%', minHeight: '30%' }
    : { width: `${leftWidth}%` };

  const previewStyle = isMobile
    ? { height: `${100 - topHeight}%`, width: '100%' }
    : { width: `${100 - leftWidth}%` };

  const detectedLang = useMemo(() => detectLanguage(debouncedCode), [debouncedCode]);
  const displayLanguage = language === 'auto' ? detectedLang : language;

  return (
    <div className="app">
      <div className="toolbar">
        <div className="toolbar-group" ref={themeDropdownRef}>
          <button
            className="btn"
            onClick={() => setShowThemeDropdown(!showThemeDropdown)}
          >
            <div className="theme-preview">
              <div
                className="theme-preview-block"
                style={{ backgroundColor: currentTheme.previewColors.primary }}
              />
              <div
                className="theme-preview-block"
                style={{ backgroundColor: currentTheme.previewColors.background }}
              />
            </div>
            <span>{currentTheme.displayName}</span>
            <ChevronDown size={16} />
          </button>
          {showThemeDropdown && (
            <div
              className="theme-dropdown"
              style={{
                position: 'absolute',
                top: '52px',
                left: '20px',
                backgroundColor: currentTheme.colors.background,
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 100,
                minWidth: '200px',
                overflow: 'hidden',
              }}
            >
              {themes.map((theme) => (
                <button
                  key={theme.name}
                  className="theme-option-btn"
                  onClick={() => handleThemeChange(theme.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    width: '100%',
                    border: 'none',
                    backgroundColor:
                      theme.name === currentThemeName
                        ? `${currentTheme.colors.primary}15`
                        : 'transparent',
                    color: currentTheme.colors.foreground,
                    cursor: 'pointer',
                    fontSize: '14px',
                    textAlign: 'left',
                    transition: 'background-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `${currentTheme.colors.primary}10`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      theme.name === currentThemeName
                        ? `${currentTheme.colors.primary}15`
                        : 'transparent';
                  }}
                >
                  <div className="theme-preview">
                    <div
                      className="theme-preview-block"
                      style={{ backgroundColor: theme.previewColors.primary }}
                    />
                    <div
                      className="theme-preview-block"
                      style={{ backgroundColor: theme.previewColors.background }}
                    />
                  </div>
                  <span>{theme.displayName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-group" ref={languageDropdownRef}>
          <button
            className="btn"
            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
          >
            <span>
              {languageOptions.find((opt) => opt.value === language)?.label}
              {language === 'auto' && ` (${displayLanguage.toUpperCase()})`}
            </span>
            <ChevronDown size={16} />
          </button>
          {showLanguageDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '52px',
                backgroundColor: currentTheme.colors.background,
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 100,
                minWidth: '140px',
                overflow: 'hidden',
              }}
            >
              {languageOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleLanguageChange(opt.value)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    width: '100%',
                    border: 'none',
                    backgroundColor:
                      opt.value === language
                        ? `${currentTheme.colors.primary}15`
                        : 'transparent',
                    color: currentTheme.colors.foreground,
                    cursor: 'pointer',
                    fontSize: '14px',
                    textAlign: 'left',
                    transition: 'background-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `${currentTheme.colors.primary}10`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      opt.value === language
                        ? `${currentTheme.colors.primary}15`
                        : 'transparent';
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar-spacer" />

        <div className="toolbar-group">
          <button className="btn btn-icon" onClick={handleCopy} title="复制代码">
            {copied ? <Check size={18} /> : <Copy size={18} />}
          </button>
          <button
            className="btn btn-icon"
            onClick={handleFullscreen}
            title="全屏预览"
          >
            <Maximize size={18} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`main-container${isMobile ? ' vertical' : ''}`}
      >
        <div style={editorStyle}>
          <Editor value={code} onChange={setCode} />
        </div>

        <div
          className={`divider${isDragging ? ' dragging' : ''}`}
          onMouseDown={handleMouseDown}
        />

        <div style={previewStyle}>
          <Highlighter code={debouncedCode} language={resolvedLanguage} />
        </div>
      </div>

      {isFullscreen && (
        <div className="fullscreen-overlay">
          <button
            className="btn btn-icon fullscreen-close"
            onClick={handleExitFullscreen}
            title="退出全屏"
          >
            <X size={20} />
          </button>
          <div
            className="code-block"
            style={{
              flex: 1,
              margin: '60px 20px 40px',
              padding: '24px',
            }}
          >
            <table className="code-table" style={{ fontSize: '16px' }}>
              <tbody>
                {debouncedCode.split('\n').map((line, index) => (
                  <tr key={index}>
                    <td className="line-number">{index + 1}</td>
                    <td className="line-code">
                      <pre>
                        <code
                          dangerouslySetInnerHTML={{
                            __html: line || '&nbsp;',
                          }}
                        />
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="fullscreen-hint">按 ESC 键退出全屏</div>
        </div>
      )}

      {copied && <div className="copied-toast">代码已复制到剪贴板</div>}
    </div>
  );
};

export default App;
