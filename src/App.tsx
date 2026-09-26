import React, { useState, useEffect, useCallback, useRef } from 'react';
import FormulaInput from './FormulaInput';
import FormulaPreview from './FormulaPreview';

interface ParseResponse {
  latex: string;
  success: boolean;
  error?: string;
  parseTimeMs: number;
}

const DEBOUNCE_MS = 300;

const App: React.FC = () => {
  const [formula, setFormula] = useState<string>('');
  const [latex, setLatex] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [parseTimeMs, setParseTimeMs] = useState<number>(0);
  const [serverStatus, setServerStatus] = useState<'unknown' | 'ok' | 'offline'>('unknown');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);

  const checkServerHealth = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch('/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        setServerStatus('ok');
      } else {
        setServerStatus('offline');
      }
    } catch {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 15000);
    return () => clearInterval(interval);
  }, [checkServerHealth]);

  const parseFormula = useCallback(async (inputFormula: string) => {
    const reqId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetch('/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ formula: inputFormula }),
      });

      if (!res.ok) {
        throw new Error(`请求失败: ${res.status}`);
      }

      const data: ParseResponse = await res.json();

      if (reqId !== requestIdRef.current) {
        return;
      }

      setLatex(data.latex);
      setSuccess(data.success);
      setParseTimeMs(data.parseTimeMs);
      if (data.success && serverStatus !== 'ok') {
        setServerStatus('ok');
      }
    } catch {
      if (reqId !== requestIdRef.current) {
        return;
      }
      setServerStatus('offline');
      setSuccess(false);
      setLatex('');
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [serverStatus]);

  const handleFormulaChange = useCallback(
    (newFormula: string) => {
      setFormula(newFormula);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!newFormula.trim()) {
        setLatex('');
        setSuccess(true);
        setParseTimeMs(0);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      debounceRef.current = setTimeout(() => {
        parseFormula(newFormula);
      }, DEBOUNCE_MS);
    },
    [parseFormula]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className="app-container">
      <header className="header">
        <h1>✦ 数学公式 → LaTeX 实时转换器 ✦</h1>
        <p>
          自然语言或符号输入 · 一键渲染矢量排版 · 复制源码 / 导出高清 PNG
          {serverStatus === 'ok' && (
            <span
              style={{
                marginLeft: '12px',
                background: 'rgba(39, 174, 96, 0.2)',
                color: '#2ecc71',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ● 服务端在线
            </span>
          )}
          {serverStatus === 'offline' && (
            <span
              style={{
                marginLeft: '12px',
                background: 'rgba(231, 76, 60, 0.2)',
                color: '#ff7675',
                padding: '2px 10px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ● 服务端离线
            </span>
          )}
        </p>
      </header>

      <main className="main-layout">
        <FormulaInput
          value={formula}
          onChange={handleFormulaChange}
          isValid={success}
          isLoading={isLoading}
          parseTimeMs={parseTimeMs}
        />
        <FormulaPreview
          latex={latex}
          originalFormula={formula}
          success={success}
        />
      </main>

      <footer className="footer">
        基于 <strong>React + TypeScript</strong> · <strong>Node.js + Express</strong> ·{' '}
        <strong>KaTeX</strong> 构建 · 支持 10+ 种数学结构实时转换
      </footer>
    </div>
  );
};

export default App;
