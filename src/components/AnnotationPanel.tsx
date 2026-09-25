import React, { useState, useEffect, useRef } from 'react';
import { Annotation, PageData, SearchResult } from '../types';

interface AnnotationPanelProps {
  pages: PageData[];
  currentPage: number;
  selectedAnnotation: Annotation | null;
  setSelectedAnnotation: (ann: Annotation | null) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  deleteAnnotation: (id: string, pageNum: number) => void;
  searchResults: SearchResult[];
  jumpToPage: (pageNum: number) => void;
  searchQuery: string;
  isMobile?: boolean;
  onClose?: () => void;
}

type TabType = 'annotations' | 'search';

const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  pages,
  currentPage,
  selectedAnnotation,
  setSelectedAnnotation,
  updateAnnotation,
  deleteAnnotation,
  searchResults,
  jumpToPage,
  searchQuery,
  isMobile = false,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('annotations');
  const noteEditorRef = useRef<HTMLDivElement>(null);

  const allAnnotations = pages.flatMap((p) => p.annotations);

  useEffect(() => {
    if (searchQuery.trim()) {
      setActiveTab('search');
    }
  }, [searchQuery]);

  useEffect(() => {
    if (noteEditorRef.current && selectedAnnotation) {
      noteEditorRef.current.innerHTML = selectedAnnotation.note;
    }
  }, [selectedAnnotation?.id]);

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const applyFormat = (command: string) => {
    document.execCommand(command, false);
    if (noteEditorRef.current) {
      updateAnnotation(selectedAnnotation!.id, {
        note: noteEditorRef.current.innerHTML,
      });
    }
  };

  const handleNoteInput = () => {
    if (noteEditorRef.current && selectedAnnotation) {
      updateAnnotation(selectedAnnotation.id, {
        note: noteEditorRef.current.innerHTML,
      });
    }
  };

  const panelStyle: React.CSSProperties = {
    width: isMobile ? '100%' : '30%',
    height: '100%',
    backgroundColor: 'white',
    borderLeft: isMobile ? 'none' : '1px solid #e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.3s ease',
  };

  const headerStyle: React.CSSProperties = {
    padding: '12px 16px',
    backgroundColor: '#1a3a5c',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: active ? 'white' : '#f0f0f0',
    color: active ? '#1a3a5c' : '#666',
    fontWeight: active ? 600 : 400,
    borderBottom: active ? '2px solid #1a3a5c' : '2px solid transparent',
    transition: 'all 0.2s ease',
    fontSize: '14px',
  });

  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  };

  const annotationCardStyle = (selected: boolean): React.CSSProperties => ({
    padding: '12px',
    marginBottom: '8px',
    borderRadius: '6px',
    border: selected ? '2px solid #1a3a5c' : '1px solid #e0e0e0',
    backgroundColor: selected ? '#f0f7ff' : 'white',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  });

  const highlightedTextStyle: React.CSSProperties = {
    backgroundColor: '#fff3b0',
    padding: '2px 4px',
    borderRadius: '2px',
    fontSize: '13px',
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  };

  const noteSectionStyle: React.CSSProperties = {
    borderTop: '1px solid #e0e0e0',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '40%',
  };

  const formatButtonStyle: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold',
    transition: 'background-color 0.2s',
  };

  const editorStyle: React.CSSProperties = {
    minHeight: '100px',
    padding: '10px',
    borderRadius: '4px',
    border: '1px solid #ddd',
    fontSize: '13px',
    lineHeight: 1.6,
    outline: 'none',
    overflowY: 'auto',
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h3 style={{ fontSize: '15px', fontWeight: 600 }}>📝 注解面板</h3>
        {isMobile && onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex' }}>
        <div
          style={tabStyle(activeTab === 'annotations')}
          onClick={() => setActiveTab('annotations')}
        >
          📌 注解 ({allAnnotations.length})
        </div>
        <div
          style={tabStyle(activeTab === 'search')}
          onClick={() => setActiveTab('search')}
        >
          🔍 搜索结果 ({searchResults.length})
        </div>
      </div>

      <div style={listStyle}>
        {activeTab === 'annotations' && (
          <>
            {allAnnotations.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  color: '#999',
                  fontSize: '14px',
                }}
              >
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>📭</div>
                暂无注解
                <br />
                选择文本后点击"高亮"或"笔记"
              </div>
            ) : (
              allAnnotations.map((ann) => (
                <div
                  key={ann.id}
                  style={annotationCardStyle(selectedAnnotation?.id === ann.id)}
                  onClick={() => {
                    setSelectedAnnotation(ann);
                    if (ann.pageNum !== currentPage) {
                      jumpToPage(ann.pageNum);
                    }
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#1a3a5c',
                        fontWeight: 600,
                      }}
                    >
                      第 {ann.pageNum} 页
                    </span>
                    <span style={{ fontSize: '11px', color: '#999' }}>
                      {formatTimestamp(ann.timestamp)}
                    </span>
                  </div>
                  <div style={highlightedTextStyle}>{ann.text}</div>
                  {ann.note && (
                    <div
                      style={{
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: '#f9f9f9',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#555',
                      }}
                      dangerouslySetInnerHTML={{ __html: ann.note.substring(0, 100) + (ann.note.length > 100 ? '...' : '') }}
                    />
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'search' && (
          <>
            {searchResults.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  color: '#999',
                  fontSize: '14px',
                }}
              >
                <div style={{ fontSize: '40px', marginBottom: '8px' }}>🔍</div>
                {searchQuery.trim() ? '未找到匹配内容' : '请输入关键词搜索'}
              </div>
            ) : (
              searchResults.map((result, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    borderRadius: '6px',
                    border: '1px solid #e0e0e0',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s',
                  }}
                  onClick={() => {
                    jumpToPage(result.pageNum);
                    if (result.annotationId) {
                      const ann = pages
                        .find((p) => p.pageNum === result.pageNum)
                        ?.annotations.find((a) => a.id === result.annotationId);
                      if (ann) setSelectedAnnotation(ann);
                    }
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f0f7ff';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.backgroundColor = 'white';
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#1a3a5c',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    第 {result.pageNum} 页
                    {result.annotationId && ' (注解)'}
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#555',
                      lineHeight: 1.5,
                    }}
                  >
                    {result.text}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {selectedAnnotation && (
        <div style={noteSectionStyle}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#1a3a5c',
              }}
            >
              ✏️ 编辑笔记
            </span>
            <button
              onClick={() => deleteAnnotation(selectedAnnotation.id, selectedAnnotation.pageNum)}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: 'none',
                backgroundColor: '#fed7d7',
                color: '#c53030',
                cursor: 'pointer',
                fontSize: '12px',
                transition: 'background-color 0.2s',
              }}
            >
              🗑️ 删除
            </button>
          </div>

          <div style={{ backgroundColor: '#fffbeb', padding: '8px', borderRadius: '4px' }}>
            <div style={{ fontSize: '12px', color: '#92400e', marginBottom: '4px' }}>
              📌 选中文本:
            </div>
            <div style={{ fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>
              {selectedAnnotation.text}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={formatButtonStyle} onClick={() => applyFormat('bold')}>
              <strong>B</strong>
            </button>
            <button
              style={{ ...formatButtonStyle, fontStyle: 'italic' }}
              onClick={() => applyFormat('italic')}
            >
              I
            </button>
            <button style={formatButtonStyle} onClick={() => applyFormat('insertUnorderedList')}>
              • 列表
            </button>
            <button style={formatButtonStyle} onClick={() => applyFormat('insertOrderedList')}>
              1. 有序
            </button>
          </div>

          <div
            ref={noteEditorRef}
            contentEditable
            onInput={handleNoteInput}
            style={editorStyle}
            suppressContentEditableWarning
            data-placeholder="输入笔记内容..."
          />
        </div>
      )}
    </div>
  );
};

export default AnnotationPanel;
