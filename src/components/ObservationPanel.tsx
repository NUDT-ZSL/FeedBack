import React, { useState, useMemo } from 'react';
import { useStar } from '../context/StarContext';
import { SHICHEN } from '../types';
import { formatTime, hourToShichen } from '../utils';

const VirtualScroll: React.FC<{
  items: any[];
  itemHeight: number;
  visibleCount: number;
  renderItem: (item: any, index: number) => React.ReactNode;
}> = ({ items, itemHeight, visibleCount, renderItem }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerHeight = visibleCount * itemHeight;
  const totalHeight = items.length * itemHeight;

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
  const endIndex = Math.min(items.length, startIndex + visibleCount + 2);

  const visibleItems = useMemo(() => {
    return items.slice(startIndex, endIndex).map((item, i) => ({
      item,
      index: startIndex + i,
      offset: (startIndex + i) * itemHeight,
    }));
  }, [items, startIndex, endIndex, itemHeight]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  return (
    <div
      style={{
        height: containerHeight,
        overflowY: 'auto',
        position: 'relative',
      }}
      className="scrollbar-thin"
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map(({ item, index, offset }) => (
          <div
            key={item.id || index}
            style={{
              position: 'absolute',
              top: offset,
              width: '100%',
              height: itemHeight,
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
};

const ObservationPanel: React.FC<{ isMobile?: boolean }> = ({ isMobile = false }) => {
  const { records, deleteRecord, clearRecords, currentHour, ra, dec } = useStar();
  const shichenIndex = hourToShichen(currentHour);

  const renderRecord = (record: any) => {
    const recordShichen = hourToShichen(record.hour);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(74, 44, 26, 0.15)',
          gap: '10px',
          minHeight: '50px',
        }}
      >
        <div
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: record.starColor,
            boxShadow: `0 0 6px ${record.starColor}`,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#4a2c1a',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>{record.starName}</span>
            <span style={{ fontSize: '11px', color: '#8b6914', fontWeight: 400 }}>
              {record.time} {SHICHEN[recordShichen]}时
            </span>
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
            赤经 {record.ra.toFixed(1)}° | 赤纬 {record.dec.toFixed(1)}°
          </div>
        </div>
        <button
          onClick={() => deleteRecord(record.id)}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: 'transparent',
            color: '#666',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            transition: 'all 0.3s ease',
            flexShrink: 0,
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#cc0000';
            e.currentTarget.style.color = 'white';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = '#666';
          }}
        >
          ×
        </button>
      </div>
    );
  };

  if (isMobile) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: '100px',
          background: 'linear-gradient(180deg, rgba(245, 230, 200, 0.95) 0%, #f5e6c8 100%)',
          borderTop: '2px solid #8b6914',
          padding: '8px 12px',
          backdropFilter: 'blur(10px)',
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <span style={{
            fontFamily: "'Noto Serif SC', serif",
            fontSize: '16px',
            fontWeight: 700,
            color: '#4a2c1a',
          }}>
            观星日志
          </span>
          <span style={{ fontSize: '11px', color: '#8b6914' }}>{records.length}/50</span>
        </div>
        <div style={{
          display: 'flex',
          gap: '10px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
          className="scrollbar-thin"
        >
          {records.slice().reverse().map((record) => (
            <div
              key={record.id}
              style={{
                minWidth: '140px',
                padding: '8px',
                background: 'rgba(255, 255, 255, 0.5)',
                borderRadius: '8px',
                border: '1px solid rgba(139, 105, 20, 0.3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: record.starColor,
                  }}
                />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#4a2c1a' }}>
                  {record.starName}
                </span>
              </div>
              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                {record.time} | {record.ra.toFixed(0)}°/{record.dec.toFixed(0)}°
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <div style={{ color: '#999', fontSize: '12px', padding: '20px', textAlign: 'center', width: '100%' }}>
              暂无观测记录
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        width: '260px',
        height: '100vh',
        background: `
          linear-gradient(180deg, rgba(245, 230, 200, 0.98) 0%, #f5e6c8 100%)
        `,
        borderLeft: '2px solid #8b6914',
        boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: '2px solid rgba(139, 105, 20, 0.3)',
          background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(139, 105, 20, 0.03) 10px, rgba(139, 105, 20, 0.03) 20px)',
        }}
      >
        <h1 style={{
          fontFamily: "'Noto Serif SC', serif",
          fontSize: '28px',
          fontWeight: 700,
          color: '#4a2c1a',
          textAlign: 'center',
          textShadow: '1px 1px 2px rgba(139, 105, 20, 0.3)',
          margin: 0,
        }}>
          观星日志
        </h1>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '12px',
          fontSize: '12px',
        }}>
          <span style={{ color: '#8b6914' }}>
            当前：{formatTime(currentHour)} {SHICHEN[shichenIndex]}时
          </span>
          <span style={{ color: '#666' }}>{records.length}/50</span>
        </div>
        <div style={{
          fontSize: '11px',
          color: '#666',
          marginTop: '4px',
          fontFamily: 'monospace',
        }}>
          赤经: {ra.toFixed(1)}° | 赤纬: {dec.toFixed(1)}°
        </div>
      </div>

      {records.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(139, 105, 20, 0.2)' }}>
          <button
            onClick={clearRecords}
            style={{
              width: '100%',
              padding: '6px',
              border: '1px solid #8b6914',
              background: 'transparent',
              color: '#8b6914',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              transition: 'all 0.3s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#8b6914';
              e.currentTarget.style.color = 'white';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#8b6914';
            }}
          >
            清空记录
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {records.length > 0 ? (
          <VirtualScroll
            items={records.slice().reverse()}
            itemHeight={50}
            visibleCount={15}
            renderItem={renderRecord}
          />
        ) : (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: '#999',
            fontSize: '14px',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.3 }}>
              ✦
            </div>
            暂无观测记录
            <div style={{ fontSize: '11px', marginTop: '8px', color: '#aaa' }}>
              点击星体后按"记录"按钮保存
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ObservationPanel;
