import React, { useState, useMemo, useCallback } from 'react';
import { FiSearch, FiArrowDown, FiArrowUp } from 'react-icons/fi';
import { StoryCard } from './StoryCard';
import { stories } from '../data/stories';
import type { SortOrder } from '../types';

export const StoryList: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setTimeout(() => {
      setDebouncedQuery(value);
    }, 200);
  }, []);

  const toggleSortOrder = useCallback(() => {
    setSortOrder(prev => (prev === 'newest' ? 'oldest' : 'newest'));
  }, []);

  const filteredAndSortedStories = useMemo(() => {
    let result = [...stories];

    if (debouncedQuery.trim()) {
      const query = debouncedQuery.toLowerCase();
      result = result.filter(
        story =>
          story.title.toLowerCase().includes(query) ||
          story.author.toLowerCase().includes(query)
      );
    }

    result.sort((a, b) => {
      const dateA = new Date(a.publishedAt).getTime();
      const dateB = new Date(b.publishedAt).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [debouncedQuery, sortOrder]);

  const extendedStories = useMemo(() => {
    if (filteredAndSortedStories.length < 20) {
      const duplicates: typeof stories = [];
      const multiplier = Math.ceil(20 / filteredAndSortedStories.length);
      for (let i = 0; i < multiplier; i++) {
        duplicates.push(
          ...filteredAndSortedStories.map((story) => ({
            ...story,
            id: story.id,
            title: `${story.title}${i > 0 ? ` (${i + 1})` : ''}`
          }))
        );
      }
      return duplicates.slice(0, 20);
    }
    return filteredAndSortedStories;
  }, [filteredAndSortedStories]);

  return (
    <main
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '40px 20px',
        minHeight: '100vh'
      }}
    >
      <header style={{ marginBottom: '40px' }}>
        <h1
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: '#333',
            marginBottom: '8px',
            textAlign: 'center'
          }}
        >
          微小说阅读平台
        </h1>
        <p
          style={{
            fontSize: '16px',
            color: '#666',
            textAlign: 'center',
            marginBottom: '32px'
          }}
        >
          发现精彩故事，留下你的思考
        </p>

        <div
          style={{
            display: 'flex',
            gap: '16px',
            maxWidth: '600px',
            margin: '0 auto',
            flexWrap: 'wrap'
          }}
        >
          <div
            style={{
              position: 'relative',
              flex: 1,
              minWidth: '200px'
            }}
          >
            <FiSearch
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#999',
                fontSize: '18px'
              }}
            />
            <input
              type="text"
              placeholder="搜索故事标题或作者..."
              value={searchQuery}
              onChange={handleSearchChange}
              aria-label="搜索故事"
              style={{
                width: '100%',
                padding: '12px 16px 12px 44px',
                borderRadius: '8px',
                border: '1px solid #E5E5E5',
                backgroundColor: '#fff',
                fontSize: '14px',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#4A90D9';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#E5E5E5';
              }}
            />
          </div>

          <button
            onClick={toggleSortOrder}
            aria-label={sortOrder === 'newest' ? '按最新排序' : '按最早排序'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 20px',
              borderRadius: '8px',
              backgroundColor: '#fff',
              border: '1px solid #E5E5E5',
              fontSize: '14px',
              color: '#333',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
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
            {sortOrder === 'newest' ? (
              <>
                <FiArrowDown />
                最新发布
              </>
            ) : (
              <>
                <FiArrowUp />
                最早发布
              </>
            )}
          </button>
        </div>
      </header>

      {extendedStories.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '80px 20px',
            color: '#999'
          }}
        >
          <p style={{ fontSize: '18px' }}>没有找到匹配的故事</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>试试其他关键词吧</p>
        </div>
      ) : (
        <div
          className="story-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '24px',
            alignItems: 'start'
          }}
        >
          {extendedStories.map((story, index) => (
            <StoryCard key={`${story.id}-${index}`} story={story} index={index} />
          ))}
        </div>
      )}
    </main>
  );
};
