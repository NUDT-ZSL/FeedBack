import React, { useRef, useCallback, useEffect } from 'react';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const Editor: React.FC<EditorProps> = ({ value, onChange, placeholder }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<{ stack: string[]; index: number }>({
    stack: [''],
    index: 0,
  });

  useEffect(() => {
    const history = historyRef.current;
    if (history.stack[history.index] !== value) {
      history.stack = history.stack.slice(0, history.index + 1);
      history.stack.push(value);
      history.index = history.stack.length - 1;
      if (history.stack.length > 100) {
        history.stack = history.stack.slice(-100);
        history.index = history.stack.length - 1;
      }
    }
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (e.key === 'Tab') {
        e.preventDefault();
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const history = historyRef.current;
        if (history.index > 0) {
          history.index--;
          onChange(history.stack[history.index]);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const history = historyRef.current;
        if (history.index < history.stack.length - 1) {
          history.index++;
          onChange(history.stack[history.index]);
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const currentLine = value.substring(lineStart, start);
        const indentMatch = currentLine.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        let newIndent = indent;
        const lastChar = value[start - 1];
        if (lastChar === '{' || lastChar === ':' || lastChar === '(' || lastChar === '[') {
          newIndent += '  ';
        }
        const newValue = value.substring(0, start) + '\n' + newIndent + value.substring(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1 + newIndent.length;
        });
        return;
      }

      const brackets: Record<string, string> = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`',
      };

      if (brackets[e.key]) {
        e.preventDefault();
        const selectedText = value.substring(start, end);
        const newValue =
          value.substring(0, start) + e.key + selectedText + brackets[e.key] + value.substring(end);
        onChange(newValue);
        requestAnimationFrame(() => {
          if (start === end) {
            textarea.selectionStart = textarea.selectionEnd = start + 1;
          } else {
            textarea.selectionStart = start + 1;
            textarea.selectionEnd = end + 1;
          }
        });
        return;
      }

      const closingBrackets = [')', ']', '}', '"', "'", '`'];
      if (closingBrackets.includes(e.key) && start === end && value[start] === e.key) {
        e.preventDefault();
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
        return;
      }

      if (e.key === 'Backspace' && start === end) {
        const charBefore = value[start - 1];
        const charAfter = value[start];
        const pairs: Record<string, string> = {
          '(': ')',
          '[': ']',
          '{': '}',
          '"': '"',
          "'": "'",
          '`': '`',
        };
        if (pairs[charBefore] === charAfter) {
          e.preventDefault();
          const newValue = value.substring(0, start - 1) + value.substring(start + 1);
          onChange(newValue);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = start - 1;
          });
          return;
        }
      }
    },
    [value, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  return (
    <div className="editor-pane">
      <div className="editor-header">代码编辑</div>
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || '在此输入或粘贴代码...'}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
    </div>
  );
};

export default Editor;
