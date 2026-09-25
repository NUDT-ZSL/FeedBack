import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import PDFViewer from './components/PDFViewer';
import AnnotationPanel from './components/AnnotationPanel';
import { Annotation, PageData, SearchResult, FileType } from './types';

const App: React.FC = () => {
  const [fileType, setFileType] = useState<FileType>(null);
  const [fileName, setFileName] = useState<string>('');
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handlePDFPagesLoaded = (e: any) => {
      if (pages.length === 0) {
        setPages(e.detail);
        setCurrentPage(1);
      }
    };
    window.addEventListener('pdfPagesLoaded', handlePDFPagesLoaded);
    return () => window.removeEventListener('pdfPagesLoaded', handlePDFPagesLoaded);
  }, [pages.length]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([]);
      return;
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, pages]);

  const performSearch = useCallback((query: string) => {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    pages.forEach((page) => {
      let startIndex = 0;
      while (true) {
        const index = page.content.toLowerCase().indexOf(lowerQuery, startIndex);
        if (index === -1) break;
        results.push({
          pageNum: page.pageNum,
          text: page.content.substring(Math.max(0, index - 20), Math.min(page.content.length, index + query.length + 20)),
          startIndex: index,
        });
        startIndex = index + 1;
      }
      page.annotations.forEach((ann) => {
        if (ann.text.toLowerCase().includes(lowerQuery) || ann.note.toLowerCase().includes(lowerQuery)) {
          results.push({
            pageNum: page.pageNum,
            text: ann.text.substring(0, 50),
            startIndex: 0,
            annotationId: ann.id,
          });
        }
      });
    });
    setSearchResults(results);
  }, [pages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      setFileType('pdf');
    } else {
      setFileType('text');
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const lines = text.split('\n');
        const linesPerPage = 40;
        const newPages: PageData[] = [];
        for (let i = 0; i < lines.length; i += linesPerPage) {
          const pageContent = lines.slice(i, i + linesPerPage).join('\n');
          newPages.push({
            pageNum: Math.floor(i / linesPerPage) + 1,
            content: pageContent,
            annotations: [],
          });
        }
        setPages(newPages);
        setCurrentPage(1);
      };
      reader.readAsText(file);
    }
  };

  const addAnnotation = useCallback((annotation: Omit<Annotation, 'id' | 'timestamp'>) => {
    const newAnnotation: Annotation = {
      ...annotation,
      id: uuidv4(),
      timestamp: Date.now(),
    };
    setPages((prev) =>
      prev.map((page) =>
        page.pageNum === annotation.pageNum
          ? { ...page, annotations: [...page.annotations, newAnnotation] }
          : page
      )
    );
    setSelectedAnnotation(newAnnotation);
  }, []);

  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    setPages((prev) =>
      prev.map((page) => ({
        ...page,
        annotations: page.annotations.map((ann) =>
          ann.id === id ? { ...ann, ...updates } : ann
        ),
      }))
    );
    if (selectedAnnotation?.id === id) {
      setSelectedAnnotation({ ...selectedAnnotation, ...updates });
    }
  }, [selectedAnnotation]);

  const deleteAnnotation = useCallback((id: string, pageNum: number) => {
    setPages((prev) =>
      prev.map((page) =>
        page.pageNum === pageNum
          ? { ...page, annotations: page.annotations.filter((ann) => ann.id !== id) }
          : page
      )
    );
    if (selectedAnnotation?.id === id) {
      setSelectedAnnotation(null);
    }
  }, [selectedAnnotation]);

  const exportAnnotations = () => {
    const exportData = {
      pages: pages.map((page) => ({
        pageNum: page.pageNum,
        annotations: page.annotations.map((ann) => ({
          text: ann.text,
          highlightColor: ann.highlightColor,
          note: ann.note,
        })),
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName || 'annotations'}_annotations.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const jumpToPage = (pageNum: number) => {
    setCurrentPage(pageNum);
    if (isMobile) {
      setIsPanelOpen(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#f5f5f5',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 24px',
    backgroundColor: '#1a3a5c',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  };

  const mainContentStyle: React.CSSProperties = {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  };

  const readerStyle: React.CSSProperties = {
    width: isMobile ? '100%' : '70%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.3s ease',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#2c5282',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'background-color 0.2s',
  };

  const searchInputStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    minWidth: '200px',
    fontSize: '14px',
  };

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>📚 在线图书批注平台</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
            📁 上传文件
          </button>
          <input
            style={searchInputStyle}
            type="text"
            placeholder="🔍 搜索内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            style={buttonStyle}
            onClick={exportAnnotations}
            disabled={pages.length === 0}
          >
            📤 导出注解
          </button>
          {isMobile && (
            <button style={buttonStyle} onClick={() => setIsPanelOpen(!isPanelOpen)}>
              📝 注解面板
            </button>
          )}
        </div>
      </header>

      <div style={mainContentStyle}>
        <div style={readerStyle}>
          {pages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
              }}
            >
              <div style={{ fontSize: '64px' }}>📖</div>
              <p style={{ fontSize: '18px', color: '#666' }}>请上传 PDF 或 TXT 文件开始阅读</p>
              <button style={{ ...buttonStyle, fontSize: '16px', padding: '12px 24px' }} onClick={() => fileInputRef.current?.click()}>
                选择文件
              </button>
            </div>
          ) : (
            <PDFViewer
              fileType={fileType!}
              fileName={fileName}
              pages={pages}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              zoom={zoom}
              setZoom={setZoom}
              addAnnotation={addAnnotation}
              searchQuery={searchQuery}
              searchResults={searchResults}
            />
          )}
        </div>

        {!isMobile && (
          <AnnotationPanel
            pages={pages}
            currentPage={currentPage}
            selectedAnnotation={selectedAnnotation}
            setSelectedAnnotation={setSelectedAnnotation}
            updateAnnotation={updateAnnotation}
            deleteAnnotation={deleteAnnotation}
            searchResults={searchResults}
            jumpToPage={jumpToPage}
            searchQuery={searchQuery}
          />
        )}

        {isMobile && isPanelOpen && (
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: '60vh',
              backgroundColor: 'white',
              borderTop: '2px solid #1a3a5c',
              transition: 'transform 0.3s ease',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <AnnotationPanel
              pages={pages}
              currentPage={currentPage}
              selectedAnnotation={selectedAnnotation}
              setSelectedAnnotation={setSelectedAnnotation}
              updateAnnotation={updateAnnotation}
              deleteAnnotation={deleteAnnotation}
              searchResults={searchResults}
              jumpToPage={jumpToPage}
              searchQuery={searchQuery}
              isMobile={true}
              onClose={() => setIsPanelOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
