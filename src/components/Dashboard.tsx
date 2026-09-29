import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ClothingItem, OutfitRecord, CATEGORY_COLORS, CATEGORY_LABELS } from '../types';
import { useLocalStorage, generateId } from '../hooks/useLocalStorage';
import { useRecommendation } from '../hooks/useRecommendation';
import { ClosetManager } from './ClosetManager';
import { OutfitRecorder } from './OutfitRecorder';
import { StyleAnalyzer } from './StyleAnalyzer';
import {
  LayoutDashboard,
  Shirt,
  CalendarDays,
  BarChart3,
  Menu,
  X,
  Download,
  Sparkles,
  LogIn,
} from 'lucide-react';

type PageType = 'dashboard' | 'closet' | 'records' | 'analysis';

const STORAGE_KEYS = {
  ITEMS: 'outfit-items',
  RECORDS: 'outfit-records',
};

const SAMPLE_ITEMS: ClothingItem[] = [
  {
    id: generateId(),
    name: '白色基础T恤',
    category: 'top',
    color: '#FFFFFF',
    styleTags: ['休闲', '通勤'],
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: generateId(),
    name: '蓝色牛仔裤',
    category: 'bottom',
    color: '#4169E1',
    styleTags: ['休闲', '街头'],
    createdAt: Date.now() - 86400000 * 25,
  },
  {
    id: generateId(),
    name: '黑色西装外套',
    category: 'outerwear',
    color: '#000000',
    styleTags: ['通勤', '复古'],
    createdAt: Date.now() - 86400000 * 20,
  },
  {
    id: generateId(),
    name: '白色运动鞋',
    category: 'shoes',
    color: '#FFFFFF',
    styleTags: ['休闲', '运动'],
    createdAt: Date.now() - 86400000 * 15,
  },
  {
    id: generateId(),
    name: '灰色毛衣',
    category: 'top',
    color: '#808080',
    styleTags: ['休闲', '复古'],
    createdAt: Date.now() - 86400000 * 10,
  },
  {
    id: generateId(),
    name: '黑色休闲裤',
    category: 'bottom',
    color: '#000000',
    styleTags: ['通勤', '休闲'],
    createdAt: Date.now() - 86400000 * 8,
  },
];

const SAMPLE_RECORDS: OutfitRecord[] = [
  {
    id: generateId(),
    date: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0],
    topId: '',
    bottomId: '',
    rating: 5,
    note: '今天天气很好，穿得很舒服',
    accessoryIds: [],
    createdAt: Date.now() - 86400000 * 2,
  },
  {
    id: generateId(),
    date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    topId: '',
    bottomId: '',
    rating: 4,
    note: '通勤穿搭，很干练',
    accessoryIds: [],
    createdAt: Date.now() - 86400000,
  },
];

export const Dashboard: React.FC = () => {
  const [items, setItems] = useLocalStorage<ClothingItem[]>(STORAGE_KEYS.ITEMS, SAMPLE_ITEMS);
  const [records, setRecords] = useLocalStorage<OutfitRecord[]>(STORAGE_KEYS.RECORDS, SAMPLE_RECORDS);
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const recommendation = useRecommendation(items, records);

  useEffect(() => {
    if (items.length >= 2 && records.length < 2) {
      const sampleRecordsWithIds: OutfitRecord[] = [
        {
          id: generateId(),
          date: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0],
          topId: items[0]?.id,
          bottomId: items[1]?.id,
          shoesId: items[3]?.id,
          rating: 5,
          note: '今天天气很好，穿得很舒服',
          accessoryIds: [],
          createdAt: Date.now() - 86400000 * 2,
        },
        {
          id: generateId(),
          date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
          topId: items[4]?.id,
          bottomId: items[5]?.id,
          outerwearId: items[2]?.id,
          rating: 4,
          note: '通勤穿搭，很干练',
          accessoryIds: [],
          createdAt: Date.now() - 86400000,
        },
      ];
      setRecords(sampleRecordsWithIds);
    }
  }, []);

  const handleExportData = useCallback(() => {
    if (isExporting) return;

    setIsExporting(true);
    setExportProgress(0);

    const interval = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + 10;
      });
    }, 100);

    setTimeout(() => {
      const data = {
        items,
        records,
        exportedAt: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `outfit-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 300);
    }, 1000);
  }, [items, records, isExporting]);

  const handleUseRecommendation = useCallback(() => {
    if (!recommendation) return;

    const topItem = recommendation.items.find(i => i.category === 'top');
    const bottomItem = recommendation.items.find(i => i.category === 'bottom');
    const outerwearItem = recommendation.items.find(i => i.category === 'outerwear');
    const shoesItem = recommendation.items.find(i => i.category === 'shoes');

    const today = new Date().toISOString().split('T')[0];
    const newRecord: OutfitRecord = {
      id: generateId(),
      date: today,
      topId: topItem?.id,
      bottomId: bottomItem?.id,
      outerwearId: outerwearItem?.id,
      shoesId: shoesItem?.id,
      accessoryIds: [],
      rating: 0,
      note: '',
      createdAt: Date.now(),
    };

    setRecords([newRecord, ...records]);
    setCurrentPage('records');
  }, [recommendation, records, setRecords]);

  const renderItemThumbnail = (item: ClothingItem, size: number = 60) => {
    if (item.photoUrl) {
      return (
        <img
          src={item.photoUrl}
          alt={item.name}
          style={{
            width: size,
            height: size,
            borderRadius: '10px',
            objectFit: 'cover',
            border: `3px solid ${CATEGORY_COLORS[item.category]}`,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }

    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '10px',
          backgroundColor: item.color,
          border: `3px solid ${CATEGORY_COLORS[item.category]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          color: item.color === '#FFFFFF' || item.color === '#FFFF00' || item.color === '#FFD700' ? '#333' : 'white',
          fontWeight: 600,
        }}
      >
        {CATEGORY_LABELS[item.category].charAt(0)}
      </div>
    );
  };

  const navItems: { id: PageType; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: '仪表盘', icon: <LayoutDashboard size={20} /> },
    { id: 'closet', label: '衣柜管理', icon: <Shirt size={20} /> },
    { id: 'records', label: '穿搭记录', icon: <CalendarDays size={20} /> },
    { id: 'analysis', label: '风格分析', icon: <BarChart3 size={20} /> },
  ];

  const handleNavClick = (page: PageType) => {
    setCurrentPage(page);
    setMobileMenuOpen(false);
  };

  const renderDashboardContent = () => (
    <div className="dashboard-content fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>
          你好，时尚达人 👋
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>
          今天想穿什么？让我来帮你搭配吧
        </p>
      </div>

      <div
        className="recommendation-card"
        style={{
          background: 'linear-gradient(135deg, var(--color-accent), #E74C3C)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px',
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(192, 57, 43, 0.3)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-40px',
            right: '-40px',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-30px',
            left: '-30px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Sparkles size={20} />
            <span style={{ fontSize: '14px', fontWeight: 500, opacity: 0.9 }}>今日推荐搭配</span>
          </div>

          {recommendation ? (
            <>
              <p style={{ fontSize: '16px', marginBottom: '20px', opacity: 0.9 }}>
                {recommendation.reason}
              </p>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
                {recommendation.items.map(item => (
                  <div key={item.id} style={{ textAlign: 'center' }}>
                    <div
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        padding: '8px',
                        borderRadius: '14px',
                        marginBottom: '6px',
                      }}
                    >
                      {renderItemThumbnail(item, 56)}
                    </div>
                    <span style={{ fontSize: '12px', opacity: 0.9 }}>{item.name}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleUseRecommendation}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 24px',
                  backgroundColor: 'white',
                  color: 'var(--color-accent)',
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 600,
                  fontSize: '14px',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <LogIn size={18} />
                一键使用
              </button>
            </>
          ) : (
            <p style={{ fontSize: '16px', marginBottom: '20px', opacity: 0.9 }}>
              先去衣柜添加一些衣物吧，我才能为你推荐搭配～
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--category-top)', marginBottom: '4px' }}>
            {items.length}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>件衣物</div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--category-bottom)', marginBottom: '4px' }}>
            {records.length}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>条记录</div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            padding: '20px',
            boxShadow: 'var(--shadow-sm)',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--category-outerwear)', marginBottom: '4px' }}>
            {new Set(items.flatMap(i => i.styleTags)).size}
          </div>
          <div style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>种风格</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <button
          onClick={() => setCurrentPage('closet')}
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            boxShadow: 'var(--shadow-sm)',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateX(8px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateX(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(74, 144, 217, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--category-top)',
            }}
          >
            <Shirt size={24} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '2px' }}>衣柜管理</div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-light)' }}>添加和管理你的衣物</div>
          </div>
        </button>

        <button
          onClick={() => setCurrentPage('analysis')}
          style={{
            backgroundColor: 'var(--color-white)',
            borderRadius: 'var(--radius-md)',
            padding: '24px',
            boxShadow: 'var(--shadow-sm)',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            transition: 'all var(--transition-normal)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateX(8px)';
            e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateX(0)';
            e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: 'rgba(155, 89, 182, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--category-shoes)',
            }}
          >
            <BarChart3 size={24} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '2px' }}>风格分析</div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-light)' }}>查看你的穿搭偏好</div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (currentPage) {
      case 'dashboard':
        return renderDashboardContent();
      case 'closet':
        return <ClosetManager items={items} onItemsChange={setItems} />;
      case 'records':
        return <OutfitRecorder items={items} records={records} onRecordsChange={setRecords} />;
      case 'analysis':
        return <StyleAnalyzer items={items} records={records} />;
      default:
        return renderDashboardContent();
    }
  };

  return (
    <div className="app-container" style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}
        style={{
          width: 'var(--nav-width)',
          backgroundColor: 'var(--color-nav-bg)',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 100,
          transition: 'transform var(--transition-normal)',
        }}
      >
        <div style={{ padding: '24px 20px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Shirt size={24} style={{ color: 'var(--color-accent)' }} />
            穿搭日记
          </h1>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 12px' }}>
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                color: currentPage === item.id ? 'white' : 'rgba(255, 255, 255, 0.7)',
                fontSize: '14px',
                fontWeight: currentPage === item.id ? 600 : 400,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: currentPage === item.id ? 'rgba(192, 57, 43, 0.2)' : 'transparent',
                borderLeft: currentPage === item.id ? '4px solid var(--color-accent)' : '4px solid transparent',
                transition: 'all var(--transition-fast)',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (currentPage !== item.id) {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== item.id) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <button
            onClick={handleExportData}
            disabled={isExporting}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              backgroundColor: isExporting ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.15)',
              color: 'white',
              borderRadius: 'var(--radius-sm)',
              fontSize: '14px',
              transition: 'all var(--transition-fast)',
              position: 'relative',
              overflow: 'hidden',
            }}
            onMouseEnter={(e) => {
              if (!isExporting) {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isExporting) {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
              }
            }}
          >
            {isExporting ? (
              <>
                <svg
                  style={{ width: '18px', height: '18px', animation: 'spin 1s linear infinite' }}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="8"
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="3"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="8"
                    stroke="white"
                    strokeWidth="3"
                    strokeDasharray={`${exportProgress * 0.5} 50`}
                    strokeLinecap="round"
                    transform="rotate(-90 12 12)"
                  />
                </svg>
                导出中...
              </>
            ) : (
              <>
                <Download size={18} />
                导出数据
              </>
            )}
          </button>
        </div>
      </nav>

      <div
        className="mobile-header"
        style={{
          display: 'none',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          backgroundColor: 'var(--color-nav-bg)',
          color: 'white',
          alignItems: 'center',
          padding: '0 16px',
          zIndex: 99,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        }}
      >
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{ color: 'white', padding: '8px' }}
        >
          <Menu size={24} />
        </button>
        <h1 style={{ fontSize: '18px', fontWeight: 700, marginLeft: '12px' }}>穿搭日记</h1>
      </div>

      {mobileMenuOpen && (
        <div
          className="mobile-overlay"
          style={{
            display: 'none',
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 98,
            animation: 'fadeIn var(--transition-fast) ease',
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <main
        ref={mainContentRef}
        className="main-content"
        style={{
          flex: 1,
          marginLeft: 'var(--nav-width)',
          padding: '32px',
          minHeight: '100vh',
          transition: 'margin-left var(--transition-normal)',
        }}
      >
        <div style={{ maxWidth: 'var(--content-max-width)', margin: '0 auto' }}>
          {renderContent()}
        </div>
      </main>

      <style>{`
        @media (max-width: 768px) {
          .sidebar {
            transform: translateX(-100%);
            padding-top: 56px;
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .mobile-header {
            display: flex !important;
          }
          .mobile-overlay {
            display: block !important;
          }
          .main-content {
            margin-left: 0 !important;
            padding: 72px 16px 16px !important;
          }
        }
      `}</style>
    </div>
  );
};
