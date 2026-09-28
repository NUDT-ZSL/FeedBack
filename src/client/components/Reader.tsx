import React, { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import type { Book, Annotation } from '../types';
import { api } from '../api';

interface ReaderProps {
  book: Book;
  annotations: Annotation[];
  onAnnotationAdded: (annotation: Annotation) => void;
  isReadOnly?: boolean;
  shareAnnotations?: Annotation[];
}

interface ToolbarPosition {
  top: number;
  left: number;
}

interface SelectionInfo {
  text: string;
  startOffset: number;
  endOffset: number;
  chapterId: string;
}

const Reader: React.FC<ReaderProps> = ({ book, annotations, onAnnotationAdded, isReadOnly = false, shareAnnotations }) => {
  const readerRef = useRef<HTMLDivElement>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition | null>(null);
  const [currentSelection, setCurrentSelection] = useState<SelectionInfo | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [flashAnnotationId, setFlashAnnotationId] = useState<string | null>(null);

  const displayAnnotations = isReadOnly && shareAnnotations ? shareAnnotations : annotations;

  const getChapterById = useCallback((chapterId: string) => {
    return book.chapters.find(ch => ch.id === chapterId);
  }, [book.chapters]);

  const truncateText = (text: string, maxLength: number = 20) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const handleTextSelection = useCallback(() => {
    if (isReadOnly) return;

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
        setShowToolbar(false);
        return;
      }

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();

      let chapterEl: HTMLElement | null = range.startContainer.parentElement;
      while (chapterEl && !chapterEl.dataset.chapterId) {
        chapterEl = chapterEl.parentElement;
      }

      if (!chapterEl) {
        setShowToolbar(false);
        return;
      }

      const chapterId = chapterEl.dataset.chapterId!;
      const chapter = getChapterById(chapterId);
      if (!chapter) {
        setShowToolbar(false);
        return;
      }

      const preSelectionRange = document.createRange();
      const chapterContentEl = chapterEl.querySelector('.chapter-content');
      if (!chapterContentEl) {
        setShowToolbar(false);
        return;
      }

      preSelectionRange.selectNodeContents(chapterContentEl);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = preSelectionRange.toString().length;
      const endOffset = startOffset + selectedText.length;

      const rect = range.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

      setCurrentSelection({
        text: selectedText,
        startOffset,
        endOffset,
        chapterId,
      });

      setToolbarPosition({
        top: rect.top + scrollTop - 45,
        left: rect.left + scrollLeft + rect.width / 2,
      });
      setShowToolbar(true);
    }, 50);
  }, [isReadOnly, getChapterById]);

  useEffect(() => {
    document.addEventListener('mouseup', handleTextSelection);
    return () => {
      document.removeEventListener('mouseup', handleTextSelection);
    };
  }, [handleTextSelection]);

  const handleHighlight = async () => {
    if (!currentSelection) return;

    try {
      const annotation = await api.createAnnotation({
        bookId: book.id,
        chapterId: currentSelection.chapterId,
        startOffset: currentSelection.startOffset,
        endOffset: currentSelection.endOffset,
        selectedText: currentSelection.text,
        color: 'yellow',
      });
      onAnnotationAdded(annotation);
    } catch (error) {
      console.error('Failed to create highlight:', error);
    }

    setShowToolbar(false);
    window.getSelection()?.removeAllRanges();
  };

  const handleAddNote = () => {
    setShowNoteModal(true);
  };

  const handleNoteSubmit = async () => {
    if (!currentSelection || !noteText.trim()) return;

    try {
      const annotation = await api.createAnnotation({
        bookId: book.id,
        chapterId: currentSelection.chapterId,
        startOffset: currentSelection.startOffset,
        endOffset: currentSelection.endOffset,
        selectedText: currentSelection.text,
        color: 'yellow',
        note: noteText.trim(),
      });
      onAnnotationAdded(annotation);
    } catch (error) {
      console.error('Failed to create note:', error);
    }

    setShowNoteModal(false);
    setNoteText('');
    setShowToolbar(false);
    window.getSelection()?.removeAllRanges();
  };

  const handleCopyText = () => {
    if (currentSelection) {
      navigator.clipboard.writeText(currentSelection.text).catch(console.error);
    }
    setShowToolbar(false);
    window.getSelection()?.removeAllRanges();
  };

  const scrollToAnnotation = (annotation: Annotation) => {
    const element = document.querySelector(`[data-annotation-id="${annotation.id}"]`) as HTMLElement;
    if (element) {
      const startTime = performance.now();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashAnnotationId(annotation.id);
      setTimeout(() => {
        setFlashAnnotationId(null);
      }, 1500);
      const endTime = performance.now();
      console.log(`Annotation scroll time: ${endTime - startTime}ms`);
    }
    setSidebarOpen(false);
  };

  const renderChapterContent = (chapterId: string, content: string) => {
    const chapterAnnotations = displayAnnotations.filter(a => a.chapterId === chapterId);
    
    let htmlContent = content;
    const insertions: Array<{ offset: number; html: string; annotation: Annotation }> = [];

    chapterAnnotations.forEach((annotation) => {
      const startTag = `<span class="highlight-yellow ${flashAnnotationId === annotation.id ? 'flash' : ''}" data-annotation-id="${annotation.id}">`;
      let endTag = '</span>';
      if (annotation.note) {
        endTag += `<span class="note-marker">📝<span class="note-tooltip">${DOMPurify.sanitize(annotation.note)}</span></span>`;
      }
      
      insertions.push({ offset: annotation.endOffset, html: endTag, annotation });
      insertions.push({ offset: annotation.startOffset, html: startTag, annotation });
    });

    insertions.sort((a, b) => b.offset - a.offset);
    insertions.forEach(insertion => {
      htmlContent = htmlContent.substring(0, insertion.offset) + insertion.html + htmlContent.substring(insertion.offset);
    });

    return { __html: DOMPurify.sanitize(htmlContent) };
  };

  const annotationsByChapter: Record<string, Annotation[]> = {};
  displayAnnotations.forEach((annotation) => {
    if (!annotationsByChapter[annotation.chapterId]) {
      annotationsByChapter[annotation.chapterId] = [];
    }
    annotationsByChapter[annotation.chapterId].push(annotation);
  });

  return (
    <>
      {!isReadOnly && (
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title="批注列表"
        >
          📑
        </button>
      )}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h3>📑 批注列表</h3>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>
            ×
          </button>
        </div>
        <div className="sidebar-content">
          {Object.keys(annotationsByChapter).length === 0 ? (
            <div className="empty-annotations">
              暂无批注<br />
              <small>选中文本即可添加批注</small>
            </div>
          ) : (
            book.chapters.map((chapter) => {
              const chapterAnnotations = annotationsByChapter[chapter.id];
              if (!chapterAnnotations || chapterAnnotations.length === 0) return null;
              return (
                <div key={chapter.id} className="chapter-group">
                  <div className="chapter-title">{chapter.title}</div>
                  {chapterAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      className="annotation-item"
                      onClick={() => scrollToAnnotation(annotation)}
                    >
                      <div className="annotation-text">
                        <span className="color-marker" style={{ backgroundColor: 'rgba(255, 235, 59, 0.6)' }}></span>
                        {truncateText(annotation.selectedText)}
                      </div>
                      {annotation.note && (
                        <div className="annotation-note">
                          📝 {truncateText(annotation.note)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="reader-wrapper" ref={readerRef}>
        <div className="reader-container">
          {isReadOnly && (
            <div style={{ marginBottom: '24px', textAlign: 'center' }}>
              <span className="read-only-badge">只读视图</span>
            </div>
          )}
          <div className="reader-content">
            {book.chapters.map((chapter) => (
              <div key={chapter.id} className="chapter" data-chapter-id={chapter.id}>
                <h2>{chapter.title}</h2>
                <p
                  className="chapter-content"
                  dangerouslySetInnerHTML={renderChapterContent(chapter.id, chapter.content)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {showToolbar && toolbarPosition && currentSelection && !isReadOnly && (
        <div
          className="annotation-toolbar"
          style={{
            top: `${toolbarPosition.top}px`,
            left: `${toolbarPosition.left}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <button className="toolbar-btn highlight" onClick={handleHighlight}>
            🎨 高亮黄色
          </button>
          <button className="toolbar-btn" onClick={handleAddNote}>
            📝 添加笔记
          </button>
          <button className="toolbar-btn" onClick={handleCopyText}>
            📋 复制文本
          </button>
        </div>
      )}

      {showNoteModal && (
        <div className="modal-overlay" onClick={() => setShowNoteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">添加笔记</div>
            <div className="modal-body">
              <label>笔记内容（支持多行）</label>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="请输入笔记内容..."
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNoteModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleNoteSubmit} disabled={!noteText.trim()}>
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Reader;
