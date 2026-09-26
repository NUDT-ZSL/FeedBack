import React, { useRef, useEffect, useState, useCallback } from 'react';
import katex from 'katex';

interface FormulaPreviewProps {
  latex: string;
  originalFormula: string;
  success: boolean;
}

const FormulaPreview: React.FC<FormulaPreviewProps> = ({
  latex,
  originalFormula,
  success,
}) => {
  const [zoom, setZoom] = useState(1);
  const [animationKey, setAnimationKey] = useState(0);
  const [copySuccess, setCopySuccess] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle');
  const [renderError, setRenderError] = useState<string | null>(null);
  const katexRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (latex && success) {
      setAnimationKey((prev) => prev + 1);
      setRenderError(null);
    }
  }, [latex, success]);

  const renderKatex = useCallback(() => {
    if (!katexRef.current) return;
    if (!latex.trim()) {
      katexRef.current.innerHTML = '';
      setRenderError(null);
      return;
    }
    try {
      katex.render(latex, katexRef.current, {
        throwOnError: true,
        displayMode: true,
        output: 'htmlAndMathml',
        strict: false,
        trust: true,
      });
      setRenderError(null);
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : '渲染错误');
      katexRef.current.innerHTML = '';
    }
  }, [latex]);

  useEffect(() => {
    renderKatex();
  }, [renderKatex]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((prev) => {
        const next = Math.round((prev + delta) * 10) / 10;
        return Math.max(0.5, Math.min(3, next));
      });
    },
    []
  );

  const handleCopyLatex = useCallback(async () => {
    if (!latex.trim()) return;
    try {
      const textArea = document.createElement('textarea');
      textArea.value = latex;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      textArea.setSelectionRange(0, 99999);
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(latex);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch {
        alert('复制失败，请手动选择源码复制');
      }
    }
  }, [latex]);

  const handleExportPNG = useCallback(async () => {
    if (!katexRef.current || !latex.trim()) return;
    setExportStatus('exporting');
    try {
      const svgEl = katexRef.current.querySelector('svg');
      const html = katexRef.current.innerHTML;

      const DPI = 300;
      const scaleFactor = DPI / 96;

      let svgDataUri: string | null = null;

      if (svgEl) {
        const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
        const bbox = svgEl.getBoundingClientRect();
        if (!clonedSvg.getAttribute('width')) {
          clonedSvg.setAttribute('width', `${bbox.width}`);
        }
        if (!clonedSvg.getAttribute('height')) {
          clonedSvg.setAttribute('height', `${bbox.height}`);
        }
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clonedSvg);
        svgDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
      }

      const renderSize = katexRef.current.getBoundingClientRect();
      const width = Math.max(Math.ceil(renderSize.width * scaleFactor), 100);
      const height = Math.max(Math.ceil(renderSize.height * scaleFactor), 100);

      const canvas = document.createElement('canvas');
      canvas.width = width + Math.ceil(40 * scaleFactor);
      canvas.height = height + Math.ceil(40 * scaleFactor);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建Canvas上下文');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (svgDataUri) {
        const img = new Image();
        img.onload = () => {
          try {
            ctx.save();
            const padding = 20 * scaleFactor;
            ctx.translate(padding, padding);
            ctx.scale(scaleFactor, scaleFactor);
            const targetW = renderSize.width;
            const targetH = renderSize.height;
            ctx.drawImage(img, 0, 0, targetW, targetH);
            ctx.restore();
            triggerDownload(canvas);
            setExportStatus('success');
            setTimeout(() => setExportStatus('idle'), 2000);
          } catch {
            fallbackHtmlExport();
          }
        };
        img.onerror = () => fallbackHtmlExport();
        img.src = svgDataUri;
      } else {
        fallbackHtmlExport();
      }

      function fallbackHtmlExport() {
        const svgString = `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="
      background: white;
      padding: ${20 * scaleFactor}px;
      font-size: ${28 * scaleFactor}px;
      transform-origin: top left;
    ">${html}</div>
  </foreignObject>
</svg>`;
        const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
        const img = new Image();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0);
            triggerDownload(canvas);
            setExportStatus('success');
            setTimeout(() => setExportStatus('idle'), 2000);
          } catch {
            setExportStatus('error');
            setTimeout(() => setExportStatus('idle'), 2000);
          }
        };
        img.onerror = () => {
          setExportStatus('error');
          setTimeout(() => setExportStatus('idle'), 2000);
        };
        img.src = uri;
      }

      function triggerDownload(c: HTMLCanvasElement) {
        const link = document.createElement('a');
        link.download = `formula_${Date.now()}.png`;
        link.href = c.toDataURL('image/png', 1.0);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 2000);
    }
  }, [latex]);

  const getExportButtonText = () => {
    switch (exportStatus) {
      case 'exporting':
        return (
          <>
            <span className="loading-spinner" /> 导出中...
          </>
        );
      case 'success':
        return <>✓ 导出成功</>;
      case 'error':
        return <>✗ 导出失败</>;
      default:
        return <>🖼️ 导出 PNG</>;
    }
  };

  const isEmpty = !latex.trim();

  return (
    <div className="card" style={{ animationDelay: '0.2s' }}>
      <div className="card-header">
        <h2 className="card-title">
          <span className="icon">Σ</span>
          LaTeX 预览
        </h2>
        <span className="card-badge">SVG · 矢量渲染</span>
      </div>

      <div
        className="preview-container"
        onWheel={handleWheel}
        ref={stageRef}
      >
        <div className={`preview-stage ${isEmpty ? 'empty' : ''}`}>
          {isEmpty ? (
            <div className="preview-empty">
              <div className="empty-icon">∑</div>
              <p>输入公式后此处将显示渲染结果</p>
              <p style={{ fontSize: '12px', marginTop: '8px', fontWeight: 400 }}>
                支持鼠标滚轮缩放（0.5x ~ 3x）
              </p>
            </div>
          ) : (
            <div
              key={animationKey}
              className="preview-flip"
              style={{
                transform: `scale(${zoom})`,
                transition: 'transform 0.15s ease-out',
              }}
            >
              {renderError ? (
                <div
                  style={{
                    color: 'var(--error)',
                    padding: '16px',
                    textAlign: 'center',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '13px',
                    maxWidth: '400px',
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚠️</div>
                  <div style={{ fontWeight: 700, marginBottom: '8px' }}>渲染错误</div>
                  <div style={{ opacity: 0.8, wordBreak: 'break-all' }}>{renderError}</div>
                </div>
              ) : (
                <div ref={katexRef} />
              )}
            </div>
          )}
        </div>

        {!isEmpty && (
          <div className="latex-source">
            <span className="source-label">LaTeX 源码</span>
            {latex}
          </div>
        )}
      </div>

      <div className="controls">
        <div className="zoom-control">
          <label>🔍 缩放</label>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            disabled={isEmpty}
          />
          <span className="zoom-value">{zoom.toFixed(1)}x</span>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleCopyLatex}
          disabled={isEmpty || !success}
        >
          {copySuccess ? <>✓ 已复制</> : <>📋 复制 LaTeX</>}
        </button>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleExportPNG}
          disabled={isEmpty || !success || exportStatus !== 'idle'}
        >
          {getExportButtonText()}
        </button>
      </div>

      {originalFormula.trim() && success && (
        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            borderTop: '1px solid var(--bg)',
            paddingTop: '12px',
          }}
        >
          💡 提示：尝试使用「积分 sin(x) dx 从 0 到 pi」等自然语言输入
        </div>
      )}
    </div>
  );
};

export default FormulaPreview;
