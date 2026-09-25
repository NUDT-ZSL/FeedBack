import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Annotation, PageData, SearchResult, FileType } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

interface PDFViewerProps {
  fileType: FileType;
  fileName: string;
  pages: PageData[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  addAnnotation: (annotation: Omit<Annotation, 'id' | 'timestamp'>) => void;
  searchQuery: string;
  searchResults: SearchResult[];
}

interface SelectionInfo {
  text: string;
  x: number;
  y: number;
  pageNum: number;
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  fileType,
  fileName,
  pages,
  currentPage,
  setCurrentPage,
  zoom,
  setZoom,
  addAnnotation,
  searchQuery,
  searchResults: _searchResults,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [pdfDocument, setPdfDocument] = useState<any>(null);
  const [isNoteMode, setIsNoteMode] = useState<boolean>(false);
  const [noteDraft, setNoteDraft] = useState<string>('');
  const toolbarRef = useRef<HTMLDivElement>(null);

  const currentPageData = pages.find((p) => p.pageNum === currentPage);

  useEffect(() => {
    if (fileType !== 'pdf' || !fileName) return;

    const loadPDF = async () => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (!input?.files?.[0]) return;
      const file = input.files[0];
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDocument(pdf);

      const newPages: PageData[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        newPages.push({
          pageNum: i,
          content: pageText,
          annotations: [],
        });
      }
      if (pages.length === 0) {
        const event = new CustomEvent('pdfPagesLoaded', { detail: newPages });
        window.dispatchEvent(event);
      }
    };

    loadPDF();
  }, [fileType, fileName]);

  useEffect(() => {
    if (!pdfDocument || fileType !== 'pdf') return;
    const renderPage = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const page = await pdfDocument.getPage(currentPage);
      const viewport = page.getViewport({ scale: zoom });
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise;
    };
    renderPage();
  }, [pdfDocument, currentPage, zoom, fileType]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setSelection(null);
        setIsNoteMode(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTextSelection = useCallback((_e: React.MouseEvent) => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (containerRect) {
          setSelection({
            text: sel.toString().trim(),
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 10,
            pageNum: currentPage,
          });
        }
      }
    }, 10);
  }, [currentPage]);

  const handleHighlight = () => {
    if (!selection) return;
    addAnnotation({
      text: selection.text,
      highlightColor: '#fff3b0',
      note: '',
      pageNum: selection.pageNum,
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleAddNote = () => {
    if (!selection) return;
    setIsNoteMode(true);
  };

  const handleSaveNote = () => {
    if (!selection) return;
    addAnnotation({
      text: selection.text,
      highlightColor: '#fff3b0',
      note: noteDraft,
      pageNum: selection.pageNum,
    });
    setSelection(null);
    setIsNoteMode(false);
    setNoteDraft('');
    window.getSelection()?.removeAllRanges();
  };

  const handleDeleteSelection = () => {
    setSelection(null);
    setIsNoteMode(false);
    setNoteDraft('');
    window.getSelection()?.removeAllRanges();
  };

  const renderTextWithHighlights = () => {
    if (!currentPageData) return null;
    let content = currentPageData.content;
    const annotations = currentPageData.annotations;

    const allMatches: { start: number; end: number; type: string; annotationId?: string }[] = [];

    annotations.forEach((ann) => {
      const index = content.indexOf(ann.text);
      if (index !== -1) {
        allMatches.push({
          start: index,
          end: index + ann.text.length,
          type: 'highlight',
          annotationId: ann.id,
        });
      }
    });

    if (searchQuery.trim()) {
      const lowerContent = content.toLowerCase();
      const lowerQuery = searchQuery.toLowerCase();
      let idx = 0;
      while (idx < content.length) {
        const found = lowerContent.indexOf(lowerQuery, idx);
        if (found === -1) break;
        allMatches.push({
          start: found,
          end: found + searchQuery.length,
          type: 'search',
        });
        idx = found + 1;
      }
    }

    allMatches.sort((a, b) => a.start - b.start);

    const merged: typeof allMatches = [];
    for (const match of allMatches) {
      if (merged.length === 0 || match.start >= merged[merged.length - 1].end) {
        merged.push(match);
      } else if (match.type === 'search') {
        merged[merged.length - 1] = { ...merged[merged.length - 1], type: 'both' };
      }
    }

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    merged.forEach((match, i) => {
      if (match.start > lastEnd) {
        parts.push(<span key={`text-${i}`}>{content.substring(lastEnd, match.start)}</span>);
      }
      const text = content.substring(match.start, match.end);
      let style: React.CSSProperties = {};
      let className = '';
      if (match.type === 'highlight' || match.type === 'both') {
        style.backgroundColor = '#fff3b0';
      }
      if (match.type === 'search' || match.type === 'both') {
        className = 'search-match';
      }
      parts.push(
        <span key={`match-${i}`} style={style} className={className}>
          {text}
        </span>
      );
      lastEnd = match.end;
    });

    if (lastEnd < content.length) {
      parts.push(<span key="text-last">{content.substring(lastEnd)}</span>);
    }

    return parts;
  };

  const toolbarStyle: React.CSSProperties = {
    position: 'absolute',
    left: selection ? `${selection.x}px` : '0',
    top: selection ? `${selection.y}px` : '0',
    transform: 'translateX(-50%) translateY(-100%)',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '6px',
    padding: isNoteMode ? '12px' : '6px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
    display: selection ? 'flex' : 'none',
    flexDirection: isNoteMode ? 'column' : 'row',
    gap: '6px',
    zIndex: 100,
    opacity: selection ? 1 : 0,
    transition: 'opacity 0.2s ease',
    minWidth: isNoteMode ? '280px' : 'auto',
  };

  const toolbarButtonStyle: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#1a3a5c',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background-color 0.2s',
  };

  const controlsStyle: React.CSSProperties = {
    padding: '12px 20px',
    backgroundColor: 'white',
    borderBottom: '1px solid #e0e0e0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  };

  const pageContainerStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '20px',
    position: 'relative',
    backgroundColor: '#f5f5f5',
  };

  const pageContentStyle: React.CSSProperties = {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '4px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
    lineHeight: 1.8,
    fontSize: `${16 * zoom}px`,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    transition: 'font-size 0.3s ease',
    userSelect: 'text',
  };

  const navButtonStyle: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={controlsStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            style={navButtonStyle}
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            ◀ 上一页
          </button>
          <span style={{ fontSize: '14px', color: '#555' }}>
            第 <strong style={{ color: '#1a3a5c' }}>{currentPage}</strong> / {pages.length} 页
          </span>
          <button
            style={navButtonStyle}
            onClick={() => setCurrentPage(Math.min(pages.length, currentPage + 1))}
            disabled={currentPage >= pages.length}
          >
            下一页 ▶
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>缩放:</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={{ width: '120px', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '13px', color: '#666', minWidth: '40px' }}>
            {Math.round(zoom * 100)}%
          </span>
        </div>
      </div>

      <div ref={containerRef} style={pageContainerStyle} onMouseUp={handleTextSelection}>
        <div style={pageContentStyle}>
          {fileType === 'pdf' ? (
            <div style={{ position: 'relative' }}>
              <canvas
                ref={canvasRef}
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  height: 'auto',
                }}
              />
              <div
                ref={textLayerRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: 0.2,
                  color: 'transparent',
                  overflow: 'hidden',
                }}
              >
                {renderTextWithHighlights()}
              </div>
            </div>
          ) : (
            renderTextWithHighlights()
          )}
        </div>

        <div ref={toolbarRef} style={toolbarStyle}>
          {!isNoteMode ? (
            <>
              <button style={toolbarButtonStyle} onClick={handleHighlight}>
                🖍️ 高亮
              </button>
              <button style={toolbarButtonStyle} onClick={handleAddNote}>
                📝 笔记
              </button>
              <button
                style={{ ...toolbarButtonStyle, backgroundColor: '#c53030' }}
                onClick={handleDeleteSelection}
              >
                ✖ 删除
              </button>
            </>
          ) : (
            <>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="输入笔记内容..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '13px',
                  resize: 'vertical',
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button
                  style={{ ...toolbarButtonStyle, backgroundColor: '#718096' }}
                  onClick={handleDeleteSelection}
                >
                  取消
                </button>
                <button style={toolbarButtonStyle} onClick={handleSaveNote}>
                  💾 保存
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PDFViewer;
