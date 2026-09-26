import React, { useMemo } from 'react';
import hljs from 'highlight.js';
import type { Language } from './utils/languageDetector';

interface HighlighterProps {
  code: string;
  language: Exclude<Language, 'auto'>;
  showLineNumbers?: boolean;
}

const Highlighter: React.FC<HighlighterProps> = ({ code, language, showLineNumbers = true }) => {
  const highlighted = useMemo(() => {
    try {
      const result = hljs.highlight(code, {
        language,
        ignoreIllegals: true,
      });
      return result.value;
    } catch {
      return code;
    }
  }, [code, language]);

  const lines = useMemo(() => {
    return highlighted.split('\n');
  }, [highlighted]);

  return (
    <div className="preview-pane">
      <div className="preview-header">
        预览 · {language.toUpperCase()}
      </div>
      <div className="code-block">
        <table className="code-table">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                {showLineNumbers && (
                  <td className="line-number">{index + 1}</td>
                )}
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
    </div>
  );
};

export default Highlighter;
