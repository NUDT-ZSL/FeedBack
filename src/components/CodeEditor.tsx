import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { LanguageType, ThemeType } from '../utils/snippetsData';
import { getLanguageLabel } from '../utils/snippetsData';

interface CodeEditorProps {
  code: string;
  language: LanguageType;
  theme: ThemeType;
  onCodeChange: (code: string) => void;
  onLanguageChange: (lang: LanguageType) => void;
  onThemeChange: (theme: ThemeType) => void;
}

const LANGUAGES: LanguageType[] = ['javascript', 'typescript', 'python', 'html', 'css', 'java', 'go'];
const THEMES: ThemeType[] = ['monokai', 'dracula', 'oneDark'];

const THEME_LABELS: Record<ThemeType, string> = {
  monokai: '浅色 Monokai',
  dracula: '暗色 Dracula',
  oneDark: '对比色 One Dark',
};

function CodeEditorImpl({ code, language, theme, onCodeChange, onLanguageChange, onThemeChange }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [currentLine, setCurrentLine] = useState(1);

  const lineNumbers = useMemo(() => {
    const lines = code.split('\n').length;
    return Array.from({ length: lines }, (_, i) => i + 1);
  }, [code]);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onCodeChange(e.target.value);
  }, [onCodeChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = code.substring(0, start) + '  ' + code.substring(end);
      onCodeChange(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }, [code, onCodeChange]);

  const handleSelectChange = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const lines = code.substring(0, pos).split('\n').length;
    setCurrentLine(lines);
  }, [code]);

  const handleLanguageSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onLanguageChange(e.target.value as LanguageType);
  }, [onLanguageChange]);

  const handleThemeSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onThemeChange(e.target.value as ThemeType);
  }, [onThemeChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid #313244',
          background: '#181825',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#cdd6f4', marginRight: 8 }}>编辑器</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#a6adc8' }}>语言:</label>
          <select value={language} onChange={handleLanguageSelect} style={{ fontSize: 12, padding: '6px 10px' }}>
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {getLanguageLabel(lang)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#a6adc8' }}>主题:</label>
          <select value={theme} onChange={handleThemeSelect} style={{ fontSize: 12, padding: '6px 10px' }}>
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#a6adc8' }}>
          行 {currentLine} / {lineNumbers.length}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', background: '#16161e' }}>
        <div
          style={{
            padding: '16px 12px',
            background: '#16161e',
            borderRight: '1px solid #313244',
            overflow: 'hidden',
            userSelect: 'none',
            minWidth: 50,
          }}
        >
          {lineNumbers.map((num) => (
            <div
              key={num}
              style={{
                fontSize: 13,
                lineHeight: '20px',
                textAlign: 'right',
                color: num === currentLine ? '#89b4fa' : '#585b70',
                fontFamily: 'inherit',
                background: num === currentLine ? 'rgba(137, 180, 250, 0.08)' : 'transparent',
                margin: '0 -12px',
                padding: '0 12px',
              }}
            >
              {num}
            </div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={code}
          onChange={handleCodeChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelectChange}
          onClick={handleSelectChange}
          onKeyUp={handleSelectChange}
          spellCheck={false}
          wrap="off"
          style={{
            flex: 1,
            padding: '16px',
            fontSize: 13,
            lineHeight: '20px',
            tabSize: 2,
            background: '#16161e',
            color: '#cdd6f4',
            overflow: 'auto',
          }}
        />
      </div>
    </div>
  );
}

export const CodeEditor = memo(CodeEditorImpl);
