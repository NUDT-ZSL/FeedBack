import { memo } from 'react';
import type { Chapter } from '../types';

interface ChapterSidebarProps {
  chapters: Chapter[];
  currentChapterId: string;
  onChapterChange: (chapterId: string) => void;
}

export const ChapterSidebar = memo(function ChapterSidebar({
  chapters,
  currentChapterId,
  onChapterChange
}: ChapterSidebarProps) {
  return (
    <aside
      style={{
        width: '240px',
        flexShrink: 0,
        paddingRight: '24px'
      }}
      role="navigation"
      aria-label="章节目录"
    >
      <div
        style={{
          position: 'sticky',
          top: '24px'
        }}
      >
        <h3
          style={{
            fontSize: '16px',
            fontWeight: 600,
            color: '#333',
            marginBottom: '16px',
            paddingBottom: '12px',
            borderBottom: '1px solid #E5E5E5'
          }}
        >
          章节目录
        </h3>
        <nav>
          <ul style={{ listStyle: 'none' }}>
            {chapters.map((chapter, index) => {
              const isActive = chapter.id === currentChapterId;
              return (
                <li key={chapter.id} style={{ marginBottom: '4px' }}>
                  <button
                    onClick={() => onChapterChange(chapter.id)}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      position: 'relative',
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      color: isActive ? '#fff' : '#333',
                      backgroundColor: isActive ? '#4A90D9' : 'transparent',
                      transition: 'all 0.2s ease',
                      border: 'none',
                      cursor: 'pointer',
                      lineHeight: 1.5
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'rgba(74, 144, 217, 0.08)';
                        const indicator = e.currentTarget.querySelector('.chapter-indicator') as HTMLElement;
                        if (indicator) {
                          indicator.style.height = '20px';
                        }
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        const indicator = e.currentTarget.querySelector('.chapter-indicator') as HTMLElement;
                        if (indicator) {
                          indicator.style.height = '0';
                        }
                      }
                    }}
                  >
                    {!isActive && (
                      <span
                        className="chapter-indicator"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          width: '2px',
                          height: '0',
                          backgroundColor: '#4A90D9',
                          transition: 'height 0.2s ease',
                          borderRadius: '2px',
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                    <span
                      style={{
                        display: 'inline-block',
                        marginRight: '8px',
                        opacity: isActive ? 0.9 : 0.6,
                        fontSize: '12px'
                      }}
                    >
                      第{index + 1}章
                    </span>
                    <br />
                    <span style={{ fontWeight: isActive ? 600 : 400 }}>
                      {chapter.title.replace(/^第[一二三四五六七八九十]+章\s*/, '')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
});
