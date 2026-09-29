import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import { FiMessageCircle } from 'react-icons/fi';
import { useAppContext } from '../context/AppContext';

interface ParagraphProps {
  content: string;
  paragraphIndex: number;
  storyId: string;
  chapterId: string;
}

export const Paragraph = memo(function Paragraph({
  content,
  paragraphIndex,
  storyId,
  chapterId
}: ParagraphProps) {
  const { addAnnotation, getAnnotations, hasAnnotation, showToast } = useAppContext();
  const [showInput, setShowInput] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasAnno = hasAnnotation(storyId, chapterId, paragraphIndex);
  const annotations = getAnnotations(storyId, chapterId, paragraphIndex);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const handleSubmit = useCallback(() => {
    if (annotationText.trim()) {
      addAnnotation({
        storyId,
        chapterId,
        paragraphIndex,
        content: annotationText.trim()
      });
      setAnnotationText('');
      setShowInput(false);
      showToast('批注已提交，感谢您的反馈！');
    }
  }, [annotationText, storyId, chapterId, paragraphIndex, addAnnotation, showToast]);

  const handleCancel = useCallback(() => {
    setShowInput(false);
    setAnnotationText('');
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    },
    [handleSubmit, handleCancel]
  );

  return (
    <div
      style={{
        position: 'relative',
        marginBottom: '12px'
      }}
    >
      <p
        style={{
          fontFamily: 'Georgia, "Times New Roman", Times, serif',
          fontSize: '17px',
          lineHeight: 1.8,
          color: '#333',
          textIndent: '2em',
          paddingRight: '48px'
        }}
      >
        {content}
      </p>

      <button
        onClick={() => setShowInput(!showInput)}
        aria-label="添加批注"
        style={{
          position: 'absolute',
          right: 0,
          top: '4px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          color: '#999',
          backgroundColor: 'transparent',
          transition: 'all 0.2s ease',
          border: 'none',
          cursor: 'pointer',
          padding: 0
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#4A90D9';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#999';
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        <FiMessageCircle size={18} />
      </button>

      {hasAnno && (
        <>
          <div
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
            style={{
              position: 'absolute',
              right: '10px',
              top: '12px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#4A90D9',
              cursor: 'pointer',
              animation: 'pulse 1.5s ease-in-out infinite',
              transformOrigin: 'center'
            }}
            aria-label={`有${annotations.length}条批注`}
          />
          {showTooltip && (
            <div
              style={{
                position: 'absolute',
                right: '24px',
                top: '0',
                minWidth: '200px',
                maxWidth: '280px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: '#fff',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                zIndex: 100,
                animation: 'fadeIn 0.2s ease forwards',
                opacity: 0
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#4A90D9',
                  marginBottom: '6px'
                }}
              >
                读者批注 ({annotations.length})
              </div>
              {annotations.map((anno) => (
                <p
                  key={anno.id}
                  style={{
                    fontSize: '13px',
                    color: '#333',
                    lineHeight: 1.5,
                    marginBottom: '4px'
                  }}
                >
                  "{anno.content}"
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {showInput && (
        <div
          style={{
            marginTop: '12px',
            padding: '16px',
            backgroundColor: '#fff',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
            animation: 'fadeIn 0.3s ease forwards',
            opacity: 0,
            marginRight: '48px'
          }}
        >
          <textarea
            ref={inputRef}
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value.slice(0, 150))}
            onKeyDown={handleKeyDown}
            placeholder="写下你对这段文字的想法... (Ctrl+Enter 提交)"
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #E5E5E5',
              fontSize: '14px',
              lineHeight: 1.5,
              resize: 'vertical',
              transition: 'border-color 0.2s ease',
              fontFamily: 'inherit'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#4A90D9';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#E5E5E5';
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '12px'
            }}
          >
            <span
              style={{
                fontSize: '12px',
                color: annotationText.length > 140 ? '#F44336' : '#999'
              }}
            >
              {annotationText.length}/150
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleCancel}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid #E5E5E5',
                  backgroundColor: '#fff',
                  fontSize: '13px',
                  color: '#666',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#fff';
                }}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!annotationText.trim()}
                style={{
                  padding: '8px 20px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: annotationText.trim() ? '#4A90D9' : '#B0B0B0',
                  fontSize: '13px',
                  color: '#fff',
                  fontWeight: 500,
                  transition: 'background-color 0.2s ease',
                  cursor: annotationText.trim() ? 'pointer' : 'not-allowed'
                }}
                onMouseEnter={(e) => {
                  if (annotationText.trim()) {
                    e.currentTarget.style.backgroundColor = '#2C6BB0';
                  }
                }}
                onMouseLeave={(e) => {
                  if (annotationText.trim()) {
                    e.currentTarget.style.backgroundColor = '#4A90D9';
                  }
                }}
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
