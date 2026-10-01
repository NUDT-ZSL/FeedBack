import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import axios from 'axios';
import type { ThemeColor } from './types';
import { THEME_COLORS } from './types';
import ExhibitionBuilder from './ExhibitionBuilder';
import ExhibitionList from './ExhibitionList';
import ExhibitionView from './ExhibitionView';

const App: React.FC = () => {
  const navigate = useNavigate();

  const createExhibition = async (name: string, themeColor: ThemeColor, description: string) => {
    try {
      const res = await axios.post('/api/exhibitions', { name, themeColor, description });
      navigate(`/builder/${res.data.id}`);
      return res.data;
    } catch (err) {
      console.error('Failed to create exhibition:', err);
      throw err;
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Routes>
        <Route
          path="/"
          element={<HomePage onCreateExhibition={createExhibition} />}
        />
        <Route
          path="/builder/:id"
          element={<ExhibitionBuilder />}
        />
        <Route
          path="/exhibition/:id"
          element={<ExhibitionView />}
        />
        <Route
          path="/list"
          element={<ExhibitionList />}
        />
      </Routes>
    </div>
  );
};

interface HomePageProps {
  onCreateExhibition: (name: string, themeColor: ThemeColor, description: string) => Promise<void>;
}

const HomePage: React.FC<HomePageProps> = ({ onCreateExhibition }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<ThemeColor>(THEME_COLORS[0]);
  const [isCreating, setIsCreating] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    try {
      await onCreateExhibition(name.trim(), selectedTheme, description.trim());
    } catch (err) {
      setIsCreating(false);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        overflowY: 'auto'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
          backgroundColor: '#fff',
          borderRadius: '16px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
          padding: '40px',
          animation: 'slideUp 0.5s ease-out'
        }}
      >
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 700,
            color: '#2c2c2c',
            marginBottom: '8px',
            textAlign: 'center'
          }}
        >
          虚拟博物馆展览平台
        </h1>
        <p
          style={{
            fontSize: '15px',
            color: '#888',
            textAlign: 'center',
            marginBottom: '32px'
          }}
        >
          打造属于你的专属艺术展览
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                color: '#2c2c2c',
                marginBottom: '8px'
              }}
            >
              展览名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入展览名称"
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '15px',
                outline: 'none',
                transition: 'border-color 0.2s ease-out',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => (e.target.style.borderColor = selectedTheme.primary)}
              onBlur={(e) => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                color: '#2c2c2c',
                marginBottom: '12px'
              }}
            >
              主题配色
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px'
              }}
            >
              {THEME_COLORS.map((theme) => (
                <div
                  key={theme.id}
                  onClick={() => setSelectedTheme(theme)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: selectedTheme.id === theme.id ? `2px solid ${theme.primary}` : '2px solid transparent',
                    backgroundColor: theme.background,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease-out',
                    transform: selectedTheme.id === theme.id ? 'scale(1.02)' : 'scale(1)'
                  }}
                >
                  <div
                    style={{
                      height: '24px',
                      borderRadius: '4px',
                      background: `linear-gradient(90deg, ${theme.primary} 0%, ${theme.secondary} 50%, ${theme.accent} 100%)`,
                      marginBottom: '8px'
                    }}
                  />
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#2c2c2c',
                      textAlign: 'center',
                      fontWeight: 500
                    }}
                  >
                    {theme.name}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '32px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: 600,
                color: '#2c2c2c',
                marginBottom: '8px'
              }}
            >
              一句话简介
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="用一句话描述你的展览"
              rows={2}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '15px',
                outline: 'none',
                resize: 'none',
                transition: 'border-color 0.2s ease-out',
                boxSizing: 'border-box',
                fontFamily: 'inherit'
              }}
              onFocus={(e) => (e.target.style.borderColor = selectedTheme.primary)}
              onBlur={(e) => (e.target.style.borderColor = '#ddd')}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: selectedTheme.primary,
                color: '#fff',
                fontSize: '16px',
                fontWeight: 600,
                cursor: isCreating || !name.trim() ? 'not-allowed' : 'pointer',
                opacity: isCreating || !name.trim() ? 0.6 : 1,
                transition: 'all 0.2s ease-out'
              }}
              onMouseEnter={(e) => {
                if (!isCreating && name.trim()) {
                  e.currentTarget.style.filter = 'brightness(1.15)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'brightness(1)';
              }}
              onMouseDown={(e) => {
                if (!isCreating && name.trim()) {
                  e.currentTarget.style.transform = 'scale(0.95)';
                }
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {isCreating ? '创建中...' : '创建展览'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/list')}
              style={{
                padding: '14px 24px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                color: '#2c2c2c',
                fontSize: '16px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease-out'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f5f0e8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
              }}
            >
              浏览展览
            </button>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 768px) {
          form > div:nth-child(3) > div {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </div>
  );
};

export default App;
