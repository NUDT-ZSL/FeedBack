import React, { useState, useRef, useEffect, useCallback } from 'react';
import IconCard, { IconItem } from './components/IconCard';

interface SpriteMapping {
  name: string;
  originalName: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  x: number;
  y: number;
  backgroundPosition: string;
}

interface GenerateResult {
  spriteId: string;
  spriteUrl: string;
  totalWidth: number;
  spriteHeight: number;
  scale: string;
  scaleFactor: number;
  padding: number;
  cssCode: string;
  mappings: SpriteMapping[];
}

interface HistoryItem {
  id: string;
  timestamp: number;
  result: GenerateResult;
  iconNames: string[];
}

const HISTORY_KEY = 'sprite_generator_history';

const App: React.FC = () => {
  const [icons, setIcons] = useState<IconItem[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [scale, setScale] = useState<'1x' | '2x' | '3x'>('2x');
  const [padding, setPadding] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('加载历史记录失败', e);
      }
    }
  }, []);

  const saveHistory = useCallback((newItem: HistoryItem) => {
    setHistory((prev) => {
      const updated = [newItem, ...prev].slice(0, 5);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const parseSvgDimensions = (svgText: string): { width: number; height: number } => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (svg) {
        let w = parseFloat(svg.getAttribute('width') || '');
        let h = parseFloat(svg.getAttribute('height') || '');
        if (!w || !h) {
          const viewBox = svg.getAttribute('viewBox');
          if (viewBox) {
            const parts = viewBox.split(/\s+/);
            if (parts.length === 4) {
              w = parseFloat(parts[2]);
              h = parseFloat(parts[3]);
            }
          }
        }
        return { width: Math.round(w || 24), height: Math.round(h || 24) };
      }
    } catch (e) {
      console.error('解析SVG尺寸失败', e);
    }
    return { width: 24, height: 24 };
  };

  const fileToIconItem = (file: File): Promise<IconItem> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const svgText = e.target?.result as string;
        const { width, height } = parseSvgDimensions(svgText);
        const name = file.name.replace(/\.svg$/i, '');
        resolve({
          id: `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          svgDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`,
          width,
          height,
          selected: true,
        });
      };
      reader.readAsText(file);
    });
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const svgFiles = Array.from(fileList).filter((f) =>
      f.type === 'image/svg+xml' || f.name.toLowerCase().endsWith('.svg')
    );
    if (svgFiles.length === 0) {
      alert('请上传SVG文件');
      return;
    }
    const remaining = Math.max(0, 20 - icons.length);
    const toProcess = svgFiles.slice(0, remaining);

    const tempItems: IconItem[] = toProcess.map((f) => ({
      id: `loading_${Date.now()}_${Math.random()}`,
      name: f.name.replace(/\.svg$/i, ''),
      svgDataUrl: '',
      width: 0,
      height: 0,
      selected: true,
      loading: true,
    }));
    setIcons((prev) => [...prev, ...tempItems]);

    const newIcons = await Promise.all(toProcess.map(fileToIconItem));
    setIcons((prev) => {
      const filtered = prev.filter((i) => !i.id.startsWith('loading_'));
      return [...filtered, ...newIcons];
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleToggleSelect = (id: string) => {
    setIcons((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)));
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (index: number) => {
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      setIcons((prev) => {
        const newIcons = [...prev];
        const [moved] = newIcons.splice(dragIndex, 1);
        newIcons.splice(dragOverIndex, 0, moved);
        return newIcons;
      });
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const removeSelected = () => {
    setIcons((prev) => prev.filter((i) => !i.selected));
  };

  const clearAll = () => {
    setIcons([]);
    setResult(null);
  };

  const generateSprite = async () => {
    const selectedIcons = icons.filter((i) => i.selected);
    if (selectedIcons.length === 0) {
      alert('请至少选择一个图标');
      return;
    }

    setGenerating(true);
    try {
      const formData = new FormData();
      selectedIcons.forEach((icon) => {
        const binaryString = atob(icon.svgDataUrl.split(',')[1]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/svg+xml' });
        formData.append('svgs', blob, `${icon.name}.svg`);
      });
      formData.append('scale', scale);
      formData.append('padding', padding.toString());
      formData.append('order', JSON.stringify(selectedIcons.map((i) => i.name)));

      const response = await fetch('/api/generate-sprite', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      const data: GenerateResult = await response.json();
      setResult(data);
      setZoom(1);

      const historyItem: HistoryItem = {
        id: data.spriteId,
        timestamp: Date.now(),
        result: data,
        iconNames: selectedIcons.map((i) => i.name),
      };
      saveHistory(historyItem);
    } catch (error) {
      console.error(error);
      alert('生成雪碧图失败，请检查控制台');
    } finally {
      setGenerating(false);
    }
  };

  const copyCss = async () => {
    if (result) {
      try {
        await navigator.clipboard.writeText(result.cssCode);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = result.cssCode;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const downloadFile = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadCss = () => {
    if (result) {
      const blob = new Blob([result.cssCode], { type: 'text/css' });
      const url = URL.createObjectURL(blob);
      downloadFile(url, 'sprite.css');
      URL.revokeObjectURL(url);
    }
  };

  const downloadSprite = () => {
    if (result) {
      downloadFile(result.spriteUrl, 'sprite.png');
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setResult(item.result);
    setZoom(1);
    setShowHistory(false);
  };

  const selectedCount = icons.filter((i) => i.selected).length;
  const activeIcons = icons.filter((i) => i.selected);

  return (
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        * { scrollbar-width: thin; scrollbar-color: #555 #2d2d2d; }
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-track { background: #2d2d2d; }
        *::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
        *::-webkit-scrollbar-thumb:hover { background: #666; }
        .monokai-code { font-family: 'Fira Code', 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6; }
        .monokai-code .comment { color: #75715e; }
        .monokai-code .selector { color: #a6e22e; }
        .monokai-code .property { color: #66d9ef; }
        .monokai-code .value { color: #fd971f; }
        .monokai-code .value-px { color: #e6db74; }
        .monokai-code .punctuation { color: #f8f8f2; }
        .monokai-code .brace { color: #f8f8f2; }
      `}</style>

      <div style={{ width: '100%', minHeight: '100vh', background: '#1e1e1e', color: '#e0e0e0', display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#252525',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#00d4aa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M4 4H8V8H4V4Z M12 4H16V8H12V4Z M4 12H8V16H4V12Z M12 12H16V16H12V12Z" fill="#1e1e1e" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#fff' }}>SVG 雪碧图生成器</h1>
              <p style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>SVG 图标 → CSS Sprite 一键生成</p>
            </div>
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{
              padding: '8px 16px',
              background: showHistory ? '#00d4aa' : '#2d2d2d',
              color: showHistory ? '#1e1e1e' : '#e0e0e0',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'all 0.2s',
            }}
          >
            📜 历史记录 ({history.length}/5)
          </button>
        </header>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: window.innerWidth < 768 ? 'column' : 'row' }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', borderRight: window.innerWidth < 768 ? 'none' : '1px solid #333' }}>
            <div
              ref={dropZoneRef}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${isDraggingOver ? '#00d4aa' : '#444'}`,
                borderRadius: '12px',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: isDraggingOver ? 'rgba(0,212,170,0.05)' : '#252525',
                marginBottom: '20px',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>{isDraggingOver ? '📥' : '📤'}</div>
              <p style={{ fontSize: '15px', color: isDraggingOver ? '#00d4aa' : '#e0e0e0', fontWeight: 500, marginBottom: '6px' }}>
                {isDraggingOver ? '松开以上传 SVG 文件' : '拖拽 SVG 文件到此处，或点击选择'}
              </p>
              <p style={{ fontSize: '12px', color: '#888' }}>支持批量上传（单次最多 20 个）</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                图标列表 <span style={{ color: '#888', fontWeight: 400 }}>({selectedCount}/{icons.length})</span>
              </h2>
              {icons.length > 0 && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={removeSelected}
                    disabled={selectedCount === 0}
                    style={{
                      padding: '6px 12px',
                      background: selectedCount === 0 ? '#333' : '#3d2d2d',
                      color: selectedCount === 0 ? '#666' : '#ff6b6b',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      transition: 'all 0.2s',
                    }}
                  >
                    移除选中
                  </button>
                  <button
                    onClick={clearAll}
                    style={{
                      padding: '6px 12px',
                      background: '#2d2d2d',
                      color: '#aaa',
                      border: 'none',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      transition: 'all 0.2s',
                    }}
                  >
                    清空
                  </button>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                minHeight: icons.length === 0 ? '120px' : 'auto',
                alignItems: icons.length === 0 ? 'center' : 'flex-start',
                justifyContent: icons.length === 0 ? 'center' : 'flex-start',
              }}
            >
              {icons.length === 0 ? (
                <p style={{ color: '#555', fontSize: '13px' }}>暂无图标，上传 SVG 开始使用</p>
              ) : (
                icons.map((icon, idx) => (
                  <IconCard
                    key={icon.id}
                    icon={icon}
                    index={idx}
                    onToggleSelect={handleToggleSelect}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDragEnter={handleDragEnter}
                    isDragging={dragIndex === idx}
                    dragOverIndex={dragOverIndex}
                  />
                ))
              )}
            </div>

            {activeIcons.length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>雪碧图实时预览</h2>
                <div
                  style={{
                    background: '#252525',
                    borderRadius: '8px',
                    padding: '16px',
                    overflowX: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: `${padding}px`,
                    backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                  }}
                >
                  {activeIcons.map((icon) => (
                    <img
                      key={icon.id}
                      src={icon.svgDataUrl}
                      alt={icon.name}
                      style={{
                        width: `${icon.width}px`,
                        height: `${icon.height}px`,
                        objectFit: 'contain',
                        display: 'block',
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ width: window.innerWidth < 768 ? '100%' : '520px', minWidth: 0, overflowY: 'auto', padding: '20px 24px', background: '#1a1a1a' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '12px' }}>生成配置</h2>
              <div style={{ background: '#252525', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>缩放倍率 (Retina)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {(['1x', '2x', '3x'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setScale(s)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: scale === s ? '#00d4aa' : '#2d2d2d',
                          color: scale === s ? '#1e1e1e' : '#e0e0e0',
                          border: 'none',
                          borderRadius: '5px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: scale === s ? 600 : 400,
                          transition: 'all 0.2s',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '8px' }}>
                    图标间距: {padding}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={padding}
                    onChange={(e) => setPadding(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: '#00d4aa' }}
                  />
                </div>
                <button
                  onClick={generateSprite}
                  disabled={generating || activeIcons.length === 0}
                  style={{
                    width: '100%',
                    padding: '12px 20px',
                    background: generating || activeIcons.length === 0 ? '#333' : '#00d4aa',
                    color: generating || activeIcons.length === 0 ? '#666' : '#1e1e1e',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: generating || activeIcons.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '15px',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  {generating ? (
                    <>
                      <div
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          border: '2px solid rgba(0,0,0,0.2)',
                          borderTopColor: '#1e1e1e',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                      生成中...
                    </>
                  ) : (
                    <>⚡ 生成雪碧图</>
                  )}
                </button>
              </div>
            </div>

            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>CSS 代码</h2>
                    <button
                      onClick={copyCss}
                      style={{
                        padding: '6px 12px',
                        background: copied ? '#00d4aa' : '#2d2d2d',
                        color: copied ? '#1e1e1e' : '#e0e0e0',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        transition: 'all 0.2s',
                      }}
                    >
                      {copied ? '✓ 已复制' : '📋 复制'}
                    </button>
                  </div>
                  <pre
                    className="monokai-code"
                    style={{
                      background: '#272822',
                      borderRadius: '8px',
                      padding: '16px',
                      maxHeight: '280px',
                      overflow: 'auto',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                    dangerouslySetInnerHTML={{ __html: highlightCss(result.cssCode) }}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>
                      雪碧图大图 <span style={{ color: '#888', fontWeight: 400 }}>({result.totalWidth}×{result.spriteHeight}px)</span>
                    </h2>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <button
                        onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                        style={{ padding: '4px 10px', background: '#2d2d2d', color: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}
                      >
                        −
                      </button>
                      <span style={{ fontSize: '12px', color: '#aaa', minWidth: '44px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                      <button
                        onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                        style={{ padding: '4px 10px', background: '#2d2d2d', color: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div
                    onWheel={(e) => {
                      e.preventDefault();
                      setZoom((z) => {
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        return Math.max(0.25, Math.min(4, z + delta));
                      });
                    }}
                    style={{
                      background: '#252525',
                      borderRadius: '8px',
                      padding: '16px',
                      overflow: 'auto',
                      maxHeight: '320px',
                      cursor: 'zoom-in',
                      backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                      backgroundSize: '16px 16px',
                      backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                    }}
                  >
                    <img
                      src={result.spriteUrl}
                      alt="Generated sprite"
                      style={{
                        display: 'block',
                        transform: `scale(${zoom})`,
                        transformOrigin: 'top left',
                        imageRendering: 'pixelated',
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={downloadCss}
                    style={{
                      flex: 1,
                      padding: '11px 16px',
                      background: '#2d2d2d',
                      color: '#e0e0e0',
                      border: '1px solid #444',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 500,
                      transition: 'all 0.2s',
                    }}
                  >
                    📄 下载 CSS
                  </button>
                  <button
                    onClick={downloadSprite}
                    style={{
                      flex: 1,
                      padding: '11px 16px',
                      background: '#00d4aa',
                      color: '#1e1e1e',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                      transition: 'all 0.2s',
                    }}
                  >
                    🖼️ 下载 PNG
                  </button>
                </div>
              </div>
            )}

            {!result && !generating && (
              <div style={{ marginTop: '40px', textAlign: 'center', color: '#555' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>✨</div>
                <p style={{ fontSize: '13px' }}>上传图标并点击生成按钮<br />查看雪碧图和 CSS 代码</p>
              </div>
            )}
          </div>
        </div>

        {showHistory && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.7)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
            onClick={() => setShowHistory(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#252525',
                borderRadius: '12px',
                padding: '24px',
                width: '100%',
                maxWidth: '600px',
                maxHeight: '80vh',
                overflowY: 'auto',
                animation: 'fadeIn 0.2s ease-in-out',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#fff' }}>历史记录</h2>
                <button
                  onClick={() => setShowHistory(false)}
                  style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '24px', cursor: 'pointer', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              {history.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#555', padding: '40px 0' }}>暂无历史记录</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {history.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => loadFromHistory(item)}
                      style={{
                        background: '#2d2d2d',
                        borderRadius: '8px',
                        padding: '14px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        border: '1px solid transparent',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#00d4aa')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img
                          src={item.result.spriteUrl}
                          alt=""
                          style={{ width: '48px', height: '48px', objectFit: 'contain', background: '#1e1e1e', borderRadius: '6px', padding: '4px' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '13px', color: '#fff', fontWeight: 500, marginBottom: '4px' }}>
                            {item.iconNames.length} 个图标 · {item.result.scale}
                          </p>
                          <p style={{ fontSize: '11px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.iconNames.join(', ')}
                          </p>
                        </div>
                        <div style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>
                          {new Date(item.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

function highlightCss(css: string): string {
  let html = css
    .replace(/\/\*[\s\S]*?\*\//g, '<span class="comment">$&</span>')
    .replace(/([.#][^{}]+?)(\s*\{)/g, '<span class="selector">$1</span><span class="brace">$2</span>')
    .replace(/\}/g, '<span class="brace">}</span>')
    .replace(/([a-z-]+?)(\s*:)/gi, '<span class="property">$1</span><span class="punctuation">$2</span>')
    .replace(/:\s*([^;}]+?)(;|\})/g, (match, value, punct) => {
      const highlightedValue = value.replace(/(-?\d+\.?\d*)px/g, '<span class="value-px">$1px</span>');
      return `: <span class="value">${highlightedValue}</span><span class="punctuation">${punct}</span>`;
    });
  return html;
}

export default App;
