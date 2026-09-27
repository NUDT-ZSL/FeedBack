import { useState, useEffect, useMemo } from 'react';
import EventCard from './EventCard';
import type { TravelEvent, FilterParams } from '../api/travelApi';

interface TimelineProps {
  events: TravelEvent[];
  selectedEventId: string | null;
  exportSelectedIds: string[];
  onToggleExportSelect: (id: string) => void;
  onEventDoubleClick: (event: TravelEvent) => void;
  onAddEvent: () => void;
  onFilterChange: (params: FilterParams) => void;
  currentFilter: FilterParams;
  onClearFilter: () => void;
}

export default function Timeline({
  events,
  selectedEventId,
  exportSelectedIds,
  onToggleExportSelect,
  onEventDoubleClick,
  onAddEvent,
  onFilterChange,
  currentFilter,
  onClearFilter,
}: TimelineProps) {
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const { years, countries, availableTags } = useMemo(() => {
    const ys = new Set<string>();
    const cs = new Set<string>();
    const ts = new Set<string>();
    events.forEach((e) => {
      ys.add(e.date.slice(0, 4));
      cs.add(e.country);
      e.tags.forEach((t) => ts.add(t));
    });
    return {
      years: Array.from(ys).sort((a, b) => Number(b) - Number(a)),
      countries: Array.from(cs).sort(),
      availableTags: Array.from(ts).sort(),
    };
  }, [events]);

  const allTags = ['美食', '风景', '人文'];

  const FilterContent = () => (
    <div style={{ padding: '20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#333' }}>筛选</h3>
        {(currentFilter.year || currentFilter.country || currentFilter.tag) && (
          <button
            onClick={onClearFilter}
            style={{
              fontSize: '12px',
              color: '#4A90D9',
              padding: '4px 10px',
              borderRadius: '12px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#E8F0FB')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            清除筛选
          </button>
        )}
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
          按年份
        </label>
        <select
          value={currentFilter.year || ''}
          onChange={(e) => onFilterChange({ ...currentFilter, year: e.target.value || undefined })}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #E8E0D8',
            borderRadius: '8px',
            fontSize: '14px',
            background: '#fff',
            color: '#333',
          }}
        >
          <option value="">全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
          按国家
        </label>
        <select
          value={currentFilter.country || ''}
          onChange={(e) => onFilterChange({ ...currentFilter, country: e.target.value || undefined })}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #E8E0D8',
            borderRadius: '8px',
            fontSize: '14px',
            background: '#fff',
            color: '#333',
          }}
        >
          <option value="">全部国家</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
          按标签
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {allTags.map((tag) => {
            const active = currentFilter.tag === tag;
            return (
              <button
                key={tag}
                onClick={() =>
                  onFilterChange({
                    ...currentFilter,
                    tag: active ? undefined : tag,
                  })
                }
                style={{
                  padding: '6px 14px',
                  borderRadius: '16px',
                  fontSize: '13px',
                  border: '1px solid',
                  borderColor: active ? '#4A90D9' : '#E8E0D8',
                  background: active ? '#4A90D9' : '#fff',
                  color: active ? '#fff' : '#555',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = '#4A90D9';
                    e.currentTarget.style.color = '#4A90D9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.borderColor = '#E8E0D8';
                    e.currentTarget.style.color = '#555';
                  }
                }}
              >
                #{tag}
              </button>
            );
          })}
        </div>
        {availableTags.filter((t) => !allTags.includes(t)).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {availableTags
              .filter((t) => !allTags.includes(t))
              .map((tag) => {
                const active = currentFilter.tag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() =>
                      onFilterChange({
                        ...currentFilter,
                        tag: active ? undefined : tag,
                      })
                    }
                    style={{
                      padding: '6px 14px',
                      borderRadius: '16px',
                      fontSize: '13px',
                      border: '1px solid',
                      borderColor: active ? '#4A90D9' : '#E8E0D8',
                      background: active ? '#4A90D9' : '#fff',
                      color: active ? '#fff' : '#555',
                      transition: 'all 0.2s',
                    }}
                  >
                    #{tag}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <div style={{ padding: '12px', background: '#F5F0EB', borderRadius: '10px', fontSize: '12px', color: '#666', lineHeight: 1.6 }}>
        💡 <strong>使用提示</strong><br />
        · 单击卡片：展开/折叠内容<br />
        · 双击卡片：打开详情面板<br />
        · 勾选右上角：选择导出
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)' }}>
      {!isMobile && (
        <div
          style={{
            width: '240px',
            background: '#FAFAFA',
            borderRight: '1px solid #E8E0D8',
            flexShrink: 0,
            position: 'sticky',
            top: '60px',
            height: 'calc(100vh - 60px)',
            overflowY: 'auto',
          }}
        >
          <FilterContent />
        </div>
      )}

      {isMobile && isMobileFilterOpen && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              zIndex: 90,
              animation: 'fadeIn 0.3s',
            }}
            onClick={() => setIsMobileFilterOpen(false)}
          />
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              background: '#FAFAFA',
              zIndex: 100,
              maxHeight: '70vh',
              overflowY: 'auto',
              borderBottomLeftRadius: '16px',
              borderBottomRightRadius: '16px',
              animation: 'slideInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid #E8E0D8',
              }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 700 }}>筛选条件</h3>
              <button
                onClick={() => setIsMobileFilterOpen(false)}
                style={{ fontSize: '20px', color: '#666', padding: '4px' }}
              >
                ✕
              </button>
            </div>
            <FilterContent />
          </div>
        </>
      )}

      <div style={{ flex: 1, padding: isMobile ? '20px 10px' : '32px 24px', overflowY: 'auto' }}>
        <div
          style={{
            maxWidth: isMobile ? '100%' : '960px',
            margin: '0 auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#333', marginBottom: '4px' }}>
                {events.length > 0
                  ? `共 ${events.length} 段旅行记忆`
                  : '还没有旅行记忆'}
              </h2>
              {(currentFilter.year || currentFilter.country || currentFilter.tag) && (
                <p style={{ fontSize: '13px', color: '#4A90D9' }}>
                  已筛选：
                  {[
                    currentFilter.year && `${currentFilter.year}年`,
                    currentFilter.country,
                    currentFilter.tag && `#${currentFilter.tag}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {isMobile && (
                <button
                  onClick={() => setIsMobileFilterOpen(true)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '10px',
                    background: '#fff',
                    border: '1px solid #E8E0D8',
                    fontSize: '14px',
                    color: '#333',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  筛选
                </button>
              )}
              <button
                onClick={onAddEvent}
                style={{
                  padding: '10px 20px',
                  borderRadius: '10px',
                  background: '#4A90D9',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(74, 144, 217, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3A7BC8';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(74, 144, 217, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#4A90D9';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(74, 144, 217, 0.3)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加记忆
              </button>
            </div>
          </div>

          <div
            style={{
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: isMobile ? '15px' : '50%',
                top: 0,
                bottom: 0,
                width: '3px',
                background: 'linear-gradient(to bottom, #E8E0D8, #D0C8C0, #E8E0D8)',
                borderRadius: '2px',
                transform: isMobile ? 'none' : 'translateX(-50%)',
                zIndex: 0,
              }}
            />

            {events.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '80px 20px',
                  color: '#999',
                }}
              >
                <div style={{ fontSize: '64px', marginBottom: '16px' }}>🌍</div>
                <p style={{ fontSize: '16px', marginBottom: '8px' }}>还没有任何旅行记忆</p>
                <p style={{ fontSize: '13px' }}>点击"添加记忆"按钮，开始记录你的美好时光</p>
              </div>
            ) : (
              <div key={JSON.stringify(currentFilter) + events.length}
                style={{
                  position: 'relative',
                  zIndex: 1,
                  animation: 'fadeIn 0.5s ease',
                }}
              >
                {events.map((event, index) => (
                  <div
                    key={event.id}
                    style={{
                      position: 'relative',
                      paddingLeft: isMobile ? '40px' : 0,
                      marginBottom: '4px',
                    }}
                  >
                    {isMobile && (
                      <div
                        style={{
                          position: 'absolute',
                          left: '7px',
                          top: '32px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#4A90D9',
                          border: '3px solid #fff',
                          boxShadow: '0 2px 6px rgba(74, 144, 217, 0.4)',
                          zIndex: 2,
                        }}
                      />
                    )}
                    <EventCard
                      event={event}
                      index={index}
                      isSelected={selectedEventId === event.id}
                      isExportSelected={exportSelectedIds.includes(event.id)}
                      onToggleExport={onToggleExportSelect}
                      onDoubleClick={onEventDoubleClick}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
