import { memo, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  monokai,
  dracula,
  oneDark,
} from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { LanguageType, ThemeType } from '../utils/snippetsData';
import { getLanguageLabel } from '../utils/snippetsData';

interface CodePreviewProps {
  code: string;
  language: LanguageType;
  theme: ThemeType;
}

const themeMap: Record<ThemeType, object> = {
  monokai: monokai,
  dracula: dracula,
  oneDark: oneDark,
};

const langMap: Record<LanguageType, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  html: 'markup',
  css: 'css',
  java: 'java',
  go: 'go',
};

function CodePreviewImpl({ code, language, theme }: CodePreviewProps) {
  const styleOverride = useMemo(() => {
    const base: any = { ...themeMap[theme] };
    if (base['pre[class*="language-"]']) {
      base['pre[class*="language-"]'] = {
        ...base['pre[class*="language-"]'],
        margin: 0,
        borderRadius: 0,
        background: 'transparent',
        fontSize: 13,
        lineHeight: '20px',
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace",
      };
    }
    if (base['code[class*="language-"]']) {
      base['code[class*="language-"]'] = {
        ...base['code[class*="language-"]'],
        fontSize: 13,
        lineHeight: '20px',
        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace",
      };
    }
    return base;
  }, [theme]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #313244',
          background: '#181825',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#cdd6f4' }}>预览</span>
        <span
          style={{
            marginLeft: 12,
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 4,
            background: '#313244',
            color: '#89b4fa',
          }}
        >
          {getLanguageLabel(language)}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: '#16161e' }}>
        <SyntaxHighlighter
          language={langMap[language]}
          style={styleOverride}
          showLineNumbers
          wrapLines
          useInlineStyles
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: '#585b70',
            textAlign: 'right',
            userSelect: 'none',
            background: 'transparent',
          }}
          customStyle={{
            margin: 0,
            padding: '16px',
            background: '#16161e',
            minHeight: '100%',
          }}
          lineProps={(lineNumber) => ({
            style: {
              display: 'block',
              width: '100%',
            },
          })}
          codeTagProps={{
            style: {
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace",
            },
          }}
        >
          {code || ' '}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export const CodePreview = memo(CodePreviewImpl);
