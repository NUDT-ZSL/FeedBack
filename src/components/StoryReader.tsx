import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { stories } from '../data/stories';
import { ChapterSidebar } from './ChapterSidebar';
import { Paragraph } from './Paragraph';
import { RatingModule } from './RatingModule';
import { ProgressBar } from './ProgressBar';
import { useReadingProgress } from '../hooks/useReadingProgress';

export const StoryReader: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const progress = useReadingProgress();

  const story = stories.find(s => s.id === id);
  const [currentChapterId, setCurrentChapterId] = useState<string>(
    story?.chapters[0]?.id || ''
  );
  const [isExiting, setIsExiting] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (story && !currentChapterId) {
      setCurrentChapterId(story.chapters[0]?.id || '');
    }
  }, [story, currentChapterId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentChapterId]);

  const handleBack = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      navigate('/');
    }, 300);
  }, [navigate]);

  const handleChapterChange = useCallback((chapterId: string) => {
    setCurrentChapterId(chapterId);
    setIsMobileSidebarOpen(false);
  }, []);

  if (!story) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: '#666'
        }}
      >
        <p>故事不存在</p>
      </div>
    );
  }

  const currentChapter = story.chapters.find(c => c.id === currentChapterId);

  if (!currentChapter) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: '#666'
        }}
      >
        <p>章节不存在</p>
      </div>
    );
  }

  return (
    <>
      <ProgressBar progress={progress} />

      <div
        className={isExiting ? 'page-exit' : 'page-enter'}
        style={{
          minHeight: '100vh',
          paddingTop: '0'
        }}
      >
        <header
          style={{
            position: 'sticky',
            top: '4px',
            backgroundColor: 'rgba(250, 248, 245, 0.95)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 100,
            borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
            padding: '16px 0'
          }}
        >
          <div
            style={{
              maxWidth: '1200px',
              margin: '0 auto',
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px'
            }}
          >
            <button
              onClick={handleBack}
              aria-label="返回列表"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#fff',
                border: '1px solid #E5E5E5',
                fontSize: '14px',
                color: '#333',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#4A90D9';
                e.currentTarget.style.backgroundColor = 'rgba(74, 144, 217, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#E5E5E5';
                e.currentTarget.style.backgroundColor = '#fff';
              }}
            >
              <FiArrowLeft size={18} />
              返回
            </button>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h1
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#333',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {story.title}
              </h1>
              <p
                style={{
                  fontSize: '13px',
                  color: '#666',
                  margin: '2px 0 0 0'
                }}
              >
                作者：{story.author}
              </p>
            </div>

            <button
              onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
              aria-label="打开章节目录"
              style={{
                display: 'none',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#fff',
                border: '1px solid #E5E5E5',
                fontSize: '14px',
                color: '#333'
              }}
            >
              目录
            </button>
          </div>
        </header>

        <div
          style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '24px 20px',
            display: 'flex',
            gap: '0'
          }}
        >
          <div
            style={{
              display: 'block'
            }}
          >
            <ChapterSidebar
              chapters={story.chapters}
              currentChapterId={currentChapterId}
              onChapterChange={handleChapterChange}
            />
          </div>

          {isMobileSidebarOpen && (
            <div
              onClick={() => setIsMobileSidebarOpen(false)}
              style={{
                display: 'none',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                zIndex: 200
              }}
            />
          )}

          <article
            style={{
              flex: 1,
              minWidth: 0
            }}
          >
            <div
              style={{
                maxWidth: '800px',
                margin: '0 auto'
              }}
            >
              <h2
                style={{
                  fontSize: '28px',
                  fontWeight: 700,
                  color: '#333',
                  marginBottom: '8px',
                  textAlign: 'center'
                }}
              >
                {currentChapter.title}
              </h2>
              <p
                style={{
                  fontSize: '14px',
                  color: '#999',
                  textAlign: 'center',
                  marginBottom: '40px'
                }}
              >
                第 {story.chapters.findIndex(c => c.id === currentChapterId) + 1} 章 / 共 {story.chapters.length} 章
              </p>

              <div style={{ marginBottom: '24px' }}>
                {currentChapter.content.map((paragraph, index) => (
                  <Paragraph
                    key={index}
                    content={paragraph}
                    paragraphIndex={index}
                    storyId={story.id}
                    chapterId={currentChapter.id}
                  />
                ))}
              </div>

              <RatingModule
                storyId={story.id}
                chapterId={currentChapter.id}
                baseAverage={currentChapter.averageRating}
                baseRatingCount={currentChapter.ratingCount}
              />
            </div>
          </article>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          article {
            width: 95% !important;
            margin: 0 auto;
          }
        }
      `}</style>
    </>
  );
};
