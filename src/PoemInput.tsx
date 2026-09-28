import { useState, useEffect } from 'react';
import { parseImagery, traditionalColors, defaultPoem } from './utils/imagery';
import type { PoemData, ImageryMatch } from './types';

interface PoemInputProps {
  onRender: (matches: ImageryMatch[], poem: PoemData) => void;
  poemData: PoemData;
  setPoemData: (data: PoemData) => void;
}

export function PoemInput({ onRender, poemData, setPoemData }: PoemInputProps) {
  const [matches, setMatches] = useState<ImageryMatch[]>([]);

  useEffect(() => {
    const result = parseImagery(poemData.content);
    setMatches(result);
  }, [poemData.content]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPoemData({ ...poemData, title: e.target.value });
  };

  const handleAuthorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPoemData({ ...poemData, author: e.target.value });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPoemData({ ...poemData, content: e.target.value });
  };

  const handleRender = () => {
    const result = parseImagery(poemData.content);
    setMatches(result);
    onRender(result, poemData);
  };

  const handleLoadExample = () => {
    setPoemData(defaultPoem);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-content">
        <h2 className="section-title">诗词输入</h2>

        <div className="poem-meta">
          <input
            type="text"
            placeholder="诗词标题"
            value={poemData.title}
            onChange={handleTitleChange}
          />
          <input
            type="text"
            placeholder="作者"
            value={poemData.author}
            onChange={handleAuthorChange}
          />
        </div>

        <textarea
          className="poem-textarea"
          placeholder="请输入诗词内容，支持繁体自动转换..."
          value={poemData.content}
          onChange={handleContentChange}
        />

        <button className="render-btn" onClick={handleRender}>
          渲染意境
        </button>

        <button
          style={{
            width: '100%',
            padding: '8px',
            marginTop: '10px',
            background: 'transparent',
            color: '#cc3d0f',
            border: '1px solid rgba(204, 61, 15, 0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: "'ZCOOL XiaoWei', serif",
            transition: 'all 0.2s',
          }}
          onClick={handleLoadExample}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(204, 61, 15, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          加载示例诗词
        </button>

        {matches.length > 0 && (
          <>
            <h3 className="section-title" style={{ marginTop: '20px', fontSize: '16px' }}>
              识别意象 ({matches.length})
            </h3>
            <div className="imagery-tags">
              {matches.map((match, index) => (
                <span
                  key={index}
                  className="imagery-tag"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {match.keyword}
                </span>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: '20px' }}>
          <h3 className="section-title" style={{ fontSize: '16px' }}>传统色板</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
            {traditionalColors.map((color) => (
              <div key={color.name} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: color.value,
                    margin: '0 auto 4px',
                    border: '2px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#666' }}>{color.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
